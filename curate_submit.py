#!/usr/bin/env python3
"""
Curate submission files from a ScratchBench result directory.

Given a result dir such as:
  result_ecnu_reasoner_composite_scratch-agent

This script:
1) Discovers task result directories under it (those containing interaction_log_*.json)
2) Builds submit JSON payloads where each interaction action is taken from
   interaction.result.executed_action (fallback to interaction.action when needed)
3) Writes one JSONL file containing all curated submit payloads
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

_PRIMITIVE_ACTION_APIS = {
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

_POINT_RE = re.compile(r"\((\d+),\s*(\d+)\)")
_ELEMENT_ROW_RE = re.compile(
    r"^\s*(\d+)\s+(?P<type>\S+)\s+(?P<text>.*?)\s+\((\d+),\s*(\d+)\)\s+(\d+)x(\d+)\s*$"
)


def _read_json(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _normalize_mode(raw_mode: Any) -> Optional[str]:
    if raw_mode is None:
        return None
    mode = str(raw_mode).strip().lower()
    if mode in {"primitive", "low_level", "low-level"}:
        return "primitive"
    if mode in {"composite", "encapsulated", "high_level", "high-level"}:
        return "composite"
    return None


def _discover_task_dirs(result_dir: Path) -> List[Path]:
    if not result_dir.is_dir():
        raise FileNotFoundError(f"Result dir not found: {result_dir}")
    found: List[Path] = []
    seen: Set[Path] = set()
    for interaction_log in result_dir.rglob("interaction_log_*.json"):
        task_dir = interaction_log.parent
        if task_dir in seen:
            continue
        seen.add(task_dir)
        found.append(task_dir)
    found.sort()
    return found


def _latest_interaction_log(task_dir: Path) -> Path:
    files = sorted(task_dir.glob("interaction_log_*.json"))
    if not files:
        raise FileNotFoundError(f"No interaction_log_*.json found under {task_dir}")
    return files[-1]


def _parse_points_from_message(message: Optional[str]) -> List[Tuple[int, int]]:
    if not message:
        return []
    return [(int(x), int(y)) for x, y in _POINT_RE.findall(message)]


def _element_center_from_elements_table(elements_table: str, index: int) -> Tuple[int, int]:
    for line in (elements_table or "").splitlines():
        m = _ELEMENT_ROW_RE.match(line)
        if not m:
            continue
        if int(m.group(1)) != int(index):
            continue
        x = int(m.group(4))
        y = int(m.group(5))
        width = int(m.group(6))
        height = int(m.group(7))
        return (int(x + width / 2), int(y + height / 2))
    raise ValueError(f"Could not resolve element index {index} from recorded elements table")


def _ground_action_from_record(
    *,
    action: Dict[str, Any],
    recorded_observation: Dict[str, Any],
    recorded_result: Dict[str, Any],
) -> Dict[str, Any]:
    api_type = (action or {}).get("api")
    args_in = (action or {}).get("args") or {}
    args: Dict[str, Any] = dict(args_in) if isinstance(args_in, dict) else {}

    result_obj = recorded_result if isinstance(recorded_result, dict) else {}
    executed_action = result_obj.get("executed_action")
    executed_args = (
        dict(executed_action.get("args"))
        if isinstance(executed_action, dict) and isinstance(executed_action.get("args"), dict)
        else {}
    )
    message = result_obj.get("message")
    points = _parse_points_from_message(message)
    elements_table = (recorded_observation or {}).get("elements") or ""

    if api_type in {"click", "double_click", "move_to"}:
        if "index" in args and ("x" not in args or "y" not in args):
            index = int(args.pop("index"))
            if isinstance(executed_args.get("x"), (int, float)) and isinstance(executed_args.get("y"), (int, float)):
                x, y = int(executed_args["x"]), int(executed_args["y"])
            elif points:
                x, y = points[0]
            else:
                x, y = _element_center_from_elements_table(elements_table, index)
            args["x"] = int(x)
            args["y"] = int(y)
    elif api_type == "scroll":
        if "index" in args and ("x" not in args or "y" not in args):
            index = int(args.pop("index"))
            if isinstance(executed_args.get("x"), (int, float)) and isinstance(executed_args.get("y"), (int, float)):
                x, y = int(executed_args["x"]), int(executed_args["y"])
            elif points:
                x, y = points[0]
            else:
                x, y = _element_center_from_elements_table(elements_table, index)
            args["x"] = int(x)
            args["y"] = int(y)
    elif api_type == "drag_and_drop":
        exec_start = None
        exec_end = None
        if isinstance(executed_args.get("start_x"), (int, float)) and isinstance(executed_args.get("start_y"), (int, float)):
            exec_start = (int(executed_args["start_x"]), int(executed_args["start_y"]))
        if isinstance(executed_args.get("end_x"), (int, float)) and isinstance(executed_args.get("end_y"), (int, float)):
            exec_end = (int(executed_args["end_x"]), int(executed_args["end_y"]))

        msg_start: Optional[Tuple[int, int]] = points[0] if len(points) >= 1 else None
        msg_end: Optional[Tuple[int, int]] = points[1] if len(points) >= 2 else None

        if "start_index" in args and ("start_x" not in args or "start_y" not in args):
            start_index = int(args.pop("start_index"))
            if exec_start is not None:
                sx, sy = exec_start
            elif msg_start is not None:
                sx, sy = msg_start
            else:
                sx, sy = _element_center_from_elements_table(elements_table, start_index)
            args["start_x"] = int(sx)
            args["start_y"] = int(sy)

        if "end_index" in args and ("end_x" not in args or "end_y" not in args):
            end_index = int(args.pop("end_index"))
            if exec_end is not None:
                ex, ey = exec_end
            elif msg_end is not None:
                ex, ey = msg_end
            else:
                ex, ey = _element_center_from_elements_table(elements_table, end_index)
            args["end_x"] = int(ex)
            args["end_y"] = int(ey)

        if ("start_x" not in args or "start_y" not in args) and exec_start is not None:
            args.setdefault("start_x", int(exec_start[0]))
            args.setdefault("start_y", int(exec_start[1]))
        if ("end_x" not in args or "end_y" not in args) and exec_end is not None:
            args.setdefault("end_x", int(exec_end[0]))
            args.setdefault("end_y", int(exec_end[1]))
        if ("start_x" not in args or "start_y" not in args) and msg_start is not None:
            args.setdefault("start_x", int(msg_start[0]))
            args.setdefault("start_y", int(msg_start[1]))
        if ("end_x" not in args or "end_y" not in args) and msg_end is not None:
            args.setdefault("end_x", int(msg_end[0]))
            args.setdefault("end_y", int(msg_end[1]))

    return {"api": api_type, "args": args}


def _extract_submit_interactions(
    interaction_log: Dict[str, Any],
) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    interactions = interaction_log.get("interactions")
    if not isinstance(interactions, list):
        raise ValueError("interaction_log['interactions'] must be a list")

    curated: List[Dict[str, Any]] = []
    stats = {
        "total_rows": 0,
        "used_executed_action": 0,
        "used_grounded_fallback": 0,
        "used_action_fallback": 0,
        "skipped_missing_action": 0,
    }

    for idx, item in enumerate(interactions, start=1):
        if not isinstance(item, dict):
            continue
        stats["total_rows"] += 1

        turn_raw = item.get("turn")
        try:
            turn = int(turn_raw)
        except Exception:
            turn = idx

        action: Optional[Dict[str, Any]] = None

        result_obj = item.get("result")
        if isinstance(result_obj, dict):
            executed_action = result_obj.get("executed_action")
            if isinstance(executed_action, dict) and executed_action.get("api"):
                action = {
                    "api": str(executed_action.get("api") or ""),
                    "args": dict(executed_action.get("args") or {})
                    if isinstance(executed_action.get("args"), dict)
                    else {},
                }
                stats["used_executed_action"] += 1

        if action is None:
            action_obj = item.get("action")
            if isinstance(action_obj, dict) and action_obj.get("api"):
                api_name = str(action_obj.get("api") or "")
                api_name_lower = api_name.strip().lower()
                if api_name_lower in _PRIMITIVE_ACTION_APIS:
                    try:
                        action = _ground_action_from_record(
                            action=action_obj,
                            recorded_observation=item.get("observation") if isinstance(item.get("observation"), dict) else {},
                            recorded_result=result_obj if isinstance(result_obj, dict) else {},
                        )
                        stats["used_grounded_fallback"] += 1
                    except Exception:
                        action = {
                            "api": api_name,
                            "args": dict(action_obj.get("args") or {})
                            if isinstance(action_obj.get("args"), dict)
                            else {},
                        }
                        stats["used_action_fallback"] += 1
                else:
                    action = {
                        "api": api_name,
                        "args": dict(action_obj.get("args") or {})
                        if isinstance(action_obj.get("args"), dict)
                        else {},
                    }
                    stats["used_action_fallback"] += 1

        if action is None:
            stats["skipped_missing_action"] += 1
            continue

        curated.append({"turn": turn, "action": action})

    curated.sort(key=lambda x: int(x.get("turn") or 0))
    return curated, stats


def _resolve_task_identity(
    *,
    task_dir: Path,
    result_dir: Path,
    task_config: Dict[str, Any],
    run_args: Dict[str, Any],
    interaction_log: Dict[str, Any],
) -> Tuple[str, str, str]:
    rel = task_dir.relative_to(result_dir)
    rel_parts = list(rel.parts)

    task_type = str(task_config.get("type") or "").strip()
    if not task_type and len(rel_parts) >= 2:
        task_type = str(rel_parts[0]).strip()
    if not task_type:
        task_type = "unknown"

    take = str(task_config.get("name") or task_dir.name).strip()
    if not take:
        take = task_dir.name

    mode = (
        _normalize_mode(interaction_log.get("mode"))
        or _normalize_mode(((run_args.get("resolved") or {}).get("mode")))
        or _normalize_mode(((run_args.get("cli_args") or {}).get("mode")))
        or "primitive"
    )
    return task_type, take, mode


def _build_submit_object(
    *,
    task_type: str,
    take: str,
    mode: str,
    curated_interactions: List[Dict[str, Any]],
    source_log: Path,
    task_dir: Path,
) -> Dict[str, Any]:
    return {
        "take": take,
        "type": task_type,
        "mode": mode,
        "interactions": curated_interactions,
        "source_interaction_log": str(source_log),
        "source_task_dir": str(task_dir),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate a single submit JSONL file from a result directory."
    )
    parser.add_argument(
        "--result-dir",
        required=True,
        help="Result directory containing task result folders (e.g., result_xxx).",
    )
    args = parser.parse_args()

    result_dir = Path(args.result_dir)
    stamp = time.strftime("%Y%m%d_%H%M%S")

    task_dirs = _discover_task_dirs(result_dir)
    if not task_dirs:
        raise FileNotFoundError(f"No task directories found under {result_dir}")

    project_root = Path(__file__).resolve().parent
    jsonl_path = project_root / f"{result_dir.name}_{stamp}.jsonl"
    jsonl_rows: List[str] = []

    for task_dir in task_dirs:
        interaction_log_path = _latest_interaction_log(task_dir)
        interaction_log = _read_json(interaction_log_path)
        task_config = _read_json(task_dir / "task_config.json") if (task_dir / "task_config.json").exists() else {}
        run_args = _read_json(task_dir / "run_args.json") if (task_dir / "run_args.json").exists() else {}

        task_type, take, mode = _resolve_task_identity(
            task_dir=task_dir,
            result_dir=result_dir,
            task_config=task_config,
            run_args=run_args,
            interaction_log=interaction_log,
        )
        curated_interactions, _ = _extract_submit_interactions(interaction_log)
        submit_obj = _build_submit_object(
            task_type=task_type,
            take=take,
            mode=mode,
            curated_interactions=curated_interactions,
            source_log=interaction_log_path,
            task_dir=task_dir,
        )
        jsonl_rows.append(json.dumps(submit_obj, ensure_ascii=False))

    jsonl_path.write_text("\n".join(jsonl_rows) + ("\n" if jsonl_rows else ""), encoding="utf-8")
    print(jsonl_path.name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
