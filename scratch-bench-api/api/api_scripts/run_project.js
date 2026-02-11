/**
 * Start project using Scratch VM directly
 */
(() => {
  try {
    const vm = getVM();
    if (typeof vm.greenFlag === 'function') {
      vm.greenFlag();
      return createSuccess({result: 'started'});
    }
    return createError('API_UNAVAILABLE', 'greenFlag API not available');
  } catch (e) {
    return createError('EXECUTION_ERROR', e.message || 'Failed to start project');
  }
})()
