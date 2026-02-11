/**
 * @evaluation: Centered hexagonal number evaluation function for centered_hexagonal_number task (using reusable function).
 * This function evaluates whether the sprite correctly calculates the nth centered hexagonal number.
 * Uses the reusable runQuestionAnswerTests function from evaluation_utils.js.
 * 
 * @param {Object} vm - Scratch VM instance
 * @param {Object} config - Test configuration
 * @param {Function} cleanup - Cleanup function
 * @returns {Promise<boolean>} Test result
 */

module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 15);
  const timeoutMs = timeoutSec * 1000;

  // Define centered hexagonal number test cases
  const testCases = [
    { input: "10", expected: "271", description: "calculates centered hexagonal number for 10" },
    { input: "2", expected: "7", description: "calculates centered hexagonal number for 2" },
    { input: "9", expected: "217", description: "calculates centered hexagonal number for 9" }
  ];

  // Keywords used to detect the input prompt from the sprite
  const questionKeywords = ["input", "number", "enter"];
  let timeoutTimer = null;

  try {
    console.log('[Centered Hexagonal Number] Begin evaluation');

    // Global timeout guard
    await new Promise((resolve, reject) => {
      timeoutTimer = EU.createTimeout(timeoutMs, () => reject(new Error('Timeout')));
      resolve();
    });

    const results = {};
    let passedTests = 0;

    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      const testName = `test_case_${i + 1}_${testCase.input}`;

      try {
        console.log(`[Centered Hexagonal Number] Running test case ${i + 1}: ${testCase.description}`);

        const testConfig = {
          timeout: 10,
          spriteName: "Sprite1"
        };

        const testResult = await EU.runQuestionAnswerTests(
          vm,
          [testCase],
          questionKeywords,
          testConfig,
          () => {}
        );

        results[testName] = testResult;
        if (testResult) {
          passedTests++;
        }

        console.log(`[Centered Hexagonal Number] Test case ${i + 1} result: ${testResult}`);
      } catch (error) {
        console.log(`[Centered Hexagonal Number] Test case ${i + 1} failed with error:`, error.message);
        results[testName] = false;
      }
    }

    const totalTests = testCases.length;
    const payload = {
      success: passedTests === totalTests,
      passed_tests: passedTests,
      total_tests: totalTests,
      partial_success_rate: totalTests ? passedTests / totalTests : 0,
      details: Object.keys(results).map((testName) => ({
        name: testName,
        passed: !!results[testName]
      }))
    };

    try { vm.runtime.stopAll(); } catch {}
    if (timeoutTimer) clearTimeout(timeoutTimer);
    console.log('[Centered Hexagonal Number] Done', payload);
    return payload;
  } catch (err) {
    console.log('[Centered Hexagonal Number] Error:', err.message);
    try { vm.runtime.stopAll(); } catch {}
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();
    throw err;
  }
};
