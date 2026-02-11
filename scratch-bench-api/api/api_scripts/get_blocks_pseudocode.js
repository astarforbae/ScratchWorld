/**
 * Enhanced pseudocode generator with field choices
 * Generate pseudocode from current sprite's blocks with available field options
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
      // Never index shadow blocks
      if (shadowBlocks.has(opcode)) {
        return false;
      }
      // Only index blocks that are in the catalog
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
            // Look for NUM field
            if (block.fields.NUM) {
              const val = block.fields.NUM.value || block.fields.NUM;
              return typeof val === 'object' ? val.value : val;
            }
            break;
            
          case 'text':
            // Look for TEXT field
            if (block.fields.TEXT) {
              const val = block.fields.TEXT.value || block.fields.TEXT;
              return `"${typeof val === 'object' ? val.value : val}"`;
            }
            break;
            
          case 'colour_picker':
            // Look for COLOUR field
            if (block.fields.COLOUR) {
              const val = block.fields.COLOUR.value || block.fields.COLOUR;
              return typeof val === 'object' ? val.value : val;
            }
            break;
            
          default:
            // For other shadow blocks, try to get the first field value
            const fieldKeys = Object.keys(block.fields);
            if (fieldKeys.length > 0) {
              const firstField = block.fields[fieldKeys[0]];
              const val = firstField.value || firstField;
              return typeof val === 'object' ? val.value : val;
            }
            break;
        }
      } catch (error) {
        // If there's an error extracting the value, just return null
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
        
        // Get available choices for this field
        const choices = getFieldChoices(block.opcode, fieldName, val, blockId);
        if (choices) {
          // Merge all field choices into one object
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
        
        // Get available choices for this field
        const choices = getFieldChoices(block.opcode, fieldName, val, block.id);
        
        // Format the field line
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
    const lines = [];
    let counter = 0;
    
    // Expected inputs and branches placeholders for certain opcodes
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
    
    // Helper function to get available choices for different field types
    function getFieldChoices(opcode, fieldName, fieldValue, blockId) {
      const choices = {};
      
      // First, try to get options dynamically from the visual block field
      if (blockId && workspace) {
        try {
          const visualBlock = workspace.getBlockById(blockId);
          if (visualBlock) {
            const field = visualBlock.getField && visualBlock.getField(fieldName);
            if (field && typeof field.getOptions === 'function') {
              try {
                const options = field.getOptions();
                if (Array.isArray(options) && options.length > 0) {
                  // Options format: [[displayText, value], ...]
                  const optionValues = options.map(opt => {
                    if (Array.isArray(opt) && opt.length >= 1) {
                      return opt[0]; // Use display text
                    }
                    return opt;
                  }).filter(Boolean);
                  
                  if (optionValues.length > 0) {
                    // Use a generic key based on field name or opcode
                    const key = fieldName.toLowerCase().replace(/_/g, '') + 'Options';
                    choices[key] = optionValues;
                    return Object.keys(choices).length > 0 ? choices : null;
                  }
                }
              } catch (e) {
                // If dynamic fetch fails, fall through to static definitions
                console.warn(`Failed to get options for ${opcode}.${fieldName}:`, e);
              }
            }
          }
        } catch (e) {
          // If workspace access fails, fall through to static definitions
          console.warn(`Failed to access block ${blockId}:`, e);
        }
      }
      
      // Fallback to static definitions for special cases where dynamic fetching doesn't work
      try {
        switch (opcode) {
          // Variable-related blocks
          case 'data_variable':
          case 'data_setvariableto':
          case 'data_changevariableby':
            if (fieldName === 'VARIABLE') {
              // Get variables for current target and stage
              const targetVars = vm.editingTarget.getAllVariableNamesInScopeByType('', true) || [];
              const stageVars = vm.runtime.getTargetForStage().getAllVariableNamesInScopeByType('') || [];
              const allVars = [...new Set([...targetVars, ...stageVars])].sort();
              choices.variables = allVars;
            }
            break;
            
          // List-related blocks
          case 'data_listcontents':
          case 'data_addtolist':
          case 'data_deleteoflist':
          case 'data_deletealloflist':
          case 'data_insertatlist':
          case 'data_replaceitemoflist':
          case 'data_itemoflist':
          case 'data_itemnumoflist':
          case 'data_lengthoflist':
          case 'data_listcontainsitem':
            if (fieldName === 'LIST') {
              const targetLists = vm.editingTarget.getAllVariableNamesInScopeByType('list', true) || [];
              const stageLists = vm.runtime.getTargetForStage().getAllVariableNamesInScopeByType('list') || [];
              const allLists = [...new Set([...targetLists, ...stageLists])].sort();
              choices.lists = allLists;
            }
            break;
            
          // Costume-related blocks
          case 'looks_costume':
          case 'looks_switchcostumeto':
          case 'looks_nextcostume':
            if (fieldName === 'COSTUME') {
              const costumes = vm.editingTarget.getCostumes().map(costume => costume.name);
              choices.costumes = costumes;
            }
            break;
            
          // Sound-related blocks
          case 'sound_sounds_menu':
          case 'sound_play':
          case 'sound_playuntildone':
            if (fieldName === 'SOUND_MENU') {
              const sounds = vm.editingTarget.sprite.sounds.map(sound => sound.name);
              choices.sounds = sounds;
            }
            break;
            
          // Backdrop-related blocks
          case 'looks_backdrops':
          case 'looks_switchbackdropto':
          case 'event_whenbackdropswitchesto':
            if (fieldName === 'BACKDROP') {
              const stage = vm.runtime.targets[0];
              if (stage) {
                const backdrops = stage.getCostumes().map(costume => costume.name);
                choices.backdrops = backdrops;
              }
            }
            break;
            
          // Sprite-related blocks
          case 'motion_pointtowards_menu':
          case 'motion_goto_menu':
          case 'motion_glideto_menu':
          case 'sensing_touchingobjectmenu':
          case 'sensing_distancetomenu':
          case 'sensing_of_object_menu':
          case 'control_create_clone_of_menu':
            if (fieldName === 'TOWARDS' || fieldName === 'TO' || fieldName === 'TOUCHINGOBJECTMENU' || 
                fieldName === 'DISTANCETOMENU' || fieldName === 'OBJECT' || fieldName === 'CLONE_OPTION') {
              const sprites = [];
              for (const targetId in vm.runtime.targets) {
                const target = vm.runtime.targets[targetId];
                if (target.isOriginal && !target.isStage && target !== vm.editingTarget) {
                  sprites.push(target.sprite.name);
                }
              }
              choices.sprites = sprites.sort();
              
              // Add special options based on block type
              if (fieldName === 'TOWARDS' || fieldName === 'TO' || fieldName === 'DISTANCETOMENU' || fieldName === 'TOUCHINGOBJECTMENU') {
                choices.specialOptions = ['mouse-pointer'];
                if (fieldName === 'TO') {
                  choices.specialOptions.unshift('random position');
                }
                if (fieldName === 'TOUCHINGOBJECTMENU') {
                  choices.specialOptions.push('edge');
                }
              }
              if (fieldName === 'OBJECT') {
                choices.specialOptions = ['Stage'];
              }
              if (fieldName === 'CLONE_OPTION') {
                choices.specialOptions = ['myself'];
              }
            }
            break;
            
          // Sensing "of" block properties
          case 'sensing_of':
            if (fieldName === 'PROPERTY') {
              // Get the target from the OBJECT field to determine available properties
              const stageProperties = ['backdrop #', 'backdrop name', 'volume'];
              const spriteProperties = ['x position', 'y position', 'direction', 'costume #', 'costume name', 'size', 'volume'];
              
              // Add variables to the appropriate list
              const stageVars = vm.runtime.getTargetForStage().getAllVariableNamesInScopeByType('') || [];
              const targetVars = vm.editingTarget.getAllVariableNamesInScopeByType('', true) || [];
              
              choices.stageProperties = [...stageProperties, ...stageVars.sort()];
              choices.spriteProperties = [...spriteProperties, ...targetVars.sort()];
            }
            break;
            
          // Current time/date sensing
          case 'sensing_current':
            if (fieldName === 'CURRENTMENU') {
              choices.timeOptions = ['year', 'month', 'date', 'day of week', 'hour', 'minute', 'second'];
            }
            break;
            
          // Key sensing
          case 'sensing_keyoptions':
            if (fieldName === 'KEY_OPTION') {
              choices.keyOptions = ['space', 'up arrow', 'down arrow', 'right arrow', 'left arrow', 'enter', 'any'];
              // Add letter and number keys
              for (let i = 97; i <= 122; i++) {
                choices.keyOptions.push(String.fromCharCode(i));
              }
              for (let i = 0; i <= 9; i++) {
                choices.keyOptions.push(i.toString());
              }
            }
            break;
        }
      } catch (error) {
        // If there's an error getting choices, just continue without them
        console.warn('Error getting field choices:', error);
      }
      
      return Object.keys(choices).length > 0 ? choices : null;
    }
    
    function ensureIndex(id) {
      if (!id) return null;
      
      // Get the block to check its opcode
      const block = blocks.getBlock(id);
      if (!block) return null;
      
      // Use the helper function to determine if this block should be indexed
      if (!shouldIndexBlock(block.opcode)) {
        return null;
      }
      
      if (!idToIdx[id]) {
        const idx = ++counter;
        idToIdx[id] = idx;
        
        // Get position information for this block
        const visualBlock = workspace ? workspace.getBlockById(id) : null;
        let position = null;
        let boundingBox = null;
        
        if (visualBlock) {
          try {
            const pos = visualBlock.getRelativeToSurfaceXY();
            const bbox = visualBlock.getBoundingRectangle();
            
            // Validate and sanitize position values
            const isValidNumber = (n) => typeof n === 'number' && isFinite(n);
            
            if (isValidNumber(pos.x) && isValidNumber(pos.y)) {
              position = { x: pos.x, y: pos.y };
            }
            
            if (isValidNumber(bbox.left) && isValidNumber(bbox.top) && 
                isValidNumber(bbox.right) && isValidNumber(bbox.bottom)) {
              boundingBox = {
                left: bbox.left,
                top: bbox.top,
                right: bbox.right,
                bottom: bbox.bottom,
                width: bbox.right - bbox.left,
                height: bbox.bottom - bbox.top
              };
            }
          } catch (posError) {
            // If position retrieval fails, continue without position data
          }
        }
        
        // Store block information by index
        idxToBlock[idx] = {
          id: id,
          opcode: block.opcode,
          position: position,
          boundingBox: boundingBox
        };
      }
      return idToIdx[id];
    }
    
    function fmtFields(b) {
      // Since we now display fields as separate lines with printBlockFields(),
      // we don't need to show them in the block header to avoid redundancy
      return '';
    }
    
    // Recursively print a block and all of its input subtrees
    function printBlockRecursive(blockId, indent) {
      if (!blockId) return;
      const idx = ensureIndex(blockId);
      if (idx === null) {
        // This is a shadow block - don't give it an index, but show its value
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
      lines.push(pad + '#' + idx + ' ' + (b?.opcode || 'unknown') + fmtFields(b || {}));
      
      // Show direct block fields as separate lines
      printBlockFields(b, pad);
      
      const inputs = blocks.getInputs(b) || {};
      
      // Define expected inputs for blocks that should show empty inputs
      const expectedInputs = EXPECTED_INPUTS;
      
      // Get all input names (both existing and expected)
      const allInputNames = new Set(Object.keys(inputs));
      if (expectedInputs[b.opcode]) {
        for (const expectedInput of expectedInputs[b.opcode]) {
          allInputNames.add(expectedInput);
        }
      }
      
      for (const inputName of allInputNames) {
        const inputData = inputs[inputName];
        const childId = inputData && inputData.block;
        
        if (childId) {
          const childBlock = blocks.getBlock(childId);
          const childShouldIndex = childBlock ? shouldIndexBlock(childBlock.opcode) : false;
          
          if (childShouldIndex) {
            // Child block should be indexed - show it normally
            lines.push(pad + '- input ' + inputName + ':');
            printBlockRecursive(childId, indent + 1);
          } else {
            // Child is a shadow block - show its value inline with options if available
            const shadowValue = getShadowBlockValue(childBlock);
            let inputLine = pad + '- input ' + inputName + ': ';
            if (shadowValue !== null) {
              inputLine += shadowValue + ' (' + childBlock.opcode + ')';
            } else {
              inputLine += '(' + childBlock.opcode + ')';
            }
            
            // Try to get field options from the shadow block
            const shadowChoices = getShadowBlockFieldChoices(childBlock, childId);
            if (shadowChoices) {
              inputLine += ' {choices: ' + JSON.stringify(shadowChoices) + '}';
            }
            
            lines.push(inputLine);
          }
        } else {
          // Always show input even when empty, but skip dummy inputs
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
          // Skip blocks not in catalog, but continue with next block
          cur = blocks.getNextBlock(cur);
          continue;
        }
        
        const b = blocks.getBlock(cur);
        const pad = '  '.repeat(indent);
        lines.push(pad + '#' + idx + ' ' + b.opcode + fmtFields(b));
        
        // Show direct block fields as separate lines
        printBlockFields(b, pad);
        
        const inputs = blocks.getInputs(b) || {};
        
        // Define expected inputs for blocks that should show empty inputs
        const expectedInputs = {
          'control_repeat_until': ['CONDITION'],
          'control_wait_until': ['CONDITION'],
          'control_if': ['CONDITION'],
          'control_if_else': ['CONDITION'],
          'operator_and': ['OPERAND1', 'OPERAND2'],
          'operator_or': ['OPERAND1', 'OPERAND2'],
          'operator_not': ['OPERAND']
        };
        
        // Get all input names (both existing and expected)
        const allInputNames = new Set(Object.keys(inputs));
        if (expectedInputs[b.opcode]) {
          for (const expectedInput of expectedInputs[b.opcode]) {
            allInputNames.add(expectedInput);
          }
        }
        
        for (const inputName of allInputNames) {
          const inputData = inputs[inputName];
          const childId = inputData && inputData.block;
          
          if (childId) {
            const childBlock = blocks.getBlock(childId);
            const childShouldIndex = childBlock ? shouldIndexBlock(childBlock.opcode) : false;
            
            if (childShouldIndex) {
              // Child block should be indexed - show it normally
              lines.push(pad + '- input ' + inputName + ':');
              printBlockRecursive(childId, indent + 1);
            } else {
              // Child is a shadow block - show its value inline with options if available
              const shadowValue = getShadowBlockValue(childBlock);
              let inputLine = pad + '- input ' + inputName + ': ';
              if (shadowValue !== null) {
                inputLine += shadowValue + ' (' + childBlock.opcode + ')';
              } else {
                inputLine += '(' + childBlock.opcode + ')';
              }
              
              // Try to get field options from the shadow block
              const shadowChoices = getShadowBlockFieldChoices(childBlock, childId);
              if (shadowChoices) {
                inputLine += ' {choices: ' + JSON.stringify(shadowChoices) + '}';
              }
              
              lines.push(inputLine);
            }
          } else {
            // Always show input even when empty, but skip dummy inputs
            if (inputName && inputName !== null && inputName !== 'null') {
              lines.push(pad + '- input ' + inputName + ':');
            }
          }
        }
        
        // Branches: show placeholders even if empty for certain opcodes
        const branch1 = blocks.getBranch(cur, 1);
        const branch2 = blocks.getBranch(cur, 2);
        const expectedBranches = EXPECTED_BRANCHES[b.opcode] || [];
        if (branch1) {
          lines.push(pad + '- SUBSTACK:');
          walkStack(branch1, indent + 1);
        } else if (expectedBranches.includes('SUBSTACK')) {
          lines.push(pad + '- SUBSTACK:');
        }
        if (branch2) {
          lines.push(pad + '- SUBSTACK2:');
          walkStack(branch2, indent + 1);
        } else if (expectedBranches.includes('SUBSTACK2')) {
          lines.push(pad + '- SUBSTACK2:');
        }
        
        cur = blocks.getNextBlock(cur);
      }
    }
    
    const scripts = blocks.getScripts();
    
    for (const topId of scripts) {
      const top = blocks.getBlock(topId);
      
      // Skip blocks that should not be indexed
      if (!shouldIndexBlock(top.opcode)) {
        continue;
      }
      
      const idx = ensureIndex(topId);
      if (idx === null) continue; // Double-check in case ensureIndex fails
      
      lines.push('#' + idx + ' [top] ' + top.opcode + fmtFields(top));
      
      // Show direct block fields as separate lines
      printBlockFields(top, '');
      
      const inputs = blocks.getInputs(top) || {};
      
      // Define expected inputs for blocks that should show empty inputs
      const expectedInputs = EXPECTED_INPUTS;
      
      // Get all input names (both existing and expected)
      const allInputNames = new Set(Object.keys(inputs));
      if (expectedInputs[top.opcode]) {
        for (const expectedInput of expectedInputs[top.opcode]) {
          allInputNames.add(expectedInput);
        }
      }
      
      for (const inputName of allInputNames) {
        const inputData = inputs[inputName];
        const childId = inputData && inputData.block;
        
        if (childId) {
          const childBlock = blocks.getBlock(childId);
          const childShouldIndex = childBlock ? shouldIndexBlock(childBlock.opcode) : false;
          
          if (childShouldIndex) {
            // Child block should be indexed - show it normally
            lines.push('- input ' + inputName + ':');
            printBlockRecursive(childId, 1);
          } else {
            // Child is a shadow block - show its value inline with options if available
            const shadowValue = getShadowBlockValue(childBlock);
            let inputLine = '- input ' + inputName + ': ';
            if (shadowValue !== null) {
              inputLine += shadowValue + ' (' + childBlock.opcode + ')';
            } else {
              inputLine += '(' + childBlock.opcode + ')';
            }
            
            // Try to get field options from the shadow block
            const shadowChoices = getShadowBlockFieldChoices(childBlock, childId);
            if (shadowChoices) {
              inputLine += ' {choices: ' + JSON.stringify(shadowChoices) + '}';
            }
            
            lines.push(inputLine);
          }
        } else {
          // Always show input even when empty, but skip dummy inputs
          if (inputName && inputName !== null && inputName !== 'null') {
            lines.push('- input ' + inputName + ':');
          }
        }
      }
      
      // Branches: show placeholders even if empty for certain opcodes
      const branch1 = blocks.getBranch(topId, 1);
      const branch2 = blocks.getBranch(topId, 2);
      const expectedBranchesTop = EXPECTED_BRANCHES[top.opcode] || [];
      if (branch1) {
        lines.push('- SUBSTACK:');
        walkStack(branch1, 1);
      } else if (expectedBranchesTop.includes('SUBSTACK')) {
        lines.push('- SUBSTACK:');
      }
      if (branch2) {
        lines.push('- SUBSTACK2:');
        walkStack(branch2, 1);
      } else if (expectedBranchesTop.includes('SUBSTACK2')) {
        lines.push('- SUBSTACK2:');
      }
      
      const nextId = blocks.getNextBlock(topId);
      if (nextId) walkStack(nextId, 0);
      lines.push('');
    }
    
    // Generate summary of available choices with value-to-ID mappings
    const choicesSummary = {};
    const valueToIdMappings = {};
    
    // Helper function to get variable ID by name
    function getVariableId(name, isStage = false) {
      const target = isStage ? vm.runtime.getTargetForStage() : vm.editingTarget;
      // Use the correct method to get variables
      const variables = target.variables || {};
      for (const varId in variables) {
        const variable = variables[varId];
        if (variable && variable.name === name && variable.type !== 'list') {
          return varId;
        }
      }
      return null;
    }
    
    // Helper function to get list ID by name
    function getListId(name, isStage = false) {
      const target = isStage ? vm.runtime.getTargetForStage() : vm.editingTarget;
      // Use the correct method to get variables (lists are also stored as variables)
      const variables = target.variables || {};
      for (const varId in variables) {
        const variable = variables[varId];
        if (variable && variable.name === name && variable.type === 'list') {
          return varId;
        }
      }
      return null;
    }
    
    // Helper function to get costume ID by name
    function getCostumeId(name, isStage = false) {
      const target = isStage ? vm.runtime.getTargetForStage() : vm.editingTarget;
      const costumes = target.getCostumes();
      for (let i = 0; i < costumes.length; i++) {
        if (costumes[i].name === name) {
          return costumes[i].assetId || costumes[i].md5ext || i.toString();
        }
      }
      return null;
    }
    
    // Helper function to get sound ID by name
    function getSoundId(name) {
      const sounds = vm.editingTarget.sprite.sounds;
      for (let i = 0; i < sounds.length; i++) {
        if (sounds[i].name === name) {
          return sounds[i].assetId || sounds[i].md5ext || i.toString();
        }
      }
      return null;
    }
    
    // Helper function to get sprite ID by name
    function getSpriteId(name) {
      for (const target of Object.values(vm.runtime.targets)) {
        if (target.isOriginal && !target.isStage && target.sprite.name === name) {
          return target.id;
        }
      }
      return null;
    }
    
    // Variables (sprite-scoped)
    const targetVariableNames = vm.editingTarget.getAllVariableNamesInScopeByType('', true) || [];
    choicesSummary.variables = targetVariableNames;
    valueToIdMappings.variables = {};
    for (const varName of targetVariableNames) {
      const varId = getVariableId(varName, false);
      if (varId) {
        valueToIdMappings.variables[varName] = varId;
      }
    }
    
    // Lists (sprite-scoped)
    const targetListNames = vm.editingTarget.getAllVariableNamesInScopeByType('list', true) || [];
    choicesSummary.lists = targetListNames;
    valueToIdMappings.lists = {};
    for (const listName of targetListNames) {
      const listId = getListId(listName, false);
      if (listId) {
        valueToIdMappings.lists[listName] = listId;
      }
    }
    
    // Costumes
    const costumes = vm.editingTarget.getCostumes();
    choicesSummary.costumes = costumes.map(c => c.name);
    valueToIdMappings.costumes = {};
    for (const costume of costumes) {
      valueToIdMappings.costumes[costume.name] = costume.assetId || costume.md5ext || costume.name;
    }
    
    // Sounds
    const sounds = vm.editingTarget.sprite.sounds;
    choicesSummary.sounds = sounds.map(s => s.name);
    valueToIdMappings.sounds = {};
    for (const sound of sounds) {
      valueToIdMappings.sounds[sound.name] = sound.assetId || sound.md5ext || sound.name;
    }
    
    // Sprites
    const sprites = Object.values(vm.runtime.targets)
      .filter(t => t.isOriginal && !t.isStage && t !== vm.editingTarget)
      .map(t => t.sprite.name)
      .sort();
    choicesSummary.sprites = sprites;
    valueToIdMappings.sprites = {};
    for (const spriteName of sprites) {
      const spriteId = getSpriteId(spriteName);
      if (spriteId) {
        valueToIdMappings.sprites[spriteName] = spriteId;
      }
    }
    
    // Add stage-specific choices
    const stage = vm.runtime.targets[0];
    if (stage) {
      // Stage backdrops
      const backdrops = stage.getCostumes();
      choicesSummary.backdrops = backdrops.map(c => c.name);
      valueToIdMappings.backdrops = {};
      for (const backdrop of backdrops) {
        valueToIdMappings.backdrops[backdrop.name] = backdrop.assetId || backdrop.md5ext || backdrop.name;
      }
      
      // Stage variables
      const stageVariables = vm.runtime.getTargetForStage().getAllVariableNamesInScopeByType('') || [];
      choicesSummary.stageVariables = stageVariables;
      valueToIdMappings.stageVariables = {};
      for (const varName of stageVariables) {
        const varId = getVariableId(varName, true);
        if (varId) {
          valueToIdMappings.stageVariables[varName] = varId;
        }
      }
      
      // Stage lists
      const stageLists = vm.runtime.getTargetForStage().getAllVariableNamesInScopeByType('list') || [];
      choicesSummary.stageLists = stageLists;
      valueToIdMappings.stageLists = {};
      for (const listName of stageLists) {
        const listId = getListId(listName, true);
        if (listId) {
          valueToIdMappings.stageLists[listName] = listId;
        }
      }
    }
    
    // Add special predefined mappings for common field values
    valueToIdMappings.specialOptions = {
      // Motion/sensing special targets
      'mouse-pointer': '_mouse_',
      'random position': '_random_',
      'edge': '_edge_',
      'Stage': '_stage_',
      'myself': '_myself_',
      
      // Key options (these typically don't need ID mapping, but included for completeness)
      'space': 'space',
      'up arrow': 'up arrow',
      'down arrow': 'down arrow',
      'right arrow': 'right arrow', 
      'left arrow': 'left arrow',
      'enter': 'enter',
      'any': 'any',
      
      // Time/date options
      'year': 'YEAR',
      'month': 'MONTH',
      'date': 'DATE',
      'day of week': 'DAYOFWEEK',
      'hour': 'HOUR',
      'minute': 'MINUTE',
      'second': 'SECOND',
      
      // Sensing properties
      'x position': 'x position',
      'y position': 'y position',
      'direction': 'direction',
      'costume #': 'costume #',
      'costume name': 'costume name',
      'size': 'size',
      'volume': 'volume',
      'backdrop #': 'backdrop #',
      'backdrop name': 'backdrop name'
    };
    
    const availableTargets = Object.values(vm.runtime.targets)
      .filter(t => t.isOriginal)
      .map(t => ({
        id: t.id,
        name: t.getName(),
        isStage: !!t.isStage
      }));

    // Variables/lists in scope for the current target (sprite + stage), name + scope only
    const targetVariables = [];
    const targetLists = [];
    const seenVarIds = new Set();

    function collectVariables(target, scopeLabel) {
      const vars = target && target.variables ? target.variables : {};
      for (const varId in vars) {
        const variable = vars[varId];
        if (!variable || seenVarIds.has(varId)) continue;
        seenVarIds.add(varId);
        const entry = { name: variable.name, scope: scopeLabel };
        if (variable.type === 'list') {
          targetLists.push(entry);
        } else {
          targetVariables.push(entry);
        }
      }
    }

    // Sprite/local scope
    collectVariables(vm.editingTarget, 'sprite');
    // Stage/all scope
    collectVariables(vm.runtime.getTargetForStage(), 'all');

    targetVariables.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    targetLists.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return createSuccess({
      pseudocode: lines.join('\n'),
      idxToBlock: idxToBlock,
      targetName: vm.editingTarget.getName(),
      targetId: vm.editingTarget.id,
      availableChoices: choicesSummary,
      valueToIdMappings: valueToIdMappings,
      availableTargets: availableTargets,
      targetVariables: targetVariables,
      targetLists: targetLists
    });
  } catch (error) {
    return createError('EXECUTION_ERROR', error.message || 'Failed to generate enhanced pseudocode');
  }
})
