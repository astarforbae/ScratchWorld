#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
AWM Agent Implementation for ScratchBench
Implements the WebArena Agent Workflow Memory system adapted for Scratch environment
"""

import os
import json
import logging
import random
from typing import Dict, Any, Optional, List
from dataclasses import asdict, dataclass, field
from datetime import datetime

from .base_agent import BaseAgent, AgentPredictionException
from .awm_prompts import (
    system_prompt_primitive,
    system_prompt_composite,
    build_primitive_turn_prompt,
    build_composite_turn_prompt,
)

# Import dependencies that may be needed for AWM functionality
from openai import OpenAI
from .llm_call_manager import LLMCallManager, LLMCallException

logger = logging.getLogger("scratch_bench.awm_agent")


@dataclass
class AWMFlags:
    """Flags controlling AWM agent behavior, adapted for Scratch environment"""
    use_html: bool = False  # We don't use HTML in Scratch, just screenshot
    use_ax_tree: bool = False  # No accessibility tree in Scratch
    use_thinking: bool = True  # Enable chain-of-thought reasoning
    use_memory: bool = True  # Enable memory functionality
    use_history: bool = True  # Include action history
    use_action_history: bool = True  # Include action history in prompts
    use_diff: bool = False  # Compare current vs previous state
    max_prompt_tokens: int = None  # Maximum tokens for prompt
    use_workflow_memory: bool = True  # Enable workflow memory integration
    workflow_path: Optional[str] = None  # Path to workflow file
    successful_trajs_path: Optional[str] = None  # Path to successful trajectories for workflow induction
    use_last_screenshot: bool = True  # Whether to only keep the latest screenshot in the request to the LLM


class AWMAgent(BaseAgent):
    """
    AWM Agent adapted for ScratchBench environment
    Implements workflow memory and context management for Scratch tasks
    """

    def __init__(
        self,
        llm_api_key: Optional[str] = None,
        model: str = "gpt-4o",
        base_url: str = "https://api.openai.com/v1",
        log_dir: str = "logs",
        mode: str = "primitive",  # "primitive" | "composite"
        flags: Optional[AWMFlags] = None,
        use_last_screenshot: bool = True
    ):
        """
        Initialize the AWM Agent for Scratch environment

        Args:
            llm_api_key: LLM API key
            model: LLM model name
            base_url: Base URL of the LLM API
            log_dir: Directory to save logs and screenshots
            mode: Agent mode ("primitive" | "composite")
            flags: AWM configuration flags
        """
        # Support multiple environment variable names
        self.llm_api_key = (llm_api_key or
                           os.environ.get("OPENAI_API_KEY") or
                           os.environ.get("LLM_API_KEY"))
        self.model = os.environ.get("LLM_MODEL") or model
        self.base_url = os.environ.get("LLM_BASE_URL") or base_url
        
        # Mode and flags
        self.mode = str(mode).strip()
        if self.mode not in ("primitive", "composite"):
            raise ValueError(f"Invalid mode: {self.mode!r}. Expected 'primitive' or 'composite'.")

        self.use_last_screenshot = use_last_screenshot
        self.flags = flags
        # Initialize AWM-specific components
        self.client = OpenAI(base_url=self.base_url, api_key=self.llm_api_key)
        
        # Memory and history
        self.observation_history: List[Dict[str, Any]] = []
        self.action_history: List[Dict[str, Any]] = []
        self.memory_history: List[str] = []  # AWM workflow memories
        self.thought_history: List[str] = []  # AWM chain-of-thought
        self.full_response_history: List[Dict[str, Any]] = []  # Complete response history for evaluation
        
        if not os.path.exists(self.flags.workflow_path) and self.flags.use_workflow_memory:
            with open(self.flags.workflow_path, 'w', encoding='utf-8') as f:
                f.write("")  # Initialize empty workflow memory file

        with open(self.flags.workflow_path, 'r', encoding='utf-8') as f:
            self.workflow_memory = f.read()
        self.successful_trajs_path = self.flags.successful_trajs_path
        if not os.path.exists(self.successful_trajs_path):
            with open(self.successful_trajs_path, 'w', encoding='utf-8') as f:
                json.dump([], f)  # Initialize empty successful trajectories file
        
        # Logging
        self.log_dir = log_dir
        self.session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        rate_limit_rpm = os.environ.get("RATE_LIMIT_RPM")
        if rate_limit_rpm:
            rate_limit_rpm = int(rate_limit_rpm)
            
        # Initialize LLM Call Manager
        self.llm_call_manager = LLMCallManager(
            model=self.model,
            api_key=self.llm_api_key,
            base_url=self.base_url,
            rate_limit_rpm=rate_limit_rpm
        )
        
        # Conversation history for LLM interaction
        self.conversation_history = []
        
        logger.info(f"Initialized AWMAgent with mode: {self.mode}")

    def initialize(self, task_description: str, documentation: Dict[str, Any]) -> None:
        """
        Initialize the AWM Agent with task description and documentation
        
        Args:
            task_description: Task description to be executed
            documentation: Environment documentation (API catalogs, etc.)
        """
        logger.info(f"Initializing AWMAgent for task: {task_description[:100]}...")
        
        # Store documentation and task description
        self.task_description = task_description
        self._documentation = documentation
        self._composite_api_catalog_text = self._documentation["composite_api_catalog_text"]
        self._blocks_catalog_text = self._documentation["blocks_catalog_text"]
        self._primitive_actions_catalog_text = self._documentation["primitive_actions_catalog_text"]
        
        # Initialize conversation history with system prompt
        self.conversation_history = []
        
        # Build system prompt based on mode and AWM features
        workflow_memory = self.workflow_memory if self.flags.use_workflow_memory else None
        if self.mode == "composite":
            system_prompt = system_prompt_composite(
                task_description,
                self._composite_api_catalog_text,
                self._blocks_catalog_text,
                workflow_memory=workflow_memory,
            )
        else:  # primitive mode
            system_prompt = system_prompt_primitive(
                task_description,
                self._primitive_actions_catalog_text,
                workflow_memory=workflow_memory,
            )

        self.conversation_history.append({
            "role": "system",
            "content": system_prompt
        })
        
        logger.info("AWMAgent initialization completed")

    def predict(self, observation: Dict[str, Any], turn: int = 0) -> Optional[Dict[str, Any]]:
        """
        Predict the next action based on current observation using AWM approach
        
        Args:
            observation: Environment observation including screenshot and elements
            turn: Current turn index
            
        Returns:
            Action plan dict or None if prediction fails
        """
        logger.info(f"AWMAgent predicting action for turn {turn}")
        
        try:
            # Process the observation and add to history
            self.observation_history.append(observation)
            
            # Build the user prompt with current observation and history
            if self.mode == "composite":
                pseudocode = observation.get("pseudocode", "")
                target_name = observation.get("targetName", "")
                available_targets = observation.get("availableTargets", [])
                target_variables = observation.get("targetVariables", []) if isinstance(observation, dict) else []
                target_lists = observation.get("targetLists", []) if isinstance(observation, dict) else []  
                user_prompt = build_composite_turn_prompt(pseudocode, target_name, available_targets, target_variables, target_lists)
            else:
                # Primitive mode: prepare image data
                image_b64 = observation.get("screenshot", "")
                elements_info = observation.get("elements", "")
                user_prompt = build_primitive_turn_prompt(elements_info)
            
            
            # Add history of interaction if enabled (last 5 steps of thought, memory, action)
            if self.flags.use_history and self.full_response_history:
                recent_steps = self.full_response_history[-5:]
                history_lines = []
                for step in recent_steps:
                    step_turn = step.get("turn")
                    thought = step.get("thought") or ""
                    memory = step.get("memory") or ""
                    action = step.get("action_plan") or ""
                    history_lines.append(
                        f"Turn {step_turn + 1}:\n"
                        f"Thought: {thought}\n"
                        f"Memory: {memory}\n"
                        f"Action: {action}\n"
                    )
                if history_lines:
                    user_prompt += (
                        f"\n## History of interaction with the task(latest {len(recent_steps)})\n"
                        f"{''.join(history_lines)}\n"
                    )
            
            # Add current turn context
            user_prompt += f"\n## Current Turn\nTurn number: {turn + 1}\n"
            user_prompt += "Based on the current state and your memory, provide your next action.\n"

            # Prepare messages: system + current user only
            if self.mode == "composite":
                current_user = {"role": "user", "content": user_prompt}
            else:
                current_user = {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{image_b64}"}
                        }
                    ],
                }
            self.conversation_history.append(current_user)
            messages = [self.conversation_history[0], current_user]
            
            # Call the LLM using the manager
            llm_response = self.llm_call_manager.call(
                messages=messages
            )
            
            content = llm_response["content"]
            logger.info(f"LLM response: \n{content}")
            
            # Add to conversation history
            self.conversation_history.append({
                "role": "assistant",
                "content": content
            })
            
            # Parse the response for action
            action_plan = self._parse_action_from_response(content)
            
            # Extract memory if present
            memory = self._extract_memory_from_response(content)
            if memory:
                self.memory_history.append(memory)
            
            # Extract thought if present
            thought = self._extract_thought_from_response(content)
            if thought:
                self.thought_history.append(thought)
            
            # Add action to history
            if action_plan:
                self.action_history.append(action_plan)
            
            # Store the full LLM response for more comprehensive evaluation
            self.full_response_history.append({
                "turn": turn,
                "user_prompt": user_prompt,
                "assistant_response": content,
                "action_plan": action_plan,
                "memory": memory,
                "thought": thought,
                "observation": observation
            })

            # self.save_interaction_log(self.log_dir)
            
            return action_plan
            
        except LLMCallException as e:
            logger.error(f"LLM call failed in AWMAgent predict: {e}", exc_info=True)
            raise AgentPredictionException(f"LLM API call failed in AWMAgent: {e}") from e
        except Exception as e:
            logger.error(f"Error in AWMAgent predict: {e}", exc_info=True)
            return None

    def _parse_action_from_response(self, content: str) -> Optional[Dict[str, Any]]:
        """
        Parse action from LLM response content
        """
        import re
        import json
        
        # Look for JSON action in code blocks
        json_match = re.search(r'```json\s*\n(\{.*?\})\s*\n```', content, re.DOTALL)
        if json_match:
            try:
                action_json = json.loads(json_match.group(1))
                return action_json
            except json.JSONDecodeError:
                logger.warning("Failed to decode JSON from action block")
        
        logger.warning(f"No valid action found in response: {content}")
        return None

    def _extract_memory_from_response(self, content: str) -> Optional[str]:
        """
        Extract memory content from response if present in <memory> tags
        """
        import re
        memory_match = re.search(r'<memory>(.*?)</memory>', content, re.DOTALL)
        if memory_match:
            return memory_match.group(1).strip()
        return None

    def _extract_thought_from_response(self, content: str) -> Optional[str]:
        """
        Extract thought process from response if present in <thinking> tags
        """
        import re
        thought_match = re.search(r'<thinking>(.*?)</thinking>', content, re.DOTALL)
        if thought_match:
            return thought_match.group(1).strip()
        return None

    def save_interaction_log(self, log_dir: str) -> str:
        """
        Save detailed interaction log for analysis
        """
        log_data = {
            "session_id": self.session_id,
            "task_description": self.task_description,
            "model": self.model,
            "mode": self.mode,
            "flags": asdict(self.flags),
            "conversation_history": self.conversation_history,
            "observation_history": self.observation_history, # TODO 剔除里面的image，否则太大了
            "action_history": self.action_history,
            "memory_history": self.memory_history,
            "thought_history": self.thought_history,
            "workflow_memory": self.workflow_memory
        }
        
        log_file = os.path.join(log_dir, f"awm_interaction_log_{self.session_id}.json")
        with open(log_file, 'w', encoding='utf-8') as f:
            json.dump(log_data, f, indent=2, ensure_ascii=False)
        
        logger.info(f"Interaction log saved to: {log_file}")
        return log_file
    
    def save_trajectory(self) -> str:
        """
        Save the current trajectory by appending a json object into self.successful_trajs_path. 
        JSON object example: 
        {
            "task_description": self.task_description,
            "traj": "thought,action,thought,action,...", 
        }
        TODO remove invalid actions
        """
        # Create trajectory string by combining thoughts and actions
        trajectory_parts = []
        
        # Get the minimum length to pair thoughts and actions properly
        min_len = min(len(self.thought_history), len(self.action_history))
        
        for i in range(min_len):
            # Add thought
            if i < len(self.thought_history) and self.thought_history[i]:
                trajectory_parts.append(f"thought: {self.thought_history[i]}")
            
            # Add action
            if i < len(self.action_history) and self.action_history[i]:
                trajectory_parts.append(f"action: {json.dumps(self.action_history[i])}")
        
        # Add any remaining thoughts or actions
        for i in range(min_len, len(self.thought_history)):
            if self.thought_history[i]:
                trajectory_parts.append(f"thought: {self.thought_history[i]}")
        
        for i in range(min_len, len(self.action_history)):
            if self.action_history[i]:
                trajectory_parts.append(f"action: {json.dumps(self.action_history[i])}")
        
        trajectory_str = "\n".join(trajectory_parts)
        
        # Create trajectory object
        trajectory_obj = {
            "task_description": self.task_description,
            "traj": trajectory_str
        }
                
        with open(self.successful_trajs_path, 'r', encoding='utf-8') as f:
            trajectories = json.load(f)
        
        # Append new trajectory
        trajectories.append(trajectory_obj)
        
        # Write back to file
        with open(self.successful_trajs_path, 'w', encoding='utf-8') as f:
            json.dump(trajectories, f, indent=2, ensure_ascii=False)
        
        logger.info(f"Trajectory saved to: {self.successful_trajs_path}")
        return self.successful_trajs_path
        

    def auto_eval(self) -> Dict[str, Any]:
        """
        Use LLM to evaluate the current trajectory of actions taken by the agent.
        Routes to the appropriate evaluation method based on mode.
        
        Returns:
            Evaluation results dictionary
        TODO 存储prompt和response
        """
        try:
            if self.mode == "composite":
                return self._eval_composite()
            else:  # primitive mode
                return self._eval_primitive()
        except Exception as e:
            logger.error(f"Error in autoeval trajectory: {e}", exc_info=True)
            return {
                "success": False,
                "thoughts": f"Error during evaluation: {str(e)}",
                "status": "failure",
            }

    def _eval_composite(self) -> Dict[str, Any]:
        """
        Evaluate trajectory for composite mode (text-based, similar to eval_text).
        
        Returns:
            Evaluation results dictionary with 'success', 'thoughts', 'status'
        """
        try:
            # Get the final state
            final_pseudocode = self.observation_history[-1].get("pseudocode", "N/A")

            # Get the final response (if any)
            final_response = self.full_response_history[-1]["assistant_response"]
            
            # Build action history string
            action_history = ""
            for i, response_data in enumerate(self.full_response_history):
                action_plan = response_data.get("action_plan", {})
                action_history += f"{i+1}: {json.dumps(action_plan) if action_plan else 'N/A'}\n"
            
            # Build the evaluation prompt (adapted from build_text_eval_prompt)
            system_msg = """You are an expert in evaluating the performance of a Scratch programming agent. The agent is designed to help users create Scratch projects by executing actions. Given the user's intent, the agent's action history, the final state description (only the last observed pseudocode for the current target, not the full project), and the agent's last response, your goal is to decide whether the agent's execution is successful or not.

