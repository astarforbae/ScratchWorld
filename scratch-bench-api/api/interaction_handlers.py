"""
Mouse and keyboard interaction handlers for the Scratch GUI Agent API.
"""
import asyncio
import time
import re
import logging
from typing import Any, Dict, List, Optional
from fastapi import HTTPException
from playwright.async_api import Page
from .models import (
    ClickAction, DoubleClickAction, RightClickAction, MoveToAction,
    DragAndDropAction, ScrollAction, TypeAction, KeyAction,
    HoldKeyAction, ReleaseKeyAction, HotkeyAction, ElementAction, WaitAction
)
from .action_response import build_error_response, build_meta, build_success_response
from .utilities import get_element_text_robust, is_element_in_viewport

logger = logging.getLogger("scratch_bench_api")


class InteractionHandler:
    def __init__(self, page: Page, session_id: Optional[str] = None):
        self.page = page
        self.session_id = session_id
        # Pattern to detect characters that are NOT letters or underscores
        self.non_letter_underscore_pattern = re.compile(r'[^a-zA-Z_]')
        # Common key aliases used by agents (e.g. pyautogui-style) -> Playwright key names.
        # Playwright key names are case-sensitive (e.g. "Control", "Meta", "ArrowLeft").
        self._key_aliases = {
            # Modifiers
            "ctrl": "Control",
            "control": "Control",
            "cmd": "Meta",
            "command": "Meta",
            "meta": "Meta",
            "win": "Meta",
            "windows": "Meta",
            "alt": "Alt",
            "option": "Alt",
            "shift": "Shift",
            # Common keys
            "esc": "Escape",
            "escape": "Escape",
            "enter": "Enter",
            "return": "Enter",
            "tab": "Tab",
            "space": "Space",
            "spacebar": "Space",
            "backspace": "Backspace",
            "bksp": "Backspace",
            "delete": "Delete",
            "del": "Delete",
            "insert": "Insert",
            "ins": "Insert",
            "home": "Home",
            "end": "End",
            "pageup": "PageUp",
            "pgup": "PageUp",
            "pagedown": "PageDown",
            "pgdn": "PageDown",
            # Arrows (allow both "left" and "arrowleft" styles)
            "left": "ArrowLeft",
            "right": "ArrowRight",
            "up": "ArrowUp",
            "down": "ArrowDown",
            "arrowleft": "ArrowLeft",
            "arrowright": "ArrowRight",
            "arrowup": "ArrowUp",
            "arrowdown": "ArrowDown",
        }

    def _normalize_key_for_playwright(self, key: str) -> str:
        """
        Normalize commonly-used agent key names (e.g. "ctrl") into Playwright key names
        (e.g. "Control") to avoid "Unknown key" errors.
        """
        if key is None:
            return key
        raw = str(key).strip()
        if not raw:
            return raw

        lowered = raw.lower()
        if lowered in self._key_aliases:
            return self._key_aliases[lowered]

        # Accept "arrow_left", "page-down", etc.
        compact = re.sub(r"[^a-z0-9]", "", lowered)
        if compact in self._key_aliases:
            return self._key_aliases[compact]

        # Function keys: f1..f24 -> F1..F24
        if re.fullmatch(r"f\d{1,2}", lowered):
            return lowered.upper()

        return raw

    def _keyboard_exception_http_status(self, exc: Exception) -> int:
        msg = str(exc) or ""
        # Playwright raises messages like: Keyboard.down: Unknown key: "ctrl"
        if "Unknown key" in msg:
            return 400
        return 500

    def _action_to_args(self, action: Any) -> Dict[str, Any]:
        """Convert a pydantic action model to a plain dict."""
        if hasattr(action, "model_dump"):
            return action.model_dump(exclude_none=True)
        if hasattr(action, "dict"):
            return action.dict(exclude_none=True)
        return {}

    def _build_primitive_success_response(
        self,
        *,
        api: str,
        requested_args: Dict[str, Any],
        executed_args: Dict[str, Any],
        started_at: float,
        data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return build_success_response(
            requested_action={"api": api, "args": requested_args},
            executed_action={"api": api, "args": executed_args},
            data=data or {},
            meta=build_meta(session_id=self.session_id, started_at=started_at),
        )

    def _build_primitive_error_response(
        self,
        *,
        api: str,
        requested_args: Dict[str, Any],
        executed_args: Dict[str, Any],
        started_at: float,
        code: str,
        message: str,
        details: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        error_obj: Dict[str, Any] = {"code": code, "message": message}
        if isinstance(details, dict):
            error_obj["details"] = details
        return build_error_response(
            requested_action={"api": api, "args": requested_args},
            executed_action={"api": api, "args": executed_args},
            error=error_obj,
            data=data or {},
            meta=build_meta(session_id=self.session_id, started_at=started_at),
        )

    def _keyboard_error_code(self, exc: Exception) -> str:
        return "INVALID_ARG" if self._keyboard_exception_http_status(exc) == 400 else "ACTION_EXECUTION_ERROR"

    def is_block_id(self, text: str) -> bool:
        """Check if the given text looks like a Scratch block ID."""
        if not text or text == "sensing_dayssince2000": # special case check
            return False
        # Check if it contains characters that are not letters or underscores
        return bool(self.non_letter_underscore_pattern.search(text))

    async def get_block_name_from_id(self, block_id: str) -> str:
        """Get the block opcode/name from a block ID using JavaScript."""
        try:
            js_code = f"""
            (() => {{
                try {{
                    const vm = window.vm || (window.Scratch && window.Scratch.vm);
                    if (!vm || !vm.editingTarget) {{
                        return null;
                    }}
                    
                    const blocks = vm.editingTarget.blocks;
                    const block = blocks.getBlock('{block_id}');
                    
                    if (block && block.opcode) {{
                        return block.opcode;
                    }}
                    
                    return null;
                }} catch (error) {{
                    return null;
                }}
            }})()
            """
            
            result = await self.page.evaluate(js_code)
            return result if result else block_id  # Return original ID if not found
        except Exception:
            return block_id  # Return original ID if JavaScript execution fails

    async def click_at_position(self, action: ClickAction):
        """在指定位置点击"""
        started_at = time.perf_counter()
        requested_args = self._action_to_args(action)
        executed_args = {"x": action.x, "y": action.y, "button": action.button}
        try:
            await self.page.mouse.click(action.x, action.y, button=action.button)
            return self._build_primitive_success_response(
                api="click",
                requested_args=requested_args,
                executed_args=executed_args,
                started_at=started_at,
            )
        except Exception as e:
            return self._build_primitive_error_response(
                api="click",
                requested_args=requested_args,
                executed_args=executed_args,
                started_at=started_at,
                code="ACTION_EXECUTION_ERROR",
                message="Click action failed",
                details={"error": str(e)},
            )

    async def double_click_at_position(self, action: DoubleClickAction):
        """在指定位置双击"""
        started_at = time.perf_counter()
        requested_args = self._action_to_args(action)
        executed_args = {"x": action.x, "y": action.y, "button": action.button}
        try:
            await self.page.mouse.dblclick(action.x, action.y, button=action.button)
            return self._build_primitive_success_response(
                api="double_click",
                requested_args=requested_args,
                executed_args=executed_args,
                started_at=started_at,
            )
        except Exception as e:
            return self._build_primitive_error_response(
                api="double_click",
                requested_args=requested_args,
                executed_args=executed_args,
                started_at=started_at,
                code="ACTION_EXECUTION_ERROR",
                message="Double click action failed",
                details={"error": str(e)},
            )

    async def move_mouse_to(self, action: MoveToAction):
        """将鼠标移动到指定位置"""
        started_at = time.perf_counter()
        requested_args = self._action_to_args(action)
        executed_args = {"x": action.x, "y": action.y, "duration": action.duration}
        try:
            if action.duration > 0:
                # 如果指定了时长，使用平滑移动
                steps = max(10, int(action.duration * 30))  # 30fps
                await self.page.mouse.move(action.x, action.y, steps=steps)
            else:
                await self.page.mouse.move(action.x, action.y)
            return self._build_primitive_success_response(
                api="move_to",
                requested_args=requested_args,
                executed_args=executed_args,
                started_at=started_at,
            )
        except Exception as e:
            return self._build_primitive_error_response(
                api="move_to",
                requested_args=requested_args,
                executed_args=executed_args,
                started_at=started_at,
                code="ACTION_EXECUTION_ERROR",
                message="Move action failed",
                details={"error": str(e)},
            )

    async def drag_and_drop(self, action: DragAndDropAction):
        """从一个点拖拽到另一个点"""
        started_at = time.perf_counter()
        requested_args = self._action_to_args(action)
        executed_args = {
            "start_x": action.start_x,
            "start_y": action.start_y,
            "end_x": action.end_x,
            "end_y": action.end_y,
            "duration": action.duration,
        }
        try:
            # 移动到起始位置
            await self.page.mouse.move(action.start_x, action.start_y)
            # 按下鼠标
            await self.page.mouse.down()

            if action.duration > 0:
                # 如果指定了时长，使用平滑拖拽
                steps = max(10, int(action.duration * 30))  # 30fps
                await self.page.mouse.move(action.end_x, action.end_y, steps=steps)
            else:
                await self.page.mouse.move(action.end_x, action.end_y)

            # 释放鼠标
            await self.page.mouse.up()
            return self._build_primitive_success_response(
                api="drag_and_drop",
                requested_args=requested_args,
                executed_args=executed_args,
                started_at=started_at,
            )
        except Exception as e:
            return self._build_primitive_error_response(
                api="drag_and_drop",
                requested_args=requested_args,
                executed_args=executed_args,
                started_at=started_at,
                code="ACTION_EXECUTION_ERROR",
                message="Drag and drop action failed",
                details={"error": str(e)},
            )

    async def scroll_mouse(self, action: ScrollAction):
        """滚动鼠标滚轮"""
        started_at = time.perf_counter()
        requested_args = self._action_to_args(action)
        executed_args: Dict[str, Any] = {"direction": action.direction, "amount": action.amount}
        if action.x is not None:
            executed_args["x"] = action.x
        if action.y is not None:
            executed_args["y"] = action.y
        try:
            # 如果指定了位置，先移动到该位置
            if action.x is not None and action.y is not None:
                await self.page.mouse.move(action.x, action.y)

            # 根据方向设置滚动参数
            delta_x = 0
            delta_y = 0

            if action.direction == "up":
                delta_y = -action.amount
            elif action.direction == "down":
                delta_y = action.amount
            elif action.direction == "left":
                delta_x = -action.amount
            elif action.direction == "right":
                delta_x = action.amount
            else:
                return self._build_primitive_error_response(
                    api="scroll",
                    requested_args=requested_args,
                    executed_args=executed_args,
                    started_at=started_at,
                    code="INVALID_ARG",
                    message=f"Unsupported scroll direction: {action.direction}",
                )

            await self.page.mouse.wheel(delta_x, delta_y)
            return self._build_primitive_success_response(
                api="scroll",
                requested_args=requested_args,
                executed_args=executed_args,
                started_at=started_at,
            )
        except Exception as e:
            return self._build_primitive_error_response(
                api="scroll",
                requested_args=requested_args,
                executed_args=executed_args,
                started_at=started_at,
                code="ACTION_EXECUTION_ERROR",
                message="Scroll action failed",
                details={"error": str(e)},
            )

    async def type_text(self, action: TypeAction):
        """输入文本"""
        started_at = time.perf_counter()
        requested_args = self._action_to_args(action)
        executed_args = {"text": action.text}
        try:
            await self.page.keyboard.type(action.text)
            return self._build_primitive_success_response(
                api="type",
                requested_args=requested_args,
                executed_args=executed_args,
                started_at=started_at,
            )
        except Exception as e:
            return self._build_primitive_error_response(
                api="type",
                requested_args=requested_args,
                executed_args=executed_args,
                started_at=started_at,
                code="ACTION_EXECUTION_ERROR",
                message="Type action failed",
                details={"error": str(e)},
            )

    async def press_key(self, action: KeyAction):
        """按下并释放单个按键"""
        started_at = time.perf_counter()
        requested_args = self._action_to_args(action)
        key = self._normalize_key_for_playwright(action.key)
        executed_args = {"key": key}
        try:
            await self.page.keyboard.press(key)
            return self._build_primitive_success_response(
                api="key",
                requested_args=requested_args,
                executed_args=executed_args,
                started_at=started_at,
            )
        except Exception as e:
            return self._build_primitive_error_response(
                api="key",
                requested_args=requested_args,
                executed_args=executed_args,
                started_at=started_at,
                code=self._keyboard_error_code(e),
                message="Key action failed",
                details={"error": str(e)},
            )

    async def hold_key(self, action: HoldKeyAction):
        """按住某个按键"""
        started_at = time.perf_counter()
        requested_args = self._action_to_args(action)
        key = self._normalize_key_for_playwright(action.key)
        executed_args = {"key": key}
        try:
            await self.page.keyboard.down(key)
            return self._build_primitive_success_response(
                api="hold_key",
                requested_args=requested_args,
                executed_args=executed_args,
                started_at=started_at,
            )
        except Exception as e:
            return self._build_primitive_error_response(
                api="hold_key",
                requested_args=requested_args,
                executed_args=executed_args,
                started_at=started_at,
                code=self._keyboard_error_code(e),
                message="Hold key action failed",
                details={"error": str(e)},
            )

    async def release_key(self, action: ReleaseKeyAction):
        """释放某个按键"""
        started_at = time.perf_counter()
        requested_args = self._action_to_args(action)
        key = self._normalize_key_for_playwright(action.key)
        executed_args = {"key": key}
        try:
            await self.page.keyboard.up(key)
            return self._build_primitive_success_response(
                api="release_key",
                requested_args=requested_args,
                executed_args=executed_args,
                started_at=started_at,
            )
        except Exception as e:
            return self._build_primitive_error_response(
                api="release_key",
                requested_args=requested_args,
                executed_args=executed_args,
                started_at=started_at,
                code=self._keyboard_error_code(e),
                message="Release key action failed",
                details={"error": str(e)},
            )

    async def press_hotkey(self, action: HotkeyAction):
        """模拟组合键"""
        started_at = time.perf_counter()
        requested_args = self._action_to_args(action)
        keys = [self._normalize_key_for_playwright(k) for k in action.keys] if action.keys else []
        executed_args = {"keys": keys}
        try:
            if not action.keys:
                return self._build_primitive_error_response(
                    api="hotkey",
                    requested_args=requested_args,
                    executed_args=executed_args,
                    started_at=started_at,
                    code="INVALID_ARG",
                    message="Hotkey action failed: keys must not be empty",
                )

            # 按住所有修饰键
            for key in keys[:-1]:
                await self.page.keyboard.down(key)

            # 按下最后一个键
            await self.page.keyboard.press(keys[-1])

            # 释放所有修饰键（逆序）
            for key in reversed(keys[:-1]):
                await self.page.keyboard.up(key)

            return self._build_primitive_success_response(
                api="hotkey",
                requested_args=requested_args,
                executed_args=executed_args,
                started_at=started_at,
            )
        except Exception as e:
            return self._build_primitive_error_response(
                api="hotkey",
                requested_args=requested_args,
                executed_args=executed_args,
                started_at=started_at,
                code=self._keyboard_error_code(e),
                message="Hotkey action failed",
                details={"error": str(e)},
            )

    # async def interact_with_element(self, action: ElementAction):
    #     """与元素交互"""
    #     try:
    #         element = await self.page.query_selector(action.selector)
    #         if element is None:
    #             raise HTTPException(status_code=404, detail=f"未找到元素: {action.selector}")
            
    #         if action.action == "click":
    #             await element.click()
    #             return {"status": "success", "message": f"点击元素: {action.selector}"}
    #         elif action.action == "hover":
    #             await element.hover()
    #             return {"status": "success", "message": f"悬停在元素: {action.selector}"}
    #         elif action.action == "focus":
    #             await element.focus()
    #             return {"status": "success", "message": f"聚焦元素: {action.selector}"}
    #         elif action.action == "type":
    #             if not action.text:
    #                 raise HTTPException(status_code=400, detail="执行type操作需要提供text字段")
    #             await element.type(action.text)
    #             return {"status": "success", "message": f"在元素 {action.selector} 中输入: {action.text}"}
    #         else:
    #             raise HTTPException(status_code=400, detail=f"不支持的操作: {action.action}")
    #     except HTTPException:
    #         raise
    #     except Exception as e:
    #         raise HTTPException(status_code=500, detail=f"元素交互失败: {str(e)}")

    # async def wait(self, action: WaitAction):
    #     """等待指定的毫秒数"""
    #     try:
    #         await asyncio.sleep(action.milliseconds / 1000.0)
    #         return {"status": "success", "message": f"等待了 {action.milliseconds} 毫秒"}
    #     except Exception as e:
    #         raise HTTPException(status_code=500, detail=f"等待操作失败: {str(e)}")

    async def check_element_visibility(self, element):
        """检查元素是否在视觉上处于顶层（未被遮挡）"""
        try:
            is_visible = await element.evaluate("""
                (element) => {
                    if (!element) return false;
                    
                    // 获取元素的位置和尺寸
                    const rect = element.getBoundingClientRect();
                    
                    // 如果元素本身不可见 (例如 display: none 或尺寸为0)，它就不可能在顶层
                    if (rect.width === 0 || rect.height === 0) {
                        return false;
                    }
                    
                    // 计算元素的中心点坐标
                    const centerX = rect.left + rect.width / 2;
                    const centerY = rect.top + rect.height / 2;
                    
                    // 获取这个中心点上最顶层的元素
                    const topElement = document.elementFromPoint(centerX, centerY);
                    
                    if (!topElement) {
                        return false;
                    }
                    
                    // 检查最顶层的元素是否就是我们关心的元素，或者是它的后代元素
                    // (因为点击一个div的中心，可能实际点到的是它里面的一个span)
                    return topElement === element || element.contains(topElement);
                }
            """)
            return is_visible
        except Exception:
            return False

    async def get_elements(self, selector: str):
        """获取指定选择器匹配的所有元素的信息"""
        start_time = time.time()
        try:
            elements = await self.page.query_selector_all(selector)
            elements_info = []

            # 获取视口大小
            viewport_size = self.page.viewport_size
            viewport_width = viewport_size["width"]
            viewport_height = viewport_size["height"]

            # 批量处理元素，减少异步调用次数
            element_tasks = []
            for i, element in enumerate(elements):
                element_tasks.append((i, element))
            
            # 并发处理元素信息
            async def process_element(task):
                i, element = task
                try:
                    # 并行获取边界框和基本属性
                    box_task = element.bounding_box()
                    aria_label_task = element.get_attribute('aria-label')
                    title_task = element.get_attribute('title')
                    
                    box, aria_label, title = await asyncio.gather(
                        box_task, aria_label_task, title_task, 
                        return_exceptions=True
                    )

                    # 检查元素是否在视口范围内
                    if not is_element_in_viewport(box, viewport_width, viewport_height):
                        return None  # 跳过视口外的元素

                    # 检查元素是否在视觉上处于顶层（未被遮挡）
                    if not await self.check_element_visibility(element):
                        return None  # 跳过被遮挡的元素

                    # 简化文本提取逻辑，优先使用属性
                    text = ""
                    if aria_label and aria_label.strip():
                        text = aria_label.strip()
                    elif title and title.strip():
                        text = title.strip()
                    else:
                        # 只在必要时进行复杂的文本提取
                        try:
                            text = await element.inner_text()
                            if not text.strip():
                                text = await element.text_content()
                        except:
                            pass

                    element_info = {
                        "index": i,
                        "position": {
                            "x": int(round(box["x"])) if box else None,
                            "y": int(round(box["y"])) if box else None,
                            "width": int(round(box["width"])) if box else None,
                            "height": int(round(box["height"])) if box else None
                        },
                        "text": text.strip() if text else ""
                    }
                    return element_info
                except Exception as e:
                    # 对于有错误的元素，也跳过而不是添加错误信息
                    return None
            
            # 并发处理所有元素
            results = await asyncio.gather(*[process_element(task) for task in element_tasks])
            elements_info = [result for result in results if result is not None]

            elapsed_time = time.time() - start_time
            logger.debug("获取元素完成 selector=%s count=%d elapsed=%.3fs", selector, len(elements_info), elapsed_time)
            
            return {"count": len(elements_info), "elements": elements_info}
        except Exception as e:
            elapsed_time = time.time() - start_time
            logger.exception("获取元素失败 selector=%s elapsed=%.3fs err=%s", selector, elapsed_time, e)
            raise HTTPException(status_code=500, detail=f"获取元素信息失败: {str(e)}")

    def _parse_named_selectors(self, selectors: str):
        """Parse comma-separated selectors into a list of (name, selector)."""
        raw_list = [s.strip() for s in selectors.split(',') if s.strip()]
        named_selectors = []
        for item in raw_list:
            if "::" in item:
                name, sel = item.split("::", 1)
                name = name.strip()
                sel = sel.strip()
            else:
                name = item
                sel = item
            if sel:
                named_selectors.append((name, sel))
        return named_selectors

    async def get_elements_batch(self, selectors: str):
        """批量获取多个选择器的元素信息。
        支持两种传参格式（逗号分隔列表）：
        1) 仅选择器："selector1,selector2"
        2) 命名选择器："name1::selector1,name2::selector2"（推荐）

        返回统一的扁平列表：{"elements": [{..., "type": name}, ...]}
        """
        start_time = time.time()
        try:
            raw_list = [s.strip() for s in selectors.split(',') if s.strip()]

            # 解析为 (name, selector) 对，如果没有 name，使用 selector 作为 name
            named_selectors = []
            for item in raw_list:
                if '::' in item:
                    name, sel = item.split('::', 1)
                    name = name.strip()
                    sel = sel.strip()
                else:
                    name = item
                    sel = item
                if sel:
                    named_selectors.append((name, sel))

            # 并发获取所有命名选择器的元素
            async def get_selector_elements(name: str, selector: str):
                try:
                    elements = await self.page.query_selector_all(selector)
                    elements_info = []

                    # 获取视口大小
                    viewport_size = self.page.viewport_size
                    viewport_width = viewport_size["width"]
                    viewport_height = viewport_size["height"]

                    for i, element in enumerate(elements):
                        try:
                            # 检查是否是blocklyDraggable元素，如果是则获取block相关属性
                            class_name_task = element.get_attribute('class')
                            data_id_task = element.get_attribute('data-id')
                            aria_label_task = element.get_attribute('aria-label')
                            title_task = element.get_attribute('title')

                            class_name, data_id, aria_label, title = await asyncio.gather(
                                class_name_task, data_id_task, aria_label_task, title_task,
                                return_exceptions=True
                            )

                            # 对于blocklyDraggable元素，获取第一个blocklyBlockBackground path的边界框
                            if class_name and isinstance(class_name, str) and "blocklyDraggable" in class_name:
                                try:
                                    # 查找第一个 path.blocklyBlockBackground 元素
                                    background_path = await element.query_selector('path.blocklyBlockBackground')
                                    if background_path:
                                        box = await background_path.bounding_box()
                                    else:
                                        # 如果找不到background path，回退到整个元素的边界框
                                        box = await element.bounding_box()
                                except Exception:
                                    # 如果出错，回退到整个元素的边界框
                                    box = await element.bounding_box()
                            else:
                                # 非block元素，直接获取边界框
                                box = await element.bounding_box()

                            # 检查是否是input元素，如果是则获取额外的input相关属性
                            tag_name = await element.evaluate("element => element.tagName.toLowerCase()")
                            input_text = ""
                            if tag_name == "input":
                                try:
                                    # 并行获取input相关属性
                                    name_task = element.get_attribute('name')
                                    value_task = element.get_attribute('value')
                                    type_task = element.get_attribute('type')
                                    checked_task = element.get_attribute('checked')
                                    placeholder_task = element.get_attribute('placeholder')
                                    
                                    name_attr, value_attr, type_attr, checked_attr, placeholder_attr = await asyncio.gather(
                                        name_task, value_task, type_task, checked_task, placeholder_task,
                                        return_exceptions=True
                                    )
                                    
                                    # 构建input文本描述
                                    parts = []
                                    if name_attr and isinstance(name_attr, str):
                                        parts.append(name_attr)
                                    # Removed input type from text description to avoid "(text)" in output
                                    # if type_attr and isinstance(type_attr, str):
                                    #     parts.append(f"({type_attr})")
                                    if value_attr is not None:
                                        parts.append(f"value: {value_attr or ''}")
                                    if placeholder_attr and isinstance(placeholder_attr, str):
                                        parts.append(f"placeholder: {placeholder_attr}")
                                    if checked_attr is not None:
                                        parts.append("checked" if checked_attr == "" or checked_attr == "checked" else "unchecked")
                                    
                                    input_text = " ".join(parts)
                                except Exception:
                                    pass

                            # 检查元素是否在视口范围内
                            if not is_element_in_viewport(box, viewport_width, viewport_height):
                                continue

                            # 检查元素是否在视觉上处于顶层（未被遮挡）
                            if not await self.check_element_visibility(element):
                                continue  # 跳过被遮挡的元素

                            # 文本提取（尽量轻量）
                            text = ""
                            
                            # 对于input元素，优先使用构建的文本描述
                            if input_text:
                                text = input_text
                            # 否则使用常规文本提取
                            elif aria_label and isinstance(aria_label, str) and aria_label.strip():
                                text = aria_label.strip()
                            elif title and isinstance(title, str) and title.strip():
                                text = title.strip()
                            else:
                                try:
                                    t = await element.inner_text()
                                    if isinstance(t, str) and t.strip():
                                        text = t.strip()
                                    else:
                                        t2 = await element.text_content()
                                        if isinstance(t2, str) and t2.strip():
                                            text = t2.strip()
                                except:
                                    pass

                            element_info = {
                                "index": i,
                                "position": {
                                    "x": int(round(box["x"])) if box else None,
                                    "y": int(round(box["y"])) if box else None,
                                    "width": int(round(box["width"])) if box else None,
                                    "height": int(round(box["height"])) if box else None
                                },
                                "text": text.replace('\n', ' ').replace('\r', ' ') if text else text,
                                "type": name.replace('\n', ' ').replace('\r', ' ') if name else name
                            }


                            # 如果是blockly可拖拽块，附加 block_name 信息
                            if class_name and isinstance(class_name, str) and "blocklyDraggable" in class_name:
                                block_name = ""
                                if data_id and isinstance(data_id, str):
                                    # Check if data_id looks like a block ID and resolve it to block name
                                    if self.is_block_id(data_id):
                                        try:
                                            resolved_name = await self.get_block_name_from_id(data_id)
                                            # Add " on canvas" postfix to indicate this block is on the canvas
                                            block_name = resolved_name + " on canvas"
                                        except Exception:
                                            block_name = data_id  # Fallback to original ID
                                    else:
                                        block_name = data_id
                                if not block_name and text:
                                    block_name = text
                                element_info["block_name"] = block_name

                            elements_info.append(element_info)
                        except Exception:
                            continue

                    return elements_info
                except Exception:
                    return []

            # 发起并发任务
            tasks = [get_selector_elements(name, sel) for name, sel in named_selectors]
            results = await asyncio.gather(*tasks)

            # 扁平化
            flat_elements = []
            for lst in results:
                if isinstance(lst, list):
                    flat_elements.extend(lst)

            elapsed_time = time.time() - start_time
            logger.debug(
                "批量获取元素完成 selectors=%d elements=%d elapsed=%.3fs",
                len(named_selectors),
                len(flat_elements),
                elapsed_time,
            )

            # 重新为所有元素设置全局索引，从 0 开始
            for gi, el in enumerate(flat_elements):
                try:
                    if isinstance(el, dict):
                        el["index"] = gi
                except Exception:
                    continue

            return {
                "elements": flat_elements,
                "total_selectors": len(named_selectors),
                "elapsed_time": elapsed_time
            }
        except Exception as e:
            elapsed_time = time.time() - start_time
            logger.exception("批量获取元素失败 elapsed=%.3fs err=%s", elapsed_time, e)
            raise HTTPException(status_code=500, detail=f"批量获取元素信息失败: {str(e)}")

    async def get_elements_batch_v2(self, selectors: str):
        """Optimized batch element extraction with one in-page JavaScript pass.

        Input format stays compatible with get_elements_batch:
        - "selector1,selector2"
        - "name1::selector1,name2::selector2"
        """
        start_time = time.time()
        try:
            named_selectors = self._parse_named_selectors(selectors)
            named_selector_payload = [{"name": name, "selector": sel} for name, sel in named_selectors]

            # Run extraction fully in page context to avoid per-element Playwright RPC overhead.
            flat_elements = await self.page.evaluate(
                """
                (namedSelectors) => {
                    const out = [];
                    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
                    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

                    const isInViewport = (rect) => {
                        if (!rect) return false;
                        const right = rect.x + rect.width;
                        const bottom = rect.y + rect.height;
                        if (right <= 0) return false;
                        if (rect.x >= viewportWidth) return false;
                        if (bottom <= 0) return false;
                        if (rect.y >= viewportHeight) return false;
                        return true;
                    };

                    const isTopVisible = (element) => {
                        if (!element) return false;
                        const rect = element.getBoundingClientRect();
                        if (!rect || rect.width === 0 || rect.height === 0) {
                            return false;
                        }
                        const centerX = rect.left + rect.width / 2;
                        const centerY = rect.top + rect.height / 2;
                        const topElement = document.elementFromPoint(centerX, centerY);
                        if (!topElement) return false;
                        return topElement === element || element.contains(topElement);
                    };

                    const sanitizeText = (val) => {
                        if (typeof val !== "string") return "";
                        return val.replace(/\\n/g, " ").replace(/\\r/g, " ").trim();
                    };

                    const sanitizeName = (val) => {
                        if (typeof val !== "string") return val;
                        return val.replace(/\\n/g, " ").replace(/\\r/g, " ");
                    };

                    const isBlockId = (text) => {
                        if (!text || text === "sensing_dayssince2000") return false;
                        return /[^a-zA-Z_]/.test(text);
                    };

                    const vm = window.vm || (window.Scratch && window.Scratch.vm);
                    const opcodeCache = new Map();
                    const resolveBlockOpcode = (blockId) => {
                        if (!blockId) return null;
                        if (opcodeCache.has(blockId)) {
                            return opcodeCache.get(blockId);
                        }
                        let opcode = null;
                        try {
                            if (vm && vm.editingTarget && vm.editingTarget.blocks) {
                                const block = vm.editingTarget.blocks.getBlock(blockId);
                                if (block && block.opcode) {
                                    opcode = block.opcode;
                                }
                            }
                        } catch (_) {
                            opcode = null;
                        }
                        opcodeCache.set(blockId, opcode);
                        return opcode;
                    };

                    for (const entry of namedSelectors || []) {
                        const rawName = (entry && entry.name) || "";
                        const selector = (entry && entry.selector) || "";
                        if (!selector) continue;

                        let elements = [];
                        try {
                            elements = Array.from(document.querySelectorAll(selector));
                        } catch (_) {
                            continue;
                        }

                        for (let i = 0; i < elements.length; i++) {
                            const element = elements[i];
                            if (!element) continue;

                            const className = element.getAttribute("class") || "";
                            const dataId = element.getAttribute("data-id");
                            const ariaLabel = element.getAttribute("aria-label");
                            const title = element.getAttribute("title");
                            const isBlockly = className.includes("blocklyDraggable");

                            let rectNode = element;
                            if (isBlockly) {
                                try {
                                    const bg = element.querySelector("path.blocklyBlockBackground");
                                    if (bg) rectNode = bg;
                                } catch (_) {
                                    rectNode = element;
                                }
                            }
                            const rect = rectNode.getBoundingClientRect();
                            const box = {
                                x: Math.round(rect.x),
                                y: Math.round(rect.y),
                                width: Math.round(rect.width),
                                height: Math.round(rect.height),
                            };

                            if (!isInViewport(box)) continue;
                            if (!isTopVisible(element)) continue;

                            let inputText = "";
                            const tagName = (element.tagName || "").toLowerCase();
                            if (tagName === "input") {
                                const nameAttr = element.getAttribute("name");
                                const valueAttr = element.getAttribute("value");
                                const checkedAttr = element.getAttribute("checked");
                                const placeholderAttr = element.getAttribute("placeholder");
                                const parts = [];
                                if (typeof nameAttr === "string" && nameAttr) {
                                    parts.push(nameAttr);
                                }
                                if (valueAttr !== null) {
                                    parts.push(`value: ${valueAttr || ""}`);
                                }
                                if (typeof placeholderAttr === "string" && placeholderAttr) {
                                    parts.push(`placeholder: ${placeholderAttr}`);
                                }
                                if (checkedAttr !== null) {
                                    parts.push(checkedAttr === "" || checkedAttr === "checked" ? "checked" : "unchecked");
                                }
                                inputText = parts.join(" ");
                            }

                            let text = "";
                            if (inputText) {
                                text = inputText;
                            } else if (typeof ariaLabel === "string" && ariaLabel.trim()) {
                                text = ariaLabel.trim();
                            } else if (typeof title === "string" && title.trim()) {
                                text = title.trim();
                            } else {
                                const inner = typeof element.innerText === "string" ? element.innerText.trim() : "";
                                if (inner) {
                                    text = inner;
                                } else {
                                    const content = typeof element.textContent === "string" ? element.textContent.trim() : "";
                                    if (content) text = content;
                                }
                            }

                            const elementInfo = {
                                index: i,
                                position: box,
                                text: sanitizeText(text),
                                type: sanitizeName(rawName),
                            };

                            if (isBlockly) {
                                let blockName = "";
                                if (typeof dataId === "string" && dataId) {
                                    if (isBlockId(dataId)) {
                                        const opcode = resolveBlockOpcode(dataId);
                                        blockName = `${opcode || dataId} on canvas`;
                                    } else {
                                        blockName = dataId;
                                    }
                                }
                                if (!blockName && elementInfo.text) {
                                    blockName = elementInfo.text;
                                }
                                elementInfo.block_name = blockName;
                            }

                            out.push(elementInfo);
                        }
                    }

                    return out;
                }
                """,
                named_selector_payload,
            )

            if not isinstance(flat_elements, list):
                flat_elements = []

            elapsed_time = time.time() - start_time
            logger.debug(
                "批量获取元素V2完成 selectors=%d elements=%d elapsed=%.3fs",
                len(named_selectors),
                len(flat_elements),
                elapsed_time,
            )

            # Keep response shape and global index behavior consistent with v1.
            for gi, el in enumerate(flat_elements):
                if isinstance(el, dict):
                    el["index"] = gi

            return {
                "elements": flat_elements,
                "total_selectors": len(named_selectors),
                "elapsed_time": elapsed_time,
            }
        except Exception as e:
            elapsed_time = time.time() - start_time
            logger.exception("批量获取元素V2失败 elapsed=%.3fs err=%s", elapsed_time, e)
            raise HTTPException(status_code=500, detail=f"批量获取元素信息失败V2: {str(e)}")
