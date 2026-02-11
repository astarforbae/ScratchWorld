#!/usr/bin/env python3
"""
Visual Perception Benchmark Runner - Screenshot based evaluation
"""

import json
import os
import sys
import base64
import logging
import argparse
from pathlib import Path
from typing import Dict, Any, Optional, List
from dotenv import load_dotenv
from openai import OpenAI

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)

# Small test task IDs - one from each tag type
SMALL_TEST_TASK_IDS = [
    # connection_yes (30 tasks)
    "1",
    # connection_no_easy (15 tasks)
    "46",
    # connection_no_hard (15 tasks)
    "31",
    # existence_yes_clear (15 tasks)
    "61",
    # existence_yes_occluded (15 tasks)
    "76",
    # existence_yes_unidentifiable (10 tasks)
    "91",
    # existence_no_absent (15 tasks)
    "101",
    # existence_no_confusable (15 tasks)
    "116",
    # existence_no_unidentifiable (10 tasks)
    "131",
    # equivalence_numeric_yes (8 tasks)
    "142",
    # equivalence_numeric_no (7 tasks)
    "149",
    # equivalence_dropdown_yes (8 tasks)
    "157",
    # equivalence_dropdown_no (7 tasks)
    "164",
    # exact_match_numeric (15 tasks)
    "171",
    # exact_match_dropdown (15 tasks)
    "186",
]


