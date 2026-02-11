/**
 * @evaluation: is_undulating
 *
 * Validates the following behaviors for the Undulating Number project:
 * 1) Correctly identifies undulating number 1212121 (1212121 -> true)
 * 2) Correctly identifies non-undulating number 1991 (1991 -> false)
 * 3) Correctly identifies undulating number 121 (121 -> true)
 *
 * The evaluation runs multiple test cases and returns a comprehensive result.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 15);
  const timeoutMs = timeoutSec * 1000;

  let timeoutTimer = null;

  const restartProject = async () => {
    try { vm.runtime.stopAll(); } catch {}
    EU.startVM(vm);
    await EU.wait(400);
  };

  const testCases = [
    { input: "1212121", expected: "true", name: "undulating_1212121" },
    { input: "1991", expected: "false", name: "non_undulating_1991" },
    { input: "121", expected: "true", name: "undulating_121" }
  ];

  const questionKeywords = ['input'];

  try {
    console.log('[Undulating Number] Begin');

    // Global timeout guard
    await new Promise((resolve, reject) => {
      timeoutTimer = EU.createTimeout(timeoutMs, () => reject(new Error('Timeout')));
      resolve();
    });

    await restartProject();
    await EU.wait(300);

    const results = {};
    
    for (const testCase of testCases) {
      try {
        const result = await EU.runQuestionAnswerTests(
          vm,
          [testCase],
          questionKeywords,
          { timeout: timeoutSec, spriteName: "Sprite1" },
          () => {}
        );
        results[testCase.name] = !!result;
      } catch (error) {
        console.log(`[Undulating Number] Test ${testCase.name} failed:`, error.message);
        results[testCase.name] = false;
      }
      await restartProject();
      await EU.wait(200);
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

    console.log('[Undulating Number] Done', payload);
    return payload;
  } catch (err) {
    console.log('[Undulating Number] Error:', err.message);
    try { vm.runtime.stopAll(); } catch {}
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();
    throw err;
  }
};
