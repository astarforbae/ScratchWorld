#!/usr/bin/env python3
"""
Single-Step Drag Benchmark Runner - 简化版任务执行器
执行单步动作预测任务：获取观测 -> 模型预测 -> 执行动作
"""

import json
import os
import sys
import time
import base64
import logging
import argparse
import socket
import subprocess
import copy
import re
import io
from pathlib import Path
from typing import Dict, Any, Optional, List
from datetime import datetime
from dotenv import load_dotenv
import requests
from openai import OpenAI
from PIL import Image, ImageDraw
from io import BytesIO

BENCHMARK_DIR = Path(__file__).parent / "single_step_drag_benchmark"
if str(BENCHMARK_DIR) not in sys.path:
    sys.path.insert(0, str(BENCHMARK_DIR))

from single_step_drag_benchmark.connection_utils import verify_connection
from single_step_drag_benchmark.coordinate_resize import resize_action_coordinates, get_resizer, Qwen3VLResizer, UITarsResizer

# ============================================================================
# 拖拽任务的启发式知识经验
# ============================================================================

DRAG_KNOWLEDGE = """
### Experience & Heuristics for Coordinate Prediction
Note: All pixel values (px) mentioned below are in a 1280x720 coordinate system. The provided screenshots also have this 1280x720 resolution.

1. Start Point
Target: The visible body of the Source Block (or the Top Block if moving a stack).
Heuristic: Set start_point near the Left Edge of the block (e.g., 10-20px from the left).   
Note: Grabbing the Top Block prevents splitting the stack; grabbing the left side facilitates alignment.

2. End Point - Vertical Stacking (Command Blocks)
    Context: Connecting single blocks or entire stacks vertically.

Appending (Bottom): (Same for single blocks & stacks)
Align X with Target's Left Edge. Set Y 15-20px below Target's Bottom Edge.

Prepending (Top): (Inserting above)
Align X with Target's Left Edge.
Height Adjustment: Set Y to Target_Top_Y - Source_Height.
Reasoning: Since the cursor holds the top of the source stack, you must lift it by its total height so its bottom connects with the target's top.

3. End Point - Nesting (Inside C-Blocks)
Context: Placing a block/stack inside container blocks like "Forever".
X: Indent 15-20px to the right of Target's Left Edge.
Y: Position 15-20px below the bottom edge of the C-block's "top arm" (inside the mouth).

4. End Point - Parameter Insertion (Values & Booleans)
Context: Dropping round (Reporter) or hexagonal (Boolean) blocks into input slots.
Target: The specific empty input slot (white oval or hexagon) on the Target Block.
Heuristic: Set end_point to the geometric center of that target input slot.
"""

SYSTEM_PROMPT_SCREENSHOT = """You are an AI assistant that controls the Scratch programming environment. Your task is: INSTRUCTION

You need to perform a drag-and-drop action to complete this task.

Output the action in the following format:
drag(start_point='<point>x1 y1</point>', end_point='<point>x2 y2</point>')

Where (x1 y1) is the starting position and (x2 y2) is the ending position.

Example:
drag(start_point='<point>100 200</point>', end_point='<point>300 400</point>')
"""

SYSTEM_PROMPT_WITH_ELEMENT_LIST = """You are an AI assistant that controls the Scratch programming environment. You have access to a list of elements on the webpage. Your task is: INSTRUCTION

You need to perform a drag-and-drop action to complete this task.

You can use either element indices or coordinates:
- Use <index>number</index> for element indices (based on the element list)
- Use <point>x y</point> for screen coordinates

Output formats:
drag(start_point='<index>0</index>', end_point='<index>5</index>')
drag(start_point='<point>100 200</point>', end_point='<point>300 400</point>')
drag(start_point='<index>0</index>', end_point='<point>300 400</point>')

Example:
drag(start_point='<index>1</index>', end_point='<index>3</index>')
"""

SET_WORKSPACE_STATE_JS = """
({ ws, payload }) => {
    if (!ws) return { success: false, error: "Workspace not available" };
    const canvas = ws.getCanvas();
    if (!canvas) return { success: false, error: "Cannot get canvas" };
    const bubbleCanvas = ws.getBubbleCanvas();
    const has = Object.prototype.hasOwnProperty;
    const scale = (payload && has.call(payload, 'scale')) ? (parseFloat(payload.scale) || 1) : (ws.scale || 1);
    if (typeof ws.setScale === 'function') {
        ws.setScale(scale);
    } else {
        ws.scale = scale;
    }
    const denom = scale || 1;
    let scrollX;
    let scrollY;
    if (payload && has.call(payload, 'scrollX')) {
        scrollX = parseFloat(payload.scrollX) || 0;
    } else if (payload && has.call(payload, 'tx')) {
        scrollX = -(parseFloat(payload.tx) || 0) / denom;
    } else {
        scrollX = 0;
    }
    if (payload && has.call(payload, 'scrollY')) {
        scrollY = parseFloat(payload.scrollY) || 0;
    } else if (payload && has.call(payload, 'ty')) {
        scrollY = -(parseFloat(payload.ty) || 0) / denom;
    } else {
        scrollY = 0;
    }
    const tx = -scrollX * denom;
    const ty = -scrollY * denom;
    let applied = false;
    if (ws.scrollbar && typeof ws.scrollbar.set === 'function') {
        try {
            ws.scrollbar.set(scrollX, scrollY);
            applied = true;
        } catch (e) {
            applied = false;
        }
    }
    if (!applied && typeof ws.translate === 'function') {
        ws.scrollX = scrollX;
        ws.scrollY = scrollY;
        ws.translate(-scrollX, -scrollY);
        if (typeof ws.resizeContents === 'function') ws.resizeContents();
        applied = true;
    }
    if (!applied && typeof ws.scroll === 'function') {
        try {
            const prevX = ws.scrollX || 0;
            const prevY = ws.scrollY || 0;
            ws.scroll(scrollX - prevX, scrollY - prevY);
            ws.scrollX = scrollX;
            ws.scrollY = scrollY;
            applied = true;
        } catch (e) {
            applied = false;
        }
    }
    const finalTransform = 'translate(' + tx + ',' + ty + ') scale(' + scale + ')';
    canvas.setAttribute('transform', finalTransform);
    if (bubbleCanvas) {
        bubbleCanvas.setAttribute('transform', finalTransform);
    }
    ws.scrollX = scrollX;
    ws.scrollY = scrollY;
    return {
        success: true,
        transform: finalTransform,
        tx,
        ty,
        scale,
        scrollX: ws.scrollX,
        scrollY: ws.scrollY
    };
}
"""

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# 任务目录和API目录
TASKS_DIR = BENCHMARK_DIR / "tasks"
API_DIR = Path(__file__).parent / "scratch-bench-api"
BACKEND_LOG_PATH = BENCHMARK_DIR / "run_single_step_drag_benchmark_backend.log"