There are four types of tasks:
1. Create task: The user wants to create a Scratch project from scratch that satisfies the given task description. This involves starting from a blank project and implementing all required features and logic.
2. Extend task: The user wants to extend an existing Scratch project to meet new requirements. This includes editing, adding, or removing elements to align with the updated task description.
3. Debug task: The user wants to debug bugs or issues in an existing Scratch project based on a provided description of the problems. This requires identifying and correcting errors to ensure the project functions as intended.
4. Compute task: The user wants to implement a specific functionality in Scratch based on a provided description that's related to algorithms. This requires focusing on algorithmic logic and ensuring the functionality is correctly implemented within the Scratch environment.

*IMPORTANT*
Format your response into two lines as shown below:

Thoughts: <your thoughts and reasoning process>
Status: "success" or "failure"
"""
            
            prompt = f"""User Intent: {self.task_description}

Action History:
{action_history}

Full response of the final step:
{final_response if final_response else "N/A"}

Final pseudocode of the current target (last observed; not the full project):
{final_pseudocode}
"""
            
            # Call the LLM using the manager
            llm_response = self.llm_call_manager.call(
                messages=[
                    {"role": "system", "content": system_msg},
                    {"role": "user", "content": prompt}
                ],
            )
            
            content = llm_response["content"]
            logger.info(f"Composite eval response: {content}")
            
            # Parse the response to extract Thoughts and Status
            thoughts = self._extract_content_from_eval(content, "Thoughts:")
            status = self._extract_content_from_eval(content, "Status:")
            
            # Determine success based on status
            success = status.lower().strip().strip('"').strip("'") == "success"
            
            return {
                "success": success,
                "thoughts": thoughts,
                "status": status,
            }
            
        except Exception as e:
            logger.error(f"Error in eval_composite: {e}", exc_info=True)
            return {
                "success": False,
                "thoughts": f"Error during composite evaluation: {str(e)}",
                "status": "failure",
            }
            
    def _eval_primitive(self) -> Dict[str, Any]:
        """
        Evaluate trajectory for primitive mode (vision-based, similar to eval_vision).
        Uses the last screenshot for visual evaluation.
        
        Returns:
            Evaluation results dictionary with 'success', 'thoughts', 'status'
        """
        try:
            # Get the final state 
            final_elements = self.observation_history[-1].get("elements", "N/A")

            # Get the final response (if any)
            final_response = self.full_response_history[-1]["assistant_response"]            

            # Build action history string
            action_history = ""
            for i, response_data in enumerate(self.full_response_history):
                action_plan = response_data.get("action_plan", {})
                action_history += f"{i+1}: {json.dumps(action_plan) if action_plan else 'N/A'}\n"
            
            # Build the evaluation prompt (adapted from build_vision_eval_prompt)
            system_msg = """You are an expert in evaluating the performance of a Scratch programming agent. The agent is designed to help users create Scratch projects by executing actions. Given the user's intent, the agent's action history, the final screenshot of the Scratch webpage, and the agent's last response, your goal is to decide whether the agent's execution is successful or not.

