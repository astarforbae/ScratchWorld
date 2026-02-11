/**
 * Block connection utilities for Scratch API operations
 */

/**
 * Get the top block of a stack
 */
function getTopOfStack(block) {
  let cur = block;
  while (cur.previousConnection && cur.previousConnection.targetBlock()) {
    cur = cur.previousConnection.targetBlock();
  }
  return cur;
}

/**
 * Get the last block of a stack
 */
function getLastOfStack(block) {
  let cur = block;
  while (cur.nextConnection && cur.nextConnection.targetBlock()) {
    cur = cur.nextConnection.targetBlock();
  }
  return cur;
}

/**
 * Check if searchBlock is within the stack starting at startBlock
 */
function isBlockInStack(startBlock, searchBlock) {
  let cur = startBlock;
  while (cur) {
    if (cur === searchBlock) return true;
    if (!cur.nextConnection || typeof cur.nextConnection.targetBlock !== 'function') break;
    cur = cur.nextConnection.targetBlock();
  }
  return false;
}

/**
 * Check if ancestor appears in block's parent chain
 */
function isBlockAncestor(ancestor, block) {
  if (!ancestor || !block) return false;
  if (ancestor === block) return true;
  let cur = block;
  while (cur && typeof cur.getParent === 'function') {
    cur = cur.getParent();
    if (cur === ancestor) return true;
  }
  return false;
}

/**
 * If the given target block is the FIRST block inside a parent's statement input,
 * return { parent, inputName }. Otherwise return null.
 */
function getStatementParentInputIfFirst(targetBlock) {
  if (!targetBlock || !targetBlock.previousConnection || !targetBlock.previousConnection.isConnected()) {
    return null;
  }
  const parent = targetBlock.getParent && targetBlock.getParent();
  if (!parent) return null;
  // Check each input on the parent to see if its statement connection points to targetBlock
  const inputs = parent.inputList || [];
  for (const inp of inputs) {
    if (inp && inp.connection && typeof inp.connection.targetBlock === 'function') {
      const tb = inp.connection.targetBlock();
      if (tb === targetBlock) {
        return { parent, inputName: inp.name, input: inp };
      }
    }
  }
  return null;
}

/**
 * Disconnect a connection if it's connected
 */
function disconnectIf(connection) {
  if (connection && connection.isConnected()) {
    connection.disconnect();
  }
}

/**
 * Disconnect a connection and properly dispose of shadow blocks
 * Following Blockly's internal pattern from removeInput method
 */
function disconnectAndCleanupShadows(connection) {
  if (!connection || !connection.isConnected()) {
    return;
  }
  
  // Follow Blockly's exact pattern for removing inputs with shadow blocks:
  // 1. Set shadow DOM to null
  if (connection.setShadowDom) {
    connection.setShadowDom(null);
  }
  
  // 2. Get the target block
  const targetBlock = connection.targetBlock();
  
  if (targetBlock) {
    // 3. If it's a shadow block, dispose it; otherwise unplug it
    if (targetBlock.isShadow && targetBlock.isShadow()) {
      targetBlock.dispose();
    } else {
      targetBlock.unplug();
    }
  }
}

/**
 * Require a connection condition or throw error
 */
function requireConnection(condition, message, code = 'CONNECTION_MISMATCH') {
  if (!condition) {
    throw { code, message };
  }
}

/**
 * Detach a block (and its following stack) from current parent/stack
 */
