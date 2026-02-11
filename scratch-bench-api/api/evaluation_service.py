"""
Project evaluation service for the Scratch GUI Agent API.
"""
import os
import json
import logging
import subprocess
import traceback
from pathlib import Path
from fastapi import HTTPException
from .models import EvaluationRequest
from .js_loader import js_loader


class EvaluationService:
    def __init__(self):
        # Use relative path that works on both Windows and Linux
        current_dir = Path(__file__).parent.parent.parent
        self.automation_test_dir = str(current_dir / "automation-test")
        # Also set up evaluation scripts directory for browser-based evaluations
        self.evaluation_scripts_dir = str(Path(__file__).parent / "evaluation_scripts")
        self.page = None
        
    def set_page(self, page):
        """Set the browser page for browser-based evaluations."""
        self.page = page
        
    async def evaluate_project(self, request: EvaluationRequest) -> dict:
        """评估Scratch项目"""
        # 设置详细日志
        logging.basicConfig(level=logging.DEBUG)
        logger = logging.getLogger(__name__)

        try:
            logger.info("=" * 60)
            logger.info("开始评估项目")
            logger.info("=" * 60)
            
            # Check evaluation method
            if request.evaluation_method == "browser":
                return await self._evaluate_browser_based(request, logger)
            else:
                raise HTTPException(status_code=400, detail=f"Unsupported evaluation method: {request.evaluation_method}")
                
        except Exception as e:
            logger.error(f"评估过程中出现未知异常: {e}")
            logger.error(f"异常类型: {type(e)}")
            logger.error(f"完整异常: {traceback.format_exc()}")
            raise HTTPException(status_code=500, detail=f"评估失败: {str(e)}")

    async def _evaluate_browser_based(self, request: EvaluationRequest, logger) -> dict:
        """Browser-based evaluation using JavaScript in the page context."""
        if not self.page:
            raise HTTPException(status_code=500, detail="Browser page not available for evaluation")
            
        try:
            logger.info(f"Starting browser-based evaluation for task: {request.task_name}")
            
            # Check if we have a specific evaluation script for this task
            evaluation_script = request.task_name  # Use task name directly since files are named like bouncing_cat.js

            try:
                # Load evaluation script text (CommonJS module exporting a function)
                script_text = js_loader.load_evaluation_script(evaluation_script)
                # Try to load shared evaluation utilities (provides helpers like runQuestionAnswerTests)
                eval_utils_text = None
                try:
                    eval_utils_text = js_loader.load_evaluation_script("evaluation_utils")
                except FileNotFoundError:
                    eval_utils_text = None
                config = {}

                logger.info(f"Executing evaluation script in browser: {evaluation_script}")
                logger.info(f"Configuration: {config}")

                # Wrapper that reconstructs module.exports and executes the function in the page with window.vm
                js_wrapper = """
                (payload) => {
                  try {
                    const scriptText = payload && payload.scriptText;
                    const config = (payload && payload.config) || {};
                    const evalUtilsScript = payload && payload.evalUtilsScript;
                    const vm = (typeof window !== 'undefined' && window.vm) ? window.vm : null;
                    if (!vm) return {success:false, error:{message:'VM not available'}};
                    const cleanup = () => { try { vm.stopAll && vm.stopAll(); } catch(e) {} };
                    // Inject EvaluationUtils if provided
                    if (evalUtilsScript) {
                      try {
                        const runEvalUtils = new Function('module', 'exports', evalUtilsScript);
                        const utilsModule = { exports: {} };
                        runEvalUtils(utilsModule, utilsModule.exports);
                        // Expose helpers on window for scripts expecting window.EvaluationUtils
                        if (typeof window !== 'undefined') {
                          window.EvaluationUtils = utilsModule.exports;
                        }
                      } catch (e) {
                        return {success:false, error:{message: 'Failed to load evaluation_utils: ' + (e && e.message ? e.message : String(e))}};
                      }
                    }
                    const runModule = new Function('module', 'exports', scriptText);
                    const moduleObj = { exports: {} };
                    runModule(moduleObj, moduleObj.exports);
                    const evalFn = moduleObj.exports;
                    const maybePromise = evalFn(vm, config, cleanup);
                    
                    // Keep a fixed service-level safety timeout to prevent hangs.
                    // This timeout is intentionally NOT propagated into script config.
                    const timeoutMs = 120000;
                    return new Promise((resolve) => {
                      let timeoutId = setTimeout(() => {
                        try { cleanup(); } catch(e) {}
                        resolve({success:false, error:{message: 'Evaluation timeout after ' + Math.floor(timeoutMs/1000) + 's'}});
                      }, timeoutMs);
                      const settle = (payload) => { clearTimeout(timeoutId); resolve(payload); };
                      if (maybePromise && typeof maybePromise.then === 'function') {
                        maybePromise.then(
                          ok => settle({success: true, result: ok}),
                          err => settle({success: false, error: {message: (err && err.message) ? err.message : String(err)}})
                        );
                      } else {
                        settle({success:true, result: maybePromise});
                      }
                    });
                  } catch (e) {
                    return {success:false, error:{message: e && e.message ? e.message : String(e)}};
                  }
                }
                """

                # Attach console listener to capture output during evaluation
                captured_logs = []
                def _console_handler(msg):
                    try:
                        # Normalize: [type] text
                        typ = getattr(msg, 'type', None)
                        # In newer Playwright, type can be method; attempt call
                        if callable(typ):
                            try:
                                typ = msg.type()
                            except Exception:
                                typ = None
                        txt = ''
                        try:
                            txt = msg.text()
                        except Exception:
                            # Fallback for older versions
                            txt = getattr(msg, 'text', '') or ''
                        line = f"[{typ or 'log'}] {txt}"
                        captured_logs.append(line)
                    except Exception:
                        pass

                self.page.on("console", _console_handler)
                try:
                    # Execute in browser
                    result = await self.page.evaluate(js_wrapper, {"scriptText": script_text, "config": config, "evalUtilsScript": eval_utils_text})
                finally:
                    try:
                        self.page.off("console", _console_handler)
                    except Exception:
                        pass

                logger.info(f"Browser evaluation completed with result: {result}")

                if isinstance(result, dict):
                    if result.get("success"):
                        return {
                            "status": "success",
                            "result": result.get("result", {}),
                            "message": result.get("message", ""),
                            "evaluation_method": "browser",
                            "stdout": "\n".join(captured_logs)
                        }
                    else:
                        error = result.get("error", {})
                        return {
                            "status": "failed",
                            "error": error.get("message", "Browser evaluation failed"),
                            "result": result.get("result", {}),
                            "evaluation_method": "browser",
                            "stdout": "\n".join(captured_logs)
                        }
                else:
                    return {
                        "status": "failed",
                        "error": "Invalid result format from browser evaluation",
                        "evaluation_method": "browser",
                        "stdout": "\n".join(captured_logs)
                    }

            except FileNotFoundError:
                logger.warning(f"No browser evaluation script found for {request.task_name}, falling back to node-based evaluation")
                return await self._evaluate_node_based(request, logger)
                
        except Exception as e:
            logger.error(f"Browser evaluation failed: {e}")
            logger.error(f"Full traceback: {traceback.format_exc()}")
            raise HTTPException(status_code=500, detail=f"Browser evaluation failed: {str(e)}")
