#!/usr/bin/env python3
"""
Coordinate Resize Module

This module provides different coordinate resize strategies for different grounding models.
Each model may have its own way of outputting coordinates that need to be transformed
back to the actual screen dimensions.

For UI-TARS:
    The model uses smart_resize to fit images within min_pixels and max_pixels constraints
    while maintaining aspect ratio. We need to reverse this transformation.

For other models:
    Use identity mapping (no transformation) by default.
"""

import math
from typing import Tuple, List, Protocol, Dict, Any
from abc import ABC, abstractmethod


# ============================================================================
# Constants for UI-TARS smart_resize
# ============================================================================

IMAGE_FACTOR = 28
MIN_PIXELS = 100 * 28 * 28
MAX_PIXELS = 16384 * 28 * 28
MAX_RATIO = 200


# ============================================================================
# Abstract Base Class for Coordinate Resizers
# ============================================================================

class CoordinateResizer(ABC):
    """Abstract base class for coordinate resizers."""
    
    @abstractmethod
    def resize(
        self,
        coordinates: Tuple[int, int],
        original_width: int,
        original_height: int,
    ) -> Tuple[int, int]:
        """
        Resize model output coordinates to actual screen coordinates.
        
        Args:
            coordinates: (x, y) coordinates from model output
            original_width: Original image/screen width
            original_height: Original image/screen height
            
        Returns:
            (x, y) coordinates in actual screen space
        """
        pass
    
    @abstractmethod
    def to_model_space(
        self,
        coordinates: Tuple[int, int],
        original_width: int,
        original_height: int,
    ) -> Tuple[int, int]:
        """
        Convert actual screen coordinates to model coordinate space.
        
        Args:
            coordinates: (x, y) coordinates in actual screen space
            original_width: Original image/screen width
            original_height: Original image/screen height
            
        Returns:
            (x, y) coordinates in model space
        """
        pass

    @abstractmethod
    def get_coordinate_system_prompt(
        self,
        original_width: int,
        original_height: int
    ) -> str:
        """
        Get a string describing the coordinate system for the prompt.
        """
        pass
    
    def resize_drag(
        self,
        start_x: int,
        start_y: int,
        end_x: int,
        end_y: int,
        original_width: int,
        original_height: int,
    ) -> Tuple[int, int, int, int]:
        """
        Resize drag coordinates (start and end points).
        
        Args:
            start_x, start_y: Start coordinates from model output
            end_x, end_y: End coordinates from model output
            original_width: Original image/screen width
            original_height: Original image/screen height
            
        Returns:
            (start_x, start_y, end_x, end_y) in actual screen space
        """
        new_start = self.resize((start_x, start_y), original_width, original_height)
        new_end = self.resize((end_x, end_y), original_width, original_height)
        return (new_start[0], new_start[1], new_end[0], new_end[1])


# ============================================================================
# Identity Resizer (No transformation)
# ============================================================================

class IdentityResizer(CoordinateResizer):
    """
    Identity mapping - no coordinate transformation.
    Use this for models that output coordinates in actual screen space.
    """
    
    def resize(
        self,
        coordinates: Tuple[int, int],
        original_width: int,
        original_height: int,
    ) -> Tuple[int, int]:
        """Return coordinates unchanged."""
        return coordinates
    
    def to_model_space(
        self,
        coordinates: Tuple[int, int],
        original_width: int,
        original_height: int,
    ) -> Tuple[int, int]:
        """Return coordinates unchanged."""
        return coordinates
        
    def get_coordinate_system_prompt(self, original_width: int, original_height: int) -> str:
        return f"{original_width}x{original_height} coordinate system"


# ============================================================================
# UI-TARS Resizer (smart_resize based)
# ============================================================================

