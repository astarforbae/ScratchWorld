#!/usr/bin/env python3
"""
Shared connection verification helpers for RQ1.
"""

def verify_connection(
    target_info,
    ref_info,
    connection_type,
    id_to_block,
    target_input_name=None,
    target_stack_tail_block_id=None,
    variable_name=None,
    debug=False,
):
    if not target_info or not ref_info:
        return False

    if connection_type == "next":
        if debug:
            print(target_info)
            print(ref_info)
        if target_info.get("parent") == ref_info["id"] and ref_info.get("next") == target_info["id"]:
            return True
    elif connection_type == "parent":
        tail_id = target_stack_tail_block_id or target_info.get("id")
        
        if tail_id and ref_info.get("parent") == tail_id:
            return True
    elif connection_type.startswith("substack"):
        inputs = ref_info.get("inputs", {})
        if debug:
            print(inputs)
            print(target_info["id"])
        key = "SUBSTACK" if connection_type == "substack_1" else "SUBSTACK2"
        if key in inputs:
            inp = inputs[key]
            if inp.get("block") == target_info["id"]:
                return True
    elif connection_type == "input":
        if variable_name:
            if target_info.get("opcode") != "data_variable":
                return False
            fields = target_info.get("fields", {})
            variable_field = fields.get("VARIABLE")
            if isinstance(variable_field, dict):
                actual_name = variable_field.get("value") or variable_field.get("name")
            elif isinstance(variable_field, (list, tuple)) and variable_field:
                actual_name = variable_field[0]
            elif isinstance(variable_field, str):
                actual_name = variable_field
            else:
                actual_name = None
            if actual_name != variable_name:
                return False
        inputs = ref_info.get("inputs", {})
        if target_input_name:
            inp = inputs.get(target_input_name)
            if inp and inp.get("block") == target_info["id"]:
                return True
        else:
            for inp in inputs.values():
                if inp.get("block") == target_info["id"]:
                    return True
    return False
