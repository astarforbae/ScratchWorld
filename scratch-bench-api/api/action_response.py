"""
Shared response builders for action APIs.

This module centralizes the v2 action response envelope:
{
    "success": <bool>,
    "requested_action": {"api": str, "args": dict},
    "executed_action": {"api": str, "args": dict},
    "data": dict,
    "error": null | {"code": str, "message": str, "details"?: dict},
    "meta": {"session_id": str|None, "timestamp": str, "duration_ms": int}
}
"""

from __future__ import annotations

from datetime import datetime, timezone
import time
from typing import Any, Dict, Optional


def _iso_utc_now() -> str:
    """Return current UTC timestamp in ISO-8601 with Z suffix."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _normalize_action(action: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Normalize action shape to {"api": <str>, "args": <dict>}.

    Missing fields are filled with safe defaults to preserve envelope shape.
    """
    if not isinstance(action, dict):
        return {"api": "", "args": {}}

    api = action.get("api")
    args = action.get("args", {})
    normalized_args = dict(args) if isinstance(args, dict) else {}
    return {
        "api": str(api) if api is not None else "",
        "args": normalized_args,
    }


def normalize_error(error: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Normalize error object to {"code": str, "message": str, "details"?: dict}.
    """
    if not isinstance(error, dict):
        return {"code": "UNKNOWN_ERROR", "message": str(error) if error is not None else "Unknown error"}

    code = error.get("code")
    message = error.get("message")
    details = error.get("details")

    out: Dict[str, Any] = {
        "code": str(code) if code is not None else "UNKNOWN_ERROR",
        "message": str(message) if message is not None else "Unknown error",
    }
    if isinstance(details, dict):
        out["details"] = details
    return out


def build_meta(
    *,
    session_id: Optional[str],
    started_at: Optional[float] = None,
    duration_ms: Optional[int] = None,
    timestamp: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Build metadata block for action responses.

    Args:
        session_id: Current session id (if available).
        started_at: Optional monotonic timestamp from time.perf_counter().
        duration_ms: Optional explicit duration in milliseconds.
        timestamp: Optional explicit ISO timestamp.
    """
    if duration_ms is None:
        if started_at is not None:
            duration_ms = max(0, int(round((time.perf_counter() - started_at) * 1000)))
        else:
            duration_ms = 0

    return {
        "session_id": session_id,
        "timestamp": timestamp or _iso_utc_now(),
        "duration_ms": duration_ms,
    }


def normalize_composite_data(data: Any, *, requested_api: Optional[str] = None) -> Dict[str, Any]:
    """
    Normalize composite API payload into useful business data only.

    Applied rules:
    - Remove top-level `success`.
    - Remove top-level `api` if redundant with requested_api.
    - Unwrap `result` when it is a transport wrapper.
    - Keep output as an object.
    """
    if data is None:
        return {}

    if not isinstance(data, dict):
        return {"value": data}

    out = dict(data)
    out.pop("success", None)

    if requested_api and out.get("api") == requested_api:
        out.pop("api", None)

    # Case: {"result": ...} after removing wrappers -> unwrap.
    if set(out.keys()) == {"result"}:
        inner = out.get("result")
        if isinstance(inner, dict):
            inner_out = dict(inner)
            inner_out.pop("success", None)
            if requested_api and inner_out.get("api") == requested_api:
                inner_out.pop("api", None)
            return inner_out
        return {"value": inner}

    # Case: keep non-wrapper keys; sanitize nested result dict if present.
    if isinstance(out.get("result"), dict):
        result_obj = dict(out["result"])
        result_obj.pop("success", None)
        if requested_api and result_obj.get("api") == requested_api:
            result_obj.pop("api", None)
        out["result"] = result_obj

    return out


def build_success_response(
    *,
    requested_action: Dict[str, Any],
    executed_action: Dict[str, Any],
    data: Optional[Dict[str, Any]] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build v2 success response envelope."""
    return {
        "success": True,
        "requested_action": _normalize_action(requested_action),
        "executed_action": _normalize_action(executed_action),
        "data": dict(data) if isinstance(data, dict) else {},
        "error": None,
        "meta": dict(meta) if isinstance(meta, dict) else build_meta(session_id=None),
    }


def build_error_response(
    *,
    requested_action: Dict[str, Any],
    executed_action: Dict[str, Any],
    error: Dict[str, Any],
    data: Optional[Dict[str, Any]] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build v2 error response envelope."""
    return {
        "success": False,
        "requested_action": _normalize_action(requested_action),
        "executed_action": _normalize_action(executed_action),
        "data": dict(data) if isinstance(data, dict) else {},
        "error": normalize_error(error),
        "meta": dict(meta) if isinstance(meta, dict) else build_meta(session_id=None),
    }