class UITarsResizer(CoordinateResizer):
    """
    UI-TARS coordinate resizer.
    
    UI-TARS uses smart_resize to process images before sending to the model.
    The model outputs coordinates in the resized space, so we need to
    transform them back to the original screen space.
    
    The smart_resize algorithm:
    1. Round dimensions to be divisible by IMAGE_FACTOR (28)
    2. If total pixels exceed max_pixels, scale down
    3. If total pixels are below min_pixels, scale up
    4. Maintain aspect ratio as closely as possible
    """
    
    def __init__(
        self,
        factor: int = IMAGE_FACTOR,
        min_pixels: int = MIN_PIXELS,
        max_pixels: int = MAX_PIXELS,
        max_ratio: int = MAX_RATIO,
    ):
        self.factor = factor
        self.min_pixels = min_pixels
        self.max_pixels = max_pixels
        self.max_ratio = max_ratio
    
    def _round_by_factor(self, number: float, factor: int) -> int:
        """Returns the closest integer to 'number' that is divisible by 'factor'."""
        return round(number / factor) * factor
    
    def _ceil_by_factor(self, number: float, factor: int) -> int:
        """Returns the smallest integer >= 'number' that is divisible by 'factor'."""
        return math.ceil(number / factor) * factor
    
    def _floor_by_factor(self, number: float, factor: int) -> int:
        """Returns the largest integer <= 'number' that is divisible by 'factor'."""
        return math.floor(number / factor) * factor
    
    def smart_resize(self, height: int, width: int) -> Tuple[int, int]:
        """
        Calculate the resized dimensions using UI-TARS smart_resize logic.
        
        This replicates the preprocessing that UI-TARS applies to images.
        
        Args:
            height: Original image height
            width: Original image width
            
        Returns:
            (new_height, new_width) after smart_resize transformation
        """
        if height <= 0 or width <= 0:
            raise ValueError(f"Invalid dimensions: height={height}, width={width}")
        
        if max(height, width) / min(height, width) > self.max_ratio:
            raise ValueError(
                f"Absolute aspect ratio must be smaller than {self.max_ratio}, "
                f"got {max(height, width) / min(height, width)}"
            )
        
        h_bar = max(self.factor, self._round_by_factor(height, self.factor))
        w_bar = max(self.factor, self._round_by_factor(width, self.factor))
        
        if h_bar * w_bar > self.max_pixels:
            beta = math.sqrt((height * width) / self.max_pixels)
            h_bar = self._floor_by_factor(height / beta, self.factor)
            w_bar = self._floor_by_factor(width / beta, self.factor)
        elif h_bar * w_bar < self.min_pixels:
            beta = math.sqrt(self.min_pixels / (height * width))
            h_bar = self._ceil_by_factor(height * beta, self.factor)
            w_bar = self._ceil_by_factor(width * beta, self.factor)
        
        return h_bar, w_bar
    
    def resize(
        self,
        coordinates: Tuple[int, int],
        original_width: int,
        original_height: int,
    ) -> Tuple[int, int]:
        """
        Transform coordinates from UI-TARS output space to actual screen space.
        
        Args:
            coordinates: (x, y) coordinates from UI-TARS model output
            original_width: Original screen/image width
            original_height: Original screen/image height
            
        Returns:
            (x, y) coordinates in actual screen space
        """
        model_x, model_y = coordinates
        
        # Get the resized dimensions that the model used
        new_height, new_width = self.smart_resize(original_height, original_width)
        
        # Transform coordinates back to original space
        actual_x = int(model_x / new_width * original_width)
        actual_y = int(model_y / new_height * original_height)
        
        return (actual_x, actual_y)
    
    def to_model_space(
        self,
        coordinates: Tuple[int, int],
        original_width: int,
        original_height: int,
    ) -> Tuple[int, int]:
        """
        Transform coordinates from actual screen space to UI-TARS model space.
        """
        actual_x, actual_y = coordinates
        
        # Get the resized dimensions that the model used
        new_height, new_width = self.smart_resize(original_height, original_width)
        
        # Transform coordinates to model space
        model_x = int(actual_x / original_width * new_width)
        model_y = int(actual_y / original_height * new_height)
        
        return (model_x, model_y)

    def get_coordinate_system_prompt(self, original_width: int, original_height: int) -> str:
        new_height, new_width = self.smart_resize(original_height, original_width)
        return f"{new_width}x{new_height} coordinate system"


# ============================================================================
# Qwen3-VL Resizer (0-1000 normalized coordinates)
# ============================================================================