There are four types of tasks:
1. Create task: The user wants to create a Scratch project from scratch that satisfies the given task description. This involves starting from a blank project and implementing all required features and logic.
2. Extend task: The user wants to extend an existing Scratch project to meet new requirements. This includes editing, adding, or removing elements to align with the updated task description.
3. Debug task: The user wants to debug bugs or issues in an existing Scratch project based on a provided description of the problems. This requires identifying and correcting errors to ensure the project functions as intended.
4. Compute task: The user wants to implement a specific functionality in Scratch based on a provided description that's related to algorithms. This requires focusing on algorithmic logic and ensuring the functionality is correctly implemented within the Scratch environment.

*IMPORTANT*
Format your response into two lines as shown below:

Thoughts: <your thoughts and reasoning process>
Status: "success" or "failure"
"""
            
            prompt = f"""User Intent: {self.task_description}

Action History:
{action_history}

Full response of the final step:
{final_response if final_response else "N/A"}

Final UI element information of the current Scratch project:
{final_elements}

The last snapshot of the Scratch webpage is shown in the image."""
            
            image_data = self.observation_history[-1].get("screenshot")
            
            # Call the LLM with vision capability using the manager
            llm_response = self.llm_call_manager.call(
                messages=[
                    {"role": "system", "content": system_msg},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{image_data}"
                                }
                            }
                        ]
                    }
                ],
            )
            
            content = llm_response["content"]
            logger.info(f"Low level eval response: {content}")
            
            # Parse the response to extract Thoughts and Status
            thoughts = self._extract_content_from_eval(content, "Thoughts:")
            status = self._extract_content_from_eval(content, "Status:")
            
            # Determine success based on status
            success = status.lower().strip().strip('"').strip("'") == "success"
            
            return {
                "success": success,
                "thoughts": thoughts,
                "status": status,
            }
            
        except Exception as e:
            logger.error(f"Error in eval_primitive: {e}", exc_info=True)
            return {
                "success": False,
                "thoughts": f"Error during primitive evaluation: {str(e)}",
                "status": "failure",
            }

    def _extract_content_from_eval(self, text: str, start_tag: str) -> str:
        """
        Extract content following a specific tag (e.g., 'Thoughts:', 'Status:')
        Similar to extract_content in autoeval/prompts.py
        """
        lines = text.split("\n")
        for line in lines:
            if line.startswith(start_tag):
                return line[len(start_tag):].strip()
        return ""

    def induce_workflow(self) -> str:
        """
        Generate synthesized workflows from the agent's experience and save to file.
        """
        output_path = self.flags.workflow_path
        
        logger.info("Starting workflow induction...")
        
        try:
            # 1. Load successful trajectories from file
            
            with open(self.successful_trajs_path, 'r', encoding='utf-8') as f:
                all_trajectories = json.load(f)
            
            logger.info(f"Loaded {len(all_trajectories)} successful trajectories")
            
            if not all_trajectories or len(all_trajectories) == 0:
                logger.warning("No trajectories to induce workflows from")
                return ""
            
            # 2. Random select at most 10 trajectories
            selected_trajs = random.sample(all_trajectories, min(10, len(all_trajectories)))
            logger.info(f"Selected {len(selected_trajs)} trajectories for workflow induction")
            # selected_trajs = all_trajectories
            # logger.info(f"Selected all successful trajectories ({len(selected_trajs)}) for workflow induction")
            
            # 3. Format trajectories for the prompt
            formatted_trajs = []
            for traj_obj in selected_trajs:
                task_desc = traj_obj["task_description"]
                traj_str = traj_obj["traj"]
                formatted_trajs.append(f"Query: {task_desc}\nActions:\n{traj_str}")
            

            formmatted_trajs_text = "## Successful Trajectories\n" + "\n\n".join(formatted_trajs)
            
            # Build the instruction prompt
            instruction = """Given a list of Scratch programming tasks, your task is to extract the common workflows to solve these tasks.
