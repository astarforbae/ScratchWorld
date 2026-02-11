#!/usr/bin/env python3
"""
Main Task Runner
Coordinates the entire task execution flow: config loading → environment management → agent interaction → evaluation
"""

import json
import sys
import time
import logging
from pathlib import Path
import requests
import base64
from typing import Dict, Any, Optional
import traceback
import os
import shutil
from datetime import datetime
from dotenv import load_dotenv
from scratchbench.core.agent_client import ScratchAgentEnvironment
from scratchbench.core.base_agent import AgentPredictionException
import copy
from dataclasses import dataclass, asdict

def _safe_join(base: str, route: str) -> str:
    if not route:
        return base
    if route.startswith('/'):
        return base.rstrip('/') + route
    return base.rstrip('/') + '/' + route

def _sanitize_model_name(model_name: str) -> str:
    return model_name.replace('/', '_').replace('\\', '_').replace("-", "_").replace(" ", "_")


def _mask_secret_value(value: Any) -> str:
    if isinstance(value, str) and len(value) > 4:
        return ("*" * max(0, len(value) - 4)) + value[-4:]
    return "****"


def _mask_api_keys_in_dict(value: Any) -> Any:
    if isinstance(value, dict):
        masked: Dict[str, Any] = {}
        for k, v in value.items():
            if "api_key" in str(k).lower():
                masked[k] = _mask_secret_value(v)
            else:
                masked[k] = _mask_api_keys_in_dict(v)
        return masked
    if isinstance(value, list):
        return [_mask_api_keys_in_dict(v) for v in value]
    if isinstance(value, tuple):
        return tuple(_mask_api_keys_in_dict(v) for v in value)
    return value

@dataclass(frozen=True)
class RunConfig:
    task_list: str
    no_recording: bool
    mode: str
    model: str
    max_steps: int
    use_last_screenshot: bool
    disable_element_list: bool
    parallel: int
    agent: str
    tasks_dir: str
    env_file: str

    api_key: str
    llm_base_url: str
    recording_quality: str
    max_sessions: int
    api_url: str

    agent_configs: Dict[str, Any]

class ColorFormatter(logging.Formatter):
    """Custom formatter to add colors to log output for stdout."""

    COLORS = {
        logging.DEBUG: "\033[37m",   # White
        logging.INFO: "\033[36m",    # Cyan
        logging.WARNING: "\033[33m", # Yellow
        logging.ERROR: "\033[31m",   # Red
        logging.CRITICAL: "\033[41m" # Red background
    }
    RESET = "\033[0m"

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelno, self.RESET)
        message = super().format(record)
        return f"{color}{message}{self.RESET}"