class Qwen3VLResizer(CoordinateResizer):
    """
    Qwen3-VL coordinate resizer.
    
    Qwen3-VL outputs coordinates normalized to 0-1000 range.
    To convert back to actual screen coordinates:
        actual_x = model_x * (screen_width / 1000)
        actual_y = model_y * (screen_height / 1000)
    
    For example, with a 1280x720 screen:
        x_actual = x_model * 1.28
        y_actual = y_model * 0.72
    """
    
    NORMALIZED_RANGE = 1000  # Qwen3-VL uses 0-1000 coordinate space
    
    def resize(
        self,
        coordinates: Tuple[int, int],
        original_width: int,
        original_height: int,
    ) -> Tuple[int, int]:
        """
        Transform coordinates from Qwen3-VL normalized space (0-1000) to actual screen space.
        
        Args:
            coordinates: (x, y) coordinates from Qwen3-VL model output (0-1000 range)
            original_width: Original screen/image width
            original_height: Original screen/image height
            
        Returns:
            (x, y) coordinates in actual screen space
        """
        model_x, model_y = coordinates
        
        # Scale from 0-1000 normalized space to actual screen dimensions
        actual_x = int(model_x * original_width / self.NORMALIZED_RANGE)
        actual_y = int(model_y * original_height / self.NORMALIZED_RANGE)
        
        return (actual_x, actual_y)
    
    def to_model_space(
        self,
        coordinates: Tuple[int, int],
        original_width: int,
        original_height: int,
    ) -> Tuple[int, int]:
        """
        Transform coordinates from actual screen space to Qwen3-VL normalized space (0-1000).
        """
        actual_x, actual_y = coordinates
        
        # Scale from actual screen dimensions to 0-1000 normalized space
        model_x = int(actual_x * self.NORMALIZED_RANGE / original_width)
        model_y = int(actual_y * self.NORMALIZED_RANGE / original_height)
        
        return (model_x, model_y)

    def get_coordinate_system_prompt(self, original_width: int, original_height: int) -> str:
        return "0-1000 normalized coordinate system"


# ============================================================================
# Factory function to get the appropriate resizer
# ============================================================================

# Model name patterns that require UI-TARS resizing
UITARS_MODEL_PATTERNS = [
    "ui-tars",
    "uitars",
    "ecnu-vl",
    "ecnu_vl",
]

# Model name patterns that require Qwen3-VL resizing (0-1000 normalized)
QWEN3VL_MODEL_PATTERNS = [
    "qwen3-vl",
    "qwen3_vl",
    "qwen3vl",
    "gui-owl-1.5"
]


def get_resizer(model_name: str) -> CoordinateResizer:
    """
    Get the appropriate coordinate resizer for a given model.
    
    Args:
        model_name: Name of the LLM/VLM model being used
        
    Returns:
        An instance of the appropriate CoordinateResizer subclass
    """
    model_name_lower = model_name.lower()
    
    # Check if it's a UI-TARS style model
    for pattern in UITARS_MODEL_PATTERNS:
        if pattern in model_name_lower:
            return UITarsResizer()
    
    # Check if it's a Qwen3-VL style model (0-1000 normalized coordinates)
    for pattern in QWEN3VL_MODEL_PATTERNS:
        if pattern in model_name_lower:
            return Qwen3VLResizer()
    
    # Default to identity mapping for unknown models
    return IdentityResizer()


def resize_action_coordinates(
    action_plan: Dict[str, Any],
    model_name: str,
    screen_width: int,
    screen_height: int,
) -> Dict[str, Any]:
    """
    Convenience function to resize all coordinates in an action plan.
    
    Args:
        action_plan: The action plan dict with 'api' and 'args' keys
        model_name: Name of the model that produced the coordinates
        screen_width: Original screen width
        screen_height: Original screen height
        
    Returns:
        Modified action plan with resized coordinates
    """
    if not action_plan or "args" not in action_plan:
        return action_plan
    
    resizer = get_resizer(model_name)
    args = action_plan["args"]
    
    # Check if this is a drag_and_drop action with coordinates
    if action_plan.get("api") == "drag_and_drop":
        # Resize start coordinates if present
        if "start_x" in args and "start_y" in args:
            new_x, new_y = resizer.resize(
                (args["start_x"], args["start_y"]),
                screen_width,
                screen_height,
            )
            args["start_x"] = new_x
            args["start_y"] = new_y
        
        # Resize end coordinates if present
        if "end_x" in args and "end_y" in args:
            new_x, new_y = resizer.resize(
                (args["end_x"], args["end_y"]),
                screen_width,
                screen_height,
            )
            args["end_x"] = new_x
            args["end_y"] = new_y
    
    # Handle click/scroll actions with single coordinates
    elif action_plan.get("api") in ["click", "scroll", "move_to"]:
        if "x" in args and "y" in args:
            new_x, new_y = resizer.resize(
                (args["x"], args["y"]),
                screen_width,
                screen_height,
            )
            args["x"] = new_x
            args["y"] = new_y
    
    return action_plan