function detachBlocks(blockId) {
  const ws = getWorkspace();
  const src = ws.getBlockById(blockId);
  if (!src) return createError('NOT_FOUND', `Block not found: ${blockId}`);

  try {
    // Detach flow:
    // 1) Gather stack context (tail/after, parent input or previous block).
    // 2) Pre-validate reconnection for the remaining chain.
    // 3) Disconnect current links, then restore the remaining chain.
    const parentInfo = getStatementParentInputIfFirst(src);
    const srcTail = getLastOfStack(src);
    const after = srcTail.nextConnection && srcTail.nextConnection.targetBlock
      ? srcTail.nextConnection.targetBlock()
      : null;
    const prevConnected = src.previousConnection && src.previousConnection.isConnected();
    const prevBlock = prevConnected ? src.previousConnection.targetBlock() : null;

    if (parentInfo) {
      requireConnection(parentInfo.input && parentInfo.input.connection, "Parent statement input missing connection");
      if (after) {
        requireConnection(after.previousConnection, 'Cannot reconnect blocks after detached stack');
      }
    } else if (prevConnected && prevBlock && after) {
      requireConnection(prevBlock.nextConnection && after.previousConnection, 'Cannot reconnect around detached stack');
    }

    if (after) {
      disconnectIf(srcTail.nextConnection);
    }

    if (parentInfo) {
      disconnectIf(parentInfo.input.connection);
      if (after) {
        parentInfo.input.connection.connect(after.previousConnection);
      }
    } else if (prevConnected) {
      disconnectIf(src.previousConnection);
      if (prevBlock && after && prevBlock.nextConnection && after.previousConnection) {
        prevBlock.nextConnection.connect(after.previousConnection);
      }
    }

    return createSuccess({ detached: true, blockId: src.id, topId: getTopOfStack(src).id });
  } catch (e) {
    if (e && e.code) return { success: false, error: e };
    return createError('ERROR', e && e.message ? e.message : String(e));
  }
}

/**
 * Connect blocks with different placement strategies
 */
