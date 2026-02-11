/**
 * Set a field value on a block
 */
(payload) => {
  // --- Phase 3: Enhanced shadow block management and mapping ---
  const FIELD_TO_SHADOW_MAP = {
    'NUM': 'math_number',
    'TEXT': 'text',
    'COLOUR': 'colour_picker',
    'COLOR': 'colour_picker',
    'ANGLE': 'math_angle',
    'BROADCAST_OPTION': 'event_broadcast_menu',
    'CLONE_OPTION': 'control_create_clone_of_menu',
    'KEY_OPTION': 'event_whenkeypressed_menu',
    'TOUCHINGOBJECTMENU': 'sensing_touchingobjectmenu',
    'DISTANCETOMENU': 'sensing_distancetomenu',
    'SOUND_MENU': 'sound_sounds_menu',
    'COSTUME': 'looks_costume',
    'BACKDROP': 'looks_backdrops'
  };

  function fieldToShadowType(fieldName) {
    const n = String(fieldName || '').toUpperCase();
    return FIELD_TO_SHADOW_MAP[n] || null;
  }

  function inferShadowFromInputAndField(inputName, fieldName) {
    // First try field-based mapping
    let shadowType = fieldToShadowType(fieldName);
    if (shadowType) return shadowType;

    // Fallback to input-name based inference
    if (typeof inferShadowTypeForInputName === 'function') {
      try {
        return inferShadowTypeForInputName(inputName);
      } catch (e) {
        // Ignore errors, continue with default
      }
    }

    // Final fallback based on common patterns
    const inp = String(inputName || '').toUpperCase();
    const fld = String(fieldName || '').toUpperCase();
    
    if (inp.includes('COLOR') || inp.includes('COLOUR') || fld.includes('COLOR') || fld.includes('COLOUR')) {
      return 'colour_picker';
    }
    if (inp.includes('ANGLE') || inp.includes('DIRECTION') || inp.includes('DEGREES')) {
      return 'math_angle';
    }
    if (fld === 'TEXT' || inp.includes('MESSAGE') || inp.includes('STRING') || inp.includes('TEXT')) {
      return 'text';
    }
    
    return 'math_number'; // Safe default for most numeric inputs
  }

  function findRootField(block, fieldName) {
    // Enhanced root field detection - look for fields anywhere on the block
    
    // Method 1: Try the direct getField method first (most reliable)
    if (block.getField && typeof block.getField === 'function') {
      try {
        const field = block.getField(fieldName);
        if (field) {
          console.log(`[DEBUG] Found field '${fieldName}' using direct getField method`);
          return { input: null, field: field };
        }
      } catch (e) {
        // Field doesn't exist, continue with other methods
      }
    }
    
    // Method 2: Search through all inputs (including dummy inputs)
    const inputs = Array.isArray(block.inputList) ? block.inputList : [];
    for (const inp of inputs) {
      const row = inp && inp.fieldRow;
      if (Array.isArray(row)) {
        for (const fld of row) {
          if (fld && typeof fld.getName === 'function' && fld.getName() === fieldName) {
            console.log(`[DEBUG] Found field '${fieldName}' in input fieldRow`);
            return { input: inp, field: fld };
          }
        }
      }
    }
    
    // Method 3: Check if the block has a fields property (some blocks store fields differently)
    if (block.fields && typeof block.fields === 'object') {
      const field = block.fields[fieldName];
      if (field) {
        console.log(`[DEBUG] Found field '${fieldName}' in block.fields`);
        return { input: null, field: field };
      }
    }
    
    console.log(`[DEBUG] Field '${fieldName}' not found on block`);
    return null;
  }

  function autoDetectFieldLocation(block, inputName) {
    // NEW APPROACH: Treat the parameter as an INPUT NAME, not a field name
    
    // 1) First check if there's a root field with this exact name (for backwards compatibility)
    const rootHit = findRootField(block, inputName);
    if (rootHit) {
      return { found: true, location: 'root', inputName: null, targetBlock: block, fieldName: inputName };
    }

    // 2) Look for an input with the specified name
    const inputs = Array.isArray(block.inputList) ? block.inputList : [];
    for (const inp of inputs) {
      const name = inp && inp.name;
      const hasConn = !!(inp && inp.connection);
      
      // Check if this is the input we're looking for
      if (name === inputName && hasConn) {
        const connected = inp.connection && inp.connection.targetBlock && inp.connection.targetBlock();
        if (connected) {
          // Found existing shadow block on this input
          // Determine the primary field name for this shadow block type
          const primaryField = getPrimaryFieldForShadowBlock(connected);
          if (primaryField) {
            return { 
              found: true, 
              location: 'input', 
              inputName: name, 
              targetBlock: connected, 
              fieldName: primaryField 
            };
          }
        } else {
          // Input exists but no shadow connected - we can create one
          return { 
            found: false, 
            canCreate: true, 
            inputName: name, 
            targetInput: inp 
          };
        }
      }
    }

    // 3) Input not found
    return { found: false, canCreate: false };
  }

  function getPrimaryFieldForShadowBlock(shadowBlock) {
    // Determine the primary field name based on shadow block type
    const blockType = shadowBlock.type;
    const fieldMap = {
      // Numeric input shadows
      'math_number': 'NUM',
      'math_positive_number': 'NUM', 
      'math_angle': 'NUM',
      
      // Text input shadows
      'text': 'TEXT',
      
      // Color input shadows
      'colour_picker': 'COLOUR',
      
      // Menu/dropdown shadows - these have their own specific field names
      'event_broadcast_menu': 'BROADCAST_OPTION',
      'control_create_clone_of_menu': 'CLONE_OPTION',
      'event_whenkeypressed_menu': 'KEY_OPTION',
      'sensing_touchingobjectmenu': 'TOUCHINGOBJECTMENU',
      'sensing_distancetomenu': 'DISTANCETOMENU',
      'sound_sounds_menu': 'SOUND_MENU',
      'looks_costume': 'COSTUME',
      'looks_backdrops': 'BACKDROP',
      
      // Motion menu shadows
      'motion_pointtowards_menu': 'TOWARDS',
      'motion_goto_menu': 'TO',
      'motion_glideto_menu': 'TO',
      
      // Sensing menu shadows  
      'sensing_keyoptions': 'KEY_OPTION',
      'sensing_of_object_menu': 'OBJECT',
      
      // Other common menu shadows
      'operator_mathop_menu': 'MATHOP',
      'looks_effectmenu': 'EFFECT',
      'data_variable': 'VARIABLE',
      'data_listcontents': 'LIST'
    };
    
    // If we don't have a specific mapping, try to infer from the block type
    const mapped = fieldMap[blockType];
    if (mapped) return mapped;
    
    // Fallback: try to find the first field on the shadow block
    if (shadowBlock.inputList && shadowBlock.inputList.length > 0) {
      for (const input of shadowBlock.inputList) {
        if (input.fieldRow && input.fieldRow.length > 0) {
          for (const field of input.fieldRow) {
            if (field && typeof field.getName === 'function') {
              const fieldName = field.getName();
              if (fieldName) {
                console.log(`[DEBUG] Auto-detected field '${fieldName}' for shadow block type '${blockType}'`);
                return fieldName;
              }
            }
          }
        }
      }
    }
    
    // Final fallback
    console.log(`[DEBUG] No field mapping found for shadow block type '${blockType}', using 'NUM' as fallback`);
    return 'NUM';
  }

  function ensureBroadcastMessageExists(workspace, messageName) {
    // Check if broadcast message already exists
    const existingMessages = workspace.getAllVariables ? workspace.getAllVariables() : [];
    for (const variable of existingMessages) {
      if (variable.type === 'broadcast_msg' && variable.name === messageName) {
        return variable.getId();
      }
    }
    
    // Try alternative method to get broadcast messages
    if (workspace.getVariableMap) {
      const variableMap = workspace.getVariableMap();
      if (variableMap.getVariablesOfType) {
        const broadcasts = variableMap.getVariablesOfType('broadcast_msg');
        for (const broadcast of broadcasts) {
          if (broadcast.name === messageName) {
            return broadcast.getId();
          }
        }
      }
    }
    
    // Create new broadcast message if it doesn't exist
    try {
      let newBroadcast;
      if (workspace.createVariable) {
        newBroadcast = workspace.createVariable(messageName, 'broadcast_msg');
      } else if (workspace.getVariableMap && workspace.getVariableMap().createVariable) {
        const variableMap = workspace.getVariableMap();
        newBroadcast = variableMap.createVariable(messageName, 'broadcast_msg');
      }
      
      if (newBroadcast) {
        console.log('[DEBUG] Created new broadcast message:', messageName, 'with ID:', newBroadcast.getId());
        return newBroadcast.getId();
      }
    } catch (e) {
      console.log('[DEBUG] Failed to create broadcast message:', e);
    }
    
    // Fallback: return the message name itself
    console.log('[DEBUG] Using message name as fallback ID:', messageName);
    return messageName;
  }

  function setBlockField({ blockId, value, fieldName = null, blockIndex = null }) {
    const ws = getWorkspace();
    if (!blockId) return createError('INVALID_ARG', 'blockId is required');
    if (value === undefined) return createError('INVALID_ARG', 'value is required');
    if (!fieldName) return createError('INVALID_ARG', 'fieldName is required');

    const block = ws.getBlockById(blockId);
    if (!block) return createError('NOT_FOUND', `Block not found: ${blockId}`);

    // Simplified API path only
    const inputNameStr = String(fieldName); // Treat fieldName as inputName

    // Try to locate the input and its shadow block
    const detected = autoDetectFieldLocation(block, inputNameStr);

    if (!detected.found) {
      // Check if we can create a shadow block
      if (detected.canCreate && detected.targetInput) {
        console.log('[DEBUG] Creating shadow block for input:', detected.inputName);
        
        // Infer appropriate shadow type for this input
        let shadowType = inferShadowFromInputAndField(detected.inputName, null);
        if (!shadowType) {
          return createError('UNSUPPORTED', `Cannot determine shadow type for input '${detected.inputName}'`);
        }

        // Create the shadow block
        const shadow = ws.newBlock(shadowType);
        shadow.setShadow(true);
        try { shadow.initSvg(); shadow.render(); } catch (e) {}

        // Get the primary field for this shadow type
        const primaryFieldName = getPrimaryFieldForShadowBlock(shadow);
        const targetField = shadow.getField && shadow.getField(primaryFieldName);
        
        if (!shadow.outputConnection || !targetField) {
          try { shadow.dispose && shadow.dispose(false); } catch (e) {}
          return createError('SHADOW_CREATE_FAILED', `Failed to create shadow block of type '${shadowType}'`);
        }

        // Connect the shadow to the input
        try { 
          detected.targetInput.connection.connect(shadow.outputConnection); 
        } catch (e) {
          try { shadow.dispose && shadow.dispose(false); } catch (e2) {}
          return createError('CONNECTION_FAILED', `Failed to connect shadow block: ${e.message}`);
        }

        // Set the field value with special handling for broadcast messages
        const originalValue = String(value);
        let translatedValue = originalValue;
        
        // Special handling for broadcast fields
        if (primaryFieldName === 'BROADCAST_OPTION' || detected.inputName === 'BROADCAST_INPUT') {
          try {
            // Ensure the broadcast message exists
            const broadcastId = ensureBroadcastMessageExists(ws, originalValue);
            if (broadcastId) {
              translatedValue = broadcastId;
            }
          } catch (e) {
            console.log('[DEBUG] Failed to create/find broadcast message:', e);
          }
        }
        
        // Handle dropdown translation for other field types
        if (typeof targetField.getOptions === 'function') {
          try {
            const options = targetField.getOptions();
            if (Array.isArray(options)) {
              const match = options.find(opt => Array.isArray(opt) && opt[0] === originalValue);
              if (match && match.length >= 2) translatedValue = match[1];
            }
          } catch (e) {}
        }
        
        targetField.setValue(String(translatedValue));

        return createSuccess({
          updated: 1,
          blockIndex: blockIndex,
          fieldName: inputNameStr,
          value: String(value)
        });
      }

      // Input not found at all
      const inputs = Array.isArray(block.inputList) ? block.inputList : [];
      return createError('INPUT_NOT_FOUND', `Input '${inputNameStr}' not found on block ${block.type}. Available inputs: ${inputs.map(i => i.name).filter(Boolean).join(', ') || 'none'}`);
    }

    // Found existing shadow block with field
    const targetBlock = detected.targetBlock;
    const actualFieldName = detected.fieldName;
    const field = targetBlock.getField && targetBlock.getField(actualFieldName);
    
    if (!field) {
      return createError('INVALID_FIELD', `Field '${actualFieldName}' not found on shadow block ${targetBlock.type}`);
    }

    try {
      // Set the field value with special handling for broadcast messages
      const originalValue = String(value);
      let translatedValue = originalValue;
      
      // Special handling for broadcast fields
      if (actualFieldName === 'BROADCAST_OPTION' || detected.inputName === 'BROADCAST_INPUT') {
        try {
          // Ensure the broadcast message exists
          const broadcastId = ensureBroadcastMessageExists(ws, originalValue);
          if (broadcastId) {
            translatedValue = broadcastId;
          }
        } catch (e) {
          console.log('[DEBUG] Failed to create/find broadcast message:', e);
        }
      }
      
      // Handle dropdown translation for other field types
      if (typeof field.getOptions === 'function') {
        try {
          const options = field.getOptions();
          if (Array.isArray(options)) {
            const match = options.find(opt => Array.isArray(opt) && opt[0] === originalValue);
            if (match && match.length >= 2) translatedValue = match[1];
          }
        } catch (e) {}
      }
      
      field.setValue(String(translatedValue));
      
      return createSuccess({
        updated: 1,
        blockIndex: blockIndex,
        fieldName: inputNameStr,
        value: String(value)
      });
    } catch (e) {
      return createError('SET_FAILED', e && e.message ? e.message : String(e));
    }
  }

  // Debug: Log the payload to understand what's being received
  console.log('[DEBUG] set_block_field payload:', JSON.stringify(payload, null, 2));

  // Note: blockIndex to blockId conversion is handled by Python layer
  // The Python code correctly resolves blockId from cached_idx_to_block mapping
  // No need to convert here - payload.blockId should already be set correctly

  // Check if this is the simplified API call
  if (payload && payload.fieldName) {
    console.log('[DEBUG] Using simplified API - calling setBlockField with fieldName');
    return setBlockField({ 
      blockId: payload.blockId, 
      value: payload.value,
      fieldName: payload.fieldName,
      blockIndex: payload.blockIndex || null
    });
  }

  return createError('INVALID_ARG', 'fieldName is required');
}