Each given task contains a natural language instruction, and a series of thoughts and actions to solve the task. You need to find the repetitive subset of actions across multiple tasks, and extract each of them out as a workflow.
Each workflow should be a commonly-reused sub-routine of the tasks. Do not generate similar or overlapping workflows. Each workflow should have at least two steps. Represent the non-fixed elements (sprite names, values, coordinates) with descriptive variable names.

OUTPUT REQUIREMENTS (strict):
- Output ONLY the workflows.
- Do NOT include any explanations, comments, headings, or surrounding text.
- Start directly with the first workflow line (e.g., "Workflow 1: ...") and then list subsequent workflows.
- Each workflow should contain only its title and the step content (the think/action parts) as in the examples.
- Don't create simple workflows that only contain one action step. 

Try to generate as many workflows that can cover all the tasks in the input list."""
            
            # Build the one-shot example (simplified for Scratch context)
            composite_one_shot = """## Concrete Examples
### Trajectories

Query: Create a sprite that moves across the stage
Actions:
thought: I need to select a sprite to work with.
action: {"action": "select_sprite", "params": {"name": "Cat"}}

thought: Now I need to add code to make the sprite move. I'll add a when flag clicked event and a move steps block.
action: {"action": "add_block", "params": {"blockType": "event_whenflagclicked"}}

