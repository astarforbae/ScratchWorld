"""
Video recording management for the Scratch GUI Agent API.
"""
import asyncio
import logging
from datetime import datetime
from pathlib import Path
from playwright.async_api import Browser, BrowserContext, Page
from .models import StartRecordingRequest, EndRecordingRequest

logger = logging.getLogger("scratch_bench_api")


class RecordingManager:
    def __init__(self, browser: Browser):
        self.browser = browser
        self.recording_context = None
        self.recording_sessions = {}  # 存储录制会话信息

    def set_browser(self, browser: Browser) -> None:
        """Update the underlying Playwright Browser reference.

        This should be called whenever the environment resets/restarts the browser
        so that subsequent recordings create contexts on the fresh browser.
        """
        self.browser = browser

    async def start_recording(self, request: StartRecordingRequest) -> dict:
        """开始录制视频"""
        try:
            # 生成录制会话ID
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            recording_id = f"rec_{timestamp}_{request.task_name}"

            # 设置录制质量
            video_size = {
                "low": {"width": 854, "height": 480},
                "medium": {"width": 1280, "height": 720},
                "high": {"width": 1920, "height": 1080}
            }.get(request.quality, {"width": 1280, "height": 720})

            # 创建录制目录
            if request.save_dir:
                # 使用自定义保存目录，在其中创建临时录制子目录
                base_dir = Path(request.save_dir)
                base_dir.mkdir(parents=True, exist_ok=True)
                session_dir = base_dir / f"recording_{recording_id}"
                session_dir.mkdir(exist_ok=True)
                # 记住最终目标目录
                final_dir = base_dir
            else:
                # 使用默认录制目录
                recordings_dir = Path("/usr/src/app/output/recordings")
                recordings_dir.mkdir(parents=True, exist_ok=True)
                session_dir = recordings_dir / recording_id
                session_dir.mkdir(exist_ok=True)
                final_dir = session_dir

            # 创建新的浏览器上下文用于录制
            self.recording_context = await self.browser.new_context(
                record_video_dir=str(session_dir),
                record_video_size=video_size,
                viewport=video_size
            )

            # 创建新页面并导航到Scratch GUI
            new_page = await self.recording_context.new_page()
            await new_page.goto("http://localhost:8601?locale=en", timeout=10000)

            # 保存录制会话信息
            self.recording_sessions[recording_id] = {
                "task_name": request.task_name,
                "start_time": datetime.now().isoformat(),
                "quality": request.quality,
                "session_dir": str(session_dir),  # Playwright录制目录
                "final_dir": str(final_dir),      # 最终文件目标目录
                "custom_save_dir": request.save_dir,  # 用户指定的保存目录
                "status": "recording",
                "page": new_page  # Store the recording page
            }

            logger.info(
                "开始录制: %s task=%s quality=%s size=%sx%s",
                recording_id,
                request.task_name,
                request.quality,
                video_size.get("width"),
                video_size.get("height"),
            )

            return {
                "status": "success",
                "recording_id": recording_id,
                "message": f"开始录制任务: {request.task_name}",
                "video_quality": request.quality,
                "video_size": video_size,
                "page": new_page  # Return the page for use in main.py
            }

        except Exception as e:
            logger.exception("开始录制失败: %s", e)
            raise Exception(f"开始录制失败: {str(e)}")

    async def end_recording(self, request: EndRecordingRequest) -> dict:
        """结束录制视频"""
        try:
            recording_id = request.recording_id

            if recording_id not in self.recording_sessions:
                raise Exception(f"录制会话不存在: {recording_id}")

            session_info = self.recording_sessions[recording_id]

            if self.recording_context:
                # 关闭录制上下文，这会自动保存视频文件
                await self.recording_context.close()
                self.recording_context = None

                # 等待文件写入完成
                await asyncio.sleep(1)

            # 查找生成的视频文件
            session_dir = Path(session_info["session_dir"])
            final_dir = Path(session_info["final_dir"])

            logger.debug(
                "查找视频文件: session_dir=%s final_dir=%s session_exists=%s final_exists=%s",
                session_dir,
                final_dir,
                session_dir.exists(),
                final_dir.exists(),
            )

            # 列出录制目录中的所有文件
            if session_dir.exists():
                all_files = list(session_dir.iterdir())
                logger.debug("录制目录文件数: %d", len(all_files))

            video_files = list(session_dir.glob("*.webm"))
            logger.debug("找到的视频文件数: %d", len(video_files))

            video_file_path = None
            if video_files:
                # 找到原始视频文件
                original_video = video_files[0]

                # 确定最终的视频文件路径
                new_video_name = "task_recording.webm"
                video_file_path = final_dir / new_video_name

                # 如果目标文件已存在，先删除
                if video_file_path.exists():
                    video_file_path.unlink()

                # 移动视频文件到最终目录
                if session_info.get("custom_save_dir"):
                    # 如果是自定义目录，需要移动文件
                    import shutil
                    shutil.move(str(original_video), str(video_file_path))
                    logger.info("视频文件已移动到: %s", video_file_path)

                    # 清理临时录制目录
                    try:
                        session_dir.rmdir()
                        logger.debug("清理临时目录: %s", session_dir)
                    except Exception as e:
                        logger.warning("清理临时目录失败: %s", e, exc_info=True)
                else:
                    # 默认目录，直接重命名
                    original_video.rename(video_file_path)

            # 更新会话信息
            session_info.update({
                "end_time": datetime.now().isoformat(),
                "status": "completed",
                "video_file": str(video_file_path) if video_file_path else None
            })

            # 计算录制时长
            start_time = datetime.fromisoformat(session_info["start_time"])
            end_time = datetime.fromisoformat(session_info["end_time"])
            duration = (end_time - start_time).total_seconds()

            # 获取文件大小
            file_size = None
            if video_file_path and video_file_path.exists():
                file_size_bytes = video_file_path.stat().st_size
                file_size = f"{file_size_bytes / (1024*1024):.1f}MB"

            logger.info("录制完成: %s file=%s duration=%.1fs size=%s", recording_id, video_file_path, duration, file_size)

            return {
                "status": "success",
                "recording_id": recording_id,
                "task_name": session_info["task_name"],
                "video_file": str(video_file_path) if video_file_path else None,
                "duration_seconds": round(duration, 1),
                "file_size": file_size,
                "message": "录制完成"
            }

        except Exception as e:
            logger.exception("结束录制失败: %s", e)
            raise Exception(f"结束录制失败: {str(e)}")

    def get_recording_status(self) -> dict:
        """获取当前录制状态"""
        active_recordings = [
            {
                "recording_id": rid,
                "task_name": info["task_name"],
                "start_time": info["start_time"],
                "status": info["status"]
            }
            for rid, info in self.recording_sessions.items()
            if info["status"] == "recording"
        ]

        return {
            "is_recording": self.recording_context is not None,
            "active_recordings": active_recordings,
            "total_sessions": len(self.recording_sessions)
        }

    def list_recordings(self) -> dict:
        """列出所有录制会话"""
        recordings = []
        for recording_id, info in self.recording_sessions.items():
            recording_info = {
                "recording_id": recording_id,
                "task_name": info["task_name"],
                "start_time": info["start_time"],
                "status": info["status"],
                "quality": info["quality"]
            }

            if info["status"] == "completed":
                recording_info.update({
                    "end_time": info.get("end_time"),
                    "video_file": info.get("video_file")
                })

                # 检查文件是否存在
                if info.get("video_file"):
                    video_path = Path(info["video_file"])
                    recording_info["file_exists"] = video_path.exists()
                    if video_path.exists():
                        file_size_bytes = video_path.stat().st_size
                        recording_info["file_size"] = f"{file_size_bytes / (1024*1024):.1f}MB"

            recordings.append(recording_info)

        return {
            "recordings": recordings,
            "total_count": len(recordings)
        }

    def get_recording_context(self) -> BrowserContext:
        """Get the current recording context"""
        return self.recording_context

    def get_recording_page(self, recording_id: str) -> Page:
        """Get the page for a specific recording session"""
        if recording_id in self.recording_sessions:
            return self.recording_sessions[recording_id].get("page")
        return None
