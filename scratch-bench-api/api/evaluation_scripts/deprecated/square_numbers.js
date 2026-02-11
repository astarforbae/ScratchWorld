/**
 * @evaluation: square_numbers
 *
 * Validates the following behaviors for the Square Numbers project:
 * 1) Correctly calculates square of 1 (1 -> 1)
 * 2) Correctly calculates square of 2 (2 -> 4)
 * 3) Correctly calculates square of 3 (3 -> 9)
 * 4) Correctly calculates square of 4 (4 -> 16)
 * 5) Correctly calculates square of 5 (5 -> 25)
 *
 * The evaluation runs multiple test cases and returns a comprehensive result.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 30);
  const timeoutMs = timeoutSec * 1000;

  let timeoutTimer = null;

  const restartProject = async () => {
    try { vm.runtime.stopAll(); } catch {}
    EU.startVM(vm);
    await EU.wait(400);
  };

  const testCases = [
    { input: 1, expected: 1, name: "square_numbers_1" },
    { input: 2, expected: 4, name: "square_numbers_2" },
    { input: 3, expected: 9, name: "square_numbers_3" },
    { input: 4, expected: 16, name: "square_numbers_4" },
    { input: 5, expected: 25, name: "square_numbers_5" }
  ];

  const questionKeywords = ['enter a number', 'number', 'input'];

  try {
    console.log('[Square Numbers] Begin');

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
        console.log(`[Square Numbers] Test ${testCase.name} failed:`, error.message);
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

    console.log('[Square Numbers] Done', payload);
    return payload;
  } catch (err) {
    console.log('[Square Numbers] Error:', err.message);
    try { vm.runtime.stopAll(); } catch {}
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();
    throw err;
  }
};
