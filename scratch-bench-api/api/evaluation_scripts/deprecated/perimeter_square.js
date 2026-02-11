/**
 * @evaluation: perimeter_square
 *
 * Validates the following behaviors for the Perimeter Square project:
 * 1) Correctly calculates perimeter for side length 10 (10 -> 40)
 * 2) Correctly calculates perimeter for side length 5 (5 -> 20)
 * 3) Correctly calculates perimeter for side length 4 (4 -> 16)
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
    { input: 10, expected: 40, name: "perimeter_square_10" },
    { input: 5, expected: 20, name: "perimeter_square_5" },
    { input: 4, expected: 16, name: "perimeter_square_4" }
  ];

  const questionKeywords = ['side length', 'enter', 'input'];

  try {
    console.log('[Perimeter Square] Begin');

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
        console.log(`[Perimeter Square] Test ${testCase.name} failed:`, error.message);
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

    console.log('[Perimeter Square] Done', payload);
    return payload;
  } catch (err) {
    console.log('[Perimeter Square] Error:', err.message);
    try { vm.runtime.stopAll(); } catch {}
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();
    throw err;
  }
};