class VisualPerceptionBenchmarkRunner:
    """Visual Perception Benchmark Runner - Screenshot based evaluation"""

    def __init__(self, model_name: str):
        self.model_name = model_name

        # Initialize OpenAI client
        api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("LLM_API_KEY")
        base_url = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")
        self.client = OpenAI(api_key=api_key, base_url=base_url)

        benchmark_dir = Path(__file__).parent / "visual_perception_benchmark"
        self.tasks_dir = benchmark_dir / "tasks"
        self.screenshots_dir = benchmark_dir / "screenshots_final"
        
        if not self.tasks_dir.exists():
            logger.warning(f"Tasks directory not found: {self.tasks_dir}")
        if not self.screenshots_dir.exists():
            logger.warning(f"Screenshots directory not found: {self.screenshots_dir}")

        # Create result directory
        safe_model_name = (
            self.model_name.replace("/", "_").replace("\\", "_").replace("-", "_")
        )
        self.result_dir = Path(f"result_visual_perception_benchmark_{safe_model_name}")
        self.result_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"Results will be saved to: {self.result_dir}")

    def load_tasks(self, task_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """Load tasks from visual_perception_benchmark/tasks directory"""
        tasks = []
        
        json_files = sorted(
            self.tasks_dir.glob("*.json"),
            key=lambda x: int(x.stem) if x.stem.isdigit() else 0
        )
        
        for json_file in json_files:
            with open(json_file, "r", encoding="utf-8") as f:
                task_data = json.load(f)
            
            task_id = task_data.get("task_id", json_file.stem)
            
            # Filter by task_ids if provided
            if task_ids is not None and task_id not in task_ids:
                continue
            
            # Determine task type based on tag
            tag = task_data.get("tag", "")
            task_type = self._get_task_type_from_tag(tag)
            
            task = {
                "id": task_id,
                "screenshot_name": task_data.get("screenshot", ""),
                "instruction": task_data.get("instruction", ""),
                "type": task_type,
                "ground_truth": task_data.get("ground_truth", ""),
                "tag": tag,
                "task_type": task_data.get("task_type", ""),
            }
            tasks.append(task)
        
        return tasks

    def _get_task_type_from_tag(self, tag: str) -> str:
        """
        Determine the response type based on tag
        - exact_match_* tags: field (需要回答具体的值)
        - 其他所有 tags: binary (YES/NO)
        """
        if tag.startswith("exact_match_"):
            return "field"
        else:
            return "binary"

    def run_tasks(self, task_ids: Optional[List[str]] = None):
        """Run tasks from visual_perception_benchmark/tasks directory"""
        tasks = self.load_tasks(task_ids)
        
        if not tasks:
            logger.warning("No tasks found to run.")
            return
        
        logger.info(f"Loaded {len(tasks)} tasks to run.")
        
        results = []
        success_count = 0
        skipped_count = 0
        
        for i, task in enumerate(tasks):
            task_id = task['id']
            task_dir = self.result_dir / task_id
            result_file = task_dir / "result.json"
            
            # Check if result already exists
            if result_file.exists():
                logger.info(f"Skipping Task {i+1}/{len(tasks)} (ID: {task_id}) - Result already exists")
                skipped_count += 1
                
                # Load existing result for statistics
                try:
                    with open(result_file, "r", encoding="utf-8") as f:
                        existing_result = json.load(f)
                        results.append(existing_result)
                        if existing_result.get("success", False):
                            success_count += 1
                except Exception as e:
                    logger.warning(f"Failed to load existing result for task {task_id}: {e}")
                
                continue
            
            logger.info(f"Running Task {i+1}/{len(tasks)} (ID: {task_id}, Tag: {task['tag']})...")

            # Run task
            output = self.run_single_task(task)

            if "error" in output:
                logger.error(f"Task {task_id} failed: {output['error']}")
                continue

            content = output["content"]
            full_response = output["full_response"]
            messages = output["messages"]
            
            # Validation
            success = self._validate_result(content, task["ground_truth"], task["type"])
            if success:
                success_count += 1
            
            # Sanitize prompt
            sanitized_prompt = self._sanitize_prompt(messages, task["screenshot_name"])
            
            # Save result
            result_data = {
                "task_id": task_id,
                "tag": task["tag"],
                "instruction": task["instruction"],
                "ground_truth": task["ground_truth"],
                "model_response": content,
                "success": success,
                "prompt": sanitized_prompt,
                "response": full_response
            }

            task_dir.mkdir(exist_ok=True)

            with open(result_file, "w", encoding="utf-8") as f:
                json.dump(result_data, f, indent=2, ensure_ascii=False)

            results.append(result_data)
            status_str = "✓" if success else "✗"
            logger.info(f"  {status_str} Result saved. Response: '{content}' | GT: '{task['ground_truth']}'")

        # Print summary
        logger.info("=" * 60)
        logger.info(f"Completed {len(results)} tasks.")
        if skipped_count > 0:
            logger.info(f"Skipped {skipped_count} tasks (already completed).")
        logger.info(f"Success: {success_count}/{len(results)} ({100*success_count/len(results):.1f}%)")
        
        # Group by tag
        tag_stats = {}
        for r in results:
            tag = r["tag"]
            if tag not in tag_stats:
                tag_stats[tag] = {"total": 0, "success": 0}
            tag_stats[tag]["total"] += 1
            if r["success"]:
                tag_stats[tag]["success"] += 1
        
        logger.info("\nResults by tag:")
        for tag, stats in sorted(tag_stats.items()):
            pct = 100 * stats["success"] / stats["total"] if stats["total"] > 0 else 0
            logger.info(f"  {tag}: {stats['success']}/{stats['total']} ({pct:.1f}%)")

    def run_single_task(self, task: Dict[str, Any]) -> Dict[str, Any]:
        screenshot_path = self.screenshots_dir / task["screenshot_name"]
        if not screenshot_path.exists():
            return {"error": f"Screenshot not found: {screenshot_path}"}

        # Read image and encode to base64
        try:
            with open(screenshot_path, "rb") as image_file:
                base64_image = base64.b64encode(image_file.read()).decode("utf-8")
        except Exception as e:
            return {"error": f"Failed to read image: {e}"}

        instruction = task["instruction"]
        task_type = task["type"]

        # Construct Prompt
        system_content = """
You are an expert assistant for analyzing Scratch project screenshots. Please adhere to the following rules:
1. Scope: Focus strictly on the blocks placed on the main workspace (canvas). Ignore all blocks in the sidebar palette on the left.
2. Naming Convention: The block names used in questions are unambiguous and follow these patterns:

Brackets [] indicate abstract placeholders. For example, 'set [variable] to' refers to any variable assignment block (e.g., 'set score to 0').
'go to [destination]' refers ONLY to blocks with dropdown menus (e.g., 'go to random position') and strictly excludes 'go to x y' blocks.
Mathematical operators are referred to by symbols (+, -, *, <) rather than words.
The Green Flag icon is referred to as text 'green flag'.
Answer the questions based solely on the visual evidence on the canvas using this terminology.
"""
        user_content_text = f"Instruction: {instruction}\n"

        if task_type == "binary":
            user_content_text += "**Answer with 'YES' or 'NO' only.**"
        elif task_type == "field":
            user_content_text += "**Answer with the exact value only (number or text). IMPORTANT: The answer is case-sensitive.**"

        messages = [
            {"role": "system", "content": system_content},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_content_text},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{base64_image}"},
                    },
                ],
            },
        ]

        # Call LLM
        try:
            if (
                "gpt-5" in self.model_name.lower()
            ):  # adapt for reasoning models if needed
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
                    temperature=0.0,  # Use deterministic output for evaluation
                )

            content = response.choices[0].message.content.strip()
            
            return {
                "task": task,
                "content": content,
                "full_response": response.model_dump(),
                "messages": messages,
                "status": "success"
            }

        except Exception as e:
            logger.error(f"LLM call failed: {e}")
            return {"error": str(e)}

    def _validate_result(
        self, response: str, ground_truth: str, task_type: str
    ) -> bool:
        """Validate the response against ground truth"""
        if not response:
            return False

        response = response.strip()
        ground_truth = ground_truth.strip()

        if task_type == "binary":
            # Case-insensitive for binary YES/NO questions
            return response.upper() == ground_truth.upper()
        else:
            # Case-sensitive for field questions (exact match required)
            return response == ground_truth

    def _sanitize_prompt(self, messages: list, image_name: str) -> list:
        """Remove base64 images and replace with filename"""
        sanitized = []
        for msg in messages:
            new_msg = msg.copy()
            if isinstance(new_msg.get("content"), list):
                new_content = []
                for item in new_msg["content"]:
                    new_item = item.copy()
                    if new_item.get("type") == "image_url":
                        new_item["image_url"] = {"url": f"<{image_name}>"}
                    new_content.append(new_item)
                new_msg["content"] = new_content
            sanitized.append(new_msg)
        return sanitized


