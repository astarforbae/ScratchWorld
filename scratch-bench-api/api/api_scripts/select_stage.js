/**
 * Select the stage as the editing target
 */
(() => {
  try {
    const vm = getVM();
    if (!vm.runtime || !Array.isArray(vm.runtime.targets)) {
      return createError('VM_UNAVAILABLE', 'VM targets not available');
    }
    
    if (typeof vm.setEditingTarget !== 'function') {
      return createError('API_UNAVAILABLE', 'setEditingTarget not available');
    }
    
    const stage = vm.runtime.targets.find(t => t.isStage);
    if (!stage) {
      return createError('NOT_FOUND', 'Stage not found');
    }
    
    vm.setEditingTarget(stage.id);
    return createSuccess({
      selected: stage.getName ? stage.getName() : 'Stage', 
      targetId: stage.id
    });
  } catch (e) {
    return createError('EXECUTION_ERROR', e.message || 'Failed to select stage');
  }
})
