"""
Refactored main.py for Scratch GUI Agent API.
All functionality split into focused modules while preserving existing endpoints.
"""
import time
import base64
import asyncio
import argparse
import os
import logging
import re
from contextlib import asynccontextmanager
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path
from fastapi import FastAPI, HTTPException, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv, find_dotenv
from typing import Optional

# Import all the new modules
from .browser_manager import BrowserManager
from .interaction_handlers import InteractionHandler
from .scratch_api import ScratchAPI
from .project_manager import ProjectManager
from .evaluation_service import EvaluationService
from .session_manager import SessionManager
from .models import (
    ClickAction, DoubleClickAction, RightClickAction, MoveToAction,
    DragAndDropAction, ScrollAction, TypeAction, KeyAction,
    HoldKeyAction, ReleaseKeyAction, HotkeyAction, ElementAction, WaitAction,
    CompositeRequest, EvaluationRequest
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Modern FastAPI lifespan handler replacing deprecated on_event startup/shutdown."""
    global browser_manager, interaction_handler, scratch_api, project_manager, evaluation_service, session_manager
    # Startup
    browser_manager = BrowserManager()
    project_manager = ProjectManager()
    evaluation_service = EvaluationService()

    await browser_manager.startup(headless=HEADLESS)

    page = browser_manager.get_page()
    interaction_handler = InteractionHandler(page, session_id=None)
    scratch_api = ScratchAPI(page, session_id=None)
    project_manager.set_page(page)
    evaluation_service.set_page(page)

    # Initialize SessionManager for parallel sessions (Phase 1)
    try:
        session_manager = SessionManager(browser_manager.get_browser())
        # Start background cleanup to proactively release expired sessions
        session_manager.start_cleanup()
    except Exception as e:
        session_manager = None
        logging.getLogger("scratch_bench_api").exception("Failed to initialize SessionManager: %s", e)

    try:
        yield
    finally:
        # Shutdown
        # Close all parallel sessions first (if any)
        try:
            if session_manager:
                # Stop background cleanup loop before closing sessions
                try:
                    await session_manager.stop_cleanup()
                except Exception:
                    pass
                await session_manager.close_all()
        finally:
            if browser_manager:
                await browser_manager.shutdown()


app = FastAPI(title="Scratch GUI Agent Environment", lifespan=lifespan)

# 添加CORS中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------------
# Exception logging
# -----------------------------
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Log HTTPException details to file/stdout."""
    try:
        _logger.error(
            "HTTPException %s %s -> %s: %s",
            request.method,
            request.url.path,
            exc.status_code,
            exc.detail,
        )
    except Exception:
        pass
    return Response(content=exc.detail or "", status_code=exc.status_code)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Log unexpected exceptions with stack traces."""
    try:
        _logger.exception("Unhandled error for %s %s", request.method, request.url.path)
    except Exception:
        pass
    raise exc

# -----------------------------
# Request logging with session_id prefix
# -----------------------------
_logger = logging.getLogger("scratch_bench_api")
if not _logger.handlers:
    # Basic configuration if not already configured by the runner
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s [%(levelname)s] [%(threadName)s] %(name)s: %(message)s",
    )

_SESSION_RE = re.compile(r"/sessions/([^/]+)")

@app.middleware("http")
async def log_requests_with_session(request, call_next):
    """Log inbound requests with session_id (if present) for better parallel observability."""
    path = request.url.path
    method = request.method
    m = _SESSION_RE.search(path)
    session_id = m.group(1) if m else None
    start = time.time()
    
    prefix = f"[session_id={session_id}] " if session_id else ""
    _logger.info("%sReceived %s %s", prefix, method, path)
    
    try:
        response = await call_next(request)
        status = getattr(response, "status_code", 0)
        return response
    finally:
        duration_ms = int((time.time() - start) * 1000)
        prefix = f"[session_id={session_id}] " if session_id else ""
        _logger.info(
            "%s%s %s %s in %dms",
            prefix,
            method,
            path,
            f"-> {locals().get('status', 'unknown')}",
            duration_ms,
        )

# -----------------------------
# File logging setup (rotating handlers)
# -----------------------------
# Persist logs to disk in addition to stdout. Configurable via env vars:
# - LOG_LEVEL (already supported; default: INFO)
# Always write to scratch-bench-api/logs regardless of current working directory.
LOG_DIR = str((Path(__file__).resolve().parents[1] / "logs").resolve())
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

try:
    os.makedirs(LOG_DIR, exist_ok=True)
except Exception:
    # Do not crash if directory cannot be created; stdout logging still works
    pass

def _ensure_file_handlers():
    """Attach rotating file handlers to our loggers exactly once."""
    try:
        has_text_file = any(isinstance(h, logging.FileHandler) for h in _logger.handlers)
        if has_text_file:
            return

        text_log_path = os.path.join(LOG_DIR, "api.log")

        text_handler = TimedRotatingFileHandler(
            text_log_path, when="midnight", backupCount=7, encoding="utf-8"
        )
        text_handler.setLevel(LOG_LEVEL)
        text_handler.setFormatter(
            logging.Formatter(
                "%(asctime)s [%(levelname)s] [%(threadName)s] %(name)s: %(message)s"
            )
        )

        _logger.addHandler(text_handler)
    except Exception:
        # Never raise due to logging setup issues
        pass

# Install file handlers at import time so all logs persist by default
_ensure_file_handlers()

# 全局变量 - 管理器实例
browser_manager = None
interaction_handler = None
scratch_api = None
project_manager = None
evaluation_service = None
session_manager = None

# CLI参数全局变量（可由 .env 覆盖）
# 自动查找离当前工作目录最近的 .env 文件
load_dotenv(find_dotenv(), override=False)

def _get_bool_env(name: str, default: bool) -> bool:
    val = os.getenv(name)
    if val is None:
        return default
    return str(val).strip().lower() in ("1", "true", "yes", "on")

HEADLESS: bool = _get_bool_env("HEADLESS", True)

# 生命周期由 lifespan() 管理，移除了已弃用的 on_event 装饰器。

# API端点
@app.get("/")
async def root():
    return {"message": "Scratch GUI Agent环境已启动"}

# -----------------------------
# Phase 1: Session CRUD endpoints
# -----------------------------
@app.post("/sessions")
async def create_session(record: Optional[bool] = False, quality: Optional[str] = "medium", task_name: Optional[str] = None, save_dir: Optional[str] = None):
    """Create a new session (BrowserContext + Page). Auto-navigate to SCRATCH GUI URL."""
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        sess = await session_manager.create_session(record=bool(record), quality=quality or "medium", task_name=task_name, save_dir=save_dir)
        # Navigate to Scratch GUI
        url = os.getenv("SCRATCH_GUI_URL", "http://localhost:8601?locale=en")
        try:
            await sess.page.goto(url, timeout=15000)
        except Exception as e:
            # Allow session creation even if navigation fails; client can retry
            _logger.warning("session page navigation failed: %s", e)
        return {
            "session_id": sess.session_id,
            "created_at": sess.created_at,
            "is_recording": sess.is_recording,
        }
    except RuntimeError as re:
        raise HTTPException(status_code=429, detail=str(re))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/sessions/{session_id}/html")
async def session_get_html(session_id: str):
    """Get page HTML for a specific session."""
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        sess = await session_manager.get_session(session_id)
        page = sess.page
        html_content = await page.content()
        return {"html": html_content}
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取HTML内容失败: {str(e)}")

@app.get("/sessions/{session_id}/screenshot")
async def session_get_screenshot(session_id: str, format: str = "base64", full_page: bool = True):
    """Get a screenshot from a specific session's page."""
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        sess = await session_manager.get_session(session_id)
        page = sess.page
        screenshot_bytes = await page.screenshot(full_page=full_page)

        if format == "base64":
            base64_image = base64.b64encode(screenshot_bytes).decode("utf-8")
            return {"screenshot": base64_image, "format": "base64"}
        else:
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            filename = f"screenshot_{timestamp}.png"
            filepath = f"/usr/src/app/output/{filename}"
            with open(filepath, "wb") as f:
                f.write(screenshot_bytes)
            return {"screenshot": filename, "format": "file", "path": filepath}
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取截图失败: {str(e)}")

# -----------------------------
# Phase 2: Sessionized mirrors (initial)
# -----------------------------

# def _get_session_page_or_404(session_id: str):
#     """Resolve a session_id to a Playwright Page or raise HTTP 404/500.

#     This is the common helper for sessionized endpoints.
#     """
#     if session_manager is None:
#         raise HTTPException(status_code=500, detail="SessionManager not initialized")
#     try:
#         # session_manager.get_page is async, so we wrap inside an async helper at call site
#         return session_id  # placeholder token so we can fetch page in async endpoints
#     except KeyError as ke:
#         raise HTTPException(status_code=404, detail=str(ke))
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))

