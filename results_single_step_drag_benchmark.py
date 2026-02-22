#!/usr/bin/env python3
"""
Summarize start/end correctness for single-step drag benchmark results.

Usage: python results_sinlge_step_drag_benchmark.py <results_dir>
"""

import argparse
import json
from pathlib import Path

import math
from dataclasses import dataclass
from typing import Optional, Tuple


import math
from dataclasses import dataclass
from typing import Optional, Tuple

DEFAULT_FALLBACK_STEP = 5.0

@dataclass(frozen=True)
class Region:
    points: list
    step_x: float
    step_y: float
    half_x: float
    half_y: float

@dataclass(frozen=True)
class TaskRegions:
    drag_start_point: Optional[Tuple[float, float]]
    start_region: Optional[Region]
    end_region: Optional[Region]

def is_point(value):
    return (
        isinstance(value, (list, tuple))
        and len(value) == 2
        and isinstance(value[0], (int, float))
        and isinstance(value[1], (int, float))
    )

def min_positive_diff(values):
    min_diff = None
    prev = None
    for val in values:
        if prev is not None:
            diff = val - prev
            if diff > 0 and (min_diff is None or diff < min_diff):
                min_diff = diff
        prev = val
    return min_diff

def estimate_steps(points):
    xs = sorted({p[0] for p in points if is_point(p)})
    ys = sorted({p[1] for p in points if is_point(p)})
    step_x = min_positive_diff(xs)
    step_y = min_positive_diff(ys)

    if step_x is None and step_y is None:
        step_x = DEFAULT_FALLBACK_STEP
        step_y = DEFAULT_FALLBACK_STEP
    elif step_x is None:
        step_x = step_y
    elif step_y is None:
        step_y = step_x

    if step_x <= 0:
        step_x = DEFAULT_FALLBACK_STEP
    if step_y <= 0:
        step_y = DEFAULT_FALLBACK_STEP

    return float(step_x), float(step_y)

def build_region(points):
    if not points:
        return None
    clean_points = [tuple(p) for p in points if is_point(p)]
    if not clean_points:
        return None
    step_x, step_y = estimate_steps(clean_points)
    return Region(
        points=clean_points,
        step_x=step_x,
        step_y=step_y,
        half_x=step_x / 2.0,
        half_y=step_y / 2.0,
    )

def analyze_point(point, region):
    if region is None or point is None:
        return {
            "in_region": None,
            "distance_to_nearest": None,
            "nearest_point": None,
            "grid_step": None,
            "error": "missing_region" if region is None else "missing_point",
        }

    px, py = float(point[0]), float(point[1])
    min_dist_sq = None
    nearest = None
    in_region = False

    for fx, fy in region.points:
        dx = px - fx
        dy = py - fy
        if not in_region and abs(dx) <= region.half_x and abs(dy) <= region.half_y:
            in_region = True
        dist_sq = dx * dx + dy * dy
        if min_dist_sq is None or dist_sq < min_dist_sq:
            min_dist_sq = dist_sq
            nearest = [fx, fy]

    distance = math.sqrt(min_dist_sq) if min_dist_sq is not None else None
    return {
        "in_region": in_region,
        "distance_to_nearest": None if distance is None else round(distance, 3),
        "nearest_point": nearest,
        "grid_step": [region.step_x, region.step_y],
    }

def build_task_regions(tasks_dir: Path):
    tasks = {}
    if not tasks_dir.exists():
        return tasks
    for task_file in sorted(tasks_dir.glob("*.json")):
        data = load_json(task_file)
        if not isinstance(data, dict):
            continue
        task_id = data.get("id") or task_file.stem
        eval_config = data.get("evaluation_config") or {}
        drag_start_point = eval_config.get("drag_start_point")
        if not is_point(drag_start_point):
            drag_start_point = None
        start_region = build_region(eval_config.get("feasible_start_points") or [])
        end_region = build_region(eval_config.get("feasible_points") or [])
        tasks[task_id] = TaskRegions(
            drag_start_point=tuple(drag_start_point) if drag_start_point else None,
            start_region=start_region,
            end_region=end_region,
        )
    return tasks

def extract_drag_points(result_data):
    action = result_data.get("action") if isinstance(result_data, dict) else None
    args = action.get("args") if isinstance(action, dict) else None
    if not isinstance(args, dict):
        return None, None
    start_x = args.get("start_x")
    start_y = args.get("start_y")
    end_x = args.get("end_x")
    end_y = args.get("end_y")
    if start_x is None or start_y is None or end_x is None or end_y is None:
        return None, None
    return [start_x, start_y], [end_x, end_y]