def main():
    """Main function"""
    parser = argparse.ArgumentParser(
        description="Visual Perception Benchmark Runner - Screenshot based evaluation"
    )
    parser.add_argument(
        "--model",
        type=str,
        default=os.environ.get("LLM_MODEL", "gpt-5"),
        help="LLM model name (default: gpt-5 or env LLM_MODEL)",
    )
    parser.add_argument(
        "--small",
        action="store_true",
        help="Run small test with one task from each tag type (17 tasks total)",
    )
    parser.add_argument(
        "--task-ids",
        type=str,
        nargs="+",
        help="Specific task IDs to run (e.g., --task-ids 1 2 3)",
    )
    parser.add_argument(
        "--env-file",
        type=str,
        default=".env",
        help="Environment variable file path (default: .env)",
    )

    args = parser.parse_args()

    model_name = args.model

    env_file = args.env_file
    load_dotenv(env_file)
    logger.info(f"加载环境变量文件: {env_file}")
    
    logger.info(f"使用模型: {model_name}")

    try:
        runner = VisualPerceptionBenchmarkRunner(model_name=model_name)
        
        # Determine which tasks to run
        if args.small:
            logger.info(f"Running small test with {len(SMALL_TEST_TASK_IDS)} tasks (one from each tag)...")
            runner.run_tasks(task_ids=SMALL_TEST_TASK_IDS)
        elif args.task_ids:
            logger.info(f"Running specified tasks: {args.task_ids}")
            runner.run_tasks(task_ids=args.task_ids)
        else:
            logger.info("Running all visual perception benchmark tasks...")
            runner.run_tasks()

    except Exception as e:
        logger.error(f"Task execution failed: {e}", exc_info=True)


if __name__ == "__main__":
    main()
