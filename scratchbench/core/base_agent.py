#!/usr/bin/env python
# -*- coding: utf-8 -*-

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional


class AgentPredictionException(Exception):
    """
    Exception raised when an agent fails to make a prediction due to LLM API failures.
    
    This exception should be raised when the underlying LLM service is unavailable,
    returns an error, or fails after all retries. It indicates a fatal error that
    should terminate the interaction loop.
    
    This is distinct from returning None, which indicates the agent couldn't generate
    a valid action for other reasons (e.g., parsing failures, invalid state).
    """
    pass


class BaseAgent(ABC):
    """
    抽象 Agent 基类
    
    定义了所有 Agent 实现必须遵循的接口。Agent 只负责推理和决策，
    不管理环境交互，环境交互由 TaskRunner 协调。
    """
    
    @abstractmethod
    def initialize(self, task_description: str, documentation: Dict[str, Any]) -> None:
        """
        初始化 Agent 以执行特定任务
        
        Args:
            task_description: 任务描述，告诉 Agent 要完成什么任务
            documentation: 环境文档，包含API目录和操作说明
        """
        pass
    
    @abstractmethod
    def predict(self, observation: Dict[str, Any], turn: int = 0) -> Optional[Dict[str, Any]]:
        """
        根据当前观察预测下一步动作
        
        这是 Agent 的核心方法，接收环境观察，返回要执行的动作。
        
        Args:
            observation: 环境观察，包含：
                - screenshot: base64编码的截图（primitive模式）
                - elements: 页面元素信息（primitive模式）  
                - pseudocode: 当前伪代码（composite模式）
                - targetName: 目标名称（composite模式）
                - 其他环境相关信息
            turn: 当前交互轮次，从0开始
            
        Returns:
            动作计划字典，包含：
            - api: 动作类型（如"click", "drag", "done", "failed"等）
            - 其他动作相关参数
            
            返回None表示Agent无法产生有效动作
            
        Raises:
            AgentPredictionException: 当LLM API调用失败时抛出，提前终止交互循环
        """
        pass