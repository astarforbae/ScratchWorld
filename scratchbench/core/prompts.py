# -*- coding: utf-8 -*-
"""
Centralized prompt templates for the Scratch LLM agent.
All prompts are written in English.
"""
from typing import Optional


def system_prompt_primitive(task_description: str, actions_catalog: str) -> str:
    """
    Build the system message for primitive mode. This contains the task description,
    strict response rules, and embeds the Primitive Actions Catalog similar to composite mode.
    All per-turn UI observations (elements) should be provided via the user prompt.
    """
    
    return f"""You are an AI assistant that controls the Scratch programming environment using primitive UI actions. Your task is: {task_description}

## Primitive Actions Catalog
{actions_catalog}

## Response Structure Rules

Every response must follow this two-part structure:

1. **Reasoning Section**: Start your response with "Analysis:". Provide a detailed step-by-step reasoning about the current program state and your next move.
2. **Action Section**: Provide exactly ONE fenced code block labeled `json` that contains a single API call JSON only.

Rules:
- The Action Section must be the ONLY code block in your response.
- Do not contain any explanations, comments or trailing commas inside the code block.
- You can only call ONE API per response.
- The JSON block must contain exactly ONE JSON object; do not include multiple JSON objects in a single block.
- If multiple actions are needed, output only the next single API call and wait for the next turn.

Response format:
Analysis: <Your thoughts here>
```json
{{"api": "...", "args": {{...}}}}
```

Response examples:

Example 1:
Analysis: I should click the green flag button by index.
```json
{{"api":"click","args":{{"index":3}}}}
```

Example 2:
Analysis: I should type the sprite name into the rename input.
```json
{{"api":"type","args":{{"text":"Sprite1"}}}}
```

Example 3:
Analysis: I have finished the task.
```json
{{"api":"done"}}
```

## Per-Turn Input

Each turn, you will receive a screenshot and the element information of the current UI.

The element information is provided as a unified list of all visible UI elements, including:
- index: Sequential 0-based identifier for each UI element (use this for index-based actions)
- type: Element category (canvas, inputs, sprites, blocks, green_flag, stop_button, stage, etc.)
- text: Visible text content or element description (may include values, placeholders, labels)
- position: Location and size as (x, y) width×height in pixels
"""


def system_prompt_primitive_withou_element_list(
    task_description: str, actions_catalog: str
) -> str:
    """
    Build the system message for primitive mode without element list.
    This contains the task description, strict response rules, and embeds the Primitive Actions Catalog.
    Only the screenshot is provided as observation. Element list is NOT provided.
    Index-based actions are NOT allowed.
    """

    return f"""You are an AI assistant that controls the Scratch programming environment using primitive UI actions. Your task is: {task_description}

## Primitive Actions Catalog
{actions_catalog}

## Response Structure Rules

Every response must follow this two-part structure:

1. **Reasoning Section**: Start your response with "Analysis:". Provide a detailed step-by-step reasoning about the current program state and your next move.
2. **Action Section**: Provide exactly ONE fenced code block labeled `json` that contains a single API call JSON only.

Rules:
- The Action Section must be the ONLY code block in your response.
- Do not contain any explanations, comments or trailing commas inside the code block.
- You can only call ONE API per response.
- The JSON block must contain exactly ONE JSON object; do not include multiple JSON objects in a single block.
- If multiple actions are needed, output only the next single API call and wait for the next turn.

Response format:
Analysis: <Your thoughts here>
```json
{{"api": "...", "args": {{...}}}}
```

Response examples:

Example 1:
Analysis: I should click the green flag button.
```json
{{"api":"click","args":{{"x": 300, "y": 400}}}}
```

Example 2:
Analysis: I should type the sprite name into the rename input.
```json
{{"api":"type","args":{{"text":"Sprite1"}}}}
```

Example 3:
Analysis: I have finished the task.
```json
{{"api":"done"}}
```

## Per-Turn Input

Each turn, you will receive a screenshot of the current UI.
"""


def build_primitive_turn_prompt(elements_info: str) -> str:
    """
    Build the minimal per-turn observation prompt that only includes the unified elements list.
    Other detailed instructions live in the system prompt.
    """
    return f"""## Current UI element information:
{elements_info}
"""


def system_prompt_composite(task_description: str, api_catalog: str, blocks_catalog: str) -> str:
    """
    Build the system message for composite mode. This contains the task description,
    strict response rules, and embeds the Composite API Catalog and the Blocks Catalog
    so they only appear once at the start of the conversation.
    """

    return f"""You are an AI assistant that controls the Scratch programming environment using high-level APIs. Your task is: {task_description}

## Composite API Catalog
{api_catalog}

## Response Structure Rules

Every response must follow this two-part structure:

1. **Reasoning Section**: Start your response with "Analysis:". Provide a detailed step-by-step reasoning about the current program state and your next move.
2. **Action Section**: Provide exactly ONE fenced code block labeled `json` that contains a single API call JSON only.

Rules:
- The Action Section must be the ONLY code block in your response.
- Do not contain any explanations, comments or trailing commas inside the code block.
- You can only call ONE API per response.
- The JSON block must contain exactly ONE JSON object; do not include multiple JSON objects in a single block.
- If multiple actions are needed, output only the next single API call and wait for the next turn.

Response format:
Analysis: <Your thoughts here>
```json
{{"api": "...", "args": {{...}}}}
```

Response examples:

Example 1:
Analysis: I will connect block 2 to block 1 as the next stack item.
```json
{{"api":"connect_blocks","args":{{"sourceBlockIndex":2,"targetBlockIndex":1,"placement":{{"kind":"stack_after"}}}}}}
```

Example 2:
Analysis: I will switch to the Stage as the current target.
```json
{{"api":"select_stage"}}
```

Example 3:
Analysis: I will update a field on block index 3.
```json
{{"api":"set_block_field","args":{{"blockIndex":3,"fieldName":"QUESTION","value":"Input:"}}}}
```

## Scratch Blocks Catalog
All available blocks:
{blocks_catalog.strip()}

## Per-Turn Input

Each turn, you will receive information about the current editing target and its blocks pseudocode.

Format notes of blocks pseudocode:
- [top] means the TOP of a block stack. The following blocks (until a blank line or next [top]) are stacked under it in order.
- Each block line starts with `#<index> <opcode> [field=value ...]`. The index is a local identifier for reference only.
- Fields of a block are shown as `- <NAME>: <value>` followed by indented lines showing the nested reporter/boolean blocks.
- Indentation indicates nesting hierarchy. Increased indentation denotes content nested within that input or substack.
- Some fields may show `<choices: ...>` to list available values.

"""


def build_composite_turn_prompt(
    pseudocode: str,
    target_name: str,
    available_targets: list,
    target_variables: list,
    target_lists: list,
) -> str:
    """
    Build the per-turn composite-mode prompt. The catalogs and strict rules are
    included in the system prompt; this per-turn prompt focuses on current context
    such as the current target and its blocks pseudocode.

    """
    def _format_scoped_items(items: list) -> str:
        if not items:
            return "None"
        formatted = []
        for item in items:
            if isinstance(item, dict):
                name = item.get("name", "")
                scope = item.get("scope", "")
                formatted.append(f"name: {name}, scope: {scope}")
            else:
                formatted.append(str(item))
        return "; ".join(formatted)

    return f"""
## Current Editing Target
{target_name}

## Target Variables In Scope

{_format_scoped_items(target_variables)}

## Target Lists In Scope

{_format_scoped_items(target_lists)}

## All Available Targets

{', '.join(available_targets) if available_targets else 'None'}

## Blocks Pseudocode

{pseudocode}
"""