def infer_task_id(result_data, result_path: Path):
    if isinstance(result_data, dict):
        task_id = result_data.get("task_id")
        if task_id:
            return task_id
    parts = result_path.parts
    if len(parts) >= 3:
        return parts[-3]
    return None

def compute_start_end_analysis(data, task_id, tasks_map):
    task_regions = tasks_map.get(task_id)
    if not task_regions:
        return {"error": "task_config_not_found", "task_id": task_id}

    start, end = extract_drag_points(data)
    if start is None or end is None:
        return {"error": "missing_drag_points", "task_id": task_id}

    start_info = analyze_point(start, task_regions.start_region)
    start_info["point"] = start

    analysis = {
        "task_id": task_id,
        "start": start_info,
    }

    start_in_region = start_info.get("in_region")
    end_info = None

    if start_in_region is True:
        if task_regions.drag_start_point is None:
            end_info = {
                "skipped": True,
                "skip_reason": "missing_drag_start_point",
                "original_point": end,
            }
        else:
            dx = task_regions.drag_start_point[0] - start[0]
            dy = task_regions.drag_start_point[1] - start[1]
            mapped_end = [end[0] + dx, end[1] + dy]
            end_info = analyze_point(mapped_end, task_regions.end_region)
            end_info["original_point"] = end
            end_info["mapped_point"] = mapped_end
            end_info["translation"] = {
                "drag_start_point": [task_regions.drag_start_point[0], task_regions.drag_start_point[1]],
                "delta": [dx, dy],
            }
    else:
        end_info = {
            "skipped": True,
            "skip_reason": "start_out_of_region" if start_in_region is False else "start_unknown",
            "original_point": end,
        }

    analysis["end"] = end_info

    failure_type = "unknown"
    if start_in_region is False:
        failure_type = "start"
    elif start_in_region is True:
        end_in_region = end_info.get("in_region") if isinstance(end_info, dict) else None
        if end_in_region is False:
            failure_type = "end"
        elif end_in_region is True:
            failure_type = "none"
    analysis["failure_type"] = failure_type

    return analysis


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def is_task_passed(data):
    if not isinstance(data, dict):
        return False
    eval_result = data.get("evaluation_result")
    if isinstance(eval_result, bool):
        return eval_result
    success = data.get("success")
    if isinstance(success, bool):
        return success
    return False


def get_run_result(result_path: Path, tasks_map):
    if not result_path.exists():
        return None, f"Missing result.json: {result_path}"
    data = load_json(result_path)
    if data is None:
        return None, f"Failed to read {result_path}"
    
    # Check if analysis is already there, but we can also recompute standalone
    analysis = data.get("start_end_analysis")
    if not isinstance(analysis, dict) or analysis.get("error") is not None:
        task_id = infer_task_id(data, result_path)
        analysis = compute_start_end_analysis(data, task_id, tasks_map)

    return {
        "analysis": analysis,
        "task_passed": is_task_passed(data),
    }, None


def collect_task_runs(task_dir: Path, tasks_map):
    run_dirs = [
        child for child in task_dir.iterdir()
        if child.is_dir() and child.name.isdigit()
    ]
    run_results = []

    if run_dirs:
        for run_dir in sorted(run_dirs, key=lambda p: int(p.name)):
            if len(run_results) >= 3:
                break
            run_result, err = get_run_result(run_dir / "result.json", tasks_map)
            if err:
                print(err)
                continue
            run_results.append(run_result)
    else:
        run_result, err = get_run_result(task_dir / "result.json", tasks_map)
        if err:
            print(err)
        else:
            run_results.append(run_result)

    if not run_results:
        return None
    return run_results


def is_in_region(info):
    if not isinstance(info, dict):
        return None
    val = info.get("in_region")
    if isinstance(val, bool):
        return val
    return None


def get_distance(info):
    if not isinstance(info, dict):
        return None
    val = info.get("distance_to_nearest")
    if isinstance(val, (int, float)):
        return float(val)
    return None


def init_bucket():
    return {
        "start_pass": 0,
        "task_success": 0,
        "start_fail_gaps": [],
        "end_fail_gaps": [],
        "task_count": 0,
        "pass_at_1": 0,
        "pass_at_2": 0,
        "pass_at_3": 0,
    }


def update_pass_at_metrics(bucket, run_results):
    bucket["task_count"] += 1
    passed_at = None
    for i, run in enumerate(run_results):
        if run.get("task_passed"):
            passed_at = i + 1
            break
    if passed_at is not None:
        if passed_at <= 1:
            bucket["pass_at_1"] += 1
        if passed_at <= 2:
            bucket["pass_at_2"] += 1
        if passed_at <= 3:
            bucket["pass_at_3"] += 1


