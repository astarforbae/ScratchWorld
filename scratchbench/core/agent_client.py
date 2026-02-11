import requests
import base64
import json
import time
import argparse
import os
from typing import Dict, Any, List, Optional, Tuple
import logging
from .element_fusion import ElementFusion
import io

logger = logging.getLogger("scratch_bench.agent_client")


class ScratchAgentEnvironment:
    """
    Scratch GUI Agent环境客户端
    为LLM Agent提供获取观察和执行动作的接口
    """

    def __init__(
        self,
        api_url="http://localhost:8081",
        mode: str = "primitive",
        session_id: Optional[str] = None,
        enable_ocr: bool = True,
        ocr_server_url: str = "http://localhost:9090",
        documents_config: Optional[Dict[str, Any]] = None,
        use_element_list: bool = True,
    ):
        self.api_url = api_url
        self.mode = str(mode).strip()
        if self.mode not in ("primitive", "composite"):
            raise ValueError(f"Invalid mode: {self.mode!r}. Expected 'primitive' or 'composite'.")
        self.session_id: Optional[str] = session_id
        self.use_element_list = use_element_list
        
        # OCR and fusion components
        self.enable_ocr = enable_ocr
        self.ocr_server_url = ocr_server_url if enable_ocr else None
        self.element_fusion = ElementFusion(enable_ocr=enable_ocr) if enable_ocr else None

        # Elements list for index resolution
        self._current_elements = []
        
        # Set log prefix
        self._log_prefix = f"[session_id={self.session_id}] " if self.session_id else ""
        assert documents_config is not None, "documents_config cannot be None"
        
        # Documentation paths
        self.composite_api_catalog_path = os.path.abspath(
            os.path.join(
                os.path.dirname(__file__),
                "..",
                "docs",
                documents_config.get("composite_api_catalog", "composite_api_catalog.txt"),
            )
        )
        self.blocks_catalog_path = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "docs", documents_config.get("blocks_catalog", "blocks_catalog.txt"))
        )
        self.primitive_actions_catalog_path = os.path.abspath(
            os.path.join(
                os.path.dirname(__file__),
                "..",
                "docs",
                documents_config.get("primitive_actions_catalog", "primitive_actions_catalog.txt"),
            )
        )
        self.primitive_actions_catalog_without_element_list_path = os.path.abspath(
            os.path.join(
                os.path.dirname(__file__),
                "..",
                "docs",
                documents_config.get(
                    "primitive_actions_catalog_without_element_list",
                    "primitive_actions_catalog_without_element_list.txt",
                ),
            )
        )

    @staticmethod
    def _safe_action_obj(action: Any) -> Dict[str, Any]:
        if not isinstance(action, dict):
            return {"api": "", "args": {}}
        args = action.get("args")
        if not isinstance(args, dict):
            args = {}
        api = action.get("api")
        return {"api": str(api) if api is not None else "", "args": dict(args)}

    def _build_error_envelope(
        self,
        *,
        requested_action: Dict[str, Any],
        executed_action: Dict[str, Any],
        code: str,
        message: str,
        details: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        error_obj: Dict[str, Any] = {"code": code, "message": message}
        if isinstance(details, dict):
            error_obj["details"] = details
        return {
            "success": False,
            "requested_action": self._safe_action_obj(requested_action),
            "executed_action": self._safe_action_obj(executed_action),
            "data": dict(data) if isinstance(data, dict) else {},
            "error": error_obj,
            "meta": {},
        }

    def _to_unified_envelope(
        self,
        *,
        raw: Any,
        requested_action: Dict[str, Any],
        executed_action: Dict[str, Any],
        force_requested_action: bool = False,
        force_executed_action: bool = False,
    ) -> Dict[str, Any]:
        fallback_requested = self._safe_action_obj(requested_action)
        fallback_executed = self._safe_action_obj(executed_action)

        if not isinstance(raw, dict):
            return self._build_error_envelope(
                requested_action=fallback_requested,
                executed_action=fallback_executed,
                code="MALFORMED_RESPONSE",
                message=f"Expected dict response, got {type(raw).__name__}",
            )

        required_keys = {"success", "requested_action", "executed_action", "data", "error", "meta"}
        if not required_keys.issubset(raw.keys()):
            return {
                **self._build_error_envelope(
                    requested_action=fallback_requested,
                    executed_action=fallback_executed,
                    code="MALFORMED_RESPONSE",
                    message=f"Missing required envelope keys: {sorted(required_keys - set(raw.keys()))}",
                ),
                "data": {"raw_keys": sorted(raw.keys())},
            }

        success = raw.get("success")
        if not isinstance(success, bool):
            return self._build_error_envelope(
                requested_action=fallback_requested,
                executed_action=fallback_executed,
                code="MALFORMED_RESPONSE",
                message=f"'success' must be bool, got {type(success).__name__}",
            )

        request_obj = fallback_requested if force_requested_action else raw.get("requested_action")
        if not (isinstance(request_obj, dict) and isinstance(request_obj.get("args"), dict)):
            return self._build_error_envelope(
                requested_action=fallback_requested,
                executed_action=fallback_executed,
                code="MALFORMED_RESPONSE",
                message="Invalid 'requested_action' object in response",
            )
        request_obj = {
            "api": str(request_obj.get("api")) if request_obj.get("api") is not None else "",
            "args": dict(request_obj.get("args")),
        }

        executed_obj = fallback_executed if force_executed_action else raw.get("executed_action")
        if not (isinstance(executed_obj, dict) and isinstance(executed_obj.get("args"), dict)):
            return self._build_error_envelope(
                requested_action=fallback_requested,
                executed_action=fallback_executed,
                code="MALFORMED_RESPONSE",
                message="Invalid 'executed_action' object in response",
            )
        executed_obj = {
            "api": str(executed_obj.get("api")) if executed_obj.get("api") is not None else "",
            "args": dict(executed_obj.get("args")),
        }

        data_obj = raw.get("data")
        if not isinstance(data_obj, dict):
            return self._build_error_envelope(
                requested_action=fallback_requested,
                executed_action=fallback_executed,
                code="MALFORMED_RESPONSE",
                message="Invalid 'data' object in response",
            )

        meta_obj = raw.get("meta")
        if not isinstance(meta_obj, dict):
            return self._build_error_envelope(
                requested_action=fallback_requested,
                executed_action=fallback_executed,
                code="MALFORMED_RESPONSE",
                message="Invalid 'meta' object in response",
            )

        if success:
            error_obj = None
        else:
            raw_error = raw.get("error")
            if not isinstance(raw_error, dict):
                return self._build_error_envelope(
                    requested_action=fallback_requested,
                    executed_action=fallback_executed,
                    code="MALFORMED_RESPONSE",
                    message="Missing or invalid 'error' object for failed response",
                )
            code = raw_error.get("code")
            message = raw_error.get("message")
            if code is None or message is None:
                return self._build_error_envelope(
                    requested_action=fallback_requested,
                    executed_action=fallback_executed,
                    code="MALFORMED_RESPONSE",
                    message="Error object must include 'code' and 'message'",
                )
            error_obj = {"code": str(code), "message": str(message)}
            if isinstance(raw_error.get("details"), dict):
                error_obj["details"] = dict(raw_error["details"])

        return {
            "success": success,
            "requested_action": request_obj,
            "executed_action": executed_obj,
            "data": dict(data_obj),
            "error": error_obj,
            "meta": dict(meta_obj),
        }



    def _ocr_detect(self, image_data: bytes, confidence: float = 0.5) -> Optional[Dict[str, Any]]:
        """Send screenshot to OCR server and get elements"""
        if not self.ocr_server_url:
            return None
            
        try:
            files = {
                'file': ('screenshot.png', io.BytesIO(image_data), 'image/png')
            }
            data = {
                'confidence': str(confidence)
            }
            
            response = requests.post(
                f"{self.ocr_server_url}/ocr/detect", 
                files=files, 
                data=data,
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                logger.debug(f"OCR detected {result.get('total_elements', 0)} elements")
                return result
            else:
                logger.warning(f"OCR request failed: {response.status_code} - {response.text}")
                return None
                    
        except Exception as e:
            logger.error(f"OCR request error: {e}")
            return None

    def get_observation(self) -> Dict[str, Any]:
        """
        获取当前环境的观察
        
        根据模式返回不同的观察信息：
        
        Args:
            无参数，使用实例的 self.mode 属性决定返回格式
            
        Returns:
            Dict[str, Any]: 观察数据字典，包含以下字段：
            
            **composite 模式**:
                - screenshot (str): base64编码的PNG截图数据字符串
                - pseudocode (str): 当前Scratch项目的伪代码描述
                - targetName (str): 当前选中的目标精灵名称
                - timestamp (float): 获取观察的时间戳（Unix时间戳）
                
            **primitive 模式**:
                - screenshot (str): base64编码的PNG截图数据字符串  
                - elements (str): 格式化的UI元素信息字符串，包含索引、类型、文本和位置信息
                - timestamp (float): 获取观察的时间戳（Unix时间戳）
                
            **错误情况**:
                - error (str): 错误信息字符串（当获取pseudocode失败时）
                
        Note:
            - screenshot字段在所有模式下都是base64编码的PNG图片字符串
            - elements字段是格式化的表格字符串，便于LLM直接解析
            - pseudocode字段包含当前Scratch项目的代码逻辑描述
        """
        # 统一先获取截图，两个模式都包含截图
        screenshot_response = self._get("/screenshot", params={"format": "base64"})
        screenshot_response.raise_for_status()
        screenshot_data = screenshot_response.json()

        if self.mode == "composite":
            # 使用composite API获取blocks pseudocode
            pseudocode_result = self.execute_composite_action("get_blocks_pseudocode")

            if pseudocode_result.get("success"):
                data = pseudocode_result.get("data", {})
                logger.info(
                    self._log_prefix
                    + "current pseudocode: \n"
                    + data.get("pseudocode", "")
                )
                logger.info(
                    self._log_prefix
                    + "current targetName: "
                    + data.get("targetName", "")
                )
                available_targets = [t["name"] for t in data.get("availableTargets", []) if isinstance(t, dict) and "name" in t]
                logger.info(
                    self._log_prefix
                    + "available targets: "
                    + ", ".join(available_targets)
                )

                target_variables = data.get("targetVariables", [])
                formatted_target_variables = [
                    f'name: {v.get("name", "")}, scope: {v.get("scope", "")}'
                    for v in target_variables
                    if isinstance(v, dict)
                ]
                logger.info(
                    self._log_prefix
                    + "target variables: "
                    + ", ".join(formatted_target_variables)
                )

                target_lists = data.get("targetLists", [])
                formatted_target_lists = [
                    f'name: {v.get("name", "")}, scope: {v.get("scope", "")}'
                    for v in target_lists
                    if isinstance(v, dict)
                ]
                logger.info(
                    self._log_prefix
                    + "target lists: "
                    + ", ".join(formatted_target_lists)
                )
                
                return {
                    "screenshot": screenshot_data["screenshot"],
                    "pseudocode": data.get("pseudocode", ""),
                    "targetName": data.get("targetName", ""),
                    "availableTargets": available_targets,
                    "targetVariables": target_variables,
                    "targetLists": target_lists,
                    "timestamp": time.time(),
                }
            else:
                return {
                    "error": f"Failed to get blocks pseudocode: {(pseudocode_result.get('error') or {}).get('message', 'Unknown error')}"
                }

        else:  # primitive mode (default)
            elements_list = []
            formatted_elements = ""
            
            # 只有在需要element list的时候才去获取
            if self.use_element_list:
                # 获取详细的UI元素信息（参考environment_observer.py的方法）
                elements_list = self._get_detailed_elements_info(screenshot_data)
                
                # Store elements for index resolution
                self._current_elements = elements_list if isinstance(elements_list, list) else []

                # 将元素格式化为字符串，便于LLM直接消费
                formatted_elements = self.format_elements_info(elements_list)

                logger.info(f"Formatted elements: {formatted_elements}")

            return {
                "screenshot": screenshot_data["screenshot"],
                "elements": formatted_elements,
                "timestamp": time.time(),
            }

    def _get_detailed_elements_info(self, screenshot_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        获取详细的页面元素信息，使用批量API并发处理所有选择器。
        如果启用OCR，则融合DOM和OCR元素信息。
        
        Args:
            screenshot_data: 已获取的截图数据，包含base64编码的截图
            
        Returns:
            统一的扁平元素列表，每个元素包含一个 `type` 字段。
        """
        # 定义要检测的元素选择器
        selectors = {
            "stage": "[data-testid='stage']",
            "canvas": ".blocklyMainBackground",
            "inputs": "input",
            "sprites": ".sprite-selector_sprite-wrapper_df7cJ",
            "blocks": ".blocklyDraggable",
            "flyout_buttons": ".blocklyFlyoutButton",
            "category_menu_item": ".scratchCategoryMenuItem",
        }

        # 获取DOM元素
        name_selector_pairs = [f"{name}::{sel}" for name, sel in selectors.items()]
        selector_string = ",".join(name_selector_pairs)
        batch_response = self._get(
            "/elements_batch", params={"selectors": selector_string}, timeout=60
        )
        batch_response.raise_for_status()
        batch_data = batch_response.json()

        dom_elements = batch_data.get("elements", [])
        if not isinstance(dom_elements, list):
            dom_elements = []

        elapsed_time = batch_data.get("elapsed_time", 0)
        logger.info(self._log_prefix + f"DOM元素获取完成，总耗时: {elapsed_time:.3f}秒")

        # 如果未启用OCR，直接返回DOM元素
        if not self.enable_ocr or not self.element_fusion:
            return dom_elements

        # 获取OCR元素
        ocr_elements = []
        if screenshot_data.get("screenshot"):
            # 解码截图数据 (format字段表示数据格式，通常为base64)
            screenshot_bytes = base64.b64decode(screenshot_data["screenshot"])
            
            # 调用OCR服务 - 直接发送请求
            ocr_start_time = time.time()
            ocr_result = self._ocr_detect(screenshot_bytes)
            ocr_elapsed = time.time() - ocr_start_time
            
            if ocr_result and ocr_result.get("success"):
                ocr_elements = ocr_result.get("elements", [])
                logger.info(self._log_prefix + f"OCR检测完成，总耗时: {ocr_elapsed:.3f}秒，检测到 {len(ocr_elements)} 个元素")
            else:
                logger.warning(self._log_prefix + f"OCR检测失败: {ocr_result.get('error', 'Unknown error') if ocr_result else 'No response'}")
        else:
            logger.warning(self._log_prefix + "截图数据缺失，跳过OCR检测")
                

        # 融合DOM和OCR元素
        fusion_start_time = time.time()
        fused_elements = self.element_fusion.fuse_elements(dom_elements, ocr_elements)
        fusion_elapsed = time.time() - fusion_start_time
        
        logger.info(self._log_prefix + f"元素融合完成，总耗时: {fusion_elapsed:.3f}秒")
        
        return fused_elements

    def format_elements_info(self, elements_data: List[Dict[str, Any]], show_position: bool = True) -> str:
        """
        Format element information into a more readable table format for a unified flat list.
        Each element is expected to be a dict with keys: index (global 0-based), position/bbox, text, and type.
        """

        formatted_info: List[str] = []

        # Header
        if show_position:
            header = "index    type    text    position"
            formatted_info.append(header)
        else:
            header = "index    type    text"
            formatted_info.append(header)

        # Rows
        for global_index, element in enumerate(elements_data, start=0):
            if not isinstance(element, dict):
                continue

            element_type = element.get("type") or ""

            # Prefer block_name over text if present
            text_content = ""
            if element.get("block_name"):
                text_content = element["block_name"]
            else:
                text = (element.get("text") or "").strip()
                if text:
                    if text.startswith('"') and text.endswith('"'):
                        text = text[1:-1]
                    text_content = text

            if show_position:
                position_info = self._extract_position_info_compact(element)
                line = f"{global_index}    {element_type}    {text_content}    {position_info}"
            else:
                line = f"{global_index}    {element_type}    {text_content}"

            formatted_info.append(line)

        return "\n".join(formatted_info)

    def _extract_position_info_compact(self, element: Dict[str, Any]) -> str:
        """Extract position information from element in a compact format for table display."""
        position_data = element.get("bbox") or element.get("position")
        if not isinstance(position_data, dict):
            return ""
        
        x = position_data.get("x")
        y = position_data.get("y")
        w = position_data.get("width")
        h = position_data.get("height")
        
        if all(v is not None for v in [x, y, w, h]):
            return f"({x}, {y}) {w}x{h}"
        return ""

    def _parse_position_data(self, position_data) -> Tuple[int, int, int, int]:
        """
        Parse position data (dict or string) into (x, y, width, height)
        
        Args:
            position_data: Position data as dict {'x': 1, 'y': 93, 'width': 782, 'height': 594} 
                          or string "(1, 93) 782x594"
            
        Returns:
            Tuple of (x, y, width, height)
            
        Raises:
            ValueError: If position data cannot be parsed
        """
        try:
            if isinstance(position_data, dict):
                # Modern format: {'x': 1, 'y': 93, 'width': 782, 'height': 594}
                x = int(position_data.get('x', 0))
                y = int(position_data.get('y', 0))
                width = int(position_data.get('width', 0))
                height = int(position_data.get('height', 0))
                return x, y, width, height
                
            elif isinstance(position_data, str):
                # Legacy string format: "(1, 93) 782x594"
                parts = position_data.split(') ')
                if len(parts) != 2:
                    raise ValueError(f"Invalid position format: {position_data}")
                    
                # Parse coordinates: "(x, y"
                coords_part = parts[0][1:]  # Remove leading '('
                x, y = map(int, coords_part.split(', '))
                
                # Parse dimensions: "widthxheight"
                dimensions_part = parts[1]
                width, height = map(int, dimensions_part.split('x'))
                
                return x, y, width, height
            else:
                raise ValueError(f"Invalid position data type: {type(position_data)}")
            
        except (ValueError, IndexError, KeyError) as e:
            raise ValueError(f"Failed to parse position data '{position_data}': {e}")

    def _get_element_center_by_index(self, index: int) -> Tuple[int, int]:
        """
        Get the center coordinates of an element by its index
        
        Args:
            index: 0-based element index
            
        Returns:
            Tuple of (center_x, center_y)
            
        Raises:
            ValueError: If index is invalid or element has no position
        """
        if not isinstance(self._current_elements, list):
            raise ValueError("No elements available for index resolution")
            
        if index < 0 or index >= len(self._current_elements):
            raise ValueError(f"Index {index} out of range (0..{len(self._current_elements)-1})")
            
        element = self._current_elements[index]
        if not isinstance(element, dict):
            raise ValueError(f"Invalid element structure at index {index}")
            
        position_data = element.get("position") or element.get("bbox")
        if not position_data:
            raise ValueError(f"Element at index {index} has no position information")
            
        try:
            x, y, width, height = self._parse_position_data(position_data)
            center_x = int(x + width / 2)
            center_y = int(y + height / 2)
            return center_x, center_y
        except ValueError as e:
            raise ValueError(f"Failed to get center for element at index {index}: {e}")

    def _resolve_index_args(self, api_type: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """
        Resolve index-based parameters into coordinate parameters
        
        Args:
            api_type: The action type being executed
            args: Action parameters that may contain indices
            
        Returns:
            Parameters with indices resolved to coordinates
        """
        resolved_args = dict(args)
        
        try:
            # Handle single-point actions (click, double_click, move_to, scroll)
            if api_type in ["click", "double_click", "move_to", "scroll"]:
                if "index" in resolved_args:
                    index = resolved_args.pop("index")
                    if "x" not in resolved_args or "y" not in resolved_args:
                        center_x, center_y = self._get_element_center_by_index(index)
                        resolved_args["x"] = center_x
                        resolved_args["y"] = center_y
                        logger.info(self._log_prefix + f"Resolved index {index} to coordinates ({center_x}, {center_y})")
                        
            # Handle drag and drop actions
            elif api_type == "drag_and_drop":
                if "start_index" in resolved_args:
                    start_index = resolved_args.pop("start_index")
                    if "start_x" not in resolved_args or "start_y" not in resolved_args:
                        start_x, start_y = self._get_element_center_by_index(start_index)
                        resolved_args["start_x"] = start_x
                        resolved_args["start_y"] = start_y
                        logger.info(self._log_prefix + f"Resolved start_index {start_index} to coordinates ({start_x}, {start_y})")
                        
                if "end_index" in resolved_args:
                    end_index = resolved_args.pop("end_index")
                    if "end_x" not in resolved_args or "end_y" not in resolved_args:
                        end_x, end_y = self._get_element_center_by_index(end_index)
                        resolved_args["end_x"] = end_x
                        resolved_args["end_y"] = end_y
                        logger.info(self._log_prefix + f"Resolved end_index {end_index} to coordinates ({end_x}, {end_y})")
                        
        except ValueError as e:
            return {"error": f"Index resolution failed: {e}"}
            
        return resolved_args
    
    def execute_action_plan(self, action_plan):
        """
        Execute the action plan returned by the LLM
        
        Args:
        - action_plan: dict containing api_type and args
        
        Returns:
        - execution result
        """
        try:
            logger.info(f"Executing action: {action_plan}")
            if self.mode == "composite":
                api_name = action_plan.get("api")
                args = action_plan.get("args", {})
                result = self.execute_composite_action(api_name, **(args or {}))
            else: 
                api_type = action_plan.get("api")
                args = action_plan.get("args", {})
                result = self.execute_primitive_action(api_type, **(args or {}))
            logger.info(f"Execution result: {result}")
            return result

        except Exception as e:
            logger.error(f"Action execution error: {e}")
            api_name = action_plan.get("api") if isinstance(action_plan, dict) else ""
            api_args = action_plan.get("args", {}) if isinstance(action_plan, dict) else {}
            requested_action = {"api": api_name, "args": api_args if isinstance(api_args, dict) else {}}
            return self._build_error_envelope(
                requested_action=requested_action,
                executed_action=requested_action,
                code="CLIENT_ERROR",
                message=str(e),
            )

    def execute_primitive_action(self, api_type: str, **args) -> Dict[str, Any]:
        """
        执行动作

        参数:
        - api_type: 动作类型，支持的动作：
          鼠标操作: 'click', 'double_click', 'move_to', 'drag_and_drop', 'scroll'
          键盘操作: 'type', 'key', 'hold_key', 'release_key', 'hotkey'
        - kwargs: 动作参数 (支持坐标和索引两种方式)

        返回:
        - 动作执行结果
        """
        requested_action = {"api": api_type, "args": dict(args)}
        try:
            # First resolve any index-based parameters to coordinates
            resolved_args = self._resolve_index_args(api_type, args)
            
            # Check if index resolution failed
            if isinstance(resolved_args, dict) and "error" in resolved_args:
                return self._build_error_envelope(
                    requested_action=requested_action,
                    executed_action=requested_action,
                    code="INDEX_RESOLUTION_ERROR",
                    message=str(resolved_args.get("error")),
                )

            mouse_actions = {"click", "double_click", "move_to", "drag_and_drop", "scroll"}
            keyboard_actions = {"type", "key", "hold_key", "release_key", "hotkey"}

            if api_type not in mouse_actions and api_type not in keyboard_actions:
                return self._build_error_envelope(
                    requested_action=requested_action,
                    executed_action=requested_action,
                    code="UNSUPPORTED_ACTION",
                    message=f"Unsupported primitive action: {api_type}",
                )

            request_payload = resolved_args if api_type in mouse_actions else args
            response = self._post(f"/{api_type}", json=dict(request_payload) if isinstance(request_payload, dict) else {})
            response.raise_for_status()
            raw_result = response.json()

            executed_args = (
                resolved_args if api_type in mouse_actions and isinstance(resolved_args, dict) else dict(args)
            )
            executed_action = {"api": api_type, "args": executed_args}
            force_executed = api_type in mouse_actions
            return self._to_unified_envelope(
                raw=raw_result,
                requested_action=requested_action,
                executed_action=executed_action,
                force_requested_action=True,
                force_executed_action=force_executed,
            )
        except Exception as e:
            return self._build_error_envelope(
                requested_action=requested_action,
                executed_action=requested_action,
                code="CLIENT_ERROR",
                message=str(e),
            )
    
    
    def execute_composite_action(self, api: str, **args) -> Dict[str, Any]:
        """
        Execute a high-level composite API on the backend.

        Body shape: {"api": <api_name>, "args": {...}}
        Returns unified action envelope.
        """
        requested_action = {"api": api, "args": dict(args)}
        try:
            payload = {"api": api, "args": args or {}}
            response = self._post("/composite/execute", json=payload, timeout=20)
            response.raise_for_status()
            raw_result = response.json()
            return self._to_unified_envelope(
                raw=raw_result,
                requested_action=requested_action,
                executed_action=requested_action,
            )
        except Exception as e:
            return self._build_error_envelope(
                requested_action=requested_action,
                executed_action=requested_action,
                code="CLIENT_ERROR",
                message=str(e),
            )
        
    def _url(self, route: str) -> str:
        """
        Build URL for route. If session_id is set, prefix with /sessions/{id}.
        route should start with a leading '/'.
        """
        if self.session_id:
            return f"{self.api_url}/sessions/{self.session_id}{route}"
        return f"{self.api_url}{route}"

    def _get(
        self,
        route: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        timeout: Optional[float] = 60,
    ):
        return requests.get(self._url(route), params=params, timeout=timeout)

    def _post(
        self,
        route: str,
        *,
        json: Optional[Dict[str, Any]] = None,
        timeout: Optional[float] = None,
    ):
        return requests.post(self._url(route), json=json, timeout=timeout)

    def get_documentation(self) -> Dict[str, Any]:
        """
        加载并返回所有文档内容
        
        Returns:
            Dict containing all documentation:
            - composite_api_catalog_text: Text content of API catalog
            - blocks_catalog_text: Text content of blocks catalog
            - primitive_actions_catalog_text: Text content of primitive actions catalog
            - primitive_actions_catalog_without_element_list_text: Text content of primitive actions catalog (no element list)
        """
        documentation = {}
        
        # Load composite API catalog
        with open(self.composite_api_catalog_path, "r", encoding="utf-8") as f:
            composite_text = f.read()
            documentation["composite_api_catalog_text"] = composite_text
        
        # Load blocks catalog
        with open(self.blocks_catalog_path, "r", encoding="utf-8") as f:
            documentation["blocks_catalog_text"] = f.read()
        
        # Load primitive actions catalog
        with open(self.primitive_actions_catalog_path, "r", encoding="utf-8") as f:
            primitive_text = f.read()
            documentation["primitive_actions_catalog_text"] = primitive_text
            
        # Load primitive actions catalog without element list
        with open(self.primitive_actions_catalog_without_element_list_path, "r", encoding="utf-8") as f:
            primitive_no_elements_text = f.read()
            documentation["primitive_actions_catalog_without_element_list_text"] = primitive_no_elements_text
        
        return documentation
