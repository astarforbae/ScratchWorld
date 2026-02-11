"""
Browser lifecycle management for the Scratch GUI Agent API.
"""
import asyncio
import logging
from pathlib import Path
from playwright.async_api import async_playwright, Page, Browser, BrowserContext
import shutil
import os
import time
import base64

logger = logging.getLogger("scratch_bench_api")

class BrowserManager:
    def __init__(self):
        self.playwright = None
        self.browser = None
        self.context: BrowserContext | None = None
        self.page: Page | None = None
        self.headless = True
        # Recording state
        self.is_recording: bool = False
        self.recording_session_dir: Path | None = None
        self.recording_final_dir: Path | None = None
        self.recording_info: dict | None = None
        # A stable cache directory (relative to the server code root) for finalized recordings
        # Works regardless of Docker or host paths since it's computed from this file location.
        self.recording_cache_root: Path = (Path(__file__).resolve().parents[1] / "recording_cache").resolve()
    
    async def startup(self, headless: bool = True):
        """Initialize browser and navigate to Scratch GUI"""
        self.headless = headless
        
        logger.info("启动Playwright环境")
        # 创建playwright实例
        self.playwright = await async_playwright().start()
        # 使用全局 HEADLESS 标志控制是否无头
        self.browser = await self.playwright.chromium.launch(headless=self.headless)
        # Always create a context to keep a single-context model
        self.context = await self.browser.new_context()
        self.page = await self.context.new_page()
        self.page.on("dialog", lambda dialog: dialog.accept())
        
        # 连接到Scratch GUI - 添加重试机制（支持通过环境变量覆盖）
        url = os.getenv("SCRATCH_GUI_URL", "http://localhost:8601?locale=en")
        max_retries = 20  # 最多尝试20次
        retry_delay = 3   # 每次尝试间隔3秒
        
        for attempt in range(1, max_retries + 1):
            try:
                logger.debug("连接Scratch GUI: %s (attempt %d/%d)", url, attempt, max_retries)
                await self.page.goto(url, timeout=10000)  # 减少单次超时时间为10秒
                logger.info("Scratch GUI 页面加载成功")
                # Avoid blocking the event loop inside async function
                await asyncio.sleep(5)
                
                return  # 成功连接，退出函数
            except Exception as e:
                logger.warning("连接Scratch GUI失败: %s", e)
                if attempt < max_retries:
                    logger.debug("等待 %s 秒后重试", retry_delay)
                    await asyncio.sleep(retry_delay)
                else:
                    logger.error("达到最大重试次数 (%d)，无法连接到 Scratch GUI", max_retries)
                    await self.shutdown()
                    raise Exception(f"无法连接到Scratch GUI: 已尝试 {max_retries} 次连接，但都失败了")

    async def shutdown(self):
        """Close browser and cleanup"""
        # Try to finalize recording if still active
        try:
            if self.is_recording:
                await self.finalize_recording()
        except Exception:
            pass
        if self.context:
            try:
                await self.context.close()
            except Exception:
                pass
            self.context = None
        if self.browser:
            try:
                await self.browser.close()
            except Exception:
                pass
            self.browser = None
        if self.playwright:
            try:
                await self.playwright.stop()
            except Exception:
                pass
            self.playwright = None
        logger.info("环境已关闭")

    async def reset_environment(self, record: bool = False, quality: str = "medium", task_name: str | None = None, save_dir: str | None = None):
        """重置环境状态，创建单一上下文；可选启用录制。

        当 record=True 时，会创建带视频录制的上下文，否则创建普通上下文。
        """
        logger.info("开始重置环境")

        # 1. 重启浏览器
        logger.info("重启浏览器")

        # 关闭当前页面/上下文/浏览器
        if self.page:
            try:
                await self.page.close()
                logger.debug("已关闭当前页面")
            except Exception:
                pass
            self.page = None
        if self.context:
            try:
                await self.context.close()
                logger.debug("已关闭上下文")
            except Exception:
                pass
            self.context = None
        if self.browser:
            try:
                await self.browser.close()
                logger.debug("已关闭浏览器")
            except Exception:
                pass
            self.browser = None

        # 如有必要，重新启动 Playwright（可能在上一次 /shutdown 后被停止）
        if self.playwright is None:
            self.playwright = await async_playwright().start()

        # 重新启动浏览器
        self.browser = await self.playwright.chromium.launch(headless=self.headless)

        # 根据是否录制创建上下文/页面
        size_map = {
            "low": {"width": 854, "height": 480},
            "medium": {"width": 1280, "height": 720},
            "high": {"width": 1920, "height": 1080},
        }
        video_size = size_map.get((quality or "medium").lower(), size_map["medium"])

        # reset recording state containers
        self.is_recording = bool(record)
        self.recording_info = None
        self.recording_session_dir = None
        self.recording_final_dir = None

        if self.is_recording:
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            safe_task = (task_name or "recording").strip().replace(" ", "_")[:50]
            recording_id = f"rec_{timestamp}_{safe_task}"

            # Determine base directory for caching finalized recordings.
            # Priority: explicit save_dir -> otherwise use stable cache under server root
            if save_dir:
                base_dir = Path(save_dir)
            else:
                # recording_cache/ under scratch-bench-api/ (server root)
                base_dir = self.recording_cache_root

            base_dir.mkdir(parents=True, exist_ok=True)

            # Use a per-session subdirectory to store raw Playwright video chunks
            session_dir = base_dir / f"session_{recording_id}"
            session_dir.mkdir(parents=True, exist_ok=True)

            # Finalized files will be placed directly under base_dir (cache root or save_dir)
            final_dir = base_dir

            self.recording_session_dir = session_dir
            self.recording_final_dir = final_dir

            self.context = await self.browser.new_context(
                record_video_dir=str(session_dir),
                record_video_size=video_size,
                viewport=video_size,
            )
            self.page = await self.context.new_page()
            self.page.on("dialog", lambda dialog: dialog.accept())

            self.recording_info = {
                "recording_id": recording_id,
                "task_name": safe_task,
                "quality": quality,
                "video_size": video_size,
                "session_dir": str(session_dir),
                "final_dir": str(final_dir),
                "cache_root": str(self.recording_cache_root),
                "start_time": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "status": "recording",
            }
        else:
            self.context = await self.browser.new_context()
            self.page = await self.context.new_page()
            self.page.on("dialog", lambda dialog: dialog.accept())

        logger.info("已启动新浏览器")

        # 2. 重新访问 Scratch GUI（支持环境变量覆盖）
        url = os.getenv("SCRATCH_GUI_URL", "http://localhost:8601?locale=en")
        logger.info("重新访问 Scratch GUI: %s", url)

        max_retries = 10
        retry_delay = 2

        for attempt in range(1, max_retries + 1):
            try:
                await self.page.goto(url, timeout=10000)
                logger.info("页面重新加载成功")
                break
            except Exception as e:
                logger.warning("第 %d 次访问失败: %s", attempt, e)
                if attempt < max_retries:
                    logger.debug("等待 %s 秒后重试", retry_delay)
                    await asyncio.sleep(retry_delay)
                else:
                    logger.error("达到最大重试次数，页面访问失败")
                    raise Exception(f"重置后无法访问 Scratch GUI: {str(e)}")

        logger.info("环境重置完成")
        payload = {
            "status": "success",
            "message": "Environment reset with browser restart",
            "details": {
                "browser_restarted": True,
                "page_reloaded": True,
                "recording": self.is_recording,
            },
        }
        if self.is_recording and self.recording_info:
            payload["recording_id"] = self.recording_info.get("recording_id")
        return payload

    def get_page(self) -> Page:
        """Get the current page instance"""
        return self.page

    def get_browser(self) -> Browser:
        """Get the current browser instance"""
        return self.browser

    def get_context(self) -> BrowserContext | None:
        """Get the current browser context"""
        return self.context

    def is_recording_enabled(self) -> bool:
        return bool(self.is_recording)

    async def finalize_recording(self) -> dict | None:
        """Finalize recording: close context to flush video, move/rename file, compute metadata.

        Returns recording_info dict if recording was active, else None.
        """
        if not self.is_recording or not self.recording_session_dir or not self.recording_info:
            return None

        session_dir = self.recording_session_dir
        final_dir = self.recording_final_dir or session_dir

        # Close the context to finalize the video
        if self.context:
            try:
                await self.context.close()
            except Exception:
                pass
            self.context = None
        self.page = None

        # Give a brief moment for file to flush
        await asyncio.sleep(1)

        video_file_path = None
        stable_file_path = None
        data_b64 = None
        try:
            video_files = list(Path(session_dir).glob("*.webm"))
            if video_files:
                original_video = video_files[0]
                # A stable file name under the cache root/final_dir for API download
                # Prefer including the recording_id in the filename to avoid collisions
                recording_id = self.recording_info.get("recording_id", "recording")
                target_name = f"{recording_id}.webm"
                target_path = Path(final_dir) / target_name
                if target_path.exists():
                    target_path.unlink()
                if Path(final_dir) != Path(session_dir):
                    shutil.move(str(original_video), str(target_path))
                else:
                    original_video.rename(target_path)
                video_file_path = target_path
                stable_file_path = target_path
                # Read finalized file and encode as base64 for API response delivery
                try:
                    raw = Path(video_file_path).read_bytes()
                    data_b64 = base64.b64encode(raw).decode("utf-8")
                except Exception as read_err:
                    logger.warning("无法读取或编码视频文件: %s", read_err, exc_info=True)
        except Exception as e:
            logger.warning("视频文件处理失败: %s", e, exc_info=True)

        # Update recording info
        self.recording_info.update({
            "end_time": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "status": "completed",
            "data_base64": data_b64,
            "mime_type": "video/webm" if data_b64 else None,
        })
        if video_file_path and Path(video_file_path).exists():
            size_bytes = Path(video_file_path).stat().st_size
            self.recording_info["file_size"] = f"{size_bytes / (1024*1024):.1f}MB"

        # Reset recording flags
        info = self.recording_info
        self.is_recording = False
        self.recording_session_dir = None
        self.recording_final_dir = None
        self.recording_info = None

        # Create a fresh normal context so server remains usable
        if self.browser:
            self.context = await self.browser.new_context()
            self.page = await self.context.new_page()
            self.page.on("dialog", lambda dialog: dialog.accept())

        return info