def setup_project_root_logger(log_dir: str = "logs", name: Optional[str] = None) -> None:
    """Configure the project ROOT logger with five handlers.

    Handlers:
    - stdout (INFO+, with colors)
    - main.log (INFO+)
    - debug.log (DEBUG+, includes all detailed information)
    - error.log (ERROR+)
    - warning.log (WARNING+)
    """
    # Ensure log directory exists
    log_path = Path(log_dir)
    log_path.mkdir(parents=True, exist_ok=True)

    # ROOT logger - set to DEBUG to capture all levels
    root = logging.getLogger(name)
    root.setLevel(logging.DEBUG)

    # Clear existing handlers to avoid duplication in repeated runs
    root.handlers.clear()

    # Common formatter (no colors, for file logs)
    file_formatter = logging.Formatter(
        '%(asctime)s [%(threadName)s] %(name)s %(levelname)s %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )

    # Colored formatter (for console only)
    color_formatter = ColorFormatter(
        '%(asctime)s [%(threadName)s] %(name)s %(levelname)s %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )

    # stdout handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(color_formatter)
    root.addHandler(console_handler)

    # main.log handler (INFO+)
    main_file = log_path / 'main.log'
    main_handler = logging.FileHandler(main_file, encoding='utf-8')
    main_handler.setLevel(logging.INFO)
    main_handler.setFormatter(file_formatter)
    root.addHandler(main_handler)

    # debug.log handler (DEBUG+, includes all detailed information)
    debug_file = log_path / 'debug.log'
    debug_handler = logging.FileHandler(debug_file, encoding='utf-8')
    debug_handler.setLevel(logging.DEBUG)
    debug_handler.setFormatter(file_formatter)
    root.addHandler(debug_handler)

    # error.log handler (ERROR+)
    error_file = log_path / 'error.log'
    error_handler = logging.FileHandler(error_file, encoding='utf-8')
    error_handler.setLevel(logging.ERROR)
    error_handler.setFormatter(file_formatter)
    root.addHandler(error_handler)

    # warning.log handler (WARNING+)
    warning_file = log_path / 'warning.log'
    warning_handler = logging.FileHandler(warning_file, encoding='utf-8')
    warning_handler.setLevel(logging.WARNING)
    warning_handler.setFormatter(file_formatter)
    root.addHandler(warning_handler)

# Initialize ROOT logging once (writes to ./logs initially, will be reconfigured in main())
setup_project_root_logger(log_dir="logs", name="scratch_bench")

# Module logger name as requested
logger = logging.getLogger("scratch_bench.task_runner")

class TaskRunner:
    def __init__(
        self,
        *,
        run_config: RunConfig,
        result_dir: Path,
    ):
        """Initialize the task runner
        
        Args:
            run_config: Fully resolved run configuration (CLI + env), created in main().
            result_dir: Directory to save task results
        """
        # FastAPI service address - currently points to the scratch-gui container
        self.run_config = run_config
        self.api_url = run_config.api_url
        self.tasks_dir = Path(run_config.tasks_dir)
        self.result_dir = result_dir
        self.cost_file = Path("cost.json")
        # Track recording session id returned by server (if recording enabled)
        self.current_recording_id: Optional[str] = None
        # Track last agent interaction metadata to be saved into result.json
        self.last_interaction_meta: Dict[str, Any] = {}
        # Server-side sessions are always used
        self.session_id: Optional[str] = None
        # Store the last resolved effective parallel worker count (for tests/diagnostics)
        self._last_effective_parallel: Optional[int] = None
        # Store assigned API key for this runner instance (single key shared across workers)
        self.api_key: str = run_config.api_key
        # Recording and interaction settings
        self.enable_recording = not bool(run_config.no_recording)
        self.max_steps = int(run_config.max_steps)
        self.agent_type = run_config.agent
        # Agent configurations are loaded once in main() and carried by run_config
        self.agent_configs = run_config.agent_configs

    def _log_prefix(self) -> str:
        """Build a consistent log prefix for runner messages including session id when available."""
        sid = getattr(self, "session_id", None)
        return f"[session_id={sid}] " if sid else ""
    
    def load_task_config(self, task_name: str) -> Dict[str, Any]:
        """Load a task config file, supporting search in subdirectories"""
        # Try searching task config in different subdirectories
        search_paths = [self.tasks_dir / f"{task_name}.json"]  # backward-compatible direct path

        task_dirs = ["create", "debug", "extend", "compute"]

        for dir_name in task_dirs:
            search_paths.append(self.tasks_dir / dir_name / f"{task_name}.json")

        config_path = None
        for path in search_paths:
            if path.exists():
                config_path = path
                break

        if not config_path:
            searched_paths = "\n".join([f"  - {path}" for path in search_paths])
            raise FileNotFoundError(f"Task config not found. Searched paths:\n{searched_paths}")

        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)

        logger.info(f"Loaded task config: {task_name}")
        logger.info(f"Config file: {config_path}")
        logger.info(f"Description: {config.get('description', 'N/A')}")
        logger.info(f"Type: {config.get('type', 'N/A')}")
        logger.info(f"Initial project: {config.get('initial_project', 'N/A')}")

        return config
    
    def setup_environment(self, config: Dict[str, Any], task_name: str) -> bool:
        """Set up environment: create/reset context (optionally with recording) + load initial project"""
        # Always create a server-side session
        logger.info(self._log_prefix() + f"[task={task_name}] Creating session for task environment...")
        options = {}
        if self.enable_recording:
            options.update({
                "record": True,
                "quality": self.run_config.recording_quality,
                "task_name": task_name,
            })
        created = self.create_session(options)
        if not created:
            logger.error(self._log_prefix() + f"[task={task_name}] Failed to create session")
            return False
        logger.info(self._log_prefix() + f"[task={task_name}] Session created: {self.session_id}")
        
        time.sleep(3)
        # Load initial project
        logger.info(self._log_prefix() + f"[task={task_name}] Loading initial project: {config['initial_project']}")
        response = requests.post(
            self._url("/load_project"),
            params={"project_name": config['initial_project']}
        )
        if response.status_code != 200:
            logger.error(self._log_prefix() + f"Project load failed: {response.text}")
            return False
        
        # Toggle stage to small stage for better element visibility
        logger.info(self._log_prefix() + f"[task={task_name}] Toggling stage to small stage")
        response = requests.post(self._url("/toggle_stage"))
        if response.status_code != 200:
            logger.warning(self._log_prefix() + f"Stage toggle failed: {response.text}")
        
        logger.info(self._log_prefix() + f"[task={task_name}] Environment setup complete")
        return True
            
    
    def create_task_result_dir(self, task_name: str, task_type: str) -> Path:
        """Create a result directory for the task"""
        # Ensure result_dir is set
        if not self.result_dir:
            raise ValueError("result_dir is not set. It should be configured in the main execution flow.")
        task_result_dir = self.result_dir / task_type / task_name
        task_result_dir.mkdir(parents=True, exist_ok=True)
        return task_result_dir

    def _save_run_config(self, *, task_result_dir: Path, task_name: str, task_type: str, task_config: Dict[str, Any]) -> None:
        """Persist the running configuration and args for this run into the task's result directory.

        This writes two files:
        - task_config.json: a verbatim copy of the loaded task config
        - run_args.json: masked run config and per-task metadata for reproducibility
        """
        # 1) Save a copy of the task config used for this run
        config_path = task_result_dir / "task_config.json"
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(task_config, f, indent=2, ensure_ascii=False)

        # 2) Save masked run config once + task-specific metadata
        cli_args = _mask_api_keys_in_dict(asdict(self.run_config))

        run_args = {
            "cli_args": cli_args,
            "task": {
                "timestamp": datetime.now().isoformat(),
                "task_name": task_name,
                "task_type": task_type,
            },
        }

        args_path = task_result_dir / "run_args.json"
        with open(args_path, "w", encoding="utf-8") as f:
            json.dump(run_args, f, indent=2, ensure_ascii=False)

        logger.info(f"Saved run configuration to: {args_path}")

    def run_agent_interaction(self, config: Dict[str, Any], task_result_dir: Path) -> bool:
        """Run agent interaction"""
        logger.info(f"Starting agent interaction with agent type: {self.agent_type}")
        logger.info(f"Using assigned API key: {self.api_key[-4:]}")

        # Get parameters from resolved run configuration
        base_url = self.run_config.llm_base_url or ""
        model = self.run_config.model
        # Use task-specific log directory
        log_dir = str(task_result_dir)

        logger.info(f"Using LLM model: {model}")
        if base_url:
            logger.info(f"Using custom LLM Base URL: {base_url}")
        logger.info(f"Logs and screenshots will be saved to: {log_dir}")

        mode = self.run_config.mode
        
        # Get documentation from environment
        agent_config = self.agent_configs.get(self.agent_type, {})
        env_documents_config = agent_config.get("documents", {})

        # Create environment here (inject session_id if available)
        env = ScratchAgentEnvironment(
            api_url=self.api_url,
            mode=mode,
            session_id=self.session_id,
            documents_config=env_documents_config,
            use_element_list=(not self.run_config.disable_element_list)
        )

        documentation = env.get_documentation()
        # Create agent instance based on agent_type
        if self.agent_type == "scratch-agent":
            # Import and use LLM Agent directly
            from scratchbench.core.llm_agent import ScratchAgent

            agent = ScratchAgent(
                llm_api_key=self.api_key,
                model=model,
                base_url=base_url,
                log_dir=log_dir,
                mode=mode,
                use_last_screenshot=(self.run_config.use_last_screenshot is True),
                use_element_list=(not self.run_config.disable_element_list)
            )
            
        elif self.agent_type == "agent-s2":
            from scratchbench.core.agent_s import AgentS
            
            engine_params = {
                "engine_type": "openai",
                "model": model,
                "base_url": base_url,
                "api_key": self.api_key,
            }
            safe_model_name = _sanitize_model_name(model)
            if not safe_model_name:
                safe_model_name = "unknown_model"
            memory_folder_name = f"kb_scratch_{safe_model_name}"
            memory_root_path = os.getcwd()
            source_kb_path = os.path.join(memory_root_path, "kb_scratch")
            target_kb_path = os.path.join(memory_root_path, memory_folder_name)
            if not os.path.isdir(target_kb_path):
                if os.path.isdir(source_kb_path):
                    shutil.copytree(source_kb_path, target_kb_path)
                else:
                    logger.warning(
                        "kb_scratch not found at %s; skipping memory copy for %s",
                        source_kb_path,
                        memory_folder_name,
                    )
            
            agent = AgentS(
                platform="linux",
                action_space="pyautogui",
                observation_type="mixed",
                search_engine=None,
                embedding_engine_type="openai",
                embedding_engine_params=agent_config.get("embedding_engine", {}),
                engine_params=engine_params,
                grounding_engine_params=agent_config.get("grounding_engine", {}),
                memory_folder_name=memory_folder_name,
                mode=mode
            )

            
        elif self.agent_type == "awm":
            # Import and use AWM agent
            from scratchbench.core.awm_agent import AWMAgent, AWMFlags

            # Get AWM-specific configuration from agent_config
            awm_config = agent_config.get("awm_config", {})
            docs_dir = Path("scratchbench/docs")
            docs_dir.mkdir(parents=True, exist_ok=True)
            model_mode_tag = f"{_sanitize_model_name(model)}_{mode}"
            workflow_path = docs_dir / f"awm_workflows_{model_mode_tag}.txt"
            successful_trajs_path = docs_dir / f"awm_successful_trajs_{model_mode_tag}.json"
            awm_flags = AWMFlags(
                use_workflow_memory=awm_config.get("use_workflow_memory", True),
                workflow_path=str(workflow_path),
                successful_trajs_path=str(successful_trajs_path),
                use_thinking=awm_config.get("use_thinking", True),
                use_memory=awm_config.get("use_memory", True),
                use_history=awm_config.get("use_history", True),
            )
            
            agent = AWMAgent(
                llm_api_key=self.api_key,
                model=model,
                base_url=base_url,
                log_dir=log_dir,
                mode=mode,
                flags=awm_flags,
                use_last_screenshot=True
            )
            
        else:
            logger.error(f"Unknown agent type: {self.agent_type}")
            return False

        # Initialize agent with task description and documentation
        logger.info("Initializing agent with task description and documentation")
        agent.initialize(config['instruction'], documentation)  # type: ignore


        # Run interaction loop in TaskRunner (previously in Agent)
        logger.info(f"Max interaction steps: {self.max_steps}")
        logger.info(f"Starting interaction loop for task: {config['instruction']}")
        
        # Initialize interaction tracking
        interaction_session_id = getattr(agent, 'session_id', None)

        def _normalize_action_for_log(action_obj: Any) -> Dict[str, Any]:
            if not isinstance(action_obj, dict):
                return {"api": "", "args": {}}
            api = action_obj.get("api")
            args = action_obj.get("args", {})
            return {
                "api": str(api) if api is not None else "",
                "args": dict(args) if isinstance(args, dict) else {},
            }

        def _build_local_envelope(
            *,
            success: bool,
            requested_action: Dict[str, Any],
            executed_action: Optional[Dict[str, Any]] = None,
            data: Optional[Dict[str, Any]] = None,
            error: Optional[Dict[str, Any]] = None,
        ) -> Dict[str, Any]:
            normalized_requested = _normalize_action_for_log(requested_action)
            normalized_executed = _normalize_action_for_log(executed_action or requested_action)

            normalized_error = None
            if not success:
                err = error or {}
                normalized_error = {
                    "code": str(err.get("code", "UNKNOWN_ERROR")),
                    "message": str(err.get("message", "Unknown error")),
                    "details": err.get("details")
                }

            return {
                "success": bool(success),
                "requested_action": normalized_requested,
                "executed_action": normalized_executed,
                "data": dict(data) if isinstance(data, dict) else {},
                "error": normalized_error,
                "meta": {
                    "session_id": interaction_session_id,
                    "timestamp": datetime.now().isoformat(),
                    "duration_ms": 0,
                },
            }

        interaction_log = {
            "session_id": interaction_session_id,
            "task_description": config['instruction'],
            "model": model,
            "base_url": base_url,
            "start_time": datetime.now().isoformat(),
            "interactions": [],
            "mode": mode,
            "max_steps": self.max_steps
        }
        
        final_status = None
        final_reason = None
        abort_interaction = False
        
        for turn in range(self.max_steps):
            logger.info(f"===== Turn {turn+1}/{self.max_steps} =====")
            
            # Create current turn log record
            turn_log = {
                "turn": turn + 1,
                "timestamp": datetime.now().isoformat(),
                "observation": None,
                "agent_prediction": None,
                "action": None,
                "result": None,
                "screenshot_path": None
            }
            
            try:
                # 1. Get current environment observation
                logger.info("Getting environment observation")
                observation = env.get_observation()
                
                if "error" in observation:
                    logger.error(f"Failed to get observation: {observation['error']}")
                    turn_log["result"] = _build_local_envelope(
                        success=False,
                        requested_action={"api": "get_observation", "args": {}},
                        error={
                            "code": "OBSERVATION_ERROR",
                            "message": str(observation["error"]),
                        },
                    )
                    turn_log["action"] = turn_log["result"]["executed_action"]
                    turn_log["error"] = observation["error"]
                    continue
                
                screenshot_path = self._save_screenshot(observation["screenshot"], turn, task_result_dir)
                turn_log["screenshot_path"] = screenshot_path
                
                # Record observation (remove image data to reduce log size)
                observation_log = observation.copy()
                if "screenshot" in observation_log:
                    observation_log["screenshot"] = "<base64_image_data_removed>"
                turn_log["observation"] = observation_log
                
                # 2. Get Agent prediction
                logger.info("Getting agent prediction")
                try:
                    action_plan = agent.predict(observation, turn)
                except AgentPredictionException as e:
                    # LLM API call failed - this is a fatal error, terminate the task
                    logger.error(f"Fatal error: API error occurred: {e}")
                    turn_log["result"] = _build_local_envelope(
                        success=False,
                        requested_action={"api": "predict", "args": {"turn": turn + 1}},
                        error={
                            "code": "API_ERROR",
                            "message": str(e),
                        },
                    )
                    turn_log["action"] = turn_log["result"]["executed_action"]
                    turn_log["error"] = f"API_ERROR: {str(e)}"
                    turn_log["fatal"] = True
                    final_status = "API_ERROR"
                    final_reason = f"API error: {str(e)}"
                    abort_interaction = True
                    break
                    
                turn_log["agent_prediction"] = action_plan
                
                # 3. Check for valid action
                if not action_plan:
                    logger.error("Agent did not return a valid action, skipping this turn")
                    turn_log["result"] = _build_local_envelope(
                        success=False,
                        requested_action={"api": "", "args": {}},
                        error={
                            "code": "INVALID_ACTION_PLAN",
                            "message": "Agent did not return a valid action",
                        },
                    )
                    turn_log["action"] = turn_log["result"]["executed_action"]
                    turn_log["error"] = "Agent did not return a valid action"
                    continue
                
                # 4. Check for termination actions
                api_type = action_plan.get("api") if isinstance(action_plan, dict) else None
                if api_type in ("done", "failed"):
                    # Do not execute any UI operation; mark final status and stop
                    reason = action_plan.get("reason") if isinstance(action_plan, dict) else None
                    terminal_action = {
                        "api": api_type,
                        "args": {"reason": reason} if reason is not None else {},
                    }
                    result = _build_local_envelope(
                        success=True,
                        requested_action=terminal_action,
                        executed_action=terminal_action,
                        data={"reason": reason} if reason is not None else {},
                    )
                    turn_log["result"] = result
                    turn_log["action"] = result["executed_action"]
                    final_status = api_type
                    final_reason = reason
                    logger.info(f"===== Interaction terminated by agent with status: {api_type} =====")
                    break
                
                # 5. Execute the action in environment
                logger.info(f"Executing action: {api_type}")
                result = env.execute_action_plan(action_plan)
                turn_log["result"] = result
                
                # 6. Wait a bit for the action to take effect
                time.sleep(2)
                
            except Exception as e:
                logger.error(f"Error in turn {turn+1}: {e}")
                requested_action = _normalize_action_for_log(turn_log.get("agent_prediction"))
                turn_log["result"] = _build_local_envelope(
                    success=False,
                    requested_action=requested_action,
                    error={
                        "code": "TURN_EXCEPTION",
                        "message": str(e),
                    },
                )
                turn_log["action"] = turn_log["result"]["executed_action"]
                turn_log["error"] = str(e)
            finally:
                # Always save turn log
                interaction_log["interactions"].append(turn_log)
        
        # Mark completion
        interaction_log["end_time"] = datetime.now().isoformat()
        interaction_log["final_status"] = final_status
        interaction_log["final_reason"] = final_reason
        
        # Save interaction log to file
        self._save_interaction_log(interaction_log, task_result_dir)

        # Auto-evaluate the agent's performance if it has auto_eval method
        auto_eval_result = None
        if self.agent_type == "awm" and hasattr(agent, "auto_eval"):
            auto_eval_result = agent.auto_eval()
            logger.info(f"Auto-evaluation result: {auto_eval_result.get('success', 'unknown')}")
            
            # Save auto-evaluation result
            auto_eval_file = task_result_dir / "autoeval.json"
            with open(auto_eval_file, 'w', encoding='utf-8') as f:
                json.dump(auto_eval_result, f, indent=2, ensure_ascii=False)
            
            logger.info(f"Auto-evaluation results saved to: {auto_eval_file}")
        
            if auto_eval_result.get("success") is True:
                agent.save_trajectory()
                logger.info("Saved successful trajectory based on auto-evaluation")
                agent.induce_workflow()

        if self.agent_type == "agent-s2" and hasattr(agent, "_agent_s2"): 
            logger.info("Updating Agent S2 narrative memory")
            agent._agent_s2.update_narrative_memory()
        
        logger.info("===== Interaction complete =====")

        # Capture steps used and termination info for result.json
        steps_used = len(interaction_log["interactions"])
        self.last_interaction_meta = {
            "steps_used": steps_used,
            "final_status": final_status,
            "final_reason": final_reason,
            "log_file": None,  # TaskRunner manages logs directly
            "interaction_log": interaction_log,
            "auto_eval_result": auto_eval_result  # Include auto-eval result in metadata
        }
        logger.info(f"Agent steps used: {steps_used}; final_status={final_status}")
        
        return not abort_interaction

    def _save_interaction_log(self, interaction_log: Dict[str, Any], task_result_dir: Path) -> None:
        """
        Save interaction log to JSON file in task result directory
        
        Args:
            interaction_log: Complete interaction log dictionary
            task_result_dir: Directory to save the log file
        """
        try:
            log_filename = f"interaction_log_{interaction_log.get('session_id', 'unknown')}.json"
            log_filepath = task_result_dir / log_filename
            
            with open(log_filepath, 'w', encoding='utf-8') as f:
                json.dump(interaction_log, f, ensure_ascii=False, indent=2)
            
            logger.info(f"Interaction log saved to: {log_filepath}")
            
            # Also update the last_interaction_meta with the log file path
            if hasattr(self, 'last_interaction_meta'):
                self.last_interaction_meta["log_file"] = str(log_filepath)
                
        except Exception as e:
            logger.warning(f"Failed to save interaction log: {e}")

    def _save_screenshot(self, base64_image: str, turn: int, task_result_dir: Path, suffix: str = "") -> str:
        """
        Save screenshot to task result directory
        
        Args:
            base64_image: base64-encoded image data
            turn: current turn index
            task_result_dir: directory to save screenshot
            suffix: filename suffix
            
        Returns:
            saved file path
        """
        try:
            from PIL import Image
            from io import BytesIO
            
            image_data = base64.b64decode(base64_image)
            image = Image.open(BytesIO(image_data))
            
            filename = f"turn_{turn+1:03d}{suffix}.png"
            screenshots_dir = task_result_dir / "screenshots"
            screenshots_dir.mkdir(exist_ok=True)
            filepath = screenshots_dir / filename
            
            image.save(filepath)
            logger.info(f"Screenshot saved: {filepath}")
            
            return str(filepath)
        except Exception as e:
            logger.warning(f"Failed to save screenshot: {e}")
            return ""

    def shutdown_environment(self, task_result_dir: Optional[Path] = None) -> Optional[Dict[str, Any]]:
        """Request API server to gracefully shutdown environment.

        If a recording is returned by the API with base64 data, save the file
        into the provided task_result_dir.
        """
        # Always close the current session; the API returns recording info (if any)
        data = self.close_session()
        if isinstance(data, dict):
            logger.info("Environment shutdown completed")

            # Save recording file if present and a directory was provided
            if task_result_dir is not None:
                rec = data.get("recording")
                if isinstance(rec, dict):
                    b64 = rec.get("data_base64")
                    if b64:
                        try:
                            raw = base64.b64decode(b64)
                            # Use provided filename or default to timestamp
                            target_path = Path(task_result_dir) / "recording.webm"
                            target_path.write_bytes(raw)
                            rec["saved_to"] = str(target_path)
                            rec["saved_bytes"] = len(raw)
                            logger.info(f"Saved recording to: {target_path} ({len(raw)} bytes)")
                        except Exception as write_err:
                            logger.warning(f"Failed to save recording file: {write_err}")
        else:
            logger.warning("Shutdown request returned no data")
            return None
    
    def export_project(self, task_name: str, task_result_dir: Path) -> Optional[str]:
        """Export the project file to the task result directory"""
        output_filename = f"{task_name}_{int(time.time())}.sb3"
        logger.info(f"Exporting project: {output_filename}")

        response = requests.post(
            self._url("/export_project"),
            params={"output_name": output_filename}
        )

        if response.status_code == 200:
            result = response.json()
            data_b64 = result.get("data_base64")
            filename = result.get("filename", output_filename)
            size = result.get("size")

            if not data_b64:
                logger.error(f"Project export response missing data_base64: {result}")
                return None

            raw = base64.b64decode(data_b64)
            target_path = task_result_dir / filename
            target_path.write_bytes(raw)
            logger.info(f"Project file saved to: {target_path} ({len(raw)} bytes)")
            if size is not None and size != len(raw):
                logger.warning(f"Reported size {size} != written size {len(raw)}")

            return filename
        else:
            logger.error(f"Project export failed: {response.text}")
            return None
    
    def run_evaluation(self, output_filename: str, task_name: str) -> Dict[str, Any]:
        """Run evaluation"""
        logger.info("Starting evaluation...")

        # Call evaluation via API instead of executing directly on the host
        response = requests.post(
            self._url("/evaluate"),
            json={
                "task_name": task_name,
                "sb3_file_name": output_filename,
                "evaluation_method": "browser"
            },
            timeout=120
        )

        if response.status_code == 200:
            result = response.json()
            if result.get("status") == "failed":
                return {
                    "success": False,
                    "partial_success_rate": 0,
                    "output": result.get("stdout"),
                    "error": result.get("error")
                }
            else:
                return result.get("result")
        else:
            logger.error(f"API call failed: {response.status_code}")
            return {
                "success": False,
                "partial_success_rate": 0,
                "output": None,
                "error": f"API call failed: {response.status_code}"
            }
    
    def save_task_result(self, task_result_dir: Path, result: Dict[str, Any], task_name: str, is_error: bool = False):
        """Save task execution result to the task directory"""
        # Save detailed JSON result - use error.json for errors, result.json for success
        filename = "error.json" if is_error else "result.json"
        result_file = task_result_dir / filename
        with open(result_file, 'w', encoding='utf-8') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)

        logger.info(f"Task result saved to: {task_result_dir} ({filename})")


    def _url(self, route: str) -> str:
        """Build URL for route. If a session is active, prefix with /sessions/{id}."""
        if self.session_id:
            return _safe_join(self.api_url, f"/sessions/{self.session_id}{route}")
        return _safe_join(self.api_url, route)

    def create_session(self, options: Optional[Dict[str, Any]] = None) -> bool:
        try:
            # The FastAPI /sessions endpoint expects query parameters (not JSON body)
            # e.g., /sessions?record=true&quality=medium&task_name=...
            # Sending JSON caused 'record' to be ignored, leading to no recording on delete.
            resp = requests.post(f"{self.api_url}/sessions", params=options or {}, timeout=20)
            if resp.status_code != 200:
                logger.error(f"/sessions create failed: {resp.status_code} {resp.text}")
                return False
            data = resp.json()
            sid = (data or {}).get("session_id") or (data or {}).get("id")
            if not sid:
                logger.error("/sessions create did not return session_id")
                return False
            self.session_id = sid
            return True
        except Exception as e:
            logger.error(f"Failed to create session: {e}")
            return False

    def close_session(self) -> Optional[Dict[str, Any]]:
        if not self.session_id:
            return None
        try:
            resp = requests.delete(f"{self.api_url}/sessions/{self.session_id}", timeout=20)
            data = None
            try:
                data = resp.json()
            except Exception:
                data = None
            if resp.status_code not in (200, 204):
                logger.warning(f"/sessions delete returned {resp.status_code}: {resp.text}")
            self.session_id = None
            return data
        except Exception as e:
            logger.warning(f"Failed to delete session: {e}")
            return None



    def run_task(self, task_name: str) -> Dict[str, Any]:
        """Run the full task workflow"""
        logger.info(f"Starting task: {task_name}")
        logger.info("=" * 50)

        task_result_dir = None
        result = None
        
        try:
            self.last_interaction_meta = {}
            config = self.load_task_config(task_name)

            task_type = config.get('type')
            task_result_dir = self.create_task_result_dir(task_name, task_type)
            logger.info(f"Task result directory: {task_result_dir}")

            self._save_run_config(task_result_dir=task_result_dir, task_name=task_name, task_type=task_type, task_config=config)

            if not self.setup_environment(config, task_name):
                result = {"success": False, "error": "Environment setup failed", "timestamp": int(time.time())}
                self.save_task_result(task_result_dir, result, task_name, is_error=True)
                return result
            
            time.sleep(5)

            if not self.run_agent_interaction(config, task_result_dir):
                result = {"success": False, "error": "Agent interaction failed", "timestamp": int(time.time())}
                self.save_task_result(task_result_dir, result, task_name, is_error=True)
                return result
            
            # Check for API error
            if self.last_interaction_meta.get("final_status") == "API_ERROR":
                result = {
                    "success": False,
                    "error": self.last_interaction_meta.get("final_reason", "API error occurred"),
                    "timestamp": int(time.time()),
                    "agent_interaction": copy.deepcopy(self.last_interaction_meta)
                }
                self.save_task_result(task_result_dir, result, task_name, is_error=True)
                return result

            # 4. Export project
            output_filename = self.export_project(task_name, task_result_dir)
            if not output_filename:
                result = {"success": False, "error": "Project export failed", "timestamp": int(time.time())}
                self.save_task_result(task_result_dir, result, task_name, is_error=True)
                return result

            # 5. Run evaluation
            evaluation_result = self.run_evaluation(output_filename, task_name)

            # 6. Build final result
            result = {
                "success": evaluation_result["success"],
                "task_name": task_name,
                "task_type": task_type,
                "output_file": output_filename,
                "result_dir": str(task_result_dir),
                "evaluation": evaluation_result,
                "timestamp": int(time.time())
            }
            # Include agent interaction metadata (steps used and termination info)
            if self.last_interaction_meta:
                result["agent_interaction"] = copy.deepcopy(self.last_interaction_meta)

            # 7. Save task result (before shutdown in case shutdown fails)
            self.save_task_result(task_result_dir, result, task_name)

            logger.info("=" * 50)
            if result["success"]:
                logger.info(f"Task {task_name} succeeded!")
            else:
                logger.info(f"Task {task_name} failed!")

            return result

        except Exception as e:
            # Log full traceback to console and logs
            logger.exception("Task execution exception")
            tb = traceback.format_exc()
            result = {"success": False, "error": str(e), "traceback": tb, "timestamp": int(time.time())}
            # Try to save error result with traceback included
            try:
                if not task_result_dir:
                    config = self.load_task_config(task_name)
                    task_type = config.get('type', 'unknown')
                    task_result_dir = self.create_task_result_dir(task_name, task_type)
                self.save_task_result(task_result_dir, result, task_name, is_error=True)
            except Exception as save_error:
                logger.error(f"Failed to save error result: {save_error}")
            return result
            
        finally:
            # CRITICAL: Always attempt environment shutdown to clean up sessions
            # This ensures sessions are deleted regardless of success/failure/exception
            try:
                if self.session_id:  # Only attempt shutdown if we have a session
                    logger.info(f"{self._log_prefix()}Cleaning up session in finally block...")
                    shutdown_result = self.shutdown_environment(task_result_dir)
                    
                    # If we have a successful result and shutdown returned recording info, add it
                    if result and result.get("success") and shutdown_result and isinstance(shutdown_result, dict):
                        try:
                            recording_info = shutdown_result.get("recording")
                            if isinstance(recording_info, dict):
                                # Copy and strip large/binary fields
                                clean_info = copy.deepcopy(recording_info)
                                if "data_base64" in clean_info:
                                    clean_info.pop("data_base64", None)
                                # Persist cleaned recording metadata in result
                                result["recording"] = clean_info
                                # Also log a concise summary
                                saved_to = clean_info.get("saved_to")
                                saved_bytes = clean_info.get("saved_bytes")
                                if saved_to:
                                    logger.info(f"Recording saved to: {saved_to} ({saved_bytes if saved_bytes is not None else 'unknown'} bytes)")
                        except Exception as e:
                            logger.warning(f"Failed to process recording info from shutdown: {e}")
                    
                    logger.info(f"{self._log_prefix()}Session cleanup completed")
            except Exception as cleanup_error:
                logger.error(f"Failed to cleanup session in finally block: {cleanup_error}")
                # Even if cleanup fails, we should try to force-delete the session
                try:
                    if self.session_id:
                        logger.warning(f"Attempting force session deletion for {self.session_id}")
                        self.close_session()
                except Exception as force_cleanup_error:
                    logger.error(f"Force session cleanup also failed: {force_cleanup_error}")

