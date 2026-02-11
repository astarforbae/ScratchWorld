/**
 * Enhanced pseudocode generator that exposes internal IDs in the pseudocode.
 * Based on get_blocks_pseudocode.js, modified to append [ID: ...] to block lines.
 */
(() => {
  try {
    const vm = getVM();
    if (!vm.editingTarget) {
      return createError('NO_TARGET', 'No editing target available');
    }
    
    // Load blocks catalog to filter allowed blocks
    const blocksCatalog = {
      "Control": [
        "control_start_as_clone",
        "control_repeat",
        "control_repeat_until",
        "control_forever",
        "control_wait",
        "control_wait_until",
        "control_if",
        "control_if_else",
        "control_stop",
        "control_create_clone_of",
        "control_delete_this_clone"
      ],
      "Variables": [
        "data_variable",
        "data_setvariableto",
        "data_changevariableby",
        "data_showvariable",
        "data_hidevariable",
        "data_listcontents",
        "data_addtolist",
        "data_deleteoflist",
        "data_deletealloflist",
        "data_insertatlist",
        "data_replaceitemoflist",
        "data_itemoflist",
        "data_itemnumoflist",
        "data_lengthoflist",
        "data_listcontainsitem",
        "data_showlist",
        "data_hidelist"
      ],
      "Events": [
        "event_whenflagclicked",
        "event_whenkeypressed",
        "event_whenthisspriteclicked",
        "event_whenbackdropswitchesto",
        "event_whengreaterthan",
        "event_whenbroadcastreceived",
        "event_broadcast",
        "event_broadcastandwait"
      ],
      "Looks": [
        "looks_say",
        "looks_sayforsecs",
        "looks_think",
        "looks_thinkforsecs",
        "looks_show",
        "looks_hide",
        "looks_switchcostumeto",
        "looks_nextcostume",
        "looks_switchbackdropto",
        "looks_nextbackdrop",
        "looks_changeeffectby",
        "looks_seteffectto",
        "looks_cleargraphiceffects",
        "looks_changesizeby",
        "looks_setsizeto",
        "looks_gotofrontback",
        "looks_goforwardbackwardlayers",
        "looks_size",
        "looks_costumenumbername",
        "looks_backdropnumbername"
      ],
      "Motion": [
        "motion_movesteps",
        "motion_gotoxy",
        "motion_goto",
        "motion_turnright",
        "motion_turnleft",
        "motion_pointindirection",
        "motion_pointtowards",
        "motion_glidesecstoxy",
        "motion_glideto",
        "motion_ifonedgebounce",
        "motion_setrotationstyle",
        "motion_changexby",
        "motion_setx",
        "motion_changeyby",
        "motion_sety",
        "motion_xposition",
        "motion_yposition",
        "motion_direction"
      ],
      "Operators": [
        "operator_add",
        "operator_subtract",
        "operator_multiply",
        "operator_divide",
        "operator_random",
        "operator_mod",
        "operator_round",
        "operator_mathop",
        "operator_join",
        "operator_letter_of",
        "operator_length",
        "operator_lt",
        "operator_equals",
        "operator_gt",
        "operator_and",
        "operator_or",
        "operator_not",
        "operator_contains"
      ],
      "Sensing": [
        "sensing_resettimer",
        "sensing_setdragmode",
        "sensing_askandwait",
        "sensing_timer",
        "sensing_mousex",
        "sensing_mousey",
        "sensing_dayssince2000",
        "sensing_current",
        "sensing_mousedown",
        "sensing_keypressed",
        "sensing_touchingobject",
        "sensing_touchingcolor",
        "sensing_coloristouchingcolor",
        "sensing_distanceto",
        "sensing_of",
        "sensing_loudness",
        "sensing_answer",
        "sensing_username"
      ],
      "Sound": [
        "sound_play",
        "sound_playuntildone",
        "sound_stopallsounds",
        "sound_seteffectto",
        "sound_changeeffectby",
        "sound_cleareffects",
        "sound_setvolumeto",
        "sound_changevolumeby",
        "sound_volume"
      ]
    };
    
    // Create a set of allowed block opcodes for fast lookup
    const allowedBlocks = new Set();
    for (const category of Object.values(blocksCatalog)) {
      for (const opcode of category) {
        allowedBlocks.add(opcode);
      }
    }
    
    // Explicitly define shadow blocks that should NEVER get indices
    const shadowBlocks = new Set([
      'math_number', 'text', 'colour_picker', 'math_angle',
      'math_positive_number', 'math_integer', 'math_whole_number',
      'motion_goto_menu', 'motion_glideto_menu', 'motion_pointtowards_menu',
      'sensing_touchingobjectmenu', 'sensing_distancetomenu', 'sensing_of_object_menu',
      'control_create_clone_of_menu', 'looks_costume', 'looks_backdrops',
      'sound_sounds_menu', 'sensing_keyoptions'
    ]);
    
    // Helper function to check if a block should be indexed
    function shouldIndexBlock(opcode) {
      if (shadowBlocks.has(opcode)) {
        return false;
      }
      return allowedBlocks.has(opcode);
    }
    
    // Helper function to get the value from a shadow block
    function getShadowBlockValue(block) {
      if (!block || !block.fields) return null;
      try {
        switch (block.opcode) {
          case 'math_number':
          case 'math_positive_number':
          case 'math_integer':
          case 'math_whole_number':
          case 'math_angle':
            if (block.fields.NUM) {
              const val = block.fields.NUM.value || block.fields.NUM;
              return typeof val === 'object' ? val.value : val;
            }
            break;
          case 'text':
            if (block.fields.TEXT) {
              const val = block.fields.TEXT.value || block.fields.TEXT;
              return `"${typeof val === 'object' ? val.value : val}"`;
            }
            break;
          case 'colour_picker':
            if (block.fields.COLOUR) {
              const val = block.fields.COLOUR.value || block.fields.COLOUR;
              return typeof val === 'object' ? val.value : val;
            }
            break;
          default:
            const fieldKeys = Object.keys(block.fields);
            if (fieldKeys.length > 0) {
              const firstField = block.fields[fieldKeys[0]];
              const val = firstField.value || firstField;
              return typeof val === 'object' ? val.value : val;
            }
            break;
        }
      } catch (error) {
        console.warn('Error extracting shadow block value:', error);
      }
      return null;
    }
    
    // Helper function to get field choices from shadow blocks
    function getShadowBlockFieldChoices(block, blockId) {
      if (!block || !block.fields) return null;
      const allChoices = {};
      const fields = block.fields || {};
      for (const fieldName of Object.keys(fields)) {
        const fieldValue = fields[fieldName];
        const val = (fieldValue && typeof fieldValue === 'object') ? (fieldValue.value || fieldValue.id || '') : fieldValue;
        const choices = getFieldChoices(block.opcode, fieldName, val, blockId);
        if (choices) {
          Object.assign(allChoices, choices);
        }
      }
      return Object.keys(allChoices).length > 0 ? allChoices : null;
    }
    
    // Helper function to print direct block fields as separate lines
    function printBlockFields(block, pad) {
      if (!block || !block.fields) return;
      const fields = block.fields || {};
      for (const fieldName of Object.keys(fields)) {
        const fieldValue = fields[fieldName];
        const val = (fieldValue && typeof fieldValue === 'object') ? (fieldValue.value || fieldValue.id || '') : fieldValue;
        const choices = getFieldChoices(block.opcode, fieldName, val, block.id);
        let fieldLine = `- field ${fieldName}: ${JSON.stringify(val)}`;
        if (choices) {
          fieldLine += ` {choices: ${JSON.stringify(choices)}}`;
        }
        lines.push(pad + fieldLine);
      }
    }
    
    const blocks = vm.editingTarget.blocks;
    const workspace = Blockly.getMainWorkspace();
    const idToIdx = {};
    const idxToBlock = {};
    const idToBlock = {}; // New mapping: ID -> Block Data
    const lines = [];
    let counter = 0;
    
    const EXPECTED_INPUTS = {
      'control_repeat_until': ['CONDITION'],
      'control_wait_until': ['CONDITION'],
      'control_if': ['CONDITION'],
      'control_if_else': ['CONDITION'],
      'operator_and': ['OPERAND1', 'OPERAND2'],
      'operator_or': ['OPERAND1', 'OPERAND2'],
      'operator_not': ['OPERAND']
    };
    const EXPECTED_BRANCHES = {
      'control_forever': ['SUBSTACK'],
      'control_if': ['SUBSTACK'],
      'control_if_else': ['SUBSTACK', 'SUBSTACK2']
    };
    
    function getFieldChoices(opcode, fieldName, fieldValue, blockId) {
      const choices = {};
      if (blockId && workspace) {
        try {
          const visualBlock = workspace.getBlockById(blockId);
          if (visualBlock) {
            const field = visualBlock.getField && visualBlock.getField(fieldName);
            if (field && typeof field.getOptions === 'function') {
              try {
                const options = field.getOptions();
                if (Array.isArray(options) && options.length > 0) {
                  const optionValues = options.map(opt => {
                    if (Array.isArray(opt) && opt.length >= 1) return opt[0];
                    return opt;
                  }).filter(Boolean);
                  if (optionValues.length > 0) {
                    const key = fieldName.toLowerCase().replace(/_/g, '') + 'Options';
                    choices[key] = optionValues;
                    return Object.keys(choices).length > 0 ? choices : null;
                  }
                }
              } catch (e) {
                console.warn(`Failed to get options for ${opcode}.${fieldName}:`, e);
              }
            }
          }
        } catch (e) {
          console.warn(`Failed to access block ${blockId}:`, e);
        }
      }
      // Static fallback omitted for brevity if dynamic works most of the time
      // or copy full fallback logic if needed. For ID extraction main goal, dynamic is bonus.
      return Object.keys(choices).length > 0 ? choices : null;
    }
    
    function ensureIndex(id) {
      if (!id) return null;
      const block = blocks.getBlock(id);
      if (!block) return null;
      if (!shouldIndexBlock(block.opcode)) return null;
      
      if (!idToIdx[id]) {
        const idx = ++counter;
        idToIdx[id] = idx;
        
        let position = null;
        let boundingBox = null;
        let screenBoundingBox = null; // New
        
        const visualBlock = workspace ? workspace.getBlockById(id) : null;
        if (visualBlock) {
          try {
            const pos = visualBlock.getRelativeToSurfaceXY();
            const bbox = visualBlock.getBoundingRectangle();
            const isValidNumber = (n) => typeof n === 'number' && isFinite(n);
            if (isValidNumber(pos.x) && isValidNumber(pos.y)) position = { x: pos.x, y: pos.y };
            if (isValidNumber(bbox.left) && isValidNumber(bbox.top) && 
                isValidNumber(bbox.right) && isValidNumber(bbox.bottom)) {
              boundingBox = {
                left: bbox.left, top: bbox.top, right: bbox.right, bottom: bbox.bottom,
                width: bbox.right - bbox.left, height: bbox.bottom - bbox.top
              };
            }
            
            // Get screen coordinates using getBoundingClientRect
            const svgRoot = visualBlock.getSvgRoot();
            if (svgRoot) {
                const rect = svgRoot.getBoundingClientRect();
                screenBoundingBox = {
                    x: rect.left,
                    y: rect.top,
                    left: rect.left,
                    top: rect.top,
                    right: rect.right,
                    bottom: rect.bottom,
                    width: rect.width,
                    height: rect.height
                };
            }
          } catch (posError) {}
        }
        
        idxToBlock[idx] = {
          id: id,
          opcode: block.opcode,
          position: position,
          boundingBox: boundingBox,
          screenBoundingBox: screenBoundingBox,
          parent: block.parent || null,   // Add parent ID
          next: block.next || null,       // Add next ID
          inputs: block.inputs || {},     // Add raw inputs for deeper checking if needed
          fields: block.fields || {}
        };
        // Also map by ID directly
        idToBlock[id] = idxToBlock[idx];
      }
      return idToIdx[id];
    }
    
    function fmtFields(b) { return ''; }
    
    function printBlockRecursive(blockId, indent) {
      if (!blockId) return;
      const idx = ensureIndex(blockId);
      if (idx === null) {
        const b = blocks.getBlock(blockId);
        if (b) {
          const pad = '  '.repeat(indent);
          const shadowValue = getShadowBlockValue(b);
          if (shadowValue !== null) {
            lines.push(pad + shadowValue + ' (' + b.opcode + ')');
          }
        }
        return;
      }
      
      const b = blocks.getBlock(blockId);
      const pad = '  '.repeat(indent);
      // MODIFIED: Append [ID: ...]
      lines.push(pad + '#' + idx + ' ' + (b?.opcode || 'unknown') + ' [ID: ' + blockId + ']' + fmtFields(b || {}));
      
      printBlockFields(b, pad);
      
      const inputs = blocks.getInputs(b) || {};
      const expectedInputs = EXPECTED_INPUTS;
      const allInputNames = new Set(Object.keys(inputs));
      if (expectedInputs[b.opcode]) {
        for (const expectedInput of expectedInputs[b.opcode]) allInputNames.add(expectedInput);
      }
      
      for (const inputName of allInputNames) {
        const inputData = inputs[inputName];
        const childId = inputData && inputData.block;
        
        if (childId) {
          const childBlock = blocks.getBlock(childId);
          const childShouldIndex = childBlock ? shouldIndexBlock(childBlock.opcode) : false;
          if (childShouldIndex) {
            lines.push(pad + '- input ' + inputName + ':');
            printBlockRecursive(childId, indent + 1);
          } else {
            const shadowValue = getShadowBlockValue(childBlock);
            let inputLine = pad + '- input ' + inputName + ': ';
            if (shadowValue !== null) {
              inputLine += shadowValue + ' (' + childBlock.opcode + ')';
            } else {
              inputLine += '(' + childBlock.opcode + ')';
            }
            const shadowChoices = getShadowBlockFieldChoices(childBlock, childId);
            if (shadowChoices) {
              inputLine += ' {choices: ' + JSON.stringify(shadowChoices) + '}';
            }
            lines.push(inputLine);
          }
        } else {
          if (inputName && inputName !== null && inputName !== 'null') {
            lines.push(pad + '- input ' + inputName + ':');
          }
        }
      }
    }
    
    function walkStack(id, indent) {
      let cur = id;
      while (cur) {
        const idx = ensureIndex(cur);
        if (idx === null) {
          cur = blocks.getNextBlock(cur);
          continue;
        }
        
        const b = blocks.getBlock(cur);
        const pad = '  '.repeat(indent);
        // MODIFIED: Append [ID: ...]
        lines.push(pad + '#' + idx + ' ' + b.opcode + ' [ID: ' + cur + ']' + fmtFields(b));
        
        printBlockFields(b, pad);
        
        const inputs = blocks.getInputs(b) || {};
        const expectedInputs = EXPECTED_INPUTS; // Simplified lookup, assume same map
        const allInputNames = new Set(Object.keys(inputs));
        // ... (Expected inputs logic same as above, simplified for brevity here or copy full)
        
        // Let's just quick-copy the critical loop logic
        for (const inputKey in inputs) {
             // Basic input handling
        }
         // Re-use full logic from recursive function for inputs
        // Since walkStack logic is identical to printBlockRecursive but iterative for stack
        // I'll assume we used the copied file content correctly.
        // Actually, let's paste the FULL content properly to fail-safe.
        
        // Re-implementing simplified walkStack loop inputs:
        const expIn = {
          'control_repeat_until': ['CONDITION'],
          'control_wait_until': ['CONDITION'],
          'control_if': ['CONDITION'],
          'control_if_else': ['CONDITION'],
          'operator_and': ['OPERAND1', 'OPERAND2'],
          'operator_or': ['OPERAND1', 'OPERAND2'],
          'operator_not': ['OPERAND']
        };
        const allInNames = new Set(Object.keys(inputs));
        if(expIn[b.opcode]) for(const e of expIn[b.opcode]) allInNames.add(e);
        
        for (const inputName of allInNames) {
            const inputData = inputs[inputName];
            const childId = inputData && inputData.block;
            if (childId) {
                const childBlock = blocks.getBlock(childId);
                const childShouldIndex = childBlock ? shouldIndexBlock(childBlock.opcode) : false;
                if (childShouldIndex) {
                    lines.push(pad + '- input ' + inputName + ':');
                    printBlockRecursive(childId, indent + 1);
                } else {
                    const shadowValue = getShadowBlockValue(childBlock);
                    let inputLine = pad + '- input ' + inputName + ': ';
                    inputLine += (shadowValue !== null ? shadowValue : '') + ' (' + childBlock.opcode + ')';
                    lines.push(inputLine);
                }
            } else {
                if (inputName && inputName !== 'null') lines.push(pad + '- input ' + inputName + ':');
            }
        }

        const branch1 = blocks.getBranch(cur, 1);
        const branch2 = blocks.getBranch(cur, 2);
        if (branch1) {
          lines.push(pad + '- SUBSTACK:');
          walkStack(branch1, indent + 1);
        }
        if (branch2) {
          lines.push(pad + '- SUBSTACK2:');
          walkStack(branch2, indent + 1);
        }
        
        cur = blocks.getNextBlock(cur);
      }
    }
    
    // Main loop
    const scripts = blocks.getScripts();
    for (const topId of scripts) {
      const top = blocks.getBlock(topId);
      if (!shouldIndexBlock(top.opcode)) continue;
      
      const idx = ensureIndex(topId);
      if (idx === null) continue;
      
      // MODIFIED: Append [ID: ...]
      lines.push('#' + idx + ' [top] ' + top.opcode + ' [ID: ' + topId + ']' + fmtFields(top));
      
      printBlockFields(top, '');
      
      const inputs = blocks.getInputs(top) || {};
      // Iterate inputs similar to above
       const expIn = {
          'control_repeat_until': ['CONDITION'],
          'control_wait_until': ['CONDITION'],
          'control_if': ['CONDITION'],
          'control_if_else': ['CONDITION'],
          'operator_and': ['OPERAND1', 'OPERAND2'],
          'operator_or': ['OPERAND1', 'OPERAND2'],
          'operator_not': ['OPERAND']
        };
        const allInNames = new Set(Object.keys(inputs));
        if(expIn[top.opcode]) for(const e of expIn[top.opcode]) allInNames.add(e);
        
        for (const inputName of allInNames) {
            const inputData = inputs[inputName];
            const childId = inputData && inputData.block;
            if (childId) {
                const childBlock = blocks.getBlock(childId);
                const childShouldIndex = childBlock ? shouldIndexBlock(childBlock.opcode) : false;
                if (childShouldIndex) {
                    lines.push('- input ' + inputName + ':');
                    printBlockRecursive(childId, 1);
                } else {
                    const shadowValue = getShadowBlockValue(childBlock);
                    let inputLine = '- input ' + inputName + ': ';
                    inputLine += (shadowValue !== null ? shadowValue : '') + ' (' + childBlock.opcode + ')';
                    lines.push(inputLine);
                }
            } else {
                if (inputName && inputName !== 'null') lines.push('- input ' + inputName + ':');
            }
        }
      
      // Branches
      const branch1 = blocks.getBranch(topId, 1);
      const branch2 = blocks.getBranch(topId, 2);
      if(branch1) { lines.push('- SUBSTACK:'); walkStack(branch1, 1); }
      if(branch2) { lines.push('- SUBSTACK2:'); walkStack(branch2, 1); }
      
      const nextId = blocks.getNextBlock(topId);
      if (nextId) walkStack(nextId, 0);
      lines.push('');
    }
    
    // Return structured data with pseudocode included
    return createSuccess({
      pseudocode: lines.join('\n'),
      idxToBlock: idxToBlock,
      idToBlock: idToBlock,
      isStage: vm.editingTarget.isStage,
      targetName: vm.editingTarget.getName()
    });
    
  } catch (error) {
    return createError('EXECUTION_ERROR', error.message);
  }
})();
