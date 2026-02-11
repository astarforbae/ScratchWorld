/**
 * Select a sprite by name
 */
(spriteName) => {
  if (!spriteName) {
    return createError('INVALID_ARG', 'Sprite name is required');
  }

  try {
    const vm = getVM();
    if (!vm.runtime || !Array.isArray(vm.runtime.targets)) {
      return createError('VM_UNAVAILABLE', 'VM targets not available');
    }
    
    const name = spriteName.toLowerCase();
    const target = vm.runtime.targets.find(t => 
      !t.isStage && 
      typeof t.getName === 'function' && 
      t.getName().toLowerCase() === name
    );
    
    if (!target) {
      return createError('NOT_FOUND', 'Sprite not found: ' + spriteName);
    }
    
    if (typeof vm.setEditingTarget !== 'function') {
      return createError('API_UNAVAILABLE', 'setEditingTarget not available');
    }
    
    vm.setEditingTarget(target.id);
    return createSuccess({
      selected: target.getName(), 
      targetId: target.id
    });
  } catch (e) {
    return createError('EXECUTION_ERROR', e.message || 'Failed to select sprite');
  }
}
