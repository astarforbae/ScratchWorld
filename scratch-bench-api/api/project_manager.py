"""
Project management operations for the Scratch GUI Agent API.
"""
import os
import base64
import shutil
import logging
from pathlib import Path
from fastapi import HTTPException
from typing import Optional
from playwright.async_api import Page

logger = logging.getLogger("scratch_bench_api")


class ProjectManager:
    def __init__(self):
        self.benchmark_dir = Path(__file__).resolve().parents[2]
        self.static_dir = self.benchmark_dir / "scratch-gui/static"
        self.output_dir = self.benchmark_dir / "output"
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.page: Optional[Page] = None

    def set_page(self, page: Page):
        """Inject the Playwright Page so we can run JS in the GUI context."""
        self.page = page

    async def load_project(self, project_name: str) -> dict:
        """加载指定的初始项目文件：在浏览器中执行 JS，使用 vm.loadProject 加载 /static 下的 sb3。

        新方案来自 docs/use-api-for-composite.md：通过 fetch 读取 sb3 的 ArrayBuffer 并调用 vm.loadProject。
        会在指定项目加载失败时回退到 party.sb3。
        """
        try:
            if not self.page:
                raise HTTPException(status_code=500, detail="ProjectManager page is not set. Call set_page(page) after browser startup.")

            # 先做存在性提示（非强制），便于日志定位
            source_path = self.static_dir / project_name
            logger.debug("尝试通过 JS 加载项目: %s", project_name)
            logger.debug("静态文件期望路径: %s", source_path)

            # 在页面上下文执行 js 加载
            js = """
            async (projectName) => {
              const vm = (window.vm) || (window.Scratch && window.Scratch.vm);
              if (!vm) throw new Error('Scratch VM not found on page');

              // Always use same-origin static path to avoid localhost vs 127.0.0.1
              // cross-origin issues in browser fetch.
              const base = '/static/';

              async function tryLoad(name) {
                const url = base + encodeURIComponent(name);
                try {
                  const res = await fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
                  if (!res.ok) return { ok: false, status: res.status, url };
                  const buf = await res.arrayBuffer();
                  await vm.loadProject(buf);
                  // 触发 UI 同步（可选）
                  if (typeof vm.emitWorkspaceUpdate === 'function') vm.emitWorkspaceUpdate();
                  return { ok: true, url };
                } catch (e) {
                  return { ok: false, error: String(e), url };
                }
              }

              const primary = await tryLoad(projectName);
              if (primary.ok) {
                return primary;
              }

              const fallback = await tryLoad('party.sb3');
              if (!fallback.ok) {
                throw new Error(
                  'Failed to load both ' + projectName + ' and party.sb3' +
                  ' | primary=' + JSON.stringify(primary) +
                  ' | fallback=' + JSON.stringify(fallback)
                );
              }
              fallback.fallback = true;
              fallback.primary = primary;
              return fallback;
            }
            """

            res = await self.page.evaluate(js, project_name)

            # 轻微等待，给前端渲染一些时间
            try:
                import asyncio
                await asyncio.sleep(0.3)
            except Exception:
                pass

            msg = (
                f"已通过 vm.loadProject 加载: {res.get('url')}"
                + (" (fallback: party.sb3)" if res.get("fallback") else "")
            )
            logger.debug("已通过 vm.loadProject 加载: %s%s", res.get("url"), " (fallback: party.sb3)" if res.get("fallback") else "")
            return {"status": "success", "message": msg, "details": res}

        except HTTPException:
            raise
        except Exception as e:
            logger.exception("加载项目失败(JS): %s", str(e))
            raise HTTPException(status_code=500, detail=str(e))

    async def export_project(self, output_name: str) -> dict:
        """导出当前项目（直接返回文件内容）
        返回:
          {
            "status": "success",
            "filename": output_name,
            "size": <int>,
            "data_base64": <str>  # sb3文件的Base64编码
          }
        由调用方（如 task_runner）负责将其保存到目标路径。
        """
        try:
            if not self.page:
                raise HTTPException(status_code=500, detail="ProjectManager page is not set. Call set_page(page) after browser startup.")

            # 在页面上下文通过 vm.saveProjectSb3() 获取项目数据（兼容 Blob / ArrayBuffer / TypedArray）
            js = """
            async () => {
              const vm = (window.vm) || (window.Scratch && window.Scratch.vm);
              if (!vm) throw new Error('Scratch VM not found on page');
              // Give the VM a brief moment in case there are pending changes
              await new Promise(r => setTimeout(r, 50));
              const project = await vm.saveProjectSb3();
              let buffer;
              try {
                if (!project) throw new Error('saveProjectSb3 returned empty result');
                // If Blob (most common in browser)
                if (typeof Blob !== 'undefined' && project instanceof Blob) {
                  buffer = await project.arrayBuffer();
                } else if (project instanceof ArrayBuffer) {
                  buffer = project;
                } else if (ArrayBuffer.isView && ArrayBuffer.isView(project)) {
                  buffer = project.buffer;
                } else if (project && typeof project.arrayBuffer === 'function') {
                  buffer = await project.arrayBuffer();
                } else {
                  // Last resort: try to access .data
                  buffer = project.data || null;
                }
              } catch (e) {
                throw new Error('Failed to normalize project data: ' + (e && e.message ? e.message : String(e)));
              }
              if (!buffer) throw new Error('Unable to obtain project ArrayBuffer');
              const u8 = new Uint8Array(buffer);
              return Array.from(u8);
            }
            """

            data_list = await self.page.evaluate(js)
            if not isinstance(data_list, list) or not all(isinstance(x, int) for x in data_list):
                raise HTTPException(status_code=500, detail="Invalid project data returned from browser")

            data_bytes = bytes(data_list)
            if len(data_bytes) == 0:
                # Fallback: fetch the current project file from the GUI static path
                try:
                    fallback_js = """
                    async () => {
                      const url = '/static/current_project.sb3';
                      try {
                        const res = await fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
                        if (!res.ok) return { ok: false, status: res.status };
                        const buf = await res.arrayBuffer();
                        return { ok: true, bytes: Array.from(new Uint8Array(buf)) };
                      } catch (e) {
                        return { ok: false, error: String(e) };
                      }
                    }
                    """
                    fb = await self.page.evaluate(fallback_js)
                    if isinstance(fb, dict) and fb.get("ok") and isinstance(fb.get("bytes"), list):
                        data_bytes = bytes(fb["bytes"])  # replace with fallback bytes
                except Exception as _:
                    pass

            data_b64 = base64.b64encode(data_bytes).decode('utf-8')

            return {
                "status": "success",
                "filename": output_name,
                "size": len(data_bytes),
                "data_base64": data_b64
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    async def check_file(self, file_path: str) -> dict:
        """检查文件状态"""
        try:
            path = Path(file_path)
            
            result = {
                "exists": path.exists(),
                "is_file": path.is_file() if path.exists() else False,
                "is_dir": path.is_dir() if path.exists() else False,
                "permissions": {
                    "readable": os.access(file_path, os.R_OK) if path.exists() else False,
                    "writable": os.access(file_path, os.W_OK) if path.exists() else False,
                    "executable": os.access(file_path, os.X_OK) if path.exists() else False,
                },
            }
            
            if path.exists() and path.is_file():
                result["size"] = path.stat().st_size
                try:
                    result["owner"] = path.owner()
                except:
                    result["owner"] = "unknown"
                try:
                    result["group"] = path.group()
                except:
                    result["group"] = "unknown"
            
            if path.exists() and path.is_dir():
                try:
                    result["contents"] = [str(f.name) for f in path.iterdir()]
                except:
                    result["contents"] = ["Error listing directory contents"]
            
            return result
        except Exception as e:
            return {"error": str(e), "type": str(type(e))}

    async def copy_file(self, source: str, target: str) -> dict:
        """复制文件"""
        try:
            source_path = Path(source)
            target_path = Path(target)
            
            if not source_path.exists():
                return {"error": f"Source file does not exist: {source}"}
            
            target_path.parent.mkdir(parents=True, exist_ok=True)
            
            with open(source_path, 'rb') as src_file:
                content = src_file.read()
                
            with open(target_path, 'wb') as dst_file:
                dst_file.write(content)
                
            return {
                "success": True, 
                "message": f"File copied from {source} to {target}",
                "size": len(content)
            }
        except Exception as e:
            import traceback
            return {
                "error": str(e), 
                "type": str(type(e)),
                "traceback": traceback.format_exc()
            }