thought: Add the move block to make the sprite move across the stage.
action: {"action": "add_block", "params": {"blockType": "motion_movesteps"}}

thought: Connect the move block under the event block so it runs after the flag is clicked.
action: {"action": "connect_blocks", "params": {"sourceBlockIndex": "<idx_move>", "targetBlockIndex": "<idx_event>", "placement": {"kind": "stack_after"}}}

Query: Make a sprite change color when clicked
Actions:
thought: Select the sprite that will be clicked.
action: {"action": "select_sprite", "params": {"name": "Cat"}}

thought: Add an event block for when the sprite is clicked.
action: {"action": "add_block", "params": {"blockType": "event_whenthisspriteclicked"}}

thought: Add a change effect block and set the effect to color.
action: {"action": "add_block", "params": {"blockType": "looks_changeeffectby"}}
action: {"action": "set_block_field", "params": {"blockIndex": "<idx_looks>", "fieldName": "EFFECT", "value": "color"}}

thought: Connect the looks block so it runs when the sprite is clicked.
action: {"action": "connect_blocks", "params": {"sourceBlockIndex": "<idx_looks>", "targetBlockIndex": "<idx_click_event>", "placement": {"kind": "stack_after"}}}

### Summary Workflows

Workflow: Create basic event-driven motion
thought: Select the sprite to work with.
action: {"action": "select_sprite", "params": {"name": "<sprite_name>"}}
thought: Add a trigger event for user interaction.
action: {"action": "add_block", "params": {"blockType": "<event_type>"}}
thought: Add a motion block to create movement.
action: {"action": "add_block", "params": {"blockType": "<motion_type>"}}
thought: Connect the motion block to the event block.
action: {"action": "connect_blocks", "params": {"sourceBlockIndex": "<motion_idx>", "targetBlockIndex": "<event_idx>", "placement": {"kind": "stack_after"}}}