# @app.post("/sessions/{session_id}/wait")
# async def session_wait(session_id: str, action: WaitAction):
#     """Session-scoped wait endpoint. Useful for validating session routing.

#     This mirrors `/wait` but targets a specific session's page. Uses the session-bound
#     InteractionHandler for consistency.
#     """
#     if session_manager is None:
#         raise HTTPException(status_code=500, detail="SessionManager not initialized")
#     try:
#         sess = await session_manager.get_session(session_id)
#         return await sess.interaction_handler.wait(action)
#     except KeyError as ke:
#         raise HTTPException(status_code=404, detail=str(ke))
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))

@app.get("/sessions")
async def list_sessions(response: Response):
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        data = await session_manager.list_sessions()
        # Expose capacity hints via headers to help clients cap parallelism safely
        try:
            max_sessions = getattr(session_manager, "max_sessions", None)
            if max_sessions is not None:
                response.headers["X-Max-Sessions"] = str(max_sessions)
                active = len(data)
                available = max(0, int(max_sessions) - int(active))
                response.headers["X-Active-Sessions"] = str(active)
                response.headers["X-Available-Sessions"] = str(available)
        except Exception:
            # Do not fail the endpoint due to header calculation issues
            pass
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/sessions/count")
async def get_session_count():
    """Get the current number of active sessions and capacity information."""
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        sessions = await session_manager.list_sessions()
        active_count = len(sessions)
        
        # Get max sessions capacity if available
        max_sessions = getattr(session_manager, "max_sessions", None)
        available_count = max(0, int(max_sessions) - active_count) if max_sessions is not None else None
        
        result = {
            "active_sessions": active_count,
            "max_sessions": max_sessions,
        }
        
        if available_count is not None:
            result["available_sessions"] = available_count
            
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/sessions/{session_id}")
async def get_session_info(session_id: str):
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        sess = await session_manager.get_session(session_id)
        return {
            "session_id": sess.session_id,
            "created_at": sess.created_at,
            "last_used_at": sess.last_used_at,
            "is_recording": sess.is_recording,
        }
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        result = await session_manager.delete_session(session_id)
        return result
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/sessions")
async def delete_all_sessions():
    """Delete all active sessions at once. Much more efficient than individual deletions."""
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        result = await session_manager.close_all()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# -----------------------------
# Phase 2: Sessionized mirrors (project, composite, evaluate)
# -----------------------------