# 预先动作的执行顺序
ACTION_ORDER_KEYS = [
    "switch_sprite_actions",
    "locate_target_actions"
]

# 低级动作列表
LOW_LEVEL_ACTIONS = {
    "click",
    "double_click",
    "move_to",
    "drag_and_drop",
    "scroll",
    "type",
    "key",
    "hold_key",
    "release_key",
    "hotkey",
}

# ============================================================================
# API 服务器启动和停止函数
# ============================================================================

def find_free_port():
    """找一个空闲的端口"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


def wait_for_api(url, timeout=30):
    """等待API服务器启动"""
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            requests.get(f"{url}/", timeout=2)
            return True
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
            time.sleep(0.5)
            continue
    raise TimeoutError(f"API server did not start at {url}")


def start_api_server(port, log_path):
    """启动Scratch后端API服务器"""
    env = os.environ.copy()
    env["SESSION_TTL_SECONDS"] = "3600"
    cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "api.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
        "--log-level",
        "warning",
        "--no-access-log",
    ]
    log_file = open(log_path, "a", encoding="utf-8")
    process = subprocess.Popen(
        cmd,
        cwd=str(API_DIR),
        env=env,
        stdout=log_file,
        stderr=log_file,
    )
    return process, log_file


def stop_api_server(process, log_file):
    """停止API服务器"""
    if process:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
    if log_file:
        log_file.close()


class SingleStepDragBenchmarkRunner:
    """单步拖拽基准执行器"""
    
    def __init__(
        self,
        model_name: str,
        use_element_list: bool = True,
        api_url: str = "http://localhost:8081",
        ground_truth_start: bool = False,
        use_knowledge: bool = False,
    ):
        """
        初始化任务执行器
        
        Args:
            model_name: LLM模型名称
            use_element_list: 是否在prompt中使用element list
            api_url: Scratch后端API地址
            ground_truth_start: 是否在prompt中提供可行起点
            use_knowledge: 是否在prompt中添加启发式知识经验
        """
        self.model_name = model_name
        self.api_url = api_url
        self.session_id: Optional[str] = None
        self.use_element_list = use_element_list
        self.ground_truth_start = ground_truth_start
        self.use_knowledge = use_knowledge
        self._current_elements: list = []  # 存储当前观测的元素列表，用于索引解析
        
        # 创建结果目录
        safe_model_name = model_name.replace('/', '_').replace('\\', '_').replace('-', '_')
        element_suffix = "_use_element_list" if use_element_list else ""
        ground_truth_suffix = "_ground_truth_start" if ground_truth_start else ""
        knowledge_suffix = "_knowledge" if use_knowledge else ""
        self.result_dir = Path(
            f"result_single_step_drag_benchmark_{safe_model_name}{element_suffix}{ground_truth_suffix}{knowledge_suffix}"
        )
        self.result_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"结果目录: {self.result_dir}")
        logger.info(f"使用Element List: {use_element_list}")
        
        # 初始化OpenAI客户端
        api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("LLM_API_KEY")
        base_url = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")
        self.client = OpenAI(api_key=api_key, base_url=base_url)
        logger.info(f"使用模型: {model_name}")
        logger.info(f"API地址: {base_url}")
    
    def load_tasks_from_directory(self, task_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """从 single_step_drag_benchmark/tasks/ 目录加载任务（可选单任务）"""
        tasks = []
        if not TASKS_DIR.exists():
            logger.error(f"任务目录不存在: {TASKS_DIR}")
            return tasks

        if task_id:
            task_name = task_id if task_id.endswith(".json") else f"{task_id}.json"
            task_path = TASKS_DIR / task_name
            if not task_path.exists():
                logger.error(f"任务文件不存在: {task_path}")
                return tasks
            task_files = [task_path]
        else:
            task_files = sorted(TASKS_DIR.glob("*.json"))
            logger.info(f"找到 {len(task_files)} 个任务文件")

        for task_file in task_files:
            try:
                with open(task_file, 'r', encoding='utf-8') as f:
                    task_data = json.load(f)
                    tasks.append(task_data)
                    logger.info(f"加载任务: {task_file.name} - {task_data.get('id')}")
            except Exception as e:
                logger.error(f"加载任务文件失败 {task_file}: {e}")

        return tasks
    
    def build_action_plan(self, eval_config: Dict[str, Any]) -> List[tuple]:
        """从 evaluation_config 构建预先动作计划"""
        plan = []
        for key in ACTION_ORDER_KEYS:
            actions = eval_config.get(key)
            if actions:
                plan.append((key, actions))
        return plan
    
    def execute_single_action(self, action: Dict[str, Any]) -> bool:
        """执行单个动作"""
        api = action.get("api")
        args = action.get("args", {})
        
        if not api:
            logger.warning("动作缺少 api 字段")
            return False
        
        try:
            if api in LOW_LEVEL_ACTIONS:
                # 低级动作直接调用
                # 对于拖拽动作，设置duration为0.5
                if api == "drag_and_drop":
                        args["duration"] = 0.5
                url = self._url(f"/{api}")
                resp = requests.post(url, json=args, timeout=10)
            else:
                # 封装动作调用 encapsulated/execute
                url = self._url("/encapsulated/execute")
                payload = {"api": api, "args": args}
                resp = requests.post(url, json=payload, timeout=10)
            
            if resp.status_code == 200:
                return True
            else:
                logger.warning(f"动作执行返回非200状态: {resp.status_code}")
                return False
        except Exception as e:
            logger.error(f"执行动作异常 {api}: {e}")
            return False
    
    def execute_actions(self, actions: List[Dict[str, Any]]) -> bool:
        """执行一组动作"""
        if not actions:
            return True
        
        success = True
        for action in actions:
            if not self.execute_single_action(action):
                success = False
                logger.warning(f"动作执行失败: {action}")
            time.sleep(0.1)  # 动作间短暂等待
        
        return success
    
    def execute_pre_actions(self, eval_config: Dict[str, Any]) -> bool:
        """执行任务中定义的预先动作"""
        action_plan = self.build_action_plan(eval_config)
        
        if not action_plan:
            logger.info("没有预先动作需要执行")
            return True
        
        logger.info("开始执行预先动作...")
        success = True
        
        for key, actions in action_plan:
            logger.info(f"执行 {key} ({len(actions)} 个动作)")
            if not self.execute_actions(actions):
                success = False
                logger.warning(f"{key} 执行失败或部分失败")
        
        if success:
            logger.info("所有预先动作执行完成")
        else:
            logger.warning("部分预先动作执行失败")
        
        return success

    
    def _url(self, route: str) -> str:
        """构建API URL"""
        if self.session_id:
            return f"{self.api_url}/sessions/{self.session_id}{route}"
        return f"{self.api_url}{route}"
    
    def create_session(self) -> bool:
        """创建会话"""
        try:
            resp = requests.post(f"{self.api_url}/sessions", timeout=20)
            if resp.status_code != 200:
                logger.error(f"创建会话失败: {resp.status_code} {resp.text}")
                return False
            
            data = resp.json()
            self.session_id = data.get("session_id") or data.get("id")
            if not self.session_id:
                logger.error("未返回session_id")
                return False
            
            logger.info(f"会话创建成功: {self.session_id}")
            return True
        except Exception as e:
            logger.error(f"创建会话异常: {e}")
            return False
    
    def close_session(self) -> bool:
        """关闭会话"""
        if not self.session_id:
            return True
        
        try:
            resp = requests.delete(f"{self.api_url}/sessions/{self.session_id}", timeout=20)
            if resp.status_code != 200:
                logger.warning(f"关闭会话失败: {resp.status_code}")
            else:
                logger.info(f"会话已关闭: {self.session_id}")
            return True
        except Exception as e:
            logger.error(f"关闭会话异常: {e}")
            return False
    
    def load_project(self, project_name: str) -> bool:
        """加载初始项目"""
        try:
            response = requests.post(
                self._url("/load_project"),
                params={"project_name": project_name},
                timeout=30
            )
            if response.status_code != 200:
                logger.error(f"加载项目失败: {response.text}")
                return False
            
            logger.info(f"项目加载成功: {project_name}")
            return True
        except Exception as e:
            logger.error(f"加载项目异常: {e}")
            return False
    
    def toggle_stage(self) -> bool:
        """切换舞台大小"""
        try:
            response = requests.post(self._url("/toggle_stage"), timeout=10)
            if response.status_code != 200:
                logger.warning(f"切换舞台失败: {response.text}")
                return False
            
            logger.info("舞台已切换到小舞台")
            return True
        except Exception as e:
            logger.warning(f"切换舞台异常: {e}")
            return False

    def set_workspace_state(self, state: Optional[Dict[str, Any]]) -> bool:
        """设置画布状态（平移/缩放/滚动）"""
        if not state:
            return True
        try:
            url = self._url("/encapsulated/execute")
            payload = {"api": "custom_js", "args": {"fn": SET_WORKSPACE_STATE_JS, "payload": state}}
            resp = requests.post(url, json=payload, timeout=10)
            if resp.status_code != 200:
                logger.warning(f"设置画布状态失败: HTTP {resp.status_code}")
                return False
            data = resp.json().get("data", {}).get("result", {})
            if not data.get("success"):
                logger.warning(f"设置画布状态失败: {data.get('error', 'unknown error')}")
                return False
            return True
        except Exception as e:
            logger.warning(f"设置画布状态异常: {e}")
            return False
    
    def get_observation(self) -> Dict[str, Any]:
        """获取环境观测"""
        try:
            # 获取截图
            screenshot_response = requests.get(
                self._url("/screenshot"),
                params={"format": "base64"},
                timeout=30
            )
            screenshot_response.raise_for_status()
            screenshot_data = screenshot_response.json()
            
            result = {
                "screenshot": screenshot_data["screenshot"],
                "timestamp": time.time()
            }
            
            # 只在使用元素列表模式时才获取元素信息
            if self.use_element_list:
                # 获取元素列表
                selectors = {
                    "stage": "[data-testid='stage']",
                    "canvas": ".blocklyMainBackground",
                    "inputs": "input",
                    "sprites": ".sprite-selector_sprite-wrapper_df7cJ",
                    "blocks": ".blocklyDraggable",
                    "flyout_buttons": ".blocklyFlyoutButton",
                    "category_menu_item": ".scratchCategoryMenuItem",
                }
                
                name_selector_pairs = [f"{name}::{sel}" for name, sel in selectors.items()]
                selector_string = ",".join(name_selector_pairs)
                
                batch_response = requests.get(
                    self._url("/elements_batch"),
                    params={"selectors": selector_string},
                    timeout=60
                )
                batch_response.raise_for_status()
                batch_data = batch_response.json()
                
                elements = batch_data.get("elements", [])
                
                # 保存当前元素列表，用于索引解析
                self._current_elements = elements if isinstance(elements, list) else []
                
                formatted_elements = self._format_elements(elements)
                result["elements"] = formatted_elements
            
            return result
        except Exception as e:
            logger.error(f"获取观测失败: {e}")
            return {"error": str(e)}
    
    def _format_elements(self, elements: list) -> str:
        """格式化元素列表"""
        if not elements:
            return "No elements found"
        
        lines = ["index    type    text    position"]
        
        for idx, element in enumerate(elements):
            if not isinstance(element, dict):
                continue
            
            elem_type = element.get("type", "")
            text = element.get("block_name") or element.get("text", "")
            position = element.get("position") or element.get("bbox", "")
            
            # 格式化位置信息
            if isinstance(position, dict):
                x = position.get("x", 0)
                y = position.get("y", 0)
                w = position.get("width", 0)
                h = position.get("height", 0)
                position_str = f"({x}, {y}) {w}x{h}"
            else:
                position_str = str(position)
            
            lines.append(f"{idx}    {elem_type}    {text}    {position_str}")
        
        return "\n".join(lines)
    
    def save_screenshot(self, base64_image: str, filename: str, task_dir: Path) -> str:
        """保存截图"""
        try:
            image_data = base64.b64decode(base64_image)
            image = Image.open(BytesIO(image_data))
            
            filepath = task_dir / filename
            image.save(filepath)
            logger.info(f"截图已保存: {filepath}")
            
            return str(filepath)
        except Exception as e:
            logger.error(f"保存截图失败: {e}")
            return ""

    def _mark_screenshot(self, base64_image: str, point: tuple, radius: int = 12, outline_width: int = 4) -> str:
        """在截图上标注红色圆圈，返回新的base64截图"""
        try:
            image_data = base64.b64decode(base64_image)
            image = Image.open(BytesIO(image_data)).convert("RGBA")
            draw = ImageDraw.Draw(image)
            x, y = point
            left = max(0, int(x - radius))
            top = max(0, int(y - radius))
            right = min(image.width - 1, int(x + radius))
            bottom = min(image.height - 1, int(y + radius))
            draw.ellipse([left, top, right, bottom], outline=(255, 0, 0, 255), width=outline_width)

            buffer = BytesIO()
            image.save(buffer, format="PNG")
            return base64.b64encode(buffer.getvalue()).decode("utf-8")
        except Exception as e:
            logger.warning(f"标注截图失败: {e}")
            return base64_image
    
    def execute_action(self, action_plan: Dict[str, Any]) -> Dict[str, Any]:
        """执行动作"""
        try:
            api_type = action_plan.get("api")
            args = action_plan.get("args", {})
            
            # 如果使用了 element list，需要将索引解析为坐标
            if self.use_element_list:
                resolved_args = self._resolve_index_args(args)
                if "error" in resolved_args:
                    return resolved_args
                args = resolved_args
            
            # 构建请求
            response = requests.post(
                self._url(f"/{api_type}"),
                json=args,
                timeout=30
            )
            
            if response.status_code != 200:
                return {
                    "ok": False,
                    "error": f"HTTP {response.status_code}: {response.text}"
                }
            
            result = response.json()
            return result
        except Exception as e:
            logger.error(f"执行动作失败: {e}")
            return {"ok": False, "error": str(e)}
    
    def _resolve_index_args(self, args: Dict[str, Any]) -> Dict[str, Any]:
        """
        将索引参数解析为坐标参数
        
        Args:
            args: 可能包含索引的参数字典
            
        Returns:
            解析后的参数字典（索引转换为坐标）
        """
        resolved_args = dict(args)
        
        try:
            # 处理 drag_and_drop 动作
            if "start_index" in resolved_args:
                start_index = resolved_args.pop("start_index")
                if "start_x" not in resolved_args or "start_y" not in resolved_args:
                    start_x, start_y = self._get_element_center_by_index(start_index)
                    resolved_args["start_x"] = start_x
                    resolved_args["start_y"] = start_y
                    logger.info(f"解析 start_index {start_index} 为坐标 ({start_x}, {start_y})")
            
            if "end_index" in resolved_args:
                end_index = resolved_args.pop("end_index")
                if "end_x" not in resolved_args or "end_y" not in resolved_args:
                    end_x, end_y = self._get_element_center_by_index(end_index)
                    resolved_args["end_x"] = end_x
                    resolved_args["end_y"] = end_y
                    logger.info(f"解析 end_index {end_index} 为坐标 ({end_x}, {end_y})")
            
            return resolved_args
            
        except ValueError as e:
            logger.error(f"索引解析失败: {e}")
            return {"error": f"Index resolution failed: {e}"}
    
    def _get_element_center_by_index(self, index: int) -> tuple:
        """
        根据元素索引获取其中心坐标
        
        Args:
            index: 元素索引（0-based）
            
        Returns:
            (center_x, center_y) 坐标元组
            
        Raises:
            ValueError: 如果索引无效或元素没有位置信息
        """
        if not isinstance(self._current_elements, list):
            raise ValueError("没有可用的元素列表用于索引解析")
        
        if index < 0 or index >= len(self._current_elements):
            raise ValueError(f"索引 {index} 超出范围 (0..{len(self._current_elements)-1})")
        
        element = self._current_elements[index]
        if not isinstance(element, dict):
            raise ValueError(f"索引 {index} 处的元素结构无效")
        
        # 获取位置信息
        position_data = element.get("position") or element.get("bbox")
        if not position_data:
            raise ValueError(f"索引 {index} 处的元素没有位置信息")
        
        try:
            # 解析位置信息
            if isinstance(position_data, dict):
                x = int(position_data.get('x', 0))
                y = int(position_data.get('y', 0))
                width = int(position_data.get('width', 0))
                height = int(position_data.get('height', 0))
            elif isinstance(position_data, str):
                # 支持字符串格式 "(x, y) widthxheight"
                parts = position_data.split(') ')
                if len(parts) != 2:
                    raise ValueError(f"无法解析位置格式: {position_data}")
                coords_part = parts[0][1:]  # 移除开头的 '('
                x, y = map(int, coords_part.split(', '))
                dimensions_part = parts[1]
                width, height = map(int, dimensions_part.split('x'))
            else:
                raise ValueError(f"无效的位置数据类型: {type(position_data)}")
            
            # 计算中心坐标
            center_x = int(x + width / 2)
            center_y = int(y + height / 2)
            return center_x, center_y
            
        except (ValueError, IndexError, KeyError) as e:
            raise ValueError(f"无法解析索引 {index} 处的位置信息: {e}")
    
    def export_project(self, task_id: int, task_dir: Path) -> Optional[str]:
        """导出项目文件到任务目录"""
        output_filename = f"task_{task_id}_{int(time.time())}.sb3"
        logger.info(f"导出项目: {output_filename}")
        
        try:
            response = requests.post(
                self._url("/export_project"),
                params={"output_name": output_filename},
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                data_b64 = result.get("data_base64")
                filename = result.get("filename", output_filename)
                size = result.get("size")
                
                if not data_b64:
                    logger.error(f"项目导出响应缺少data_base64: {result}")
                    return None
                
                # 解码并保存文件
                raw = base64.b64decode(data_b64)
                target_path = task_dir / filename
                target_path.write_bytes(raw)
                logger.info(f"项目文件已保存: {target_path} ({len(raw)} bytes)")
                
                if size is not None and size != len(raw):
                    logger.warning(f"报告的大小 {size} != 写入的大小 {len(raw)}")
                
                return filename
            else:
                logger.error(f"项目导出失败: {response.text}")
                return None
        except Exception as e:
            logger.error(f"导出项目异常: {e}")
            return None
    
    def fetch_blocks_structure(self):
        """获取块结构"""
        try:
            url = self._url("/encapsulated/execute")
            payload = {"api": "get_blocks_structure", "args": {}}
            resp = requests.post(url, json=payload, timeout=10)
            if resp.status_code == 200:
                return resp.json().get("data", {})
        except Exception as e:
            logger.error(f"获取块结构失败: {e}")
        return {}
    
    
    def evaluation(self, eval_config, pre_drag_ids=None):
        """验证拖拽是否成功"""
        try:
            # 获取块结构
            structure_data = self.fetch_blocks_structure()
            if not structure_data:
                logger.error("无法获取块结构")
                return False
            
            id_to_block = structure_data.get("idToBlock", {})
            if not id_to_block:
                logger.error("块结构中没有idToBlock")
                return False
            
            # 获取必要信息
            target_block_id = eval_config.get("target_block_id")
            target_block_opcode = eval_config.get("target_block_opcode")
            reference_block_id = eval_config.get("reference_block_id")
            connection_type = eval_config.get("connection_type")
            target_input_name = eval_config.get("target_input_name")
            target_stack_tail_block_id = eval_config.get("target_stack_tail_block_id")
            variable_name = eval_config.get("variable_name")
            
            if not reference_block_id:
                logger.error("缺少reference_block_id")
                return False
            
            if not connection_type:
                logger.error("缺少connection_type")
                return False
            
            # 获取块信息
            target_info = None
            if not target_block_id and target_block_opcode and pre_drag_ids:
                current_ids = set(id_to_block.keys())
                new_ids = current_ids - set(pre_drag_ids)
                opcode_matches = [
                    block_id
                    for block_id in new_ids
                    if id_to_block.get(block_id, {}).get("opcode") == target_block_opcode
                ]
                if len(opcode_matches) == 1:
                    target_block_id = opcode_matches[0]
                elif len(new_ids) == 1:
                    target_block_id = list(new_ids)[0]
                else:
                    logger.warning(
                        f"flyout 目标块未唯一识别: opcode={target_block_opcode}, new_ids={len(new_ids)}"
                    )
            if target_block_id:
                target_info = id_to_block.get(target_block_id)
                if not target_info:
                    logger.warning(f"目标块 {target_block_id} 未找到")
            
            ref_info = id_to_block.get(reference_block_id)
            if not ref_info:
                logger.error(f"参考块 {reference_block_id} 未找到")
                return False
            
            # 验证连接
            is_valid = verify_connection(
                target_info,
                ref_info,
                connection_type,
                id_to_block,
                target_input_name=target_input_name,
                target_stack_tail_block_id=target_stack_tail_block_id,
                variable_name=variable_name,
            )
            
            logger.info(f"连接验证结果: {is_valid} (类型: {connection_type})")
            return is_valid
            
        except Exception as e:
            logger.error(f"验证过程中发生异常: {e}")
            return False
    
    def call_llm(self, messages: list, task_dir: Path) -> Optional[Dict[str, Any]]:
        """调用LLM并记录"""
        try:
            # 调用LLM

            if "gpt-5" in self.model_name.lower():
                response = self.client.chat.completions.create(
                    model=self.model_name,
                    messages=messages,
                    reasoning_effort="low",
                    extra_body={
                        "allowed_openai_params": ["reasoning_effort"],
                    },
                )
            else:
                response = self.client.chat.completions.create(
                    model=self.model_name,
                    messages=messages,
                    temperature=0.7,
                    top_p=0.9,
                )

            
            # 提取响应
            assistant_message = response.choices[0].message
            content = assistant_message.content
            
            # 解析动作
            action_plan = self._parse_action(content)
            
            # 保存调用日志
            call_log = {
                "model": self.model_name,
                "timestamp": datetime.now().isoformat(),
                "messages": self._sanitize_messages_for_log(messages),
                "response": {
                    "content": content,
                    "usage": {
                        "prompt_tokens": response.usage.prompt_tokens,
                        "completion_tokens": response.usage.completion_tokens,
                        "total_tokens": response.usage.total_tokens
                    }
                },
                "parsed_action": action_plan
            }
            
            log_file = task_dir / "call.log"
            with open(log_file, 'w', encoding='utf-8') as f:
                json.dump(call_log, f, indent=2, ensure_ascii=False)
            
            logger.info(f"LLM调用日志已保存: {log_file}")
            
            return action_plan
        except Exception as e:
            logger.error(f"LLM调用失败: {e}")
            return None
    
    def _sanitize_messages_for_log(self, messages: list) -> list:
        """清理消息中的base64图片数据"""
        import copy
        sanitized = copy.deepcopy(messages)
        
        for msg in sanitized:
            if "content" not in msg:
                continue
            
            content = msg["content"]
            if not isinstance(content, list):
                continue
            
            for item in content:
                if not isinstance(item, dict):
                    continue
                
                if item.get("type") == "image_url":
                    if "image_url" in item and isinstance(item["image_url"], dict):
                        url = item["image_url"].get("url", "")
                        if url.startswith("data:image"):
                            item["image_url"]["url"] = "<base64_image_data_omitted>"
        
        return sanitized
    
    def _parse_action(self, content: str) -> Optional[Dict[str, Any]]:
        """从LLM响应中解析动作 - 支持多种格式"""
        try:
            import re
            logger.info(f"原始响应内容: {content}")
            
            # 格式1: UI-TARS 标准格式 drag(start_point='<point>x1 y1</point>', end_point='<point>x2 y2</point>')
            # 同时支持逗号分隔 drag(start_point='<point>x1,y1</point>', end_point='<point>x2,y2</point>')
            pattern1a = r"drag\s*\(\s*start_point\s*=\s*['\"]<point>(\d+)\s+?(\d+)</point>['\"]\s*,\s*end_point\s*=\s*['\"]<point>(\d+)\s+?(\d+)</point>['\"]\s*\)"
            pattern1b = r"drag\s*\(\s*start_point\s*=\s*['\"]<point>(\d+)\s*,\s*(\d+)</point>['\"]\s*,\s*end_point\s*=\s*['\"]<point>(\d+)\s*,\s*(\d+)</point>['\"]\s*\)"
            
            match1 = re.search(pattern1a, content)
            if not match1:
                match1 = re.search(pattern1b, content)
            
            if match1:
                x1, y1, x2, y2 = match1.groups()
                action = {
                    'api': 'drag_and_drop',
                    'args': {
                        'start_x': int(x1),
                        'start_y': int(y1),
                        'end_x': int(x2),
                        'end_y': int(y2)
                    }
                }
                logger.info(f"成功解析 UI-TARS 标准格式: start({x1},{y1}) end({x2},{y2})")
                return action
            
            # 格式2: drag 函数 start_point/end_point 带括号格式 drag(start_point='(x1,y1)', end_point='(x2,y2)')
            pattern2 = r"drag\s*\(\s*start_point\s*=\s*['\"]?\((\d+)\s*,\s*(\d+)\)['\"]?\s*,\s*end_point\s*=\s*['\"]?\((\d+)\s*,\s*(\d+)\)['\"]?\s*\)"
            match2 = re.search(pattern2, content)
            
            if match2:
                x1, y1, x2, y2 = match2.groups()
                action = {
                    'api': 'drag_and_drop',
                    'args': {
                        'start_x': int(x1),
                        'start_y': int(y1),
                        'end_x': int(x2),
                        'end_y': int(y2)
                    }
                }
                logger.info(f"成功解析 drag start_point/end_point 括号格式: start({x1},{y1}) end({x2},{y2})")
                return action
            
            # 格式3: drag 函数 start_box/end_box 带括号格式 drag(start_box='(x1,y1)', end_box='(x2,y2)')
            pattern3 = r"drag\s*\(\s*start_box\s*=\s*['\"]?\((\d+)\s*,\s*(\d+)\)['\"]?\s*,\s*end_box\s*=\s*['\"]?\((\d+)\s*,\s*(\d+)\)['\"]?\s*\)"
            match3 = re.search(pattern3, content)
            
            if match3:
                x1, y1, x2, y2 = match3.groups()
                action = {
                    'api': 'drag_and_drop',
                    'args': {
                        'start_x': int(x1),
                        'start_y': int(y1),
                        'end_x': int(x2),
                        'end_y': int(y2)
                    }
                }
                logger.info(f"成功解析 drag start_box/end_box 括号格式: start({x1},{y1}) end({x2},{y2})")
                return action
            
            # 格式4: 简单四元组格式 (x1,y1,x2,y2)
            pattern4 = r'\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\)'
            match4 = re.search(pattern4, content)
            
            if match4:
                x1, y1, x2, y2 = match4.groups()
                action = {
                    'api': 'drag_and_drop',
                    'args': {
                        'start_x': int(x1),
                        'start_y': int(y1),
                        'end_x': int(x2),
                        'end_y': int(y2)
                    }
                }
                logger.info(f"成功解析简单四元组格式: ({x1},{y1},{x2},{y2})")
                return action
            
            # 格式5: 带 <point> 或 <index> 标签的格式 drag(start_point='<point>...</point>', end_point='<point>...</point>')
            # 或 drag(start_point='<index>...</index>', end_point='<index>...</index>')
            pattern5 = r"drag\s*\(\s*start_point\s*=\s*['\"](<(?:point|index)>.*?</(?:point|index)>)['\"]?\s*,\s*end_point\s*=\s*['\"](<(?:point|index)>.*?</(?:point|index)>)['\"]?\s*\)"
            match5 = re.search(pattern5, content)
            
            if match5:
                start_point = match5.group(1)
                end_point = match5.group(2)
                
                # 解析 start_point
                start_data = self._parse_point_or_index(start_point)
                if not start_data:
                    logger.error(f"无法解析 start_point: {start_point}")
                    return None
                
                # 解析 end_point
                end_data = self._parse_point_or_index(end_point)
                if not end_data:
                    logger.error(f"无法解析 end_point: {end_point}")
                    return None
                
                # 构建动作
                args = {}
                
                # 处理 start_point
                if 'x' in start_data and 'y' in start_data:
                    args['start_x'] = start_data['x']
                    args['start_y'] = start_data['y']
                elif 'index' in start_data:
                    args['start_index'] = start_data['index']
                
                # 处理 end_point
                if 'x' in end_data and 'y' in end_data:
                    args['end_x'] = end_data['x']
                    args['end_y'] = end_data['y']
                elif 'index' in end_data:
                    args['end_index'] = end_data['index']
                
                action = {
                    'api': 'drag_and_drop',
                    'args': args
                }
                
                logger.info(f"成功解析带标签格式: {action}")
                return action

            # 格式6: 宽松解析 drag(...)，允许混合/残缺标签与括号
            drag_segment = self._extract_drag_segment(content)
            if drag_segment:
                start_segment = self._extract_arg_segment(
                    drag_segment, target_keys=("start_point", "start_box")
                )
                end_segment = self._extract_arg_segment(
                    drag_segment, target_keys=("end_point", "end_box")
                )
                if start_segment and end_segment:
                    start_data = self._parse_point_or_index(start_segment)
                    end_data = self._parse_point_or_index(end_segment)
                    if start_data and end_data:
                        args = {}
                        if "x" in start_data and "y" in start_data:
                            args["start_x"] = start_data["x"]
                            args["start_y"] = start_data["y"]
                        elif "index" in start_data:
                            args["start_index"] = start_data["index"]

                        if "x" in end_data and "y" in end_data:
                            args["end_x"] = end_data["x"]
                            args["end_y"] = end_data["y"]
                        elif "index" in end_data:
                            args["end_index"] = end_data["index"]

                        action = {"api": "drag_and_drop", "args": args}
                        logger.info(f"成功解析宽松格式: {action}")
                        return action

                # 兜底：在 drag(...) 片段中顺序提取前四个数字
                numbers = re.findall(r"-?\d+", drag_segment)
                if len(numbers) >= 4:
                    x1, y1, x2, y2 = numbers[:4]
                    action = {
                        "api": "drag_and_drop",
                        "args": {
                            "start_x": int(x1),
                            "start_y": int(y1),
                            "end_x": int(x2),
                            "end_y": int(y2),
                        },
                    }
                    logger.info(
                        f"成功解析兜底四数字格式: start({x1},{y1}) end({x2},{y2})"
                    )
                    return action
            
            logger.error(f"未找到有效的坐标格式，原始内容: {content}")
            return None
            
        except Exception as e:
            logger.error(f"解析动作失败: {e}")
            logger.error(f"原始内容: {content}")
            return None
    
    def _parse_point_or_index(self, text: str) -> Optional[Dict[str, Any]]:
        """解析坐标或索引（支持宽松格式）"""
        import re
        
        # 尝试解析 point 格式（空格分隔）
        point_match = re.search(r'<point>(\d+)\s+(\d+)</point>', text)
        if point_match:
            return {
                'x': int(point_match.group(1)),
                'y': int(point_match.group(2))
            }
        
        # 尝试解析 point 格式（逗号分隔）
        point_comma_match = re.search(r'<point>(\d+)\s*,\s*(\d+)</point>', text)
        if point_comma_match:
            return {
                'x': int(point_comma_match.group(1)),
                'y': int(point_comma_match.group(2))
            }
        
        # 尝试解析 index 格式
        index_match = re.search(r'<index>(\d+)</index>', text)
        if index_match:
            return {
                'index': int(index_match.group(1))
            }

        # 宽松解析：如果包含 index 关键字，则取第一个数字作为索引
        if re.search(r"<\s*index\b|\bindex\b", text, re.IGNORECASE):
            nums = re.findall(r"-?\d+", text)
            if nums:
                return {"index": int(nums[0])}

        # 宽松解析：顺序提取前两个数字作为坐标
        nums = re.findall(r"-?\d+", text)
        if len(nums) >= 2:
            return {"x": int(nums[0]), "y": int(nums[1])}
        
        return None

    def _extract_drag_segment(self, content: str) -> Optional[str]:
        """提取 drag(...) 的参数片段（允许缺失右括号）"""
        import re
        match = re.search(r"drag\s*\((.*?)\)", content, re.DOTALL)
        if match:
            return match.group(1)
        match = re.search(r"drag\s*\((.*)", content, re.DOTALL)
        if match:
            return match.group(1)
        return None

    def _extract_arg_segment(
        self,
        text: str,
        target_keys: tuple,
        all_keys: tuple = ("start_point", "end_point", "start_box", "end_box"),
    ) -> Optional[str]:
        """在 drag(...) 参数片段中提取指定参数值的文本"""
        import re
        matches = []
        for key in all_keys:
            for m in re.finditer(rf"{key}\s*=", text, re.IGNORECASE):
                matches.append((m.start(), m.end(), key))
        if not matches:
            return None

        target = min(
            (m for m in matches if m[2] in target_keys),
            key=lambda x: x[0],
            default=None,
        )
        if not target:
            return None

        start = target[1]
        next_pos = min((m[0] for m in matches if m[0] > start), default=None)
        segment = text[start:next_pos] if next_pos else text[start:]
        segment = segment.strip()
        if segment.startswith(","):
            segment = segment[1:].strip()
        # 去掉尾部的分隔符
        while segment and segment[-1] in ",)":
            segment = segment[:-1].rstrip()
        # 去掉包裹引号
        if segment and segment[0] in ("'", '"'):
            quote = segment[0]
            segment = segment[1:]
            end_quote = segment.find(quote)
            if end_quote != -1:
                segment = segment[:end_quote]
        return segment.strip() if segment else None
    
    def run_task(self, task: Dict[str, Any], run_index: int = 1) -> Dict[str, Any]:
        """执行单个任务"""
        task_id = task["id"]
        instruction = task["instruction"]
        init_project = task["init_project"]
        eval_config = task.get("evaluation_config", {})
        workspace_state = eval_config.get("workspace_state")
        
        logger.info(f"=" * 60)
        logger.info(f"开始任务 {task_id}: {instruction}")
        logger.info(f"=" * 60)
        
        # 创建任务目录
        task_dir = self.result_dir / str(task_id) / str(run_index)
        task_dir.mkdir(parents=True, exist_ok=True)
        result_file = task_dir / "result.json"
        if result_file.exists():
            try:
                existing = json.loads(result_file.read_text(encoding="utf-8"))
                if isinstance(existing, dict):
                    existing.setdefault("skipped", True)
                    logger.info(f"结果已存在，跳过: {result_file}")
                    return existing
            except Exception as e:
                logger.error(f"已有结果文件无法读取，跳过: {result_file} ({e})")
                return {
                    "task_id": task_id,
                    "run_index": run_index,
                    "success": False,
                    "error": f"existing result.json unreadable: {e}",
                    "skipped": True,
                    "timestamp": datetime.now().isoformat(),
                }
        
        try:
            # 1. 创建会话
            if not self.create_session():
                return {"success": False, "error": "创建会话失败"}
            
            time.sleep(2)
            
            # 2. 加载初始项目
            if not self.load_project(init_project):
                return {"success": False, "error": "加载项目失败"}
            
            time.sleep(2)
            
            # 3. 切换舞台（与 6_build_gt 一致：先切换舞台，再执行动作）
            self.toggle_stage()
            time.sleep(1)

            # 4. 执行预先动作
            logger.info("检查并执行预先动作...")
            self.execute_pre_actions(eval_config)
            time.sleep(1)

            # 5. 设置画布状态
            if workspace_state:
                logger.info("设置画布状态...")
                self.set_workspace_state(workspace_state)
                time.sleep(0.5)
            
            # 6. 获取初始观测
            logger.info("获取初始观测...")
            observation = self.get_observation()
            if "error" in observation:
                return {"success": False, "error": f"获取观测失败: {observation['error']}"}
            
            # 7. 保存第一张截图（必要时标注起点）
            screenshot_for_prompt = observation["screenshot"]
            if self.ground_truth_start:
                drag_start_point = eval_config.get("drag_start_point")
                if (
                    isinstance(drag_start_point, (list, tuple))
                    and len(drag_start_point) == 2
                ):
                    screenshot_for_prompt = self._mark_screenshot(
                        observation["screenshot"],
                        (int(drag_start_point[0]), int(drag_start_point[1])),
                    )
            self.save_screenshot(screenshot_for_prompt, "1.png", task_dir)

            SYSTEM_PROMPT = SYSTEM_PROMPT_WITH_ELEMENT_LIST if self.use_element_list else SYSTEM_PROMPT_SCREENSHOT
            system_prompt_filled = SYSTEM_PROMPT.replace("INSTRUCTION", instruction)
            
            # 添加启发式知识经验
            if self.use_knowledge:
                system_prompt_filled += DRAG_KNOWLEDGE
            
            if self.ground_truth_start:
                drag_start_point = eval_config.get("drag_start_point")
                if (
                    isinstance(drag_start_point, (list, tuple))
                    and len(drag_start_point) == 2
                ):
                    x, y = drag_start_point
                    
                    # Determine the model's coordinate space and transform the hint accordingly
                    SCREEN_WIDTH = 1280
                    SCREEN_HEIGHT = 720
                    
                    resizer = get_resizer(self.model_name)
                    hint_x, hint_y = x, y
                    coord_desc = "in a 1280x720 coordinate system"
                    
                    if isinstance(resizer, Qwen3VLResizer):
                        # 0-1000 normalized space
                        hint_x = int(x / SCREEN_WIDTH * 1000)
                        hint_y = int(y / SCREEN_HEIGHT * 1000)
                        coord_desc = "(in 0-1000 normalized coordinates)"
                    elif isinstance(resizer, UITarsResizer):
                        # UI-TARS smart_resize space
                        # smart_resize returns (height, width)
                        new_h, new_w = resizer.smart_resize(SCREEN_HEIGHT, SCREEN_WIDTH)
                        hint_x = int(x / SCREEN_WIDTH * new_w)
                        hint_y = int(y / SCREEN_HEIGHT * new_h)
                        coord_desc = f"(in resized {new_w}x{new_h} coordinates)"
                    
                    system_prompt_filled += (
                        f"\n\nHint: A feasible drag start point for completing this task is approximately at ({hint_x}, {hint_y}) "
                        f"{coord_desc}. The start point is also marked with a red circle in the screenshot. "
                    )

            # 8. 构建LLM消息
            system_message = {
                "role": "system",
                "content": system_prompt_filled
            }
            # 复用已标注的截图用于prompt
            user_message = {}
            if self.use_element_list:
                user_message = {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": f"Current state:\n\nElements:\n{observation['elements']}"
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{screenshot_for_prompt}"
                            }
                        }
                    ]
                }
            else:
                user_message = {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{screenshot_for_prompt}"
                            }
                        }
                    ]
                }
            
            messages = [system_message, user_message]
            
            # 9. 调用LLM
            logger.info("调用LLM...")
            action_plan = self.call_llm(messages, task_dir)
            if not action_plan:
                return {"success": False, "error": "LLM调用失败"}
            
            logger.info(f"解析出的动作 (原始坐标): {action_plan}")
            
            # 9.5 坐标变换：将模型输出坐标转换为实际屏幕坐标
            # 不同模型可能有不同的坐标空间，例如 UI-TARS 使用 smart_resize
            # 屏幕尺寸默认 1280x720（与截图一致）
            SCREEN_WIDTH = 1280
            SCREEN_HEIGHT = 720
            action_plan = resize_action_coordinates(
                action_plan, self.model_name, SCREEN_WIDTH, SCREEN_HEIGHT
            )
            logger.info(f"解析出的动作 (变换后坐标): {action_plan}")

            # 注意：不再覆盖模型输出的起点
            # ground_truth_start 模式下仅在 prompt 中提供参考起点（1280x720 坐标系）
            # 模型需要自行输出正确的坐标
            
            # 10. 执行动作
            pre_drag_ids = None
            if eval_config.get("use_flyout"):
                structure_before = self.fetch_blocks_structure()
                pre_drag_ids = list((structure_before or {}).get("idToBlock", {}).keys())
            logger.info("执行动作...")
            result = self.execute_action(action_plan)
            logger.info(f"执行结果: {result}")
            
            time.sleep(2)
            
            # 11. 验证拖拽是否成功
            logger.info("验证拖拽是否成功...")
            evaluation_result = self.evaluation(eval_config, pre_drag_ids=pre_drag_ids)
            logger.info(f"验证结果: {evaluation_result}")

            # 12. 重置画布状态（用于第二次截图）
            if workspace_state:
                logger.info("重置画布状态...")
                self.set_workspace_state(workspace_state)
                time.sleep(0.5)

            # 13. 获取第二次观测
            logger.info("获取第二次观测...")
            observation2 = self.get_observation()
            if "error" not in observation2:
                # 14. 保存第二张截图
                self.save_screenshot(observation2["screenshot"], "2.png", task_dir)

            # 15. 导出项目文件
            logger.info("导出项目文件...")
            exported_filename = self.export_project(task_id, task_dir)

            # 16. 保存任务结果
            task_result = {
                "task_id": task_id,
                "run_index": run_index,
                "instruction": instruction,
                "init_project": init_project,
                "action": action_plan,
                "execution_result": result,
                "evaluation_result": evaluation_result,
                "exported_file": exported_filename,
                "success": result.get("ok", False) and evaluation_result,
                "timestamp": datetime.now().isoformat()
            }
            
            with open(result_file, 'w', encoding='utf-8') as f:
                json.dump(task_result, f, indent=2, ensure_ascii=False)
            
            logger.info(f"任务结果已保存: {result_file}")
            
            return task_result
            
        except Exception as e:
            logger.error(f"任务执行异常: {e}", exc_info=True)
            return {"success": False, "error": str(e)}
        
        finally:
            # 关闭会话
            self.close_session()
            self.session_id = None
    
    def run_all_tasks(self, tasks: Optional[List[Dict[str, Any]]] = None, times: int = 1):
        """执行所有任务"""
        # 从目录加载任务
        if tasks is None:
            tasks = self.load_tasks_from_directory()
        
        if not tasks:
            logger.error("没有找到任务文件")
            return
        
        logger.info(f"开始执行所有任务，共 {len(tasks)} 个，每个任务 {times} 次")
        
        results = []
        for task in tasks:
            for run_index in range(1, times + 1):
                logger.info(f"执行任务 {task.get('id')} 第 {run_index}/{times} 次")
                result = self.run_task(task, run_index=run_index)
                results.append(result)

                # 任务/重复间休息
                time.sleep(3)
        
        # 保存汇总结果
        summary = {
            "model": self.model_name,
            "total_tasks": len(tasks),
            "total_runs": len(tasks) * times,
            "results": results,
            "timestamp": datetime.now().isoformat()
        }
        
        summary_file = self.result_dir / "summary.json"
        with open(summary_file, 'w', encoding='utf-8') as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)
        
        logger.info(f"=" * 60)
        logger.info(f"所有任务执行完成！")
        logger.info(f"成功: {sum(1 for r in results if r.get('success', False))}/{len(results)}")
        logger.info(f"汇总结果: {summary_file}")
        logger.info(f"=" * 60)


def main():
    """主函数"""
    parser = argparse.ArgumentParser(description='单步拖拽基准执行器 - 单步动作预测')
    parser.add_argument(
        '--model',
        type=str,
        default=os.environ.get("LLM_MODEL", "gpt-5"),
        help='LLM模型名称 (默认: gpt-5 或环境变量 LLM_MODEL)'
    )
    parser.add_argument(
        '--element-list',
        action='store_true',
        help='在prompt中包含element list信息'
    )
    parser.add_argument(
        '--ground-truth-start',
        action='store_true',
        help='在prompt中提供evaluation_config.drag_start_point作为可行起点'
    )
    parser.add_argument(
        '--knowledge',
        action='store_true',
        help='在prompt中添加启发式知识经验'
    )
    parser.add_argument(
        '--api-port',
        type=int,
        default=None,
        help='API服务器端口 (默认: 自动寻找空闲端口)'
    )
    parser.add_argument(
        '--times',
        type=int,
        default=1,
        help='每个任务运行次数 (默认: 1)'
    )
    parser.add_argument(
        '--task',
        type=str,
        default=None,
        help='只运行指定任务 (例如 T1_002 或 T1_002.json)'
    )
    parser.add_argument(
        '--env-file',
        type=str,
        default='.env',
        help='环境变量文件路径 (默认: .env)'
    )
    
    args = parser.parse_args()
    
    model_name = args.model
    use_element_list = args.element_list
    ground_truth_start = args.ground_truth_start
    use_knowledge = args.knowledge
    
    env_file = args.env_file
    load_dotenv(env_file)
    logger.info(f"加载环境变量文件: {env_file}")
    
    logger.info(f"使用模型: {model_name}")
    logger.info(f"使用Element List: {use_element_list}")
    logger.info(f"使用Ground Truth Start: {ground_truth_start}")
    logger.info(f"使用Knowledge: {use_knowledge}")
    
    # 启动API服务器
    server_process = None
    server_log = None
    port = args.api_port or find_free_port()
    api_url = f"http://localhost:{port}"
    
    logger.info(f"启动API服务器 (端口 {port})...")
    try:
        server_process, server_log = start_api_server(port, BACKEND_LOG_PATH)
        wait_for_api(api_url)
        logger.info(f"API服务器已启动: {api_url}")
    except Exception as e:
        logger.error(f"API服务器启动失败: {e}")
        if server_process:
            stop_api_server(server_process, server_log)
        return
    
    try:
        # 创建并运行任务执行器
        runner = SingleStepDragBenchmarkRunner(
            model_name=model_name,
            use_element_list=use_element_list,
            api_url=api_url,
            ground_truth_start=ground_truth_start,
            use_knowledge=use_knowledge,
        )
        tasks = runner.load_tasks_from_directory(task_id=args.task) if args.task else None
        runner.run_all_tasks(tasks, times=args.times)
    except Exception as e:
        logger.error(f"任务执行出错: {e}", exc_info=True)
    finally:
        # 停止API服务器
        if server_process:
            logger.info("停止API服务器...")
            stop_api_server(server_process, server_log)
            logger.info("API服务器已停止")


if __name__ == "__main__":
    main()
