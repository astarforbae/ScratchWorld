import json
import re
from json_repair import repair_json


def try_parse_json(raw: str):
    raw = raw.strip()
    if not raw:
        return None

    # 1. Try strict JSON parse first
    try:
        return json.loads(raw)
    except Exception:
        pass

    # 2. Heuristic fixes for common LLM errors
    # Fix 1: Missing "y" key in coordinates, e.g. {"x": 156, 304} -> {"x": 156, "y": 304}
    # Matches "x": 123, 456 (with optional whitespace)
    raw = re.sub(r'("x"\s*:\s*-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)', r'\1, "y": \2', raw)

    # 3. Try to repair JSON
    try:
        repaired = repair_json(raw)
        return json.loads(repaired)
    except Exception:
        return None

def extract_action_from_llm_content(content: str):
    if not content:
        return None

    # 1. 处理 ```json ... ```
    json_fenced_blocks = re.findall(
        r"```json\s*(.*?)```",
        content,
        flags=re.IGNORECASE | re.DOTALL
    )
    if json_fenced_blocks:
        parsed = try_parse_json(json_fenced_blocks[0])
        if parsed is not None:
            return parsed

    # 2. 处理 ```...```
    fenced_blocks = re.findall(
        r"```(?:.*?)\n(.*?)```",
        content,
        flags=re.DOTALL
    )
    if not fenced_blocks:
        fenced_blocks = re.findall(
            r"```(.*?)```",
            content,
            flags=re.DOTALL
        )
    if fenced_blocks:
        parsed = try_parse_json(fenced_blocks[0])
        if parsed is not None:
            return parsed

    # 3. 处理 { ... }
    stripped = content.strip()
    brace_objects = []
    stack = []
    start_pos = None
    
    for i, char in enumerate(stripped):
        if char == '{':
            if not stack:
                start_pos = i
            stack.append(i)
        elif char == '}':
            if stack:
                stack.pop()
                if not stack and start_pos is not None:
                    brace_objects.append(stripped[start_pos:i + 1])
                    start_pos = None
    
    if brace_objects:
        parsed = try_parse_json(brace_objects[0])
        if parsed is not None:
            return parsed

    return None
