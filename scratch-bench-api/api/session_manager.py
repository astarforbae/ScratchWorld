"""
SessionManager: manages multiple Playwright BrowserContexts/Pages keyed by session_id.
Phase 1 scope: basic CRUD and guardrails. Existing endpoints remain unchanged.
"""
import asyncio
import os
import time
import uuid
import logging
from dataclasses import dataclass, field
from typing import Dict, Optional, Any, Tuple
from pathlib import Path

from playwright.async_api import Browser, BrowserContext, Page
from .scratch_api import ScratchAPI
from .interaction_handlers import InteractionHandler
from .project_manager import ProjectManager
from .evaluation_service import EvaluationService

logger = logging.getLogger("scratch_bench_api")


@dataclass
class Session:
    session_id: str
    context: BrowserContext
    page: Page
    created_at: float = field(default_factory=lambda: time.time())
    last_used_at: float = field(default_factory=lambda: time.time())
    # Recording metadata (if any)
    is_recording: bool = False
    recording_info: Optional[Dict[str, Any]] = None
    recording_session_dir: Optional[str] = None
    recording_final_dir: Optional[str] = None
    # Session-bound service instances
    scratch_api: Optional['ScratchAPI'] = None
    interaction_handler: Optional['InteractionHandler'] = None
    project_manager: Optional['ProjectManager'] = None
    evaluation_service: Optional['EvaluationService'] = None