@app.post("/sessions/{session_id}/load_project")
async def session_load_project(session_id: str, project_name: str):
    """Load a project into a specific session's page."""
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        sess = await session_manager.get_session(session_id)
        return await sess.project_manager.load_project(project_name)
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/sessions/{session_id}/export_project")
async def session_export_project(session_id: str, output_name: str):
    """Export the current project from a specific session's page."""
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        sess = await session_manager.get_session(session_id)
        return await sess.project_manager.export_project(output_name)
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/sessions/{session_id}/composite/execute")
async def session_composite_execute(session_id: str, req: CompositeRequest):
    """Session-scoped composite API dispatcher."""
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        sess = await session_manager.get_session(session_id)
        # Use the session-bound ScratchAPI instance to maintain state
        return await sess.scratch_api.execute(req)
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/sessions/{session_id}/evaluate")
async def session_evaluate_project(session_id: str, request: EvaluationRequest):
    """Session-scoped project evaluation."""
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        sess = await session_manager.get_session(session_id)
        return await sess.evaluation_service.evaluate_project(request)
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# -----------------------------
# Phase 2: Sessionized mirrors (elements & basic interactions)
# -----------------------------

@app.get("/sessions/{session_id}/elements")
async def session_get_elements(session_id: str, selector: str):
    """Get elements info for a selector from a specific session's page."""
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        sess = await session_manager.get_session(session_id)
        return await sess.interaction_handler.get_elements(selector)
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Archived original session elements_batch route (v1):
# @app.get("/sessions/{session_id}/elements_batch")
# async def session_get_elements_batch(session_id: str, selectors: str):
#     """Batch get elements info for multiple selectors from a specific session's page."""
#     if session_manager is None:
#         raise HTTPException(status_code=500, detail="SessionManager not initialized")
#     try:
#         sess = await session_manager.get_session(session_id)
#         return await sess.interaction_handler.get_elements_batch(selectors)
#     except KeyError as ke:
#         raise HTTPException(status_code=404, detail=str(ke))
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))

