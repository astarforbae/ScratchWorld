#!/usr/bin/env python
# -*- coding: utf-8 -*-

import base64
import json
import os
import re
import time
import random

from datetime import datetime
from typing import Optional, Dict, Any
from io import BytesIO
from typing import Dict, List, Optional, Tuple

import requests
from PIL import Image
from openai import OpenAI

from .base_agent import BaseAgent, AgentPredictionException
from .agent_client import ScratchAgentEnvironment
from .prompts import (
    system_prompt_primitive,
    system_prompt_composite,
    build_primitive_turn_prompt,
    build_composite_turn_prompt,
    system_prompt_primitive_withou_element_list,
)
from .utils import extract_action_from_llm_content
from .coordinate_resize import resize_action_coordinates
from .llm_call_manager import LLMCallManager, LLMCallException
import logging
import sys
import jsonschema

logger = logging.getLogger("scratch_bench.llm_agent")


class ScratchAgent(BaseAgent):
    """
    Implementation of an LLM Agent interacting with the Scratch GUI environment.
    Can connect to OpenAI or other LLM services to automatically control Scratch.
    """
    
    def __init__(self, 
                 llm_api_key=None, 
                 model="gpt-4-vision-preview",
                 base_url="https://api.openai.com/v1",
                 log_dir="logs",
                 log_file=None,
                 cost_log_path="cost.json",
                 mode: str = "primitive",  # "primitive" | "composite"
                 use_last_screenshot: bool = False,
                 use_element_list: bool = True):
        """
        Initialize the LLM Agent
        
        Args:
        - llm_api_key: LLM API key (can be read from environment variables)
        - model: LLM model name
        - base_url: Base URL of the LLM API, e.g., for different providers
        - log_dir: Directory to save logs and screenshots
        - log_file: JSON log filename, defaults to a timestamped file
        - cost_log_path: Path to the cost log
        - mode: Agent mode ("primitive" | "composite")
        - use_last_screenshot: Whether to only keep the latest screenshot in the request to the LLM
        - use_element_list: Whether to provide element list in primitive mode
        """
        # Support multiple environment variable names
        self.llm_api_key = (llm_api_key or
                           os.environ.get("OPENAI_API_KEY") or
                           os.environ.get("LLM_API_KEY"))
        # Support reading model name from environment variable
        self.model = os.environ.get("LLM_MODEL") or model
        # Support reading base_url from environment variable
        self.base_url = os.environ.get("LLM_BASE_URL") or base_url
        # LLM HTTP request timeout (seconds), configurable via LLM_HTTP_TIMEOUT env var, default 240
        self.conversation_history = []
        self.cost_log_path = cost_log_path
        # Mode & resources (mode is provided by caller/CLI)
        self.mode = str(mode).strip()
        if self.mode not in ("primitive", "composite"):
            raise ValueError(f"Invalid mode: {self.mode!r}. Expected 'primitive' or 'composite'.")
        # Whether to only keep the latest screenshot in the request to the LLM
        self.use_last_screenshot: bool = bool(use_last_screenshot)
        self.use_element_list: bool = bool(use_element_list)
        self.max_turns: int = 10
        # Lazy-initialized LLM client (OpenAI-compatible, supports custom base_url)
        self._client = OpenAI(base_url=self.base_url, api_key=self.llm_api_key)
        
        # Initialize LLM Call Manager
        self.llm_call_manager = LLMCallManager(
            model=self.model,
            api_key=self.llm_api_key,
            base_url=self.base_url,
        )
        
        # cache latest observation to avoid redundant environment calls
        self._last_observation: Optional[Dict[str, Any]] = None

        # Load documentation - this will be initialized in initialize() method
        self._documentation: Optional[Dict[str, Any]] = None
        self._composite_api_catalog_text: Optional[str] = None
        self._blocks_catalog_text: Optional[str] = None
        self._primitive_actions_catalog_text: Optional[str] = None
        self._primitive_actions_catalog_without_element_list_text: Optional[str] = None
        
        # Logging-related
        self.log_dir = log_dir
        self.session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Create log directory
        if not os.path.exists(log_dir):
            os.makedirs(log_dir)
        
        # Create prompts directory
        self.prompts_dir = os.path.join(log_dir, f"prompts_{self.session_id}")
        if not os.path.exists(self.prompts_dir):
            os.makedirs(self.prompts_dir)
        
    def initialize(self, task_description: str, documentation: Dict[str, Any]) -> None:
        """
        Initialize the Agent to execute a specific task
        
        Args:
            task_description: Description telling the Agent what to accomplish
            documentation: Environment documentation containing API catalogs and operation instructions
        """
        # Load documentation from TaskRunner (no need to create temporary environment)
        self._documentation = documentation
        self._composite_api_catalog_text = self._documentation["composite_api_catalog_text"]
        self._blocks_catalog_text = self._documentation["blocks_catalog_text"]
        self._primitive_actions_catalog_text = self._documentation["primitive_actions_catalog_text"]
        self._primitive_actions_catalog_without_element_list_text = self._documentation[
            "primitive_actions_catalog_without_element_list_text"
        ]
        
        # Initialize conversation history with system prompt
        self.conversation_history = []
        if self.mode == "composite":
            # Composite mode: include catalogs only once in system prompt
            api_catalog = self._composite_api_catalog_text or ""
            blocks_catalog = self._blocks_catalog_text or ""
            self.conversation_history.append({
                "role": "system",
                "content": system_prompt_composite(task_description, api_catalog=api_catalog, blocks_catalog=blocks_catalog)
            })
        else:
            if self.use_element_list:
                actions_catalog = self._primitive_actions_catalog_text or ""
                self.conversation_history.append({
                    "role": "system",
                    "content": system_prompt_primitive(task_description, actions_catalog=actions_catalog)
                })
            else:
                actions_catalog = self._primitive_actions_catalog_without_element_list_text or ""
                self.conversation_history.append({
                    "role": "system",
                    "content": system_prompt_primitive_withou_element_list(task_description, actions_catalog=actions_catalog)
                })
        
    def _save_turn_log_clean(self, turn, messages, response=None, cost=None):
        """
        Save the full turn log information (prompt, elements, assistant response, optional reasoning, and raw API response)

        Args:
        - turn: current turn index
        - messages: messages sent to the LLM
        - response: optional LLM response content (assistant content)
        - cost: optional cost information
        """
        filename = f"turn_{turn+1:03d}_prompt.json"
        filepath = os.path.join(self.prompts_dir, filename)

        # Minimal sanitize: if messages contain vision content with data:image URL, replace it
        sanitized_messages = []
        for msg in messages or []:
            msg_copy = dict(msg) if isinstance(msg, dict) else msg
            if isinstance(msg_copy, dict) and isinstance(msg_copy.get("content"), list):
                new_content = []
                for part in msg_copy["content"]:
                    if isinstance(part, dict) and part.get("type") == "image_url":
                        part_copy = dict(part)
                        iu = part_copy.get("image_url")
                        if isinstance(iu, dict) and isinstance(iu.get("url"), str) and iu["url"].startswith("data:image"):
                            iu2 = dict(iu)
                            iu2["url"] = "<base64_image_removed>"
                            part_copy["image_url"] = iu2
                        new_content.append(part_copy)
                    else:
                        new_content.append(part)
                msg_copy["content"] = new_content
            sanitized_messages.append(msg_copy)

        prompt_data = {
            "turn": turn + 1,
            "timestamp": datetime.now().isoformat(),
            "messages": sanitized_messages,
            "response": response,
            "cost": cost,
        }

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(prompt_data, f, indent=2, ensure_ascii=False)

        return filepath
    
    def predict(self, observation: Dict[str, Any], turn: int = 0) -> Optional[Dict[str, Any]]:
        """
        Predict the next action based on current observation
        
        This is the core method of the Agent - it takes environment observation
        and returns an action plan through LLM reasoning.

        Args:
            observation: Environment observation including screenshot and elements
            turn: Current turn index (for logging purposes)

        Returns:
            Action plan dict or None (if prediction fails)
        """
        # Prepare image data
        image_b64 = observation.get("screenshot", "")
        
        # Build prompt depending on mode
        if self.mode == "composite":
            # Per-turn prompt only contains current pseudocode and target name
            pseudocode = observation.get("pseudocode", "") if isinstance(observation, dict) else ""
            target_name = observation.get("targetName", "") if isinstance(observation, dict) else ""
            available_targets = observation.get("availableTargets", []) if isinstance(observation, dict) else []
            target_variables = observation.get("targetVariables", []) if isinstance(observation, dict) else []
            target_lists = observation.get("targetLists", []) if isinstance(observation, dict) else []
            prompt = build_composite_turn_prompt(
                pseudocode=pseudocode,
                target_name=target_name,
                available_targets=available_targets,
                target_variables=target_variables,
                target_lists=target_lists,
            )
            elements_info = None
            self.conversation_history.append({
                "role": "user",
                "content": prompt
            })
        else:
            # Original primitive mode
            content_list = []
            if self.use_element_list:
                elements_info = observation.get("elements", [])
                prompt = build_primitive_turn_prompt(elements_info)
                content_list.append({"type": "text", "text": prompt})
            
            content_list.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/png;base64,{image_b64}"
                }
            })

            self.conversation_history.append({
                "role": "user",
                "content": content_list
            })
        
        # Prepare messages (optionally filter earlier screenshots)
        messages = list(self.conversation_history)
        
        if self.mode != "composite" and self.use_last_screenshot:
            last_user_idx = len(messages) - 1
            filtered = []
            for i, m in enumerate(messages):
                if isinstance(m, dict) and m.get("role") == "user" and isinstance(m.get("content"), list):
                    if i != last_user_idx:
                        # Keep only text parts for earlier user messages
                        filtered.append({"role": "user", "content": [p for p in m["content"] if isinstance(p, dict) and p.get("type") == "text"]})
                    else:
                        filtered.append(m)
                else:
                    filtered.append(m)
            messages = filtered

        # Global truncation: Keep system message + recent turns + latest user message
        max_recent_msgs = self.max_turns * 2 + 1
        if len(messages) > max_recent_msgs + 1:
            messages = messages[:1] + messages[-max_recent_msgs:]

        self._save_turn_log_clean(turn, messages)
        
        # Call the LLM using the manager
        try:
            llm_response = self.llm_call_manager.call(
                messages=messages,
                call_id=f"turn_{turn+1:03d}"
            )
            
            response_data = llm_response["response_data"]
            content = llm_response["content"]
            
            # Add to conversation history
            history_entry = {
                "role": "assistant",
                "content": content
            }
            # Optionally record reasoning_content when available
            reasoning_content = llm_response.get("reasoning_content")
            if reasoning_content is not None:
                history_entry["reasoning_content"] = reasoning_content
            self.conversation_history.append(history_entry)
            
            logger.info("\n LLM response:" + content)

            cost = None

            self._save_turn_log_clean(turn, messages, response_data, cost)
            # Try to extract JSON part from the content
            action_plan = extract_action_from_llm_content(content)
            logger.info(f"Action plan: {action_plan}")
            
            # Resize coordinates if necessary
            if action_plan:
                # Determine screen dimensions
                screen_width, screen_height = 1280, 720  # Default fallback
                if image_b64:
                    try:
                        img_data = base64.b64decode(image_b64)
                        with Image.open(BytesIO(img_data)) as img:
                            screen_width, screen_height = img.size
                    except Exception as e:
                        logger.warning(f"Failed to get image size from screenshot: {e}")
                
                # Apply resizing
                original_plan = str(action_plan)
                action_plan = resize_action_coordinates(
                    action_plan,
                    self.model,
                    screen_width,
                    screen_height
                )
                if str(action_plan) != original_plan:
                    logger.info(f"Resized action plan: {action_plan}")
            
            return action_plan
            
        except LLMCallException as e:
            logger.error(f"LLM call failed for turn {turn}: {e}")
            # Re-raise as AgentPredictionException to signal fatal error
            raise AgentPredictionException(f"LLM API call failed: {e}") from e
