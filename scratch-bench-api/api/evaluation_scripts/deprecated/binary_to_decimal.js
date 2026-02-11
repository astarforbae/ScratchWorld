/**
 * @evaluation: Binary to decimal evaluation function for binary_to_decimal task (using reusable function).
 * This function evaluates whether the sprite correctly converts binary numbers to decimal.
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

  // Define binary to decimal test cases
  const testCases = [
    { input: "100", expected: "4", description: "converts 100 to 4" },
    { input: "1011", expected: "11", description: "converts 1011 to 11" },
    { input: "1101101", expected: "109", description: "converts 1101101 to 109" }
  ];

  // Keywords used to detect the input prompt from the sprite
  const questionKeywords = ["input", "binary", "enter"];
  let timeoutTimer = null;

  try {
    console.log('[Binary to Decimal] Begin evaluation');

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
        console.log(`[Binary to Decimal] Running test case ${i + 1}: ${testCase.description}`);

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

        console.log(`[Binary to Decimal] Test case ${i + 1} result: ${testResult}`);
      } catch (error) {
        console.log(`[Binary to Decimal] Test case ${i + 1} failed with error:`, error.message);
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
    console.log('[Binary to Decimal] Done', payload);
    return payload;
  } catch (err) {
    console.log('[Binary to Decimal] Error:', err.message);
    try { vm.runtime.stopAll(); } catch {}
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();
    throw err;
  }
};