@app.get("/sessions/{session_id}/elements_batch")
async def session_get_elements_batch(session_id: str, selectors: str):
    """Batch get elements info (optimized implementation)."""
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        sess = await session_manager.get_session(session_id)
        return await sess.interaction_handler.get_elements_batch_v2(selectors)
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/sessions/{session_id}/click")
async def session_click(session_id: str, action: ClickAction):
    """Session-scoped click at position."""
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        sess = await session_manager.get_session(session_id)
        return await sess.interaction_handler.click_at_position(action)
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/sessions/{session_id}/type")
async def session_type(session_id: str, action: TypeAction):
    """Session-scoped type text."""
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        sess = await session_manager.get_session(session_id)
        return await sess.interaction_handler.type_text(action)
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/sessions/{session_id}/double_click")
async def session_double_click(session_id: str, action: DoubleClickAction):
    """Session-scoped double click at position."""
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        sess = await session_manager.get_session(session_id)
        return await sess.interaction_handler.double_click_at_position(action)
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/sessions/{session_id}/move_to")
async def session_move_to(session_id: str, action: MoveToAction):
    """Session-scoped mouse move to position."""
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        sess = await session_manager.get_session(session_id)
        return await sess.interaction_handler.move_mouse_to(action)
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/sessions/{session_id}/drag_and_drop")
async def session_drag_and_drop(session_id: str, action: DragAndDropAction):
    """Session-scoped drag and drop."""
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        sess = await session_manager.get_session(session_id)
        return await sess.interaction_handler.drag_and_drop(action)
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/sessions/{session_id}/scroll")
async def session_scroll(session_id: str, action: ScrollAction):
    """Session-scoped mouse wheel scroll."""
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        sess = await session_manager.get_session(session_id)
        return await sess.interaction_handler.scroll_mouse(action)
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/sessions/{session_id}/key")
async def session_key(session_id: str, action: KeyAction):
    """Session-scoped press a single key."""
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        sess = await session_manager.get_session(session_id)
        return await sess.interaction_handler.press_key(action)
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/sessions/{session_id}/hold_key")
async def session_hold_key(session_id: str, action: HoldKeyAction):
    """Session-scoped hold a key down."""
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        sess = await session_manager.get_session(session_id)
        return await sess.interaction_handler.hold_key(action)
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/sessions/{session_id}/release_key")
async def session_release_key(session_id: str, action: ReleaseKeyAction):
    """Session-scoped release a key."""
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        sess = await session_manager.get_session(session_id)
        return await sess.interaction_handler.release_key(action)
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/sessions/{session_id}/hotkey")
async def session_hotkey(session_id: str, action: HotkeyAction):
    """Session-scoped press a hotkey combination."""
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        sess = await session_manager.get_session(session_id)
        return await sess.interaction_handler.press_hotkey(action)
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# @app.post("/sessions/{session_id}/element")
# async def session_element(session_id: str, action: ElementAction):
#     """Session-scoped element interaction by selector."""
#     if session_manager is None:
#         raise HTTPException(status_code=500, detail="SessionManager not initialized")
#     try:
#         sess = await session_manager.get_session(session_id)
#         return await sess.interaction_handler.interact_with_element(action)
#     except KeyError as ke:
#         raise HTTPException(status_code=404, detail=str(ke))
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))

