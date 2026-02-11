import json
import re
from typing import List
import time
import tiktoken

from typing import Tuple, List, Union, Dict

from pydantic import BaseModel, ValidationError

import pickle
import logging
logger = logging.getLogger("scratch_bench.common_utils")


class Node(BaseModel):
    name: str
    info: str


class Dag(BaseModel):
    nodes: List[Node]
    edges: List[List[Node]]


NUM_IMAGE_TOKEN = 1105  # Value set of screen of size 1920x1080 for openai vision


def _sanitize_messages_for_logging(messages):
    """Replace base64 image data with placeholder text to avoid huge logs.
    
    Based on the message structure from mllm.py's add_message function.
    Messages contain content arrays with items that can be:
    - {"type": "text", "text": "..."}
    - {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
    - {"type": "image", "source": {"type": "base64", "data": "..."}}
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
                        # Replace base64 data with placeholder
                        item["image_url"]["url"] = "<base64_image_data_omitted>"
            
            # Handle Anthropic style: image with source
            elif item.get("type") == "image":
                if "source" in item and isinstance(item["source"], dict):
                    if item["source"].get("type") == "base64":
                        item["source"]["data"] = "<base64_image_data_omitted>"
    
    return sanitized


def call_llm_safe(agent, agent_name: str = "unknown"):
    # Retry if fails
    max_retries = 3  # Set the maximum number of retries
    attempt = 0
    response = ""
    
    # Log the request at DEBUG level (will go to debug.log only)
    logger.debug("=" * 80)
    logger.debug(f"Agent Name: {agent_name}")
    
    # Sanitize messages to replace base64 image data with placeholders
    sanitized_messages = _sanitize_messages_for_logging(agent.messages)
    logger.debug(f"Messages: {sanitized_messages}")
    logger.debug("-" * 80)
    
    while attempt < max_retries:
        try:
            response = agent.get_response()
            
            # Log the response at DEBUG level (will go to debug.log only)
            logger.debug("LLM Response:")
            logger.debug(f"Response: {response}")
            logger.debug("=" * 80)
            
            break  # If successful, break out of the loop
        except Exception as e:
            attempt += 1
            logger.warning(f"[{agent_name}] LLM request attempt {attempt} failed: {e}")
            if attempt == max_retries:
                logger.error(f"[{agent_name}] LLM request failed after {max_retries} attempts")
                logger.debug("=" * 80)
        time.sleep(1.0)
    return response.choices[0].message.content


def calculate_tokens(messages, num_image_token=NUM_IMAGE_TOKEN) -> Tuple[int, int]:

    num_input_images = 0
    output_message = messages[-1]

    input_message = messages[:-1]

    input_string = """"""
    for message in input_message:
        input_string += message["content"][0]["text"] + "\n"
        if len(message["content"]) > 1:
            num_input_images += 1

    input_text_tokens = get_input_token_length(input_string)

    input_image_tokens = num_image_token * num_input_images

    output_tokens = get_input_token_length(output_message["content"][0]["text"])

    return (input_text_tokens + input_image_tokens), output_tokens


# Code based on https://github.com/xlang-ai/OSWorld/blob/main/mm_agents/agent.py


def parse_dag(text):
    pattern = r"<json>(.*?)</json>"
    match = re.search(pattern, text, re.DOTALL)
    if match:
        json_str = match.group(1)
        try:
            json_data = json.loads(json_str)
            return Dag(**json_data["dag"])
        except json.JSONDecodeError:
            print("Error: Invalid JSON")
            return None
        except KeyError:
            print("Error: 'dag' key not found in JSON")
            return None
        except ValidationError as e:
            print(f"Error: Invalid data structure - {e}")
            return None
    else:
        print("Error: JSON not found")
        return None


def parse_dag(text):
    """
    Try extracting JSON from <json>…</json> tags first;
    if not found, try ```json … ``` Markdown fences.
    """

    def _extract(pattern):
        m = re.search(pattern, text, re.DOTALL)
        return m.group(1).strip() if m else None

    # 1) look for <json>…</json>
    json_str = _extract(r"<json>(.*?)</json>")
    # 2) fallback to ```json … ```
    if json_str is None:
        json_str = _extract(r"```json\s*(.*?)\s*```")

    if json_str is None:
        print("Error: JSON not found in either <json> tags or ```json``` fence")
        return None

    try:
        payload = json.loads(json_str)
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON ({e})")
        return None

    if "dag" not in payload:
        print("Error: 'dag' key not found in JSON")
        return None

    try:
        return Dag(**payload["dag"])
    except ValidationError as e:
        print(f"Error: Invalid data structure - {e}")
        return None


def parse_single_code_from_string(input_string):
    input_string = input_string.strip()
    if input_string.strip() in ["WAIT", "DONE", "FAIL"]:
        return input_string.strip()

    # This regular expression will match both ```code``` and ```python code```
    # and capture the `code` part. It uses a non-greedy match for the content inside.
    pattern = r"```(?:\w+\s+)?(.*?)```"
    # Find all non-overlapping matches in the string
    matches = re.findall(pattern, input_string, re.DOTALL)

    # The regex above captures the content inside the triple backticks.
    # The `re.DOTALL` flag allows the dot `.` to match newline characters as well,
    # so the code inside backticks can span multiple lines.

    # matches now contains all the captured code snippets

    codes = []

    for match in matches:
        match = match.strip()
        commands = [
            "WAIT",
            "DONE",
            "FAIL",
        ]  # fixme: updates this part when we have more commands

        if match in commands:
            codes.append(match.strip())
        elif match.split("\n")[-1] in commands:
            if len(match.split("\n")) > 1:
                codes.append("\n".join(match.split("\n")[:-1]))
            codes.append(match.split("\n")[-1])
        else:
            codes.append(match)

    if len(codes) <= 0:
        return "fail"
    return codes[0]


def get_input_token_length(input_string):
    enc = tiktoken.encoding_for_model("gpt-4")
    tokens = enc.encode(input_string)
    return len(tokens)


def sanitize_code(code):
    # This pattern captures the outermost double-quoted text
    if "\n" in code:
        pattern = r'(".*?")'
        # Find all matches in the text
        matches = re.findall(pattern, code, flags=re.DOTALL)
        if matches:
            # Replace the first occurrence only
            first_match = matches[0]
            code = code.replace(first_match, f'"""{first_match[1:-1]}"""', 1)
    return code


def extract_first_agent_function(code_string):
    # Regular expression pattern to match 'agent' functions with any arguments, including nested parentheses
    pattern = r'agent\.[a-zA-Z_]+\((?:[^()\'"]|\'[^\']*\'|"[^"]*")*\)'

    # Find all matches in the string
    matches = re.findall(pattern, code_string)

    # Return the first match if found, otherwise return None
    return matches[0] if matches else None


def load_knowledge_base(kb_path: str) -> Dict:
    try:
        with open(kb_path, "r") as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading knowledge base: {e}")
        return {}


def load_embeddings(embeddings_path: str) -> Dict:
    try:
        with open(embeddings_path, "rb") as f:
            return pickle.load(f)
    except Exception as e:
        print(f"Error loading embeddings: {e}")
        return {}


def save_embeddings(embeddings_path: str, embeddings: Dict):
    try:
        with open(embeddings_path, "wb") as f:
            pickle.dump(embeddings, f)
    except Exception as e:
        print(f"Error saving embeddings: {e}")
