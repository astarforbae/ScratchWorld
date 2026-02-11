"""
Refactored Scratch operations for the Scratch GUI Agent API.
Uses external JavaScript files for cleaner code organization.
"""
import asyncio
import logging
import time
from typing import List, Dict, Any, Optional
from playwright.async_api import Page
from .models import CompositeRequest
from .action_response import (
    build_error_response,
    build_meta,
    build_success_response,
    normalize_composite_data,
)
from .utilities import get_element_text_robust
from .js_loader import js_loader

logger = logging.getLogger("scratch_bench_api")

_COMPOSITE_CATALOG_ARG_SCHEMA: Dict[str, Any] = {
    "select_sprite": {"name": None},
    "select_stage": {},
    "add_variable": {"name": None, "scope": None},
    "add_list": {"name": None, "scope": None},
    "add_block": {"blockType": None, "creation": {"variableName": None, "listName": None}},
    "connect_blocks": {
        "sourceBlockIndex": None,
        "targetBlockIndex": None,
        "placement": {"kind": None, "inputName": None},
    },
    "detach_blocks": {"blockIndex": None},
    "set_block_field": {"blockIndex": None, "fieldName": None, "value": None},
    "delete_block": {"blockIndex": None},
    "done": {},
    "failed": {},
}


def _filter_args_by_schema(raw_args: Any, schema: Any) -> Any:
    if not isinstance(schema, dict):
        return raw_args
    if not isinstance(raw_args, dict):
        return {}

    filtered: Dict[str, Any] = {}
    for key, subschema in schema.items():
        if key not in raw_args:
            continue
        value = raw_args[key]
        if isinstance(subschema, dict) and isinstance(value, dict):
            filtered[key] = _filter_args_by_schema(value, subschema)
        else:
            filtered[key] = value
    return filtered


def _sanitize_executed_args(api_name: str, raw_args: Any) -> Dict[str, Any]:
    if not isinstance(raw_args, dict):
        return {}
    schema = _COMPOSITE_CATALOG_ARG_SCHEMA.get(str(api_name or "").strip())
    if not isinstance(schema, dict):
        return {}
    filtered = _filter_args_by_schema(raw_args, schema)
    return filtered if isinstance(filtered, dict) else {}


