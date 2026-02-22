"""
Pydantic models for the Scratch GUI Agent API.
"""
from typing import Dict, Any, List, Optional
from pydantic import BaseModel


# Mouse and keyboard action models
class ClickAction(BaseModel):
    x: int
    y: int
    button: str = "left"  # left, middle, right


class DoubleClickAction(BaseModel):
    x: int
    y: int
    button: str = "left"  # left, middle, right


class RightClickAction(BaseModel):
    x: int
    y: int


class MoveToAction(BaseModel):
    x: int
    y: int
    duration: float = 0.5  # 移动时长（秒）


class DragAndDropAction(BaseModel):
    start_x: int
    start_y: int
    end_x: int
    end_y: int
    duration: float = 0.5  # 拖拽时长（秒）


class ScrollAction(BaseModel):
    direction: str  # "up", "down", "left", "right"
    amount: int = 100  # 滚动量
    x: Optional[int] = None  # 滚动位置x坐标（可选）
    y: Optional[int] = None  # 滚动位置y坐标（可选）


class TypeAction(BaseModel):
    text: str


class KeyAction(BaseModel):
    key: str  # 例如 "Enter", "ArrowLeft", "Escape" 等


class HoldKeyAction(BaseModel):
    key: str  # 要按住的按键


class ReleaseKeyAction(BaseModel):
    key: str  # 要释放的按键


class HotkeyAction(BaseModel):
    # 组合键列表，例如 ["ctrl", "a"] 或 ["Control", "A"]。
    # 服务器端会将常见别名（ctrl/cmd/option/esc 等）规范化为 Playwright 键名。
    keys: List[str]


class ElementAction(BaseModel):
    selector: str
    action: str  # click, hover, focus, type
    text: Optional[str] = None  # 如果action是type，则需要此字段


class WaitAction(BaseModel):
    milliseconds: int


# API request models
class CompositeRequest(BaseModel):
    """Envelope for composite API calls: {"api": str, "args": {}}"""
    api: str
    args: Optional[Dict[str, Any]] = None


class EvaluationRequest(BaseModel):
    task_name: str
    sb3_file_name: Optional[str] = None
    evaluation_method: str = "node"  # "node" or "browser"
    timeout: Optional[int] = None


class StartRecordingRequest(BaseModel):
    task_name: str
    quality: str = "medium"  # low, medium, high
    save_dir: Optional[str] = None  # 自定义保存目录


class EndRecordingRequest(BaseModel):
    recording_id: str
