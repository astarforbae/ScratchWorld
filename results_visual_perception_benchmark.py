#!/usr/bin/env python3
"""
Analyze RQ2 results and generate accuracy reports by type, tag, and overall.

Usage: python results_rq2.py <result_directory>
"""

import json
import sys
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from collections import defaultdict
from sklearn.metrics import f1_score


def load_result(path: Path) -> Optional[Dict]:
    """Load and parse a result.json file."""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Failed to load {path}: {e}")
        return None


def extract_task_info(result_data: Dict) -> Tuple[str, str, bool, Optional[str], Optional[str]]:
    """Extract task_id, tag, success status, ground_truth, and model_response from result data."""
    task_id = result_data.get("task_id", "unknown")
    tag = result_data.get("tag", "unknown")
    success = result_data.get("success", False)
    ground_truth = result_data.get("ground_truth")
    model_response = result_data.get("model_response")
    return task_id, tag, success, ground_truth, model_response


def get_task_type(task_id: str) -> str:
    """Determine task type from task_id by reading the task json file in visual_perception_benchmark/tasks."""
    task_file = Path(__file__).parent / "visual_perception_benchmark" / "tasks" / f"{task_id}.json"
    
    if not task_file.exists():
        return "unknown"
    
    try:
        with open(task_file, 'r', encoding='utf-8') as f:
            task_data = json.load(f)
            return task_data.get("task_type", "unknown")
    except Exception as e:
        print(f"Failed to load task file {task_file}: {e}")
        return "unknown"


def collect_results(result_dir: Path) -> Dict:
    """Collect all results from the result directory."""
    results = defaultdict(lambda: {"total": 0, "correct": 0})
    all_results = []
    
    # Iterate through all task directories (numbered directories)
    for task_path in sorted(result_dir.iterdir()):
        if not task_path.is_dir():
            continue
        
        result_file = task_path / "result.json"
        if not result_file.exists():
            continue
        
        result_data = load_result(result_file)
        if result_data is None:
            continue
        
        task_id, tag, success, ground_truth, model_response = extract_task_info(result_data)
        task_type = get_task_type(task_id)
        
        # Determine field sub-type
        sub_type = task_type
        if task_type == "field":
            if "equivalence" in tag:
                sub_type = "field-equivalence"
            elif "exact_match" in tag:
                sub_type = "field-exact_match"
        
        # Store result
        result_record = {
            "task_id": task_id,
            "type": task_type,
            "sub_type": sub_type,
            "tag": tag,
            "success": success,
            "ground_truth": ground_truth,
            "model_response": model_response
        }
        all_results.append(result_record)
        
        # Update aggregates
        results[("all", "all", "all")]["total"] += 1
        if success:
            results[("all", "all", "all")]["correct"] += 1
        
        # By type
        results[(task_type, "all", "all")]["total"] += 1
        if success:
            results[(task_type, "all", "all")]["correct"] += 1
        
        # By sub_type (for field breakdown)
        if sub_type != task_type:
            results[(sub_type, "all", "all")]["total"] += 1
            if success:
                results[(sub_type, "all", "all")]["correct"] += 1
        
        # By tag
        results[("all", tag, "all")]["total"] += 1
        if success:
            results[("all", tag, "all")]["correct"] += 1
        
        # By type and tag
        results[(task_type, tag, "all")]["total"] += 1
        if success:
            results[(task_type, tag, "all")]["correct"] += 1
    
    return dict(results), all_results


def calculate_accuracy(correct: int, total: int) -> str:
    """Calculate accuracy percentage."""
    if total == 0:
        return "N/A"
    return f"{(correct / total) * 100:.2f}%"

def print_markdown_table(headers: List[str], rows: List[List[str]]) -> None:
    print("| " + " | ".join(headers) + " |")
    print("|" + "|".join(["---"] * len(headers)) + "|")
    for row in rows:
        print("| " + " | ".join(row) + " |")

def print_results_table(results: Dict, all_results: List[Dict]) -> None:
    """Print accuracy by task type and by tag."""
    type_data = defaultdict(lambda: {"total": 0, "correct": 0})
    tag_data = defaultdict(lambda: {"total": 0, "correct": 0})
    
    for result in all_results:
        task_type = result["type"]
        tag = result["tag"]
        success = result["success"]
        
        type_data[task_type]["total"] += 1
        tag_data[tag]["total"] += 1
        if success:
            type_data[task_type]["correct"] += 1
            tag_data[tag]["correct"] += 1

    type_rows = []
    total_all = 0
    correct_all = 0
    for task_type in sorted(type_data.keys()):
        data = type_data[task_type]
        correct = data["correct"]
        total = data["total"]
        total_all += total
        correct_all += correct
        type_rows.append([
            task_type,
            str(correct),
            str(total),
            calculate_accuracy(correct, total),
        ])
    type_rows.append([
        "ALL",
        str(correct_all),
        str(total_all),
        calculate_accuracy(correct_all, total_all),
    ])

    tag_rows = []
    for tag in sorted(tag_data.keys()):
        data = tag_data[tag]
        correct = data["correct"]
        total = data["total"]
        tag_rows.append([
            tag,
            str(correct),
            str(total),
            calculate_accuracy(correct, total),
        ])

    print_markdown_table(["Task Type", "Correct", "Total", "Accuracy"], type_rows)
    print()
    print_markdown_table(["Tag", "Correct", "Total", "Accuracy"], tag_rows)


def main():
    if len(sys.argv) != 2:
        print("Usage: python results_rq2.py <result_directory>")
    
    result_dir = Path(sys.argv[1])
    
    if not result_dir.exists():
        print(f"Error: Result directory not found: {result_dir}")
    
    print(f"Loading results from: {result_dir}")
    results, all_results = collect_results(result_dir)
    
    if not all_results:
        print("No results found in the directory.")
    
    print_results_table(results, all_results)


if __name__ == "__main__":
    raise SystemExit(main())