def prepare_task_execution_list(task_list_name: str, result_dir: Path, tasks_dir: str = "tasks") -> Dict[str, list]:
    """Load a task list JSON that must reside under tasks/ directory.

    Args:
        task_list_name: The task_list_name should be a filename like 'all_tasks.json' or 'evaluate_time_and_cost.json'.
        result_dir: Result directory path for checking existing results.
        tasks_dir: Directory containing task list files (default: "tasks").
        
    Returns:
        Dict mapping task types to lists of task files, with existing results filtered out.
    """
    tasks_dir = Path(tasks_dir)
    
    # Only allow filename; strip any directories to enforce tasks/ search
    safe_name = Path(task_list_name).name

    task_list_path = tasks_dir / safe_name

    with open(task_list_path, 'r', encoding='utf-8') as f:
        task_list = json.load(f)

    logger.info(f"Loaded task list: {task_list_path}")

    # Skip tasks that already have a result.json
    filtered_task_list: Dict[str, list] = {}
    skipped_counts: Dict[str, int] = {}
    for task_type, tasks in (task_list or {}).items():
        remaining = []
        skipped = 0
        for task_file in tasks:
            # task_file is e.g. "ask_and_echo.json"; convert to task_name for result dir
            task_name = Path(task_file).stem
            result_file = result_dir / task_type / task_name / 'result.json'
            if result_file.exists():
                skipped += 1
                # Do not read the file; only skip based on existence
                logger.info(f"[skip] Existing result detected for [type={task_type}] [task={task_name}] at {result_file}")
                continue
            
            # Clean the task result directory if it exists (for tasks that should not be skipped)
            task_result_dir = result_dir / task_type / task_name
            if task_result_dir.exists():
                shutil.rmtree(task_result_dir)
                logger.info(f"[clean] Cleaned existing result directory for [type={task_type}] [task={task_name}] at {task_result_dir}")
            
            remaining.append(task_file)
        filtered_task_list[task_type] = remaining
        skipped_counts[task_type] = skipped

    # Logging summary after filtering
    total_before = sum(len(v) for v in (task_list or {}).values())
    total_after = sum(len(v) for v in (filtered_task_list or {}).values())
    total_skipped = total_before - total_after
    logger.info(f"Found {len(filtered_task_list)} task types, {total_after} tasks to run (skipped {total_skipped} existing results)")
    for task_type, tasks in filtered_task_list.items():
        logger.info(f"- {task_type}: {len(tasks)} tasks (skipped {skipped_counts.get(task_type, 0)})")

    return filtered_task_list