function connectBlocks(sourceBlockId, targetBlockId, placement) {
  const ws = getWorkspace();
  const kind = placement && placement.kind;
  const inputName = placement && placement.inputName;

  const get = id => ws.getBlockById(id);
  const src = get(sourceBlockId);
  const tgt = get(targetBlockId);
  
  if (!src) return createError('NOT_FOUND', `Source not found: ${sourceBlockId}`);
  if (!tgt) return createError('NOT_FOUND', `Target not found: ${targetBlockId}`);
  if (src === tgt) return createError('INVALID_ARG', 'Source and target are the same');

  let result;
  
  try {
    switch (kind) {
      case 'stack_before': {
        // stack_before flow:
        // 1) Validate source is stack-capable and target is not inside the source stack (avoid cycles).
        // 2) If target is the first block of a statement input, insert source into that input and
        //    chain the original substack after source's tail.
        // 3) Otherwise, pre-validate that source can be detached from its current location
        //    (either from a statement input or from a linear stack), and that target has a previousConnection.
        // 4) Detach source from its original position, reconnect any remaining blocks to preserve the old stack.
        // 5) Insert source before target in the target's stack (prev -> source -> target).
        requireConnection(src.nextConnection, 'Source needs nextConnection (a stack-capable block)');
        if (isBlockInStack(src, tgt)) {
          return createError('INVALID_ARG', 'Target is within source stack');
        }
        // Special handling: if target is the FIRST block inside a parent's statement input (e.g., SUBSTACK),
        // we should insert the source into that input rather than treating it as a linear stack connection.
        const stmtInfo = getStatementParentInputIfFirst(tgt);
        if (stmtInfo) {
          const { parent, inputName, input } = stmtInfo;
          requireConnection(input && input.connection, `Target's parent lacks connection for statement input '${inputName}'`);
          requireConnection(src.previousConnection, 'Source must be a statement block (has previousConnection)');
          const tail = getLastOfStack(src);
          requireConnection(tail.nextConnection && tgt.previousConnection, 'Cannot chain existing stack after source');

          // Disconnect the input connection (not the target's previousConnection), then connect source into it
          disconnectIf(input.connection);
          input.connection.connect(src.previousConnection);

          // Chain existing substack (starting at tgt) after the tail of source's stack
          tail.nextConnection.connect(tgt.previousConnection);

          result = createSuccess({connected: true, kind: 'statement_into', inputName, sourceId: src.id, targetId: parent.id});
        } else {
          const srcStack = getTopOfStack(src);
          const srcParentInfo = getStatementParentInputIfFirst(srcStack);
          const srcTail = getLastOfStack(src);
          const srcNextBlocks = srcTail.nextConnection && srcTail.nextConnection.targetBlock
            ? srcTail.nextConnection.targetBlock()
            : null;
          const srcPrevConnected = src.previousConnection && src.previousConnection.isConnected();
          const srcPrevBlock = srcPrevConnected ? src.previousConnection.targetBlock() : null;

          if (srcParentInfo) {
            requireConnection(srcParentInfo.input && srcParentInfo.input.connection, "Source's parent lacks statement input connection");
            if (srcNextBlocks) {
              requireConnection(srcNextBlocks.previousConnection, 'Cannot reconnect blocks after source');
            }
          } else if (srcPrevConnected && srcPrevBlock && srcNextBlocks) {
            requireConnection(srcPrevBlock.nextConnection && srcNextBlocks.previousConnection, 'Cannot reconnect around source');
          }

          const prev = tgt.previousConnection && tgt.previousConnection.targetBlock && tgt.previousConnection.targetBlock();
          requireConnection(tgt.previousConnection, 'Target missing previousConnection');
          if (prev) {
            requireConnection(prev.nextConnection && src.previousConnection, 'Cannot wire prev->source (missing connections)');
          }

          if (srcParentInfo) {
            if (srcNextBlocks) {
              disconnectIf(srcTail.nextConnection);
            }
            disconnectIf(srcParentInfo.input.connection);
            if (srcNextBlocks) {
              srcParentInfo.input.connection.connect(srcNextBlocks.previousConnection);
            }
          } else if (srcPrevConnected) {
            if (srcNextBlocks) {
              disconnectIf(srcTail.nextConnection);
            }
            disconnectIf(src.previousConnection);
            if (srcPrevBlock && srcNextBlocks && srcPrevBlock.nextConnection && srcNextBlocks.previousConnection) {
              srcPrevBlock.nextConnection.connect(srcNextBlocks.previousConnection);
            }
          }

          disconnectIf(tgt.previousConnection);
          if (prev) {
            prev.nextConnection.connect(src.previousConnection);
          }
          src.nextConnection.connect(tgt.previousConnection);
          result = createSuccess({connected: true, kind, sourceId: src.id, targetId: tgt.id});
        }
        break;
      }

      case 'stack_after': {
        // stack_after flow:
        // 1) Validate source is stack-capable, target has nextConnection, and target is not inside source stack.
        // 2) Gather source's current placement context (parent statement input or linear stack),
        //    plus the tail/next blocks needed to restore the original stack after detaching.
        // 3) Pre-validate that detaching source and reconnecting its neighbors is possible.
        // 4) Pre-validate that target -> source and (if present) source -> next connections are possible.
        // 5) Detach source from its original position, reconnect any remaining blocks.
        // 6) Insert source after target and reconnect the original next chain.
        requireConnection(src.previousConnection, 'Source needs previousConnection (a stack-capable block)');
        if (isBlockInStack(src, tgt)) {
          return createError('INVALID_ARG', 'Target is within source stack');
        }
        requireConnection(tgt.nextConnection, 'Target needs nextConnection');
        const next = tgt.nextConnection && tgt.nextConnection.targetBlock && tgt.nextConnection.targetBlock();

        const srcStack = getTopOfStack(src);
        const srcParentInfo = getStatementParentInputIfFirst(srcStack);
        const srcTail = getLastOfStack(src);
        const srcNextBlocks = srcTail.nextConnection && srcTail.nextConnection.targetBlock
          ? srcTail.nextConnection.targetBlock()
          : null;
        const srcPrevConnected = src.previousConnection && src.previousConnection.isConnected();
        const srcPrevBlock = srcPrevConnected ? src.previousConnection.targetBlock() : null;

        if (srcParentInfo) {
          requireConnection(srcParentInfo.input && srcParentInfo.input.connection, "Source's parent lacks statement input connection");
          if (srcNextBlocks) {
            requireConnection(srcNextBlocks.previousConnection, 'Cannot reconnect blocks after source');
          }
        } else if (srcPrevConnected && srcPrevBlock && srcNextBlocks) {
          requireConnection(srcPrevBlock.nextConnection && srcNextBlocks.previousConnection, 'Cannot reconnect around source');
        }

        requireConnection(tgt.nextConnection && src.previousConnection, 'Cannot wire target->source (missing connections)');
        if (next) {
          requireConnection(src.nextConnection && next.previousConnection, 'Cannot wire source->next (missing connections)');
        }

        if (srcParentInfo) {
          if (srcNextBlocks) {
            disconnectIf(srcTail.nextConnection);
          }
          disconnectIf(srcParentInfo.input.connection);
          if (srcNextBlocks) {
            srcParentInfo.input.connection.connect(srcNextBlocks.previousConnection);
          }
        } else if (srcPrevConnected) {
          if (srcNextBlocks) {
            disconnectIf(srcTail.nextConnection);
          }
          disconnectIf(src.previousConnection);
          if (srcPrevBlock && srcNextBlocks && srcPrevBlock.nextConnection && srcNextBlocks.previousConnection) {
            srcPrevBlock.nextConnection.connect(srcNextBlocks.previousConnection);
          }
        }

        disconnectIf(tgt.nextConnection);
        tgt.nextConnection.connect(src.previousConnection);
        if (next) {
          src.nextConnection.connect(next.previousConnection);
        }
        result = createSuccess({connected: true, kind, sourceId: src.id, targetId: tgt.id});
        break;
      }

      case 'statement_into': {
        // statement_into flow:
        // 1) Validate source is a statement block, target has the requested statement input,
        //    and target is not within the source stack (to avoid cycles).
        // 2) Gather source placement context (parent statement input or linear stack),
        //    plus tail/next blocks needed to restore the original chain after detaching.
        // 3) Pre-validate that detaching source and reconnecting its neighbors is possible.
        // 4) Pre-validate that inserting source into the target input (and chaining any
        //    existing substack after it) is possible.
        // 5) Detach source from its original location and restore the original chain.
        // 6) Insert source into the target input and chain any existing substack after it.
        const name = inputName || 'SUBSTACK';
        const input = tgt.getInput(name);
        requireConnection(input && input.connection, `Target has no statement input '${name}'`);
        requireConnection(src.previousConnection, 'Source must be a statement block (has previousConnection)');
        if (isBlockInStack(src, tgt)) {
          return createError('INVALID_ARG', 'Target is within source stack');
        }

        const srcStack = getTopOfStack(src);
        const srcParentInfo = getStatementParentInputIfFirst(srcStack);
        const srcTail = getLastOfStack(src);
        const srcNextBlocks = srcTail.nextConnection && srcTail.nextConnection.targetBlock
          ? srcTail.nextConnection.targetBlock()
          : null;
        const srcPrevConnected = src.previousConnection && src.previousConnection.isConnected();
        const srcPrevBlock = srcPrevConnected ? src.previousConnection.targetBlock() : null;

        if (srcParentInfo) {
          requireConnection(srcParentInfo.input && srcParentInfo.input.connection, "Source's parent lacks statement input connection");
          if (srcNextBlocks) {
            requireConnection(srcNextBlocks.previousConnection, 'Cannot reconnect blocks after source');
          }
        } else if (srcPrevConnected && srcPrevBlock && srcNextBlocks) {
          requireConnection(srcPrevBlock.nextConnection && srcNextBlocks.previousConnection, 'Cannot reconnect around source');
        }

        const existingFirst = input.connection.targetBlock && input.connection.targetBlock();
        if (existingFirst) {
          requireConnection(srcTail.nextConnection && existingFirst.previousConnection, 'Cannot chain existing stack after source');
        }

        if (srcParentInfo) {
          if (srcNextBlocks) {
            disconnectIf(srcTail.nextConnection);
          }
          disconnectIf(srcParentInfo.input.connection);
          if (srcNextBlocks) {
            srcParentInfo.input.connection.connect(srcNextBlocks.previousConnection);
          }
        } else if (srcPrevConnected) {
          if (srcNextBlocks) {
            disconnectIf(srcTail.nextConnection);
          }
          disconnectIf(src.previousConnection);
          if (srcPrevBlock && srcNextBlocks && srcPrevBlock.nextConnection && srcNextBlocks.previousConnection) {
            srcPrevBlock.nextConnection.connect(srcNextBlocks.previousConnection);
          }
        }

        if (existingFirst) {
          disconnectIf(input.connection);
          input.connection.connect(src.previousConnection);
          srcTail.nextConnection.connect(existingFirst.previousConnection);
        } else {
          input.connection.connect(src.previousConnection);
        }
        
        result = createSuccess({connected: true, kind, inputName: name, sourceId: src.id, targetId: tgt.id});
        break;
      }

      case 'value_into': {
        // value_into flow:
        // 1) Resolve/validate the target value input name.
        // 2) Validate source is a value block and target input exists.
        // 3) Ensure the target is not within source's parent chain (avoid cycles).
        // 4) Detach any existing shadow/input content, then connect source output.
        let name = inputName;
        if (!name) {
          const valueInputs = (tgt.inputList || []).filter(inp => inp.connection && inp.type === 1);
          if (valueInputs.length !== 1) {
            throw {code: 'INVALID_ARG', message: "inputName required for value_into (can't infer uniquely)"};
          }
          name = valueInputs[0].name;
        }
        const input = tgt.getInput(name);
        requireConnection(input && input.connection, `Target has no value input '${name}'`);
        requireConnection(src.outputConnection, 'Source must be a reporter/predicate (has outputConnection)');
        if (isBlockAncestor(src, tgt)) {
          return createError('INVALID_ARG', 'Target is within source hierarchy');
        }
        
        // Properly clean up any existing shadow blocks using Blockly's pattern
        disconnectAndCleanupShadows(input.connection);
        
        input.connection.connect(src.outputConnection);
        result = createSuccess({connected: true, kind, inputName: name, sourceId: src.id, targetId: tgt.id});
        break;
      }

      case 'wrap': {
        // wrap flow:
        // 1) Validate source is a C-block with the requested statement input,
        //    and ensure the target stack is not inside the source hierarchy.
        // 2) Gather top/last blocks for the target stack plus its adjacent neighbors.
        // 3) Pre-validate all connections needed for rewiring.
        // 4) Detach neighboring connections, insert source, then wrap the stack.
        const name = inputName || 'SUBSTACK';
        const sub = src.getInput(name);
        requireConnection(sub && sub.connection, `Source C-block has no statement input '${name}'`);
        const top = getTopOfStack(tgt);
        if (isBlockAncestor(src, top)) {
          return createError('INVALID_ARG', 'Target is within source hierarchy');
        }
        const last = getLastOfStack(top);
        const prev = top.getPreviousBlock && top.getPreviousBlock();
        const after = last.getNextBlock && last.getNextBlock();

        requireConnection(top.previousConnection, 'Target stack has no previousConnection');
        if (prev) {
          requireConnection(prev.nextConnection && src.previousConnection, 'Cannot connect prev->source');
        }
        if (after) {
          requireConnection(src.nextConnection && after.previousConnection, 'Cannot connect source->after');
        }

        if (prev) {
          disconnectIf(prev.nextConnection);
          prev.nextConnection.connect(src.previousConnection);
        }

        if (after) {
          disconnectIf(last.nextConnection);
        }

        sub.connection.connect(top.previousConnection);

        if (after && src.nextConnection) {
          src.nextConnection.connect(after.previousConnection);
        }

        result = createSuccess({connected: true, kind, substack: name, wrappedTopId: top.id, sourceId: src.id});
        break;
      }

      default:
        return createError('INVALID_ARG', `Unknown placement.kind: ${kind}`);
    }
    
    return result;
    
  } catch (e) {
    if (e && e.code) return { ok: false, error: e };
    return createError('ERROR', e && e.message ? e.message : String(e));
  }
}