class SessionManager:
    def __init__(self, browser: Browser, default_viewport: Optional[Dict[str, int]] = None):
        self.browser = browser
        self._sessions: Dict[str, Session] = {}
        self._lock = asyncio.Lock()
        self.max_sessions = self._get_int_env("MAX_SESSIONS", default=100)
        self.session_ttl = self._get_int_env("SESSION_TTL_SECONDS", default=900)
        self.default_viewport = default_viewport or {"width": 1280, "height": 720}
        # Background cleanup task controls
        self._cleanup_task: Optional[asyncio.Task] = None
        self._cleanup_interval = self._get_int_env("SESSION_CLEANUP_INTERVAL_SECONDS", default=30)
        # Simple background cleanup is now supported in addition to lazy cleanup on access.

    def _get_int_env(self, name: str, default: int) -> int:
        try:
            return int(os.getenv(name, str(default)))
        except Exception:
            return default

    async def _delete_oldest_sessions_locked(self, num_to_delete: int) -> None:
        """Delete the oldest sessions by last_used_at timestamp. Must be called with _lock held."""
        if num_to_delete <= 0 or not self._sessions:
            return
        
        # Sort sessions by last_used_at (oldest first)
        sorted_sessions = sorted(self._sessions.items(), key=lambda x: x[1].last_used_at)
        
        # Delete the oldest sessions
        for i in range(min(num_to_delete, len(sorted_sessions))):
            sid, sess = sorted_sessions[i]
            self._sessions.pop(sid, None)
            try:
                # Close context; ignore errors
                if sess.context:
                    await sess.context.close()
            except Exception:
                pass

    async def create_session(self, *, record: bool = False, quality: str = "medium", task_name: Optional[str] = None, save_dir: Optional[str] = None) -> Session:
        async with self._lock:
            await self._cleanup_expired_locked()
            
            # If we're at or over the limit, delete oldest sessions to make room
            if len(self._sessions) >= self.max_sessions:
                num_to_delete = len(self._sessions) - self.max_sessions + 1
                await self._delete_oldest_sessions_locked(num_to_delete)

            # Setup recording directories if needed
            is_recording = bool(record)
            recording_info = None
            session_dir = None
            final_dir = None

            if is_recording:
                timestamp = time.strftime("%Y%m%d_%H%M%S")
                safe_task = (task_name or "recording").strip().replace(" ", "_")[:50]
                recording_id = f"rec_{timestamp}_{safe_task}"
                base_dir = Path(save_dir) if save_dir else Path(__file__).resolve().parents[1] / "recording_cache"
                base_dir.mkdir(parents=True, exist_ok=True)
                session_dir = base_dir / f"session_{recording_id}"
                session_dir.mkdir(parents=True, exist_ok=True)
                final_dir = base_dir

                size_map = {
                    "low": {"width": 854, "height": 480},
                    "medium": {"width": 1280, "height": 720},
                    "high": {"width": 1920, "height": 1080},
                }
                video_size = size_map.get((quality or "medium").lower(), size_map["medium"])

                context = await self.browser.new_context(
                    record_video_dir=str(session_dir),
                    record_video_size=video_size,
                    viewport=video_size,
                )
                page = await context.new_page()
                page.on("dialog", lambda dialog: dialog.accept())

                recording_info = {
                    "recording_id": recording_id,
                    "task_name": safe_task,
                    "quality": quality,
                    "video_size": video_size,
                    "session_dir": str(session_dir),
                    "final_dir": str(final_dir),
                    "start_time": time.strftime("%Y-%m-%dT%H:%M:%S"),
                    "status": "recording",
                }
            else:
                context = await self.browser.new_context(viewport=self.default_viewport)
                page = await context.new_page()
                page.on("dialog", lambda dialog: dialog.accept())

            sid = uuid.uuid4().hex
            sess = Session(
                session_id=sid,
                context=context,
                page=page,
                is_recording=is_recording,
                recording_info=recording_info,
                recording_session_dir=str(session_dir) if session_dir else None,
                recording_final_dir=str(final_dir) if final_dir else None,
            )
            
            # Initialize session-bound service instances
            sess.scratch_api = ScratchAPI(page, session_id=sid)
            sess.interaction_handler = InteractionHandler(page, session_id=sid)
            sess.project_manager = ProjectManager()
            sess.project_manager.set_page(page)
            sess.evaluation_service = EvaluationService()
            sess.evaluation_service.set_page(page)
            
            self._sessions[sid] = sess
            return sess

    async def get_session(self, session_id: str) -> Session:
        async with self._lock:
            await self._cleanup_expired_locked()
            sess = self._sessions.get(session_id)
            if not sess:
                raise KeyError(f"Session not found: {session_id}")
            sess.last_used_at = time.time()
            return sess

    async def list_sessions(self) -> Dict[str, Dict[str, Any]]:
        async with self._lock:
            await self._cleanup_expired_locked()
            out: Dict[str, Dict[str, Any]] = {}
            for sid, s in self._sessions.items():
                out[sid] = {
                    "session_id": s.session_id,
                    "created_at": s.created_at,
                    "last_used_at": s.last_used_at,
                    "is_recording": s.is_recording,
                }
            return out

    async def delete_session(self, session_id: str) -> Dict[str, Any]:
        async with self._lock:
            sess = self._sessions.pop(session_id, None)
        if not sess:
            raise KeyError(f"Session not found: {session_id}")

        rec_info = None
        try:
            # If recording, close context to flush and read file
            if sess.is_recording and sess.recording_info:
                try:
                    await sess.context.close()
                except Exception:
                    pass
                # give it a moment
                await asyncio.sleep(1)
                # Move/rename first .webm into final dir and base64 is deferred to later phases if needed
                try:
                    from pathlib import Path as _P
                    import shutil as _sh
                    import base64 as _b64
                    videos = list(_P(sess.recording_session_dir).glob("*.webm")) if sess.recording_session_dir else []
                    if videos:
                        original = videos[0]
                        target = _P(sess.recording_final_dir) / f"{sess.recording_info.get('recording_id','recording')}.webm"
                        if target.exists():
                            target.unlink()
                        if _P(sess.recording_final_dir) != _P(sess.recording_session_dir):
                            _sh.move(str(original), str(target))
                        else:
                            original.rename(target)
                        data_b64 = None
                        try:
                            raw = target.read_bytes()
                            data_b64 = _b64.b64encode(raw).decode("utf-8")
                        except Exception:
                            data_b64 = None
                        sess.recording_info.update({
                            "end_time": time.strftime("%Y-%m-%dT%H:%M:%S"),
                            "status": "completed",
                            "data_base64": data_b64,
                            "mime_type": "video/webm" if data_b64 else None,
                        })
                        rec_info = sess.recording_info
                except Exception:
                    pass
        finally:
            # Ensure resources are closed
            try:
                if sess.context:
                    await sess.context.close()
            except Exception:
                pass
        return {"status": "closed", "recording": rec_info}

    async def get_page(self, session_id: str) -> Page:
        sess = await self.get_session(session_id)
        return sess.page

    async def _cleanup_expired_locked(self) -> None:
        """Remove and close sessions idle beyond TTL. Must be called with _lock held."""
        if self.session_ttl <= 0:
            return
        now = time.time()
        expired_ids = [sid for sid, s in list(self._sessions.items()) if (now - s.last_used_at) > self.session_ttl]
        for sid in expired_ids:
            sess = self._sessions.pop(sid, None)
            if not sess:
                continue
            try:
                idle_seconds = int(now - sess.last_used_at)
                logger.info(
                    "[session_id=%s] expired session cleanup (idle=%ss, ttl=%ss)",
                    sid,
                    idle_seconds,
                    self.session_ttl,
                )
            except Exception:
                pass
            try:
                # Close context; ignore errors
                if sess.context:
                    await sess.context.close()
            except Exception:
                pass

    async def close_all(self) -> Dict[str, Any]:
        """Gracefully close all active sessions in parallel.

        This method takes a snapshot of current sessions and closes them concurrently
        to significantly improve performance, especially when dealing with recording
        sessions that involve file operations and sleep delays.
        """
        # Take a snapshot of session IDs under lock
        async with self._lock:
            ids = list(self._sessions.keys())
        
        if not ids:
            return {"closed": 0, "errors": {}}
        
        # Create tasks for parallel session deletion
        async def _delete_session_safe(session_id: str) -> Tuple[str, bool, Optional[str]]:
            """Delete a session and return (session_id, success, error_message)"""
            try:
                await self.delete_session(session_id)
                return session_id, True, None
            except Exception as e:
                return session_id, False, str(e)
        
        # Run all deletions in parallel
        tasks = [_delete_session_safe(sid) for sid in ids]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        closed = 0
        errors: Dict[str, str] = {}
        
        for result in results:
            if isinstance(result, Exception):
                # This shouldn't happen with our safe wrapper, but just in case
                errors["unknown"] = str(result)
            else:
                session_id, success, error_msg = result
                if success:
                    closed += 1
                else:
                    errors[session_id] = error_msg or "Unknown error"
        
        return {"closed": closed, "errors": errors}

    # -----------------------------
    # Background cleanup management
    # -----------------------------
    def start_cleanup(self) -> None:
        """Start periodic cleanup of expired sessions if not already running."""
        if self._cleanup_task is None or self._cleanup_task.done():
            async def _loop():
                try:
                    while True:
                        try:
                            async with self._lock:
                                await self._cleanup_expired_locked()
                        except Exception:
                            # Never crash the loop due to cleanup error
                            pass
                        await asyncio.sleep(max(1, int(self._cleanup_interval)))
                except asyncio.CancelledError:
                    # Graceful exit
                    pass

            self._cleanup_task = asyncio.create_task(_loop())

    async def stop_cleanup(self) -> None:
        """Stop the periodic cleanup task if running."""
        task = self._cleanup_task
        self._cleanup_task = None
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
