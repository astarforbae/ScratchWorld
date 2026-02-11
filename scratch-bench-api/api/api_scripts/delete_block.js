/**
 * Delete a block from the workspace
 */
(blockId) => {
  try {
    const vm = getVM();
    if (!vm.editingTarget) {
      return createError('NO_TARGET', 'No editing target available');
    }
    
    const workspace = Blockly.getMainWorkspace();
    const visualBlock = workspace.getBlockById(blockId);
    
    if (!visualBlock) {
      return createError('NOT_FOUND', 'Visual block not found in workspace');
    }
    
    // Store block info before deletion
    const blockInfo = {
      id: blockId,
      opcode: visualBlock.type || 'unknown'
    };
    
    // Delete the block (this also removes it from connected blocks)
    visualBlock.dispose();
    
    return createSuccess({deletedBlock: blockInfo});
  } catch (error) {
    return createError('EXECUTION_ERROR', error.message || 'Failed to delete block');
  }
}
