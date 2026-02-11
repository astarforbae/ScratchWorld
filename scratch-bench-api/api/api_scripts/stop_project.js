/**
 * Stop project using Scratch VM directly
 */
(() => {
  try {
    const vm = getVM();
    if (typeof vm.stopAll === 'function') {
      vm.stopAll();
      return createSuccess({result: 'stopped'});
    } else if (vm.runtime && typeof vm.runtime.stopAll === 'function') {
      vm.runtime.stopAll();
      return createSuccess({result: 'stopped'});
    } else {
      return createError('API_UNAVAILABLE', 'stopAll API not available');
    }
  } catch (e) {
    return createError('EXECUTION_ERROR', e.message || 'Failed to stop project');
  }
})
