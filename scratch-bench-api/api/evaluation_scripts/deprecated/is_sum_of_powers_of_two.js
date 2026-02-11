/**
 * @evaluation: is_sum_of_powers_of_two
 *
 * Validates the following behaviors for the Sum of Powers of Two project:
 * 1) Correctly identifies number that can be sum of powers of 2 (10 -> true)
 * 2) Correctly identifies number that cannot be sum of powers of 2 (7 -> false)
 * 3) Correctly identifies another number that can be sum of powers of 2 (14 -> true)
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
    { input: "10", expected: "true", name: "sum_powers_of_2_10" },
    { input: "7", expected: "false", name: "not_sum_powers_of_2_7" },
    { input: "14", expected: "true", name: "sum_powers_of_2_14" }
  ];

  const questionKeywords = ['input'];

  try {
    console.log('[Sum of Powers of Two] Begin');

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
        console.log(`[Sum of Powers of Two] Test ${testCase.name} failed:`, error.message);
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

    console.log('[Sum of Powers of Two] Done', payload);
    return payload;
  } catch (err) {
    console.log('[Sum of Powers of Two] Error:', err.message);
    try { vm.runtime.stopAll(); } catch {}
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();
    throw err;
  }
};
