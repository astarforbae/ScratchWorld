#!/usr/bin/env python3
"""
Summarize start/end correctness for single-step drag benchmark results.

Usage: python results_sinlge_step_drag_benchmark.py <results_dir>
"""

import argparse
import json
from pathlib import Path


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


def get_run_result(result_path: Path):
    if not result_path.exists():
        return None, f"Missing result.json: {result_path}"
    data = load_json(result_path)
    if data is None:
        return None, f"Failed to read {result_path}"
    analysis = data.get("start_end_analysis")
    analysis = analysis if isinstance(analysis, dict) else None
    return {
        "analysis": analysis,
        "task_passed": is_task_passed(data),
    }, None


def collect_task_runs(task_dir: Path):
    run_dirs = [
        child for child in task_dir.iterdir()
        if child.is_dir() and child.name.isdigit()
    ]
    run_results = []

    if run_dirs:
        for run_dir in sorted(run_dirs, key=lambda p: int(p.name)):
            if len(run_results) >= 3:
                break
            run_result, err = get_run_result(run_dir / "result.json")
            if err:
                print(err)
                continue
            run_results.append(run_result)
    else:
        run_result, err = get_run_result(task_dir / "result.json")
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
    }


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


def summarize(results_dir: Path):
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
        run_results = collect_task_runs(task_dir)
        if run_results is None:
            continue

        category = None
        if task_id.startswith("T1_"):
            category = "t1"
        elif task_id.startswith("T2_"):
            category = "t2"

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
    return [label, str(total), start_rate, end_rate, start_gap, end_gap]


def print_table(rows):
    headers = [
        "Split",
        "Total",
        "Start Pass",
        "End Pass",
        "Start Gap(avg)",
        "End Gap(avg)",
    ]
    print("| " + " | ".join(headers) + " |")
    print("|---|---|---|---|---|---|")
    for row in rows:
        print("| " + " | ".join(row) + " |")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Summarize start/end correctness for single-step drag benchmark results",
    )
    parser.add_argument(
        "results_dir",
        help="Directory that contains per-task result folders",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    results_dir = Path(args.results_dir)
    if not results_dir.exists():
        raise SystemExit(f"Results dir not found: {results_dir}")

    totals, stats = summarize(results_dir)

    rows = [
        build_row("T1", totals["t1"], stats["t1"]),
        build_row("T2", totals["t2"], stats["t2"]),
        build_row("ALL", totals["all"], stats["all"]),
    ]
    print_table(rows)


if __name__ == "__main__":
    main()