class ScratchAPI:
    def __init__(self, page: Page, session_id: Optional[str] = None):
        self.page = page
        self.session_id = session_id
        self.cached_idx_to_block = None
        self.cached_value_to_id_mappings = None

    async def execute(self, req: CompositeRequest) -> dict:
        """Composite API dispatcher. Body: {"api": str, "args": {}}"""
        started_at = time.perf_counter()
        api = (req.api or "").strip()
        args = req.args if isinstance(req.args, dict) else {}
        requested_action = {"api": api, "args": dict(args)}

        def ok(data: dict) -> dict:
            return {"ok": True, "data": data}

        def err(code: str, message: str, details: dict= None) -> dict:
            e = {"code": code, "message": message}
            if details:
                e["details"] = details
            return {"ok": False, "error": e}

        def success_response(
            data: Any,
            *,
            executed_args: Optional[Dict[str, Any]] = None,
            executed_api: Optional[str] = None,
        ) -> dict:
            normalized_data = normalize_composite_data(data, requested_api=api or None)
            action_api = executed_api if executed_api is not None else api
            raw_executed_args = dict(executed_args) if isinstance(executed_args, dict) else dict(args)
            return build_success_response(
                requested_action=requested_action,
                executed_action={
                    "api": action_api,
                    "args": _sanitize_executed_args(action_api, raw_executed_args),
                },
                data=normalized_data,
                meta=build_meta(session_id=self.session_id, started_at=started_at),
            )

        def error_response(
            code: str,
            message: str,
            *,
            details: Optional[Dict[str, Any]] = None,
            executed_args: Optional[Dict[str, Any]] = None,
            executed_api: Optional[str] = None,
            data: Optional[Dict[str, Any]] = None,
        ) -> dict:
            error_obj: Dict[str, Any] = {"code": code, "message": message}
            if isinstance(details, dict):
                error_obj["details"] = details
            action_api = executed_api if executed_api is not None else api
            raw_executed_args = dict(executed_args) if isinstance(executed_args, dict) else dict(args)
            return build_error_response(
                requested_action=requested_action,
                executed_action={
                    "api": action_api,
                    "args": _sanitize_executed_args(action_api, raw_executed_args),
                },
                error=error_obj,
                data=data or {},
                meta=build_meta(session_id=self.session_id, started_at=started_at),
            )

        def from_legacy_result(
            result: Dict[str, Any],
            *,
            executed_args: Optional[Dict[str, Any]] = None,
            success_data: Any = None,
        ) -> dict:
            if result.get("ok"):
                payload = result.get("data", {}) if success_data is None else success_data
                return success_response(payload, executed_args=executed_args)
            err_obj = result.get("error", {}) if isinstance(result, dict) else {}
            if not isinstance(err_obj, dict):
                return error_response(
                    "ERROR",
                    str(err_obj),
                    executed_args=executed_args,
                )
            return error_response(
                str(err_obj.get("code", "ERROR")),
                str(err_obj.get("message", "Operation failed")),
                details=err_obj.get("details") if isinstance(err_obj, dict) else None,
                executed_args=executed_args,
            )

        if not api:
            return error_response("INVALID_ARG", "Missing 'api' field")

        try:
            if api == "run_project":
                result = await self._execute_js_script("run_project", ok, err)
                return from_legacy_result(result, executed_args={})
                
            elif api == "stop_project":
                result = await self._execute_js_script("stop_project", ok, err)
                return from_legacy_result(result, executed_args={})
                
            elif api == "select_category":
                category = (args.get("category") or args.get("category_name") or "").strip()
                if not category:
                    return error_response("INVALID_ARG", "'category' is required")
                result = await self._execute_js_script("select_category", ok, err, category)
                return from_legacy_result(result, executed_args={"category": category})
                
            elif api == "select_sprite":
                sprite_name = (args.get("name") or "").strip()
                if not sprite_name:
                    return error_response("INVALID_ARG", "'name' is required")
                result = await self._execute_js_script("select_sprite", ok, err, sprite_name)
                return from_legacy_result(result, executed_args={"name": sprite_name})
                
            elif api == "select_stage":
                result = await self._execute_js_script("select_stage", ok, err)
                return from_legacy_result(result, executed_args={})
                
            elif api == "add_variable":
                name = (args.get("name") or "").strip()
                scope = (args.get("scope") or "").strip()
                if not name:
                    return error_response("INVALID_ARG", "'name' is required")
                if scope not in ["sprite", "all"]:
                    return error_response("INVALID_ARG", "'scope' must be 'sprite' or 'all'")
                
                payload = {
                    "name": name, 
                    "scope": scope, 
                    "cloud": bool(args.get("cloud")) if "cloud" in args else False
                }
                result = await self._execute_js_script("add_variable", ok, err, payload)
                success_data = None
                if result.get("ok"):
                    created_payload = normalize_composite_data(result.get("data", {}), requested_api=api)
                    success_data = {"created": created_payload}
                return from_legacy_result(result, executed_args=payload, success_data=success_data)
                
            elif api == "add_list":
                name = (args.get("name") or "").strip()
                scope = (args.get("scope") or "").strip()
                if not name:
                    return error_response("INVALID_ARG", "'name' is required")
                if scope not in ["sprite", "all"]:
                    return error_response("INVALID_ARG", "'scope' must be 'sprite' or 'all'")
                
                payload = {"name": name, "scope": scope}
                result = await self._execute_js_script("add_list", ok, err, payload)
                success_data = None
                if result.get("ok"):
                    created_payload = normalize_composite_data(result.get("data", {}), requested_api=api)
                    success_data = {"created": created_payload}
                return from_legacy_result(result, executed_args=payload, success_data=success_data)
                
            elif api == "add_block":
                block_type = (args.get("blockType") or "").strip()
                if not block_type:
                    return error_response("INVALID_ARG", "'blockType' is required")
                
                payload = {"blockType": block_type, "creation": args.get("creation")}
                result = await self._execute_js_script("add_block", ok, err, payload)
                if result.get("ok"):
                    # Invalidate cached pseudocode mapping as the workspace changed
                    self.cached_idx_to_block = None
                    data = result.get("data", {})
                    return success_response(
                        {
                            "blockId": data.get("blockId"),
                            "connected": False,
                        },
                        executed_args=payload,
                    )
                return from_legacy_result(result, executed_args=payload)
                
            elif api == "get_blocks_pseudocode":
                result = await self._execute_js_script("get_blocks_pseudocode", ok, err)
                if result.get("ok"):
                    data = result.get("data", {})
                    # Cache the idxToBlock mapping and value-to-ID mappings for future use
                    self.cached_idx_to_block = data.get("idxToBlock")
                    self.cached_value_to_id_mappings = data.get("valueToIdMappings")
                    pseudocode = data.get("pseudocode")
                    if isinstance(pseudocode, str):
                        logger.debug("get_blocks_pseudocode len=%d target=%s", len(pseudocode), data.get("targetName"))
                    else:
                        logger.debug("get_blocks_pseudocode non-str type=%s", type(pseudocode).__name__)
                    return success_response({
                        "pseudocode": data.get("pseudocode"),
                        "idxToBlock": data.get("idxToBlock"),
                        "targetName": data.get("targetName"),
                        "targetId": data.get("targetId"),
                        "availableChoices": data.get("availableChoices"),
                        "availableTargets": data.get("availableTargets"),
                        "valueToIdMappings": data.get("valueToIdMappings"),
                        "targetVariables": data.get("targetVariables"),
                        "targetLists": data.get("targetLists")
                    }, executed_args={})
                return from_legacy_result(result, executed_args={})

            elif api == "get_blocks_structure":
                result = await self._execute_js_script("get_blocks_structure", ok, err)
                if result.get("ok"):
                    data = result.get("data", {})
                    self.cached_idx_to_block = data.get("idxToBlock")
                    return success_response({
                        "pseudocode": data.get("pseudocode"), # Added pseudocode
                        "blocks": data.get("idxToBlock"), 
                        "idToBlock": data.get("idToBlock"), # Keyed by ID
                        "targetName": data.get("targetName"),
                        "isStage": data.get("isStage")
                    }, executed_args={})
                return from_legacy_result(result, executed_args={})
                
            elif api == "set_block_field":
                block_index = args.get("blockIndex")
                field_name = args.get("fieldName")
                if not isinstance(block_index, int) or block_index < 1:
                    return error_response("INVALID_ARG", "'blockIndex' must be a positive integer")
                if not field_name:
                    return error_response("INVALID_ARG", "'fieldName' is required (legacy 'target' is no longer supported)")
                if "value" not in args:
                    return error_response("INVALID_ARG", "'value' is required")
                value = args.get("value")

                # Need cached mapping from indices to block ids
                if self.cached_idx_to_block is None:
                    return error_response("INVALID_STATE", "No cached block data. Call get_blocks_pseudocode first.")
                key = str(block_index)
                if key not in self.cached_idx_to_block:
                    return error_response("NOT_FOUND", f"Block not found at index: {block_index}")
                block_id = self.cached_idx_to_block[key]["id"]

                # Translate human-readable value to VM-compatible ID if mappings are available
                translated_value = value
                if self.cached_value_to_id_mappings:
                    translated_value = self._translate_value_to_id(value, field_name)

                executed_args = {
                    "blockIndex": block_index,
                    "fieldName": field_name,
                    "value": value,
                }
                
                # Use simplified API - pass blockId (not blockIndex) to avoid conversion issues
                payload = {"blockId": block_id, "fieldName": field_name, "value": translated_value}
                result = await self._execute_js_script("set_block_field", ok, err, payload)
                if result.get("ok"):
                    data = result.get("data", {})
                    # Return per catalog, include blockIndex for caller convenience
                    resp = {
                        "updated": data.get("updated", 1), 
                        "blockIndex": block_index, 
                        "blockId": block_id,
                        "fieldName": field_name,
                        "value": data.get("value"), 
                        "originalValue": value,  # Include original human-readable value
                        "translatedValue": translated_value,  # Include translated ID
                    }
                    return success_response(resp, executed_args=executed_args)
                return from_legacy_result(result, executed_args=executed_args)
                
            elif api == "connect_blocks":
                source_idx = args.get("sourceBlockIndex")
                target_idx = args.get("targetBlockIndex")
                placement = args.get("placement") or {}
                kind = placement.get("kind") if isinstance(placement, dict) else None
                input_name = placement.get("inputName") if isinstance(placement, dict) else None

                if not isinstance(source_idx, int) or source_idx < 1:
                    return error_response("INVALID_ARG", "'sourceBlockIndex' must be a positive integer")
                if not isinstance(target_idx, int) or target_idx < 1:
                    return error_response("INVALID_ARG", "'targetBlockIndex' must be a positive integer")
                if not isinstance(placement, dict) or not kind:
                    return error_response("INVALID_ARG", "'placement.kind' is required")
                if kind in ("statement_into", "value_into") and not input_name:
                    return error_response("INVALID_ARG", "'inputName' is required when kind is 'statement_into' or 'value_into'")

                # Need cached mapping
                if self.cached_idx_to_block is None:
                    return error_response("INVALID_STATE", "No cached block data. Call get_blocks_pseudocode first.")

                s_key = str(source_idx)
                t_key = str(target_idx)
                if s_key not in self.cached_idx_to_block:
                    return error_response("NOT_FOUND", f"Source block not found at index {source_idx}")
                if t_key not in self.cached_idx_to_block:
                    return error_response("NOT_FOUND", f"Target block not found at index {target_idx}")

                source_id = self.cached_idx_to_block[s_key]["id"]
                target_id = self.cached_idx_to_block[t_key]["id"]

                payload = {"sourceId": source_id, "targetId": target_id, "placement": placement}
                executed_args = {
                    "sourceBlockIndex": source_idx,
                    "targetBlockIndex": target_idx,
                    "placement": placement,
                }
                result = await self._execute_js_script("connect_blocks", ok, err, payload)
                if result.get("ok"):
                    # Invalidate cache since structure changed
                    self.cached_idx_to_block = None
                    data = result.get("data", {})
                    return success_response(data, executed_args=executed_args)
                return from_legacy_result(result, executed_args=executed_args)

            elif api == "detach_blocks":
                block_index = args.get("blockIndex")
                if not isinstance(block_index, int) or block_index < 1:
                    return error_response("INVALID_ARG", "'blockIndex' must be a positive integer")

                if self.cached_idx_to_block is None:
                    return error_response("INVALID_STATE", "No cached block data. Call get_blocks_pseudocode first.")

                key = str(block_index)
                if key not in self.cached_idx_to_block:
                    return error_response("NOT_FOUND", f"Block not found at index: {block_index}")

                block_id = self.cached_idx_to_block[key]["id"]
                payload = {"blockId": block_id}
                executed_args = {"blockIndex": block_index, "blockId": block_id}
                result = await self._execute_js_script("detach_blocks", ok, err, payload)
                if result.get("ok"):
                    self.cached_idx_to_block = None
                    data = result.get("data", {})
                    return success_response(data, executed_args=executed_args)
                return from_legacy_result(result, executed_args=executed_args)
                
            elif api == "delete_block":
                block_index = args.get("blockIndex") if "blockIndex" in args else args.get("index")
                if not isinstance(block_index, int) or block_index < 1:
                    return error_response("INVALID_ARG", "'blockIndex' must be a positive integer")

                # Check if we have cached block data
                if self.cached_idx_to_block is None:
                    # Treat absence of cache as no block found, per test expectation
                    return error_response("INVALID_STATE", "No cached block data. Call get_blocks_pseudocode first.")
                
                # Find block info by index from cache
                str_index = str(block_index)
                if str_index not in self.cached_idx_to_block:
                    return error_response("NOT_FOUND", f"Block not found at index {block_index}")
                
                block_info = self.cached_idx_to_block[str_index]
                target_block_id = block_info["id"]
                executed_args = {"blockIndex": block_index}
                
                result = await self._execute_js_script("delete_block", ok, err, target_block_id)
                if result.get("ok"):
                    # Clear cache since block structure has changed
                    self.cached_idx_to_block = None
                    data = result.get("data", {})
                    return success_response({
                        "deleted": True,
                        "index": block_index,
                        "blockId": target_block_id,
                        "blockInfo": data.get("deletedBlock")
                    }, executed_args=executed_args)
                return from_legacy_result(result, executed_args=executed_args)

            elif api == "custom_js":
                # Run a user-provided JS function in the page context.
                # Args:
                #   fn: string of a JS function/expression that evaluates to a function
                #   payload: optional data passed through to the function
                js_fn_src = (args.get("fn") or args.get("function") or args.get("code") or "").strip()
                if not js_fn_src:
                    return error_response("INVALID_ARG", "'fn' (JS function source) is required")

                payload = args.get("payload")
                executed_args = {"fn": js_fn_src}
                if "payload" in args:
                    executed_args["payload"] = payload

                # Evaluate and execute the provided function with helpers.
                # The function receives a single object argument: { vm, SB, ws, payload, getVM, getWorkspace, getScratchBlocks }
                try:
                    result = await self.page.evaluate(
                        """
                        (async (arg) => {
                          try {
                            const { fnSrc, payload } = arg || {};
                            const vm = (typeof window !== 'undefined' && (window.vm || (window.Scratch && window.Scratch.vm))) || (typeof getVM === 'function' ? getVM() : null);
                            const SB = (typeof window !== 'undefined' && (window.ScratchBlocks || window.Blockly)) || (typeof getScratchBlocks === 'function' ? getScratchBlocks() : null);
                            const ws = (SB && typeof SB.getMainWorkspace === 'function') ? SB.getMainWorkspace() : (typeof getWorkspace === 'function' ? getWorkspace() : null);
                            const fn = (0, eval)(fnSrc);
                            if (typeof fn !== 'function') {
                              return { success: false, error: { code: 'INVALID_JS_FN', message: 'Provided source did not evaluate to a function' } };
                            }
                            const helpers = { vm, SB, ws, payload, getVM: () => vm, getWorkspace: () => ws, getScratchBlocks: () => SB };
                            const out = await fn(helpers);
                            return { success: true, data: out };
                          } catch (e) {
                            return { success: false, error: { code: 'CUSTOM_JS_ERROR', message: (e && e.message) ? e.message : String(e) } };
                          }
                        })
                        """,
                        {"fnSrc": js_fn_src, "payload": payload},
                    )

                    if not isinstance(result, dict):
                        return error_response("JAVASCRIPT_ERROR", "Malformed result from page context", executed_args=executed_args)
                    if result.get("success") is True:
                        return success_response(result.get("data"), executed_args=executed_args)
                    else:
                        error = result.get("error") or {}
                        return error_response(
                            str(error.get("code", "CUSTOM_JS_ERROR")),
                            error.get("message", "Custom JS execution failed"),
                            details=error.get("details") if isinstance(error, dict) else None,
                            executed_args=executed_args,
                        )
                except Exception as e:
                    return error_response("JAVASCRIPT_ERROR", f"Failed to execute custom JS: {str(e)}", executed_args=executed_args)

            else:
                return error_response("UNSUPPORTED", f"Unsupported api: {api}")

        except Exception as e:
            return error_response("RUNTIME_ERROR", "Execution failed", details={"api": api, "error": str(e)})

    async def _execute_js_script(self, script_name: str, ok_fn, err_fn, *args) -> dict:
        """Execute a JavaScript script with utilities and handle the response."""
        try:
            js_code = js_loader.build_complete_script(script_name, *args)
            result = await self.page.evaluate(js_code)
            
            if not isinstance(result, dict):
                return err_fn("JAVASCRIPT_ERROR", "Malformed result from page context")
            
            if result.get("success") is True:
                return ok_fn(result)
            elif result.get("error"):
                error = result["error"]
                if isinstance(error, dict):
                    return err_fn(
                        str(error.get("code", "EXECUTION_ERROR")), 
                        error.get("message", "Execution error"),
                        error.get("details"),
                    )
                else:
                    return err_fn("EXECUTION_ERROR", str(error))
            else:
                # Handle legacy format
                if result.get("ok") is True:
                    return ok_fn(result.get("data", result))
                elif result.get("ok") is False:
                    error = result.get("error", {})
                    return err_fn(
                        str(error.get("code", "ERROR")), 
                        error.get("message", "Operation failed"),
                        error.get("details"),
                    )
                else:
                    return err_fn("UNKNOWN_ERROR", "Unknown response format")
                    
        except Exception as e:
            return err_fn("JAVASCRIPT_ERROR", f"Failed to execute JavaScript: {str(e)}")

    def _translate_value_to_id(self, value: str, field_name: str) -> str:
        """
        Translate human-readable value to VM-compatible ID using cached mappings.
        
        Args:
            value: Human-readable value (e.g., "score", "mouse-pointer")
            field_name: The field name being set (e.g., "VARIABLE", "LIST")
            
        Returns:
            Translated ID or original value if no mapping found
        """
        if not self.cached_value_to_id_mappings or not isinstance(value, str):
            return value
            
        mappings = self.cached_value_to_id_mappings
        field_key = str(field_name).upper() if isinstance(field_name, str) else field_name

        if field_key == "VARIABLE":
            if value in mappings.get("variables", {}):
                return mappings["variables"][value]
            if value in mappings.get("stageVariables", {}):
                return mappings["stageVariables"][value]

        if field_key == "LIST":
            if value in mappings.get("lists", {}):
                return mappings["lists"][value]
            if value in mappings.get("stageLists", {}):
                return mappings["stageLists"][value]

        if field_key == "SOUND_MENU":
            if value in mappings.get("sounds", {}):
                return mappings["sounds"][value]

        # TOWARDS, TOUCHINGOBJECTMENU, TO, CLONE_OPTION 不能转换id
        if field_key in ["DISTANCETOMENU", "OBJECT"]:
            # Check sprites first, then special options
            if value in mappings.get("sprites", {}):
                return mappings["sprites"][value]
            elif value in mappings.get("specialOptions", {}):
                return mappings["specialOptions"][value]
                
        # elif field_name in ["CURRENTMENU", "KEY_OPTION", "PROPERTY"]:
        # 这两个field在我们的任务中没有用到
        if field_key in ["CURRENTMENU", "PROPERTY"]:
            # These typically use special options mapping
            if value in mappings.get("specialOptions", {}):
                return mappings["specialOptions"][value]
        
        # If no specific mapping found, return original value
        return value
