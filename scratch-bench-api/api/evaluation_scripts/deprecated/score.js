/**
 * @evaluation: score
 *
 * Validates the following behaviors for the Score project:
 * 1) Score variable exists and reaches expected value
 *
 * The evaluation runs a single test case and returns a comprehensive result.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 5);
  const timeoutMs = timeoutSec * 1000;

  let timeoutTimer = null;

  const restartProject = async () => {
    try { vm.runtime.stopAll(); } catch {}
    EU.startVM(vm);
    await EU.wait(400);
  };

  try {
    console.log('[Score] Begin');

    // Global timeout guard
    await new Promise((resolve, reject) => {
      timeoutTimer = EU.createTimeout(timeoutMs, () => reject(new Error('Timeout')));
      resolve();
    });

    await restartProject();
    await EU.wait(300);

    const results = {};
    const expectedScore = (config && config.assertions && config.assertions[0]) ? config.assertions[0].expected : 10;
    
    // Test case: Check if score variable reaches expected value
    try {
      const testResult = await new Promise((resolve, reject) => {
        let scoreFound = false;
        const testTimeout = setTimeout(() => {
          if (!scoreFound) {
            reject(new Error('Score variable not found'));
          } else {
            reject(new Error('Score did not reach expected value'));
          }
        }, timeoutMs);

        const monitorsListener = () => {
          try {
            const targets = vm.runtime.targets;
            for (const target of targets) {
              const variables = target.variables;
              for (const varId in variables) {
                const variable = variables[varId];
                if (variable.name.toLowerCase() === 'score') {
                  scoreFound = true;
                  console.log(`[Score] Current score value: ${variable.value}`);
                  
                  if (variable.value >= expectedScore) {
                    clearTimeout(testTimeout);
                    vm.runtime.off('MONITORS_UPDATE', monitorsListener);
                    resolve(true);
                    return;
                  }
                }
              }
            }
          } catch (error) {
            clearTimeout(testTimeout);
            vm.runtime.off('MONITORS_UPDATE', monitorsListener);
            reject(error);
          }
        };

        vm.runtime.on('MONITORS_UPDATE', monitorsListener);
        vm.greenFlag();
      });
      
      results["score_test"] = testResult;
    } catch (error) {
      console.log(`[Score] Test failed:`, error.message);
      results["score_test"] = false;
    }

    const passedTests = Object.values(results).filter(Boolean).length;
    const totalTests = Object.keys(results).length;

    const payload = {
      success: passedTests === totalTests,
      passed_tests: passedTests,
      total_tests: totalTests,
      partial_success_rate: totalTests ? passedTests / totalTests : 0,
      details: Object.keys(results).map((k) => ({ name: k, passed: !!results[k] })),
    };

    try { vm.runtime.stopAll(); } catch {}
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();

    console.log('[Score] Done', payload);
    return payload;
  } catch (err) {
    console.log('[Score] Error:', err.message);
    try { vm.runtime.stopAll(); } catch {}
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();
    throw err;
  }
};
