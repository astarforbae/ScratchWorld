#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
LLM Call Manager
A comprehensive utility for managing LLM API calls with logging, retry logic, 
and rate limiting.
"""

import json
import os
import time
import random
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional
from pathlib import Path
import logging

from openai import OpenAI

logger = logging.getLogger("scratch_bench.llm_call_manager")


class LLMCallException(Exception):
    """Exception raised when LLM API calls fail after all retries."""
    pass


class LLMCallManager:
    """
    Centralized manager for all LLM API calls with features:
    - Automatic retry with exponential backoff
    - Rate limiting
    - Image data sanitization for logs
    - Support for multiple LLM providers (OpenAI-compatible APIs)
    """

    # Thinking config (edit these values to change behavior)
    GEMINI_THINKING_MODE = "low"
    CLAUDE_THINKING_BUDGET_TOKENS = 1000
    OPENAI_RESPONSES_REASONING_EFFORT = "low"
    OPENAI_TEXT_VERBOSITY = "low"
    RESPONSES_MODEL_PREFIXES = ("o1", "o3")
    
    def __init__(
        self,
        model: str,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: int = 600,
        max_retries: int = 3,
        base_delay: float = 0.5,
        backoff_factor: float = 1.8,
        max_delay: float = 10.0,
        jitter: float = 0.2,
        rate_limit_rpm: Optional[float] = None,
        session_id: Optional[str] = None
    ):
        """
        Initialize the LLM Call Manager.
        
        Args:
            model: Model name to use
            api_key: API key (reads from OPENAI_API_KEY or LLM_API_KEY env var if not provided)
            base_url: Base URL for the API (reads from LLM_BASE_URL env var if not provided)
            timeout: Request timeout in seconds
            max_retries: Maximum number of retries on failure
            base_delay: Initial delay for exponential backoff
            backoff_factor: Multiplier for backoff delay
            max_delay: Maximum delay cap
            jitter: Random jitter to add to delays
            rate_limit_rpm: Rate limit in requests per minute
            session_id: Optional session identifier for logging
        """
        # Get configuration from environment if not provided
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY") or os.environ.get("LLM_API_KEY")
        self.base_url = base_url or os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")
        self.model = model
        
        # Initialize OpenAI client
        self.client = OpenAI(base_url=self.base_url, api_key=self.api_key)
        
        self.timeout = timeout
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.backoff_factor = backoff_factor
        self.max_delay = max_delay
        self.jitter = jitter
        # Support rate limit from environment variable
        if rate_limit_rpm is not None:
            self.rate_limit_rpm = rate_limit_rpm
        else:
            env_rpm = os.environ.get("RATE_LIMIT_RPM")
            self.rate_limit_rpm = float(env_rpm) if env_rpm else None
        
        if self.rate_limit_rpm:
            logger.info(f"Rate limit configured: {self.rate_limit_rpm} RPM")
        
        self.session_id = session_id or datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Track call history
        self.call_count = 0
        self.last_call_time: Optional[float] = None
    
    def _sanitize_messages_for_logging(self, messages: List[Dict]) -> List[Dict]:
        """
        Replace base64 image data with placeholder text to avoid huge logs.
        
        Args:
            messages: List of message dictionaries
            
        Returns:
            Sanitized copy of messages
        """
        import copy
        sanitized = copy.deepcopy(messages)
        
        for msg in sanitized:
            if "content" not in msg:
                continue
            
            content = msg["content"]
            if not isinstance(content, list):
                continue
            
            for item in content:
                if not isinstance(item, dict):
                    continue
                
                # Handle OpenAI/Azure/Gemini style: image_url
                if item.get("type") == "image_url":
                    if "image_url" in item and isinstance(item["image_url"], dict):
                        url = item["image_url"].get("url", "")
                        if url.startswith("data:image"):
                            item["image_url"]["url"] = "<base64_image_data_omitted>"
                
                # Handle Anthropic style: image with source
                elif item.get("type") == "image":
                    if "source" in item and isinstance(item["source"], dict):
                        if item["source"].get("type") == "base64":
                            item["source"]["data"] = "<base64_image_data_omitted>"
        
        return sanitized

    def _sanitize_api_params_for_logging(self, api_params: Dict[str, Any]) -> Dict[str, Any]:
        """Return a safe copy of api_params for logging."""
        import copy
        sanitized = copy.deepcopy(api_params)

        if "messages" in sanitized:
            sanitized["messages"] = self._sanitize_messages_for_logging(sanitized["messages"])

        # Remove/replace sensitive fields if present in kwargs.
        for key in ("api_key", "apiKey", "authorization", "Authorization"):
            if key in sanitized:
                sanitized[key] = "<redacted>"

        return sanitized

    def _extract_responses_content(self, response_data: Dict[str, Any]) -> Dict[str, Optional[str]]:
        content = response_data.get("output_text")
        if content is None:
            content = ""
            output = response_data.get("output")
            if isinstance(output, list):
                for item in output:
                    if not isinstance(item, dict):
                        continue
                    for part in item.get("content", []) or []:
                        if isinstance(part, dict) and part.get("type") in ("output_text", "text"):
                            text_val = part.get("text")
                            if isinstance(text_val, str):
                                content += text_val
        return {"content": content, "reasoning_content": None}

    def _model_name_lower(self) -> str:
        return (self.model or "").lower()

    def _is_gemini_model(self) -> bool:
        return "gemini" in self._model_name_lower()

    def _is_claude_model(self) -> bool:
        return "claude" in self._model_name_lower()

    def _use_responses_for_model(self) -> bool:
        model_name = self._model_name_lower()
        return any(model_name.startswith(prefix) for prefix in self.RESPONSES_MODEL_PREFIXES)

    def _apply_thinking_for_chat(self, api_params: Dict[str, Any]) -> Dict[str, Any]:
        if self._is_gemini_model():
            extra_body = api_params.get("extra_body") or {}
            inner = extra_body.get("extra_body") or {}
            google = inner.get("google") or {}
            google["thinking_config"] = {
                "thinking_budget": self.GEMINI_THINKING_MODE,
                "include_thoughts": True
            }
            inner["google"] = google
            extra_body["extra_body"] = inner
            api_params["extra_body"] = extra_body

        elif self._is_claude_model():
            extra_body = api_params.get("extra_body") or {}
            extra_body["thinking"] = {
                "type": "enabled",
                "budget_tokens": self.CLAUDE_THINKING_BUDGET_TOKENS
            }
            api_params["extra_body"] = extra_body

        return api_params
    
    def _apply_rate_limit(self):
        """Apply rate limiting if configured."""
        if self.rate_limit_rpm is None or self.rate_limit_rpm <= 0:
            return
        
        if self.last_call_time is not None:
            # Calculate minimum time between requests
            min_interval = 60.0 / self.rate_limit_rpm
            elapsed = time.time() - self.last_call_time
            
            if elapsed < min_interval:
                sleep_time = min_interval - elapsed + 3.0  # Add 3s buffer
                logger.info(
                    f"Rate limit ({self.rate_limit_rpm} RPM): sleeping {sleep_time:.2f}s"
                )
                time.sleep(sleep_time)
    
    def _retry_with_backoff(self, func: Callable, operation_name: str = "LLM call") -> Any:
        """
        Execute function with retry and exponential backoff.
        
        Args:
            func: Zero-argument callable to execute
            operation_name: Description of the operation for logging
            
        Returns:
            Result from successful function call
            
        Raises:
            LLMCallException: If all retries are exhausted
        """
        total_attempts = self.max_retries + 1
        
        for attempt_idx in range(total_attempts):
            try:
                return func()
            except Exception as e:
                # Last attempt - raise exception
                if attempt_idx == total_attempts - 1:
                    logger.error(
                        f"{operation_name} failed after {total_attempts} attempts; "
                        f"last error: {type(e).__name__}: {e}"
                    )
                    raise LLMCallException(
                        f"{operation_name} failed after {total_attempts} attempts"
                    ) from e
                
                # Calculate backoff delay
                exp_delay = min(self.max_delay, self.base_delay * (self.backoff_factor ** attempt_idx))
                jitter_offset = random.uniform(-self.jitter, self.jitter) if self.jitter > 0 else 0.0
                sleep_seconds = max(0.0, exp_delay + jitter_offset)
                
                err_type = type(e).__name__
                logger.warning(
                    f"{operation_name} attempt {attempt_idx + 1}/{total_attempts} failed: "
                    f"{err_type}: {e}; retrying in {sleep_seconds:.2f}s"
                )
                time.sleep(sleep_seconds)
    
    def call(
        self,
        messages: List[Dict[str, Any]],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        call_id: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Make an LLM API call with full management (retry, logging, rate limiting).
        
        Args:
            messages: List of message dictionaries for the LLM
            temperature: Sampling temperature (optional)
            max_tokens: Maximum tokens to generate (optional)
            metadata: Additional metadata for logging (optional, currently not used)
            call_id: Custom identifier for this call (auto-generated if not provided)
            **kwargs: Additional arguments to pass to the API
            
        Returns:
            Dictionary containing:
                - response_data: Full API response
                - content: Extracted message content
                - reasoning_content: Reasoning content if available
                - call_id: Identifier for this call
                
        Raises:
            LLMCallException: If the API call fails after all retries
        """
        # Generate call ID
        self.call_count += 1
        if call_id is None:
            call_id = f"call_{self.session_id}_{self.call_count:04d}"
        
        # Apply rate limiting
        self._apply_rate_limit()
        
        # Log the call
        logger.info(f"Making LLM call: {call_id}")
        use_responses_api = self._use_responses_for_model()
        endpoint = "responses" if use_responses_api else "chat/completions"
        logger.info(
            f"API: {self.base_url}/{endpoint} | model={self.model} | "
            f"timeout={self.timeout}s | messages={len(messages)}"
        )
        
        # Prepare API call parameters
        api_params = {
            "model": self.model,
            "messages": messages,
            "timeout": self.timeout,
            **kwargs
        }
        
        if temperature is not None:
            api_params["temperature"] = temperature
        if max_tokens is not None:
            api_params["max_tokens"] = max_tokens

        # Apply provider-specific thinking configuration for chat.completions
        if not use_responses_api:
            api_params = self._apply_thinking_for_chat(api_params)

        responses_params = None
        if use_responses_api and hasattr(self.client, "responses"):
            responses_params = {
                "model": self.model,
                "input": api_params.get("messages"),
                "timeout": self.timeout,
            }
            if self.OPENAI_RESPONSES_REASONING_EFFORT is not None:
                responses_params["reasoning"] = {"effort": self.OPENAI_RESPONSES_REASONING_EFFORT}
            if self.OPENAI_TEXT_VERBOSITY is not None:
                responses_params["text"] = {"verbosity": self.OPENAI_TEXT_VERBOSITY}

        # Debug logging: sanitized request params
        params_for_log = responses_params if responses_params is not None else api_params
        sanitized_params = self._sanitize_api_params_for_logging(params_for_log)
        logger.debug(
            f"Call params for {call_id}: {json.dumps(sanitized_params, indent=2, ensure_ascii=False)}"
        )
        
        # Define the API call function
        def make_api_call():
            if responses_params is not None:
                return self.client.responses.create(**responses_params)
            return self.client.chat.completions.create(**api_params)
        
        # Execute with retry
        try:
            response_obj = self._retry_with_backoff(make_api_call, f"LLM call {call_id}")
            self.last_call_time = time.time()
            
            # Debug logging: complete original response
            logger.debug(f"Complete response for {call_id}: {response_obj}")
            
            # Convert to dict for processing
            response_data = response_obj.model_dump()
            
            # Check for API-level errors
            if "error" in response_data:
                error_msg = str(response_data.get("error"))
                logger.error(f"LLM API error in {call_id}: {error_msg}")
                raise LLMCallException(f"API error: {error_msg}")
            
            # Extract message content
            message_obj = response_data.get("choices", [{}])[0].get("message", {})
            content = message_obj.get("content", "")
            reasoning_content = message_obj.get("reasoning_content")

            if use_responses_api and "choices" not in response_data:
                extracted = self._extract_responses_content(response_data)
                content = extracted.get("content", "")
                reasoning_content = extracted.get("reasoning_content")
            
            if content is None:
                content = reasoning_content  # Fallback if content is None
            
            logger.info(f"LLM call {call_id} completed successfully")
            
            return {
                "response_data": response_data,
                "content": content,
                "reasoning_content": reasoning_content,
                "call_id": call_id,
                "message_object": message_obj
            }
            
        except LLMCallException:
            raise
        except Exception as e:
            logger.error(f"Unexpected error in LLM call {call_id}: {type(e).__name__}: {e}")
            raise LLMCallException(f"Unexpected error in {call_id}") from e