Workflow: Setup visual effects with event trigger
thought: Select the target sprite for the effect.
action: {"action": "select_sprite", "params": {"name": "<sprite_name>"}}
thought: Add an event block to trigger the visual effect.
action: {"action": "add_block", "params": {"blockType": "<event_type>"}}
thought: Add a looks block to change the sprite's appearance.
action: {"action": "add_block", "params": {"blockType": "<looks_type>"}}
thought: Configure the effect parameters.
action: {"action": "set_block_field", "params": {"blockIndex": "<looks_idx>", "fieldName": "<field_name>", "value": "<effect_value>"}}
thought: Connect the effect block to run after the event.
action: {"action": "connect_blocks", "params": {"sourceBlockIndex": "<looks_idx>", "targetBlockIndex": "<event_idx>", "placement": {"kind": "stack_after"}}}"""

            primitive_one_shot = """## Concrete Examples
### Trajectories

Query: Create a sprite that moves across the stage
Actions:
thought: Open the Events category in the block palette.
action: {"action": "click", "params": {"index": 12}}

thought: Drag the green-flag event block into the scripts area.
action: {"action": "drag_and_drop", "params": {"start_index": 25, "end_index": 5}}

thought: Open the Motion category to find the move block.
action: {"action": "click", "params": {"index": 10}}