@app.post("/sessions/{session_id}/toggle_stage")
async def session_toggle_stage(session_id: str):
    """Session-scoped toggle between small and large stage."""
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        sess = await session_manager.get_session(session_id)
        page = sess.page
        
        selectors_to_try = [
            'button[title*="Switch to small stage"]',
        ]
        
        button_found = None
        button_selector = None
        
        # Try each selector until we find the button
        for selector in selectors_to_try:
            try:
                button_found = await page.query_selector(selector)
                if button_found:
                    button_selector = selector
                    break
            except Exception:
                continue
        
        if not button_found:
            # If no button found, try to find any button with stage-related text
            all_buttons = await page.query_selector_all('button')
            for button in all_buttons:
                try:
                    title = await button.get_attribute("title") or ""
                    aria_label = await button.get_attribute("aria-label") or ""
                    if "stage" in title.lower() or "stage" in aria_label.lower():
                        button_found = button
                        button_selector = "found by text search"
                        break
                except Exception:
                    continue
        
        if not button_found:
            return {
                "success": False,
                "message": "Stage toggle button not found",
                "error": "Could not locate stage toggle button with any known selector"
            }
        
        # Click the button
        await button_found.click()
        
        # Get the current state to return feedback
        try:
            title = await button_found.get_attribute("title") or ""
            aria_label = await button_found.get_attribute("aria-label") or ""
            aria_pressed = await button_found.get_attribute("aria-pressed") or ""
            
            return {
                "success": True,
                "message": "Stage toggle clicked successfully",
                "selector_used": button_selector,
                "current_state": {
                    "title": title,
                    "aria_label": aria_label,
                    "pressed": aria_pressed == "true"
                }
            }
        except Exception:
            return {
                "success": True,
                "message": "Stage toggle clicked, but unable to read current state",
                "selector_used": button_selector
            }
            
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to toggle stage: {str(e)}")

@app.get("/sessions/{session_id}/viewport_size")
async def session_viewport_size(session_id: str):
    """Get viewport size for a specific session's page."""
    if session_manager is None:
        raise HTTPException(status_code=500, detail="SessionManager not initialized")
    try:
        sess = await session_manager.get_session(session_id)
        page = sess.page
        viewport_size = page.viewport_size
        return {
            "width": viewport_size["width"],
            "height": viewport_size["height"],
            "viewport_size": viewport_size,
        }
    except KeyError as ke:
        raise HTTPException(status_code=404, detail=str(ke))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/screenshot")
async def get_screenshot(format: str = "base64", full_page: bool = True):
    """获取当前页面的截图"""
    try:
        page = browser_manager.get_page()
        screenshot_bytes = await page.screenshot(full_page=full_page)
        
        if format == "base64":
            # 返回base64编码的图像
            base64_image = base64.b64encode(screenshot_bytes).decode("utf-8")
            return {"screenshot": base64_image, "format": "base64"}
        else:
            # 创建一个临时文件名
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            filename = f"screenshot_{timestamp}.png"
            filepath = f"/usr/src/app/output/{filename}"
            
            # 保存图像
            with open(filepath, "wb") as f:
                f.write(screenshot_bytes)
            
            return {"screenshot": filename, "format": "file", "path": filepath}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取截图失败: {str(e)}")

# 鼠标操作接口
@app.post("/click")
async def click_at_position(action: ClickAction):
    """在指定位置点击"""
    return await interaction_handler.click_at_position(action)

@app.post("/double_click")
async def double_click_at_position(action: DoubleClickAction):
    """在指定位置双击"""
    return await interaction_handler.double_click_at_position(action)

@app.post("/move_to")
async def move_mouse_to(action: MoveToAction):
    """将鼠标移动到指定位置"""
    return await interaction_handler.move_mouse_to(action)

@app.post("/drag_and_drop")
async def drag_and_drop(action: DragAndDropAction):
    """从一个点拖拽到另一个点"""
    return await interaction_handler.drag_and_drop(action)

@app.post("/scroll")
async def scroll_mouse(action: ScrollAction):
    """滚动鼠标滚轮"""
    return await interaction_handler.scroll_mouse(action)

# 键盘操作接口
@app.post("/type")
async def type_text(action: TypeAction):
    """输入文本"""
    return await interaction_handler.type_text(action)

@app.post("/key")
async def press_key(action: KeyAction):
    """按下并释放单个按键"""
    return await interaction_handler.press_key(action)

@app.post("/hold_key")
async def hold_key(action: HoldKeyAction):
    """按住某个按键"""
    return await interaction_handler.hold_key(action)

@app.post("/release_key")
async def release_key(action: ReleaseKeyAction):
    """释放某个按键"""
    return await interaction_handler.release_key(action)

@app.post("/hotkey")
async def press_hotkey(action: HotkeyAction):
    """模拟组合键"""
    return await interaction_handler.press_hotkey(action)

# @app.post("/element")
# async def interact_with_element(action: ElementAction):
#     """与元素交互"""
#     return await interaction_handler.interact_with_element(action)