def update_bucket(bucket, run):
    if not isinstance(run, dict):
        return
    analysis = run.get("analysis")
    task_passed = bool(run.get("task_passed"))

    if task_passed:
        bucket["start_pass"] += 1
        bucket["task_success"] += 1
        return

    start = analysis.get("start") if isinstance(analysis, dict) else None
    end = analysis.get("end") if isinstance(analysis, dict) else None
    start_in = is_in_region(start)
    if start_in is True:
        bucket["start_pass"] += 1
        dist = get_distance(end)
        if dist is not None:
            bucket["end_fail_gaps"].append(dist)
    elif start_in is False:
        dist = get_distance(start)
        if dist is not None:
            bucket["start_fail_gaps"].append(dist)


def summarize(results_dir: Path, tasks_dir: Path):
    tasks_map = build_task_regions(tasks_dir)
    totals = {"t1": 0, "t2": 0, "all": 0}
    stats = {
        "t1": init_bucket(),
        "t2": init_bucket(),
        "all": init_bucket(),
    }

    for task_dir in sorted(results_dir.iterdir()):
        if not task_dir.is_dir():
            continue
        task_id = task_dir.name
        run_results = collect_task_runs(task_dir, tasks_map)
        if run_results is None:
            continue

        category = None
        if task_id.startswith("T1_"):
            category = "t1"
        elif task_id.startswith("T2_"):
            category = "t2"

        update_pass_at_metrics(stats["all"], run_results)
        if category:
            update_pass_at_metrics(stats[category], run_results)

        for run in run_results:
            totals["all"] += 1
            if category:
                totals[category] += 1
            update_bucket(stats["all"], run)
            if category:
                update_bucket(stats[category], run)

    return totals, stats


def rate(success, total):
    if total == 0:
        return 0.0
    return (success / total) * 100.0


def avg(values):
    if not values:
        return None
    return sum(values) / len(values)


def format_pct(value):
    return f"{value:.2f}%"


def format_gap(value):
    if value is None:
        return "n/a"
    return f"{value:.2f}px"


def build_row(label, total, bucket):
    start_rate = format_pct(rate(bucket["start_pass"], total))
    end_rate = format_pct(rate(bucket["task_success"], bucket["start_pass"]))
    start_gap = format_gap(avg(bucket["start_fail_gaps"]))
    end_gap = format_gap(avg(bucket["end_fail_gaps"]))
    
    task_count = bucket.get("task_count", 0)
    p1 = format_pct(rate(bucket.get("pass_at_1", 0), task_count))
    p2 = format_pct(rate(bucket.get("pass_at_2", 0), task_count))
    p3 = format_pct(rate(bucket.get("pass_at_3", 0), task_count))
    
    return [label, str(task_count), str(total), p1, p2, p3, start_rate, end_rate, start_gap, end_gap]


def print_table(rows):
    headers = [
        "Split",
        "Tasks",
        "Runs",
        "Pass@1",
        "Pass@2",
        "Pass@3",
        "Start Pass",
        "End Pass",
        "Start Gap(avg)",
        "End Gap(avg)",
    ]
    print("| " + " | ".join(headers) + " |")
    print("|" + "|".join(["---"] * len(headers)) + "|")
    for row in rows:
        print("| " + " | ".join(row) + " |")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Summarize start/end correctness for single-step drag benchmark results (standalone)",
    )
    parser.add_argument(
        "results_dir",
        help="Directory that contains per-task result folders",
    )
    parser.add_argument(
        "--tasks-dir",
        default=None,
        help="Path to tasks directory (defaults to single_step_drag_benchmark/tasks)",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    results_dir = Path(args.results_dir)
    if not results_dir.exists():
        raise SystemExit(f"Results dir not found: {results_dir}")

    repo_root = Path(__file__).resolve().parent
    tasks_dir = Path(args.tasks_dir) if args.tasks_dir else repo_root / "single_step_drag_benchmark" / "tasks"
    if not tasks_dir.exists():
        raise SystemExit(f"Tasks dir not found: {tasks_dir}")

    totals, stats = summarize(results_dir, tasks_dir)

    rows = [
        build_row("T1", totals["t1"], stats["t1"]),
        build_row("T2", totals["t2"], stats["t2"]),
        build_row("ALL", totals["all"], stats["all"]),
    ]
    print_table(rows)


if __name__ == "__main__":
    main()