thought: Drag the move block under the green-flag block.
action: {"action": "drag_and_drop", "params": {"start_index": 33, "end_index": 5}}

Query: Make the sprite say "Hello" when clicked
Actions:
thought: Open the Events category.
action: {"action": "click", "params": {"index": 12}}

thought: Drag the sprite-clicked event block into the scripts area.
action: {"action": "drag_and_drop", "params": {"start_index": 27, "end_index": 5}}

thought: Open the Looks category.
action: {"action": "click", "params": {"index": 14}}

thought: Drag the say block under the event block.
action: {"action": "drag_and_drop", "params": {"start_index": 41, "end_index": 5}}

thought: Click the text field in the say block and type the message.
action: {"action": "click", "params": {"index": 42}}
action: {"action": "type", "params": {"text": "Hello"}}

### Summary Workflows

Workflow: Add basic motion script with green flag
thought: Open the Events category.
action: {"action": "click", "params": {"index": "<events_category_idx>"}}
thought: Drag the green-flag event block into the scripts area.
action: {"action": "drag_and_drop", "params": {"start_index": "<event_block_idx>", "end_index": "<scripts_area_idx>"}}
thought: Open the Motion category.
action: {"action": "click", "params": {"index": "<motion_category_idx>"}}
thought: Drag the move block under the event block.
action: {"action": "drag_and_drop", "params": {"start_index": "<move_block_idx>", "end_index": "<stack_under_flag_idx>"}}

Workflow: Add click-to-say script
thought: Open the Events category.
action: {"action": "click", "params": {"index": "<events_category_idx>"}}
thought: Drag the sprite-clicked event block into the scripts area.
action: {"action": "drag_and_drop", "params": {"start_index": "<sprite_clicked_block_idx>", "end_index": "<scripts_area_idx>"}}
thought: Open the Looks category.
action: {"action": "click", "params": {"index": "<looks_category_idx>"}}
thought: Drag the say block under the event block.
action: {"action": "drag_and_drop", "params": {"start_index": "<say_block_idx>", "end_index": "<stack_under_click_idx>"}}
thought: Click the text field and type the message.
action: {"action": "click", "params": {"index": "<say_text_field_idx>"}}
action: {"action": "type", "params": {"text": "<message>"}}"""
            
            # Combine instruction, one-shot, and examples
            selected_one_shot = primitive_one_shot if self.mode == "primitive" else composite_one_shot
            full_prompt = '\n\n'.join([instruction, selected_one_shot, formmatted_trajs_text])
            
            # 4. Call LLM to synthesize workflows using the manager
            logger.info("Calling LLM to synthesize workflows...")
            llm_response = self.llm_call_manager.call(
                messages=[{"role": "user", "content": full_prompt}],
            )
            
            workflows = llm_response["content"]
            
            # Write the reindexed content back to the file
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(workflows)
            
            logger.info(f"Workflows saved to: {output_path}")
            return output_path
            
        except Exception as e:
            logger.error(f"Error in induce_workflow: {e}", exc_info=True)
            return ""