# ============================================================================
# Test code
# ============================================================================

if __name__ == "__main__":
    # Test the resize functionality
    print("Testing coordinate resize module...")
    
    # Test UI-TARS resizer
    print("\n=== UI-TARS Resizer ===")
    uitars = UITarsResizer()
    
    # Example from user's code: 1920x1080 screen
    original_width, original_height = 1920, 1080
    new_height, new_width = uitars.smart_resize(original_height, original_width)
    print(f"Original: {original_width}x{original_height}")
    print(f"Resized (model space): {new_width}x{new_height}")
    
    # Test coordinate transformation
    model_coords = (197, 525)  # Example from user's code
    actual_coords = uitars.resize(model_coords, original_width, original_height)
    print(f"Model coordinates: {model_coords}")
    print(f"Actual coordinates: {actual_coords}")
    
    # Test Qwen3-VL resizer
    print("\n=== Qwen3-VL Resizer ===")
    qwen3vl = Qwen3VLResizer()
    
    # Example: 1280x720 screen with 0-1000 normalized coordinates
    qwen_width, qwen_height = 1280, 720
    model_coords_qwen = (500, 500)  # Center of normalized space
    actual_coords_qwen = qwen3vl.resize(model_coords_qwen, qwen_width, qwen_height)
    print(f"Screen: {qwen_width}x{qwen_height}")
    print(f"Model coordinates (0-1000): {model_coords_qwen}")
    print(f"Actual coordinates: {actual_coords_qwen}")
    print(f"Expected: ({500 * 1280 // 1000}, {500 * 720 // 1000}) = (640, 360)")
    
    # Another example: corner case
    model_coords_qwen2 = (1000, 1000)  # Bottom-right in normalized space
    actual_coords_qwen2 = qwen3vl.resize(model_coords_qwen2, qwen_width, qwen_height)
    print(f"Model coordinates (0-1000): {model_coords_qwen2}")
    print(f"Actual coordinates: {actual_coords_qwen2}")
    print(f"Expected: ({qwen_width}, {qwen_height}) = (1280, 720)")
    
    # Test factory function
    print("\n=== Factory Function ===")
    print(f"ecnu-vl -> {type(get_resizer('ecnu-vl')).__name__}")
    print(f"ui-tars-7b -> {type(get_resizer('ui-tars-7b')).__name__}")
    print(f"qwen3-vl -> {type(get_resizer('qwen3-vl')).__name__}")
    print(f"qwen3_vl_7b -> {type(get_resizer('qwen3_vl_7b')).__name__}")
    print(f"qwen-vl-max -> {type(get_resizer('qwen-vl-max')).__name__}")
    print(f"gpt-4o -> {type(get_resizer('gpt-4o')).__name__}")
    print(f"gemini-2.0 -> {type(get_resizer('gemini-2.0')).__name__}")
    
    # Test action plan resize for Qwen3-VL
    print("\n=== Action Plan Resize (Qwen3-VL) ===")
    action = {
        "api": "drag_and_drop",
        "args": {
            "start_x": 200,
            "start_y": 300,
            "end_x": 800,
            "end_y": 600,
        }
    }
    print(f"Before: {action}")
    resized_action = resize_action_coordinates(
        action, "qwen3-vl", 1920, 1080
    )
    print(f"After (1920x1080): {resized_action}")
    print(f"Expected start: ({200*1920//1000}, {300*1080//1000}) = (384, 324)")
    print(f"Expected end: ({800*1920//1000}, {600*1080//1000}) = (1536, 648)")
