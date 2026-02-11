#!/usr/bin/env python
# -*- coding: utf-8 -*-

import json
import logging
import os
import platform
import time
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any
from io import BytesIO
import base64

from .base_agent import BaseAgent, AgentPredictionException

from gui_agents.s2.agents.grounding import ScratchWorldACI
from gui_agents.s2.agents.agent_s import AgentS2 as OriginalAgentS2
from gui_agents.s2.memory.procedural_memory import PROCEDURAL_MEMORY

logger = logging.getLogger("scratch_bench.agent_s")



class AgentS(BaseAgent):    
    """
    Agent-S 在 ScratchBench 环境中的实现
    继承 BaseAgent，适配 ScratchBench 的接口规范
    """
    
    def __init__(
        self,
        platform: str = "linux",
        action_space: str = "pyautogui",
        observation_type: str = "mixed",
        search_engine: Optional[str] = None,
        memory_root_path: Optional[str] = None,
        use_default_kb: bool = False,
        memory_folder_name: str = "kb_s2",
        kb_release_tag: str = "v0.2.2",
        embedding_engine_type: str = "openai",
        embedding_engine_params: Dict = {},
        engine_params: Dict = {},
        grounding_engine_params: Dict = {},
        mode: str = "primitive",  # "primitive" | "composite"
    ):
        """
        初始化 Agent-S
        
        Args:
            platform: 平台名称
            action_space: 动作空间类型
            observation_type: 观察类型
            search_engine: 搜索引擎
            memory_root_path: 记忆根路径
            use_default_kb: 是否使用默认知识库
            memory_folder_name: 记忆文件夹名称
            kb_release_tag: 知识库版本标签
            embedding_engine_type: 嵌入引擎类型
            embedding_engine_params: 嵌入引擎参数（包含 api_key, model, base_url 等）
            engine_params: 主生成模型引擎参数（包含 engine_type, model, base_url, api_key 等）
            grounding_engine_params: Grounding 模型引擎参数（包含 engine_type, model, base_url, api_key 等）
            mode: 代理模式
        """
        self.platform = platform
        
        # 记忆和知识库配置
        if memory_root_path is None:
            memory_root_path = os.getcwd()
        self.memory_root_path = memory_root_path
        self.memory_folder_name = memory_folder_name
        self.use_default_kb = use_default_kb
        self.kb_release_tag = kb_release_tag
        
        # 其他配置
        self.action_space = action_space
        self.observation_type = observation_type
        self.search_engine = search_engine
        self.mode = str(mode).strip()
        if self.mode not in ("primitive", "composite"):
            raise ValueError(f"Invalid mode: {self.mode!r}. Expected 'primitive' or 'composite'.")
        
        # 保存传入的引擎参数
        self.engine_params = engine_params
        self.grounding_engine_params = grounding_engine_params
        
        # 嵌入引擎配置
        self.embedding_engine_params = embedding_engine_params
        self.embedding_engine_type = embedding_engine_type
        
        self.session_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # 状态变量
        # self._agent_s2: Optional[OriginalAgentS2] = None
        # self._grounding_agent: Optional[ScratchBenchACI] = None
        # self._task_description: str = ""
        # self._documentation: Optional[Dict[str, Any]] = None
        
        # 交互历史（用于兼容 ScratchBench 的日志格式）
        # TODO 没有用来更新Agent S的上下文，需要更改
        self.conversation_history = []
    
    def initialize(self, task_description: str, documentation: Dict[str, Any]) -> None:
        """
        初始化 Agent 以执行特定任务
        
        Args:
            task_description: 任务描述
            documentation: 环境文档
        """
        logger.info(f"Initializing Agent-S for task: {task_description}")
        
        self._task_description = task_description
        self._documentation = documentation

        procedural_memory = PROCEDURAL_MEMORY(mode=self.mode, documentation=documentation, task_description=self._task_description)
        
        # 创建 Grounding Agent（使用自定义的 ScratchBenchACI）
        self._grounding_agent = ScratchWorldACI(
            platform=self.platform,
            engine_params_for_generation=self.engine_params,
            engine_params_for_grounding=self.grounding_engine_params,
            width=1280,  # 默认屏幕宽度
            height=720, # 默认屏幕高度
        )
        
        # 创建 Agent-S2 实例
        self._agent_s2 = OriginalAgentS2(
            engine_params=self.engine_params,
            grounding_agent=self._grounding_agent,
            platform=self.platform,
            action_space=self.action_space,
            observation_type=self.observation_type,
            search_engine=self.search_engine,
            memory_root_path=self.memory_root_path,
            use_default_kb=self.use_default_kb,
            memory_folder_name=self.memory_folder_name,
            kb_release_tag=self.kb_release_tag,
            embedding_engine_type=self.embedding_engine_type,
            embedding_engine_params=self.embedding_engine_params,
            procedural_memory=procedural_memory,
            auto_update_memory=True
        )
        
        self._agent_s2.reset()
        logger.info("Agent-S initialization completed")
    
    def predict(self, observation: Dict[str, Any], turn: int = 0) -> Optional[Dict[str, Any]]:
        """
        根据当前观察预测下一步动作
        
        Args:
            observation: 环境观察
            turn: 当前交互轮次
            
        Returns:
            动作计划字典或 None
        """
        
        try:
            logger.info(f"Agent-S predicting action for turn {turn}")
            
            # 转换观察格式
            # agent_s_obs = self._convert_observation_to_agent_s_format(observation)
            
            # 调用 Agent-S 的 predict 方法
            # TODO DONE和FAILED可能不会触发
            info, action = self._agent_s2.predict(
                instruction=self._task_description,
                observation=observation
            )
            
            logger.debug(f"Actions: {action}")
            logger.debug(f"Info: {info}")
            
            # 记录到对话历史（兼容 ScratchBench 日志格式）
            self.conversation_history.append({
                "role": "user",
                "content": f"Turn {turn}: Observation received",
                "observation_keys": list(observation.keys()),
                "turn": turn
            })
            
            if action:
                self.conversation_history.append({
                    "role": "assistant", 
                    "content": f"Predicted action: {action['api']}",
                    "action": action,
                    "agent_s_info": info
                })
            
            return action
            
        except Exception as e:
            logger.error(f"Error in Agent-S predict: {e}", exc_info=True)
            # check if "'str' object has no attribute 'choices'"" in error message
            if "'str' object has no attribute 'choices'" in str(e) or "404 client error" in str(e).lower():
                raise AgentPredictionException(f"LLM API call failed in Agent-S: {e}") from e
            return None
    
    def reset(self) -> None:
        """重置 Agent 状态"""
        if self._agent_s2 is not None:
            self._agent_s2.reset()
        
        # 重置对话历史
        self.conversation_history = []
        
        logger.info("Agent-S state reset")
    
    """
    Below are redundant functions
    """
    
    def get_memory_stats(self) -> Dict[str, Any]:
        """获取记忆统计信息"""
        if self._agent_s2 is None:
            return {}
        
        try:
            # 尝试获取记忆统计
            stats = {
                "session_id": self.session_id,
                "memory_folder": self.memory_folder_name,
                "platform": self.platform,
                "embedding_engine": self.embedding_engine_type,
                "interactions_count": 0,
                "conversation_length": len(self.conversation_history)
            }
            
            # 检查记忆文件是否存在
            memory_path = os.path.join(self.memory_root_path, self.memory_folder_name, self.platform)
            if os.path.exists(memory_path):
                files = os.listdir(memory_path)
                stats["memory_files"] = files
                stats["memory_path"] = memory_path
            
            return stats
        except Exception as e:
            logger.error(f"Error getting memory stats: {e}")
            return {"error": str(e)}
        
    # def save_interaction_log(self, filepath: Optional[str] = None) -> str:
    #     """
    #     保存交互日志
        
    #     Args:
    #         filepath: 可选的文件路径
            
    #     Returns:
    #         保存的文件路径
    #     """
    #     if filepath is None:
    #         filepath = os.path.join(self.log_dir, f"agent_s_interaction_log_{self.session_id}.json")
        
    #     # 创建目录（如果不存在）
    #     os.makedirs(os.path.dirname(filepath), exist_ok=True)
        
    #     # 添加结束时间
    #     self.interaction_log["end_time"] = datetime.now().isoformat()
        
    #     # 保存日志
    #     with open(filepath, 'w', encoding='utf-8') as f:
    #         json.dump(self.interaction_log, f, indent=2, ensure_ascii=False)
        
    #     logger.info(f"Interaction log saved to: {filepath}")
    #     return filepath
    
    def _convert_observation_to_agent_s_format(self, observation: Dict[str, Any]) -> Dict[str, Any]:
        """
        将 ScratchBench 的观察格式转换为 Agent-S 格式
        
        Args:
            observation: ScratchBench 格式的观察
            
        Returns:
            Agent-S 格式的观察
        """
        agent_s_obs = {}
        
        # 转换截图数据
        if "screenshot" in observation:
            screenshot_b64 = observation["screenshot"]
            if isinstance(screenshot_b64, str):
                # 如果是 base64 字符串，转换为字节
                try:
                    screenshot_bytes = base64.b64decode(screenshot_b64)
                    agent_s_obs["screenshot"] = screenshot_bytes
                except Exception as e:
                    logger.error(f"Failed to decode screenshot: {e}")
                    agent_s_obs["screenshot"] = screenshot_b64.encode() if isinstance(screenshot_b64, str) else screenshot_b64
            else:
                agent_s_obs["screenshot"] = screenshot_b64
        
        # 转换元素信息
        if "elements" in observation:
            agent_s_obs["elements"] = observation["elements"]
        
        # 转换其他信息
        for key, value in observation.items():
            if key not in ["screenshot", "elements"]:
                agent_s_obs[key] = value
        
        return agent_s_obs
    
        
    def _convert_agent_s_actions_to_scratch_format(self, info: Dict, actions: List[str]) -> Optional[Dict[str, Any]]:
        """
        将 Agent-S 的动作转换为 ScratchBench 格式
        
        Args:
            info: Agent-S 返回的信息字典
            actions: Agent-S 返回的动作列表
            
        Returns:
            ScratchBench 格式的动作字典
        """
        if not actions or len(actions) == 0:
            return None
        
        action_code = actions[0]
        
        # 检查特殊动作类型
        if action_code == "DONE" or "agent.done()" in action_code:
            return {
                "api": "done",
                "message": "Task completed successfully"
            }
        elif action_code == "FAIL" or "agent.fail()" in action_code:
            return {
                "api": "failed", 
                "message": "Task failed"
            }
        elif action_code == "WAIT" or "time.sleep(" in action_code:
            return {
                "api": "wait",
                "duration": 1.0  # 默认等待时间
            }
        else:
            # 普通动作 - 执行 Python 代码
            return {
                "api": "execute_code",
                "code": action_code,
                "subtask": info.get("subtask", ""),
                "subtask_info": info.get("subtask_info", ""),
                "subtask_status": info.get("subtask_status", ""),
                "reflection": info.get("reflection", ""),
                "executor_plan": info.get("executor_plan", "")
            }