# @app.post("/wait")
# async def wait(action: WaitAction):
#     """等待指定的毫秒数"""
#     return await interaction_handler.wait(action)

@app.get("/html")
async def get_html():
    """获取页面的HTML内容"""
    try:
        page = browser_manager.get_page()
        html_content = await page.content()
        return {"html": html_content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取HTML内容失败: {str(e)}")

@app.get("/viewport_size")
async def get_viewport_size():
    """获取页面视口大小"""
    try:
        page = browser_manager.get_page()
        viewport_size = page.viewport_size
        return {
            "width": viewport_size["width"],
            "height": viewport_size["height"],
            "viewport_size": viewport_size
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取视口大小失败: {str(e)}")

# 录制相关接口（已弃用）
@app.post("/start_recording")
async def start_recording_deprecated():
    """Deprecated: Recording must be requested via /reset_environment with record=true"""
    raise HTTPException(status_code=410, detail="Deprecated: use /reset_environment?record=true to start recording")

@app.post("/end_recording")
async def end_recording_deprecated():
    """Deprecated: Recording is finalized via /shutdown automatically"""
    raise HTTPException(status_code=410, detail="Deprecated: recording is finalized via /shutdown")

# 元素查询接口
@app.get("/elements")
async def get_elements(selector: str):
    """获取指定选择器匹配的所有元素的信息"""
    return await interaction_handler.get_elements(selector)

# Archived original global elements_batch route (v1):
# @app.get("/elements_batch")
# async def get_elements_batch(selectors: str):
#     """批量获取多个选择器的元素信息，格式: selector1,selector2,selector3"""
#     return await interaction_handler.get_elements_batch(selectors)

@app.get("/elements_batch")
async def get_elements_batch(selectors: str):
    """批量获取多个选择器的元素信息"""
    return await interaction_handler.get_elements_batch_v2(selectors)

# 项目管理接口
@app.post("/load_project")
async def load_project(project_name: str):
    """加载指定的初始项目文件"""
    return await project_manager.load_project(project_name)

@app.post("/export_project")
async def export_project(output_name: str):
    """导出当前项目"""
    return await project_manager.export_project(output_name)

@app.get("/check_file")
async def check_file(file_path: str):
    """检查文件状态"""
    return await project_manager.check_file(file_path)

@app.post("/copy_file")
async def copy_file(source: str, target: str):
    """复制文件"""
    return await project_manager.copy_file(source, target)

# 环境管理接口
@app.post("/reset_environment")
async def reset_environment(
    record: Optional[bool] = False,
    quality: Optional[str] = "medium",
    task_name: Optional[str] = None,
    save_dir: Optional[str] = None,
):
    """重置环境状态; 可选：直接创建带录制的单一上下文并返回 recording_id"""
    try:
        base_result = await browser_manager.reset_environment(
            record=bool(record), quality=quality or "medium", task_name=task_name, save_dir=save_dir
        )
        # 重置后更新所有需要page/browser的管理器（始终指向 BrowserManager 的当前页面）
        page = browser_manager.get_page()
        global interaction_handler, scratch_api
        interaction_handler = InteractionHandler(page, session_id=None)
        scratch_api = ScratchAPI(page, session_id=None)
        project_manager.set_page(page)
        evaluation_service.set_page(page)
        return base_result if isinstance(base_result, dict) else {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Scratch API接口
@app.post("/composite/execute")
async def composite_execute(req: CompositeRequest):
    """Composite API dispatcher. Body: {"api": str, "args": {}}"""
    return await scratch_api.execute(req)

# 评估接口
@app.post("/evaluate")
async def evaluate_project(request: EvaluationRequest):
    """评估Scratch项目"""
    return await evaluation_service.evaluate_project(request)

@app.post("/shutdown")
async def shutdown():
    """优雅关闭环境；若存在录制则先完成录制并返回录制信息"""
    try:
        rec_info = None
        # Finalize recording if active
        if browser_manager and browser_manager.is_recording_enabled():
            try:
                rec_info = await browser_manager.finalize_recording()
            except Exception as e:
                rec_info = {"status": "error", "message": str(e)}

        # 先关闭所有会话，再关闭浏览器/Playwright
        try:
            if session_manager:
                await session_manager.close_all()
        finally:
            if browser_manager:
                await browser_manager.shutdown()

        return {"status": "success", "recording": rec_info}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8081)
