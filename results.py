#!/usr/bin/env python3
"""
Analyze Scratch-Bench run results.

This script scans result directories for task results.

Usage:
  python results.py [result_directory] [--task_list TASKS_JSON]

- result_directory: root directory to scan for results (optional, defaults to ./result)
- --task_list: JSON file in tasks/ directory containing the list of tasks to include (e.g., rq3_tasks.json).
               It filters the results to only include tasks present in this list.

Expected directory structure:
  result_dir/
  ├── create/
  │   └── task_name/
  │       └── result.json
  ├── debug/
  ├── compute/
  └── extend/

"""
from __future__ import annotations

import argparse
import csv
import json
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional, Set

ISO_FORMATS = [
    "%Y-%m-%dT%H:%M:%S%z",   # with timezone
    "%Y-%m-%dT%H:%M:%S",     # naive
]


def parse_iso(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    for fmt in ISO_FORMATS:
        try:
            return datetime.strptime(ts, fmt)
        except Exception:
            continue
    # Try appending local offset 'Z' if it looks like naive
    try:
        return datetime.fromisoformat(ts)
    except Exception:
        return None


@dataclass
class RunRecord:
    task_name: Optional[str]
    task_type: Optional[str]
    success: Optional[bool]
    duration_sec: Optional[float]
    partial_success_rate: Optional[float]


def extract_duration_sec(d: Dict[str, Any]) -> Optional[float]:
    rec = d.get("recording") or {}
    start_s = rec.get("start_time")
    end_s = rec.get("end_time")
    start_dt = parse_iso(start_s)
    end_dt = parse_iso(end_s)
    if start_dt and end_dt:
        return (end_dt - start_dt).total_seconds()
    return None


def load_allowed_tasks(task_list_filename: str, tasks_dir: str) -> Set[str]:
    """
    Load allowed tasks from a JSON file.
    Tries to find the file directly, or within the tasks directory.
    Returns a set of task names (without .json extension).
    """
    if os.path.exists(task_list_filename):
        json_path = task_list_filename
    else:
        json_path = os.path.join(tasks_dir, task_list_filename)
        
    if not os.path.exists(json_path):
        print(f"Warning: Task list file not found: {json_path}")
        return set()
    
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        allowed_tasks = set()
        
        # Handle dict format like rq3_tasks.json {"category": ["file1.json", ...]}
        if isinstance(data, dict):
            for task_list in data.values():
                if isinstance(task_list, list):
                    for task_file in task_list:
                        if isinstance(task_file, str):
                            # Remove .json extension if present
                            task_name = task_file.replace('.json', '')
                            allowed_tasks.add(task_name)
        
        # Handle list format ["file1.json", ...]
        elif isinstance(data, list):
            for task_file in data:
                if isinstance(task_file, str):
                    task_name = task_file.replace('.json', '')
                    allowed_tasks.add(task_name)
                    
        return allowed_tasks
    except Exception as e:
        print(f"Error loading task list {json_path}: {e}")
        return set()


def scan_task_results(base_dir: str, allowed_tasks: Optional[Set[str]] = None) -> List[RunRecord]:
    """
    Scan for task directories and extract success information.
    Expected structure: base_dir/task_type/task_name/
    Returns run_records
    """
    run_records: List[RunRecord] = []
    
    # Define the expected task types
    task_types = ['create', 'debug', 'compute', 'extend']
    
    for task_type in task_types:
        task_type_dir = os.path.join(base_dir, task_type)
        if not os.path.isdir(task_type_dir):
            continue
            
        # Each subdirectory in task_type_dir is a task
        for task_dir_name in os.listdir(task_type_dir):
            # The directory name is usually the task name.
            # Filter if a list is provided.
            if allowed_tasks is not None and task_dir_name not in allowed_tasks:
                continue

            task_dir = os.path.join(task_type_dir, task_dir_name)
            if not os.path.isdir(task_dir):
                continue
            
            # Check for result.json to determine success status
            result_json_path = os.path.join(task_dir, "result.json")
            if os.path.exists(result_json_path):
                try:
                    with open(result_json_path, "r", encoding="utf-8") as f:
                        result_data = json.load(f)
                    
                    # Extract partial success rate from evaluation section
                    partial_success_rate = None
                    evaluation = result_data.get("evaluation", {})
                    if isinstance(evaluation, dict):
                        partial_success_rate = evaluation.get("partial_success_rate")
                    
                    run_records.append(
                        RunRecord(
                            task_name=result_data.get("task_name", task_dir_name),
                            task_type=result_data.get("task_type", task_type),
                            success=result_data.get("success"),
                            duration_sec=extract_duration_sec(result_data),
                            partial_success_rate=partial_success_rate,
                        )
                    )
                except Exception:
                    # If result.json is malformed, still create a record with basic info
                    run_records.append(
                        RunRecord(
                            task_name=task_dir_name,
                            task_type=task_type,
                            success=None,
                            duration_sec=None,
                            partial_success_rate=None,
                        )
                    )
    
    return run_records


def scan_error_task_dirs(base_dir: str, allowed_tasks: Optional[Set[str]] = None) -> Set[str]:
    """
    Return a set of absolute task directories that contain an 'error.json' file.
    """
    task_dirs: Set[str] = set()
    
    task_types = ['create', 'debug', 'compute', 'extend']
    for task_type in task_types:
        task_type_dir = os.path.join(base_dir, task_type)
        if not os.path.isdir(task_type_dir):
            continue
        
        for task_name in os.listdir(task_type_dir):
             if allowed_tasks is not None and task_name not in allowed_tasks:
                continue
             
             task_dir = os.path.join(task_type_dir, task_name)
             if os.path.isfile(os.path.join(task_dir, "error.json")):
                 task_dirs.add(os.path.abspath(task_dir))

    return task_dirs


def categorize_tasks(base_dir: str, records: List[RunRecord], allowed_tasks: Optional[Set[str]] = None) -> Dict[str, List[str]]:
    """
    Categorize tasks into 'success', 'failed', and 'error'.
    """
    error_dirs = scan_error_task_dirs(base_dir, allowed_tasks)

    # Map each task directory to the best-known outcome
    outcomes: Dict[str, str] = {}
    names: Dict[str, str] = {}

    # First, mark error tasks by directory
    for d in error_dirs:
        outcomes[d] = "error"
        names[d] = os.path.basename(d)

    # Then, process result.json records if not already marked as error
    for r in records:
        task_dir = os.path.abspath(os.path.join(base_dir, r.task_type, r.task_name))
        if outcomes.get(task_dir) == "error":
            # error takes precedence
            continue
        task_name = r.task_name or os.path.basename(task_dir)
        names[task_dir] = task_name
        if r.success is True:
            outcomes[task_dir] = "success"
        elif r.success is False:
            outcomes[task_dir] = "failed"
        else:
            # leave uncategorized if success is None
            pass

    categorized: Dict[str, List[str]] = {"success": [], "failed": [], "error": []}
    for d, cat in outcomes.items():
        if cat in categorized:
            categorized[cat].append(names.get(d, os.path.basename(d)))

    # Sort names for stable output
    for k in categorized:
        categorized[k] = sorted(set(categorized[k]))

    return categorized


def summarize(records: List[RunRecord]) -> Dict[str, Any]:
    """
    Summarize run records for success rates, partial success rates, and duration statistics.
    """
    def avg(values: List[float]) -> Optional[float]:
        return sum(values) / len(values) if values else None

    durs = [r.duration_sec for r in records if r.duration_sec is not None]
    
    partial_sum = sum(r.partial_success_rate for r in records if r.partial_success_rate is not None)
    total_tasks = len(records)
    
    tasks_without_partial_rate = [r.task_name for r in records if r.partial_success_rate is None and r.task_name is not None]

    by_type: Dict[str, List[RunRecord]] = {}
    for r in records:
        key = r.task_type or "unknown"
        by_type.setdefault(key, []).append(r)

    type_stats: Dict[str, Dict[str, Any]] = {}
    for t, rs in by_type.items():
        t_durs = [r.duration_sec for r in rs if r.duration_sec is not None]
        t_partial_sum = sum(r.partial_success_rate for r in rs if r.partial_success_rate is not None)
        t_tasks_without = [r.task_name for r in rs if r.partial_success_rate is None and r.task_name is not None]
        t_count = len(rs)
        
        type_stats[t] = {
            "count": t_count,
            "avg_duration_sec": avg(t_durs),
            "success_rate": (sum(1 for r in rs if r.success) / t_count) if t_count else None,
            "partial_success_rate": (t_partial_sum / t_count) if t_count else None,
            "tasks_with_partial_rate": len([r for r in rs if r.partial_success_rate is not None]),
            "tasks_without_partial_rate": t_tasks_without,
        }

    overall = {
        "files_processed": total_tasks,
        "with_duration": len(durs),
        "avg_duration_sec": avg(durs),
        "total_duration_sec": sum(durs) if durs else None,
        "success_rate": (sum(1 for r in records if r.success) / total_tasks) if total_tasks else None,
        "partial_success_rate": (partial_sum / total_tasks) if total_tasks else None,
        "tasks_with_partial_rate": len([r for r in records if r.partial_success_rate is not None]),
        "tasks_without_partial_rate": tasks_without_partial_rate,
    }

    return {"overall": overall, "by_type": type_stats}


def print_summary(summary: Dict[str, Any]) -> None:
    """
    Print the success rate, partial success rate, and duration summary.
    """
    overall = summary["overall"]
    by_type = summary["by_type"]

    def fmt(v: Any) -> str:
        if v is None:
            return "-"
        if isinstance(v, float):
            return f"{v:.4f}"
        return str(v)

    print("\n==== Scratch-Bench Results Summary ====")
    print(f"Files processed: {overall['files_processed']}")
    print(f"Avg duration:    {fmt(overall['avg_duration_sec'])} s")
    print(f"Total duration:  {fmt(overall['total_duration_sec'])} s")
    print(f"Success rate:    {fmt(overall['success_rate'])}")
    print(f"Partial success rate: {fmt(overall['partial_success_rate'])} (averaged over {overall['files_processed']} tasks)")

    print("\n-- By task type --")
    type_order = ["create", "debug", "extend", "compute"]
    ordered_types = [(t, by_type[t]) for t in type_order if t in by_type]
    remaining_types = [(t, stats) for t, stats in sorted(by_type.items()) if t not in type_order]
    
    for t, stats in ordered_types + remaining_types:
        print(f"{t}:")
        print(f"  count:                {stats['count']}")
        print(f"  avg duration:         {fmt(stats['avg_duration_sec'])} s")
        print(f"  success rate:         {fmt(stats['success_rate'])}")
        print(f"  partial success rate: {fmt(stats['partial_success_rate'])}")
    
    tasks_without_partial = overall['tasks_without_partial_rate']
    if tasks_without_partial:
        print(f"\n-- Tasks without partial success rate ({len(tasks_without_partial)} tasks) --")
        sorted_tasks = sorted(set(tasks_without_partial))
        for task_name in sorted_tasks[:10]:
            print(f"  - {task_name}")
        if len(sorted_tasks) > 10:
             print(f"  ... and {len(sorted_tasks) - 10} more")


def main():
    parser = argparse.ArgumentParser(description="Analyze task results.")
    
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Heuristic to find project root by looking for 'tasks' folder adjacent to script or one level up
    if os.path.isdir(os.path.join(script_dir, "tasks")):
        project_root = script_dir
    else:
        project_root = os.path.dirname(script_dir)
        
    default_result_dir = os.path.join(project_root, "result")
    # Fallback to current working directory 'result'
    if not os.path.isdir(default_result_dir):
        default_result_dir = os.path.join(os.getcwd(), "result")
    
    parser.add_argument("base_dir", nargs="?", default=default_result_dir, help=f"Base directory to scan (default: {default_result_dir})")
    parser.add_argument("--task_list", help="JSON file in the tasks/ directory containing the list of tasks to include (e.g., rq3_tasks.json)")
    
    args = parser.parse_args()
    base_dir = args.base_dir

    if not os.path.isdir(base_dir):
        print(f"Base directory not found: {base_dir}")
        return

    # Determine allowed tasks
    allowed_tasks = None
    if args.task_list:
        tasks_dir = os.path.join(project_root, "tasks")
        if not os.path.isdir(tasks_dir):
             # Fallback
             tasks_dir = os.path.join(os.getcwd(), "tasks")
        
        allowed_tasks = load_allowed_tasks(args.task_list, tasks_dir)
        print(f"Loaded {len(allowed_tasks)} allowed tasks from {args.task_list}")
        if not allowed_tasks:
             print("No tasks found in allowed list. Please check the file format.")

    # Scan for results
    run_records = scan_task_results(base_dir, allowed_tasks)
    
    if run_records:
        # Categorize
        categories = categorize_tasks(base_dir, run_records, allowed_tasks)
        
        total_categorized = sum(len(v) for v in categories.values())
        def pct(n: int) -> str:
            return f"{(n / total_categorized * 100):.2f}%" if total_categorized else "0.00%"

        print("\n==== Task Outcome Summary ====")
        print(f"Total tasks (categorized): {total_categorized}")
        print(f"  Success: {len(categories['success'])} ({pct(len(categories['success']))})")
        print(f"  Failed:  {len(categories['failed'])} ({pct(len(categories['failed']))})")
        print(f"  Error:   {len(categories['error'])} ({pct(len(categories['error']))})")

        if categories['success']:
            print(f"  Successful tasks ({len(categories['success'])}):")
            for task_name in categories['success']:
                print(f"    - {task_name}")
        
        # Summarize
        summary = summarize(run_records)
        print_summary(summary)
    else:
        print("No results found.")

if __name__ == "__main__":
    main()