def run_task_list(run_config: RunConfig) -> None:
    """Run tasks defined by resolved RunConfig (no env re-reads)."""
    # Compute result directory
    model_name = run_config.model
    mode = run_config.mode
    agent_type = run_config.agent
    sanitized_model_name = _sanitize_model_name(model_name)
    result_dir = Path(f"result_{sanitized_model_name}_{mode}_{agent_type}")
    result_dir.mkdir(exist_ok=True)
    setup_project_root_logger(log_dir=str(result_dir), name="scratch_bench")
    logger.info(f"Using result directory: {result_dir}")

    # Extract parameters
    task_list_name = run_config.task_list
    tasks_dir = run_config.tasks_dir
    
    safe_cfg = _mask_api_keys_in_dict(asdict(run_config))
    
    logger.info(f"Run config: {json.dumps(safe_cfg, ensure_ascii=False)}")
    logger.info("=" * 60)
    
    all_tasks = prepare_task_execution_list(task_list_name or "", result_dir, tasks_dir)

    # Stats counters
    total_tasks = 0
    successful_tasks = 0
    failed_tasks = 0
    results = {}

    requested_workers = max(1, int(run_config.parallel or 1))
    max_sessions = max(1, int(run_config.max_sessions or 1))
    parallel_workers = min(requested_workers, max_sessions)
    logger.info(f"Parallel workers set to {parallel_workers} (requested={requested_workers}, max={max_sessions})")
    
    # Helper to spawn a fresh runner per task for isolation when running in parallel
    def _run_with_fresh_runner(task_name: str) -> Dict[str, Any]:
        runner = TaskRunner(run_config=run_config, result_dir=result_dir)
        return runner.run_task(task_name)

    # Execute tasks across all types concurrently using a single global executor
    from concurrent.futures import ThreadPoolExecutor, as_completed
    # Initialize per-type results containers
    for task_type in all_tasks.keys():
        results[task_type] = []

    # Prepare a flattened list of (task_type, task_name)
    flat_tasks = []
    for task_type, task_files in all_tasks.items():
        logger.info(f"Executing {task_type} tasks ({len(task_files)})")
        logger.info("-" * 40)
        for tf in task_files:
            task_name = tf.replace('.json', '')
            flat_tasks.append((task_type, task_name))

    logger.info(f"Running {len(flat_tasks)} tasks across all types in parallel with {parallel_workers} workers...")
    futures = {}

    with ThreadPoolExecutor(max_workers=parallel_workers) as executor:
        for task_type, task_name in flat_tasks:
            total_tasks += 1
            logger.info(f"[{total_tasks}] (queued) [type={task_type}] [task={task_name}] queued for parallel execution")
            fut = executor.submit(_run_with_fresh_runner, task_name)
            futures[fut] = task_type

        for fut in as_completed(futures):
            task_type = futures[fut]
            try:
                result = fut.result()
            except Exception as e:
                result = {"success": False, "error": str(e), "timestamp": int(time.time())}
            if result.get("success"):
                successful_tasks += 1
            else:
                failed_tasks += 1
            results[task_type].append(result)

    # Compute success rate
    success_rate = (successful_tasks / total_tasks * 100) if total_tasks > 0 else 0

    # Print summary
    logger.info("=" * 60)
    logger.info("Batch execution summary")
    logger.info("=" * 60)
    logger.info(f"Total tasks: {total_tasks}")
    logger.info(f"Successful tasks: {successful_tasks}")
    logger.info(f"Failed tasks: {failed_tasks}")
    logger.info(f"Success rate: {success_rate:.2f}%")

    # Per-type statistics
    logger.info("Per-type task statistics:")
    for task_type, type_results in results.items():
        type_success = sum(1 for r in type_results if r["success"])
        type_total = len(type_results)
        type_rate = (type_success / type_total * 100) if type_total > 0 else 0
        logger.info(f"  {task_type}: {type_success}/{type_total} ({type_rate:.1f}%)")

