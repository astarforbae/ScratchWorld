/**
 * Create a variable in the current target
 */
(payload) => {
  try {
    const vm = getVM();
    const name = (payload && payload.name ? String(payload.name) : '').trim();
    const scope = (payload && payload.scope ? String(payload.scope) : 'sprite').trim();
    const cloud = !!(payload && payload.cloud);
    if (!name) return createError('INVALID_NAME', 'Invalid name');

    const stage = (vm.runtime && typeof vm.runtime.getTargetForStage === 'function')
      ? vm.runtime.getTargetForStage()
      : (vm.runtime && vm.runtime.targets && vm.runtime.targets.find(t => t.isStage));
    const isLocal = scope === 'sprite';
    const target = isLocal ? vm.editingTarget : stage;
    if (!target) return createError('TARGET_UNAVAILABLE', 'Target unavailable for variable creation');
    if (typeof target.createVariable !== 'function') return createError('API_UNAVAILABLE', 'createVariable API not available on target');

    const type = '';
    const existing = (typeof target.lookupVariableByNameAndType === 'function') ? target.lookupVariableByNameAndType(name, type) : null;
    let id, created = false;
    if (!existing) {
      id = generateId();
      // Cloud var flag only valid on stage/global
      target.createVariable(id, name, type, !!cloud && !isLocal);
      created = true;
    } else {
      id = existing.id;
    }

    if (typeof vm.emitWorkspaceUpdate === 'function') vm.emitWorkspaceUpdate();
    if (vm.runtime && typeof vm.runtime.emitProjectChanged === 'function') vm.runtime.emitProjectChanged();
    return createSuccess({name, id, scope: isLocal ? 'sprite' : 'all', created});
  } catch (e) {
    return createError('EXECUTION_ERROR', e.message || 'Failed to create variable');
  }
}