def main():
    import argparse

    parser = argparse.ArgumentParser(description="Scratch Task Runner")
    parser.add_argument("--task_list", help="Run tasks from list JSON under tasks/ (e.g., all_tasks.json)", required=True)
    parser.add_argument("--no_recording", action="store_true", help="Disable video recording")
    parser.add_argument("--mode", choices=["primitive", "composite"], help="Agent mode: primitive or composite", required=True)
    parser.add_argument("--model", type=str, help="LLM model name to use", required=True)
    parser.add_argument("--max_steps", type=int, default=50, help="Maximum agent interaction turns for all tasks (default: 50)")
    parser.add_argument("--use_last_screenshot", action="store_true", help="Only send the latest screenshot to the LLM (filter earlier ones)")
    parser.add_argument("--disable_element_list", action="store_true", help="Disable element list in primitive mode")
    parser.add_argument("--parallel", type=int, default=1, help="Run task lists in parallel with N workers (default 1)")
    parser.add_argument("--agent", choices=["scratch-agent", "agent-s2", "awm"],
                       default="scratch-agent", help="Agent type to use (default: scratch-agent)")
    parser.add_argument("--tasks_dir", type=str, default="tasks", help="Directory containing task list files (default: tasks)")
    parser.add_argument("--env-file", type=str, default=".env", help="Path to .env file to load (default: .env)")
    parser.add_argument("--api_url", type=str, default="http://localhost:8081", help="API URL for scratch bench api")

    args = parser.parse_args()

    load_dotenv(dotenv_path=args.env_file)

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("Missing OPENAI_API_KEY in environment.")
    llm_base_url = os.environ.get("LLM_BASE_URL")
    recording_quality = os.environ.get("RECORDING_QUALITY", "medium")
    max_sessions = int(os.environ.get("MAX_SESSIONS", "1"))
    # Load agent-config.json once and carry it in RunConfig for downstream consumers
    agent_config_file = Path("agent-config.json")
    with open(agent_config_file, "r", encoding="utf-8") as f:
        agent_configs = json.load(f)

    run_config = RunConfig(
        task_list=args.task_list,
        no_recording=bool(args.no_recording),
        mode=args.mode,
        model=args.model,
        max_steps=int(args.max_steps),
        use_last_screenshot=bool(args.use_last_screenshot),
        disable_element_list=bool(args.disable_element_list),
        parallel=int(args.parallel),
        agent=args.agent,
        tasks_dir=args.tasks_dir,
        env_file=args.env_file,
        api_key=api_key,
        llm_base_url=llm_base_url,
        recording_quality=recording_quality,
        max_sessions=max_sessions,
        api_url=args.api_url,
        agent_configs=agent_configs,
    )

    run_task_list(run_config)

if __name__ == "__main__":
    main()
