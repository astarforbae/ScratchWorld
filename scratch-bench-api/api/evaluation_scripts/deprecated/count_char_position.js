/**
 * @evaluation: count_char_position evaluation function for count_char_position task (using reusable function).
 * This function evaluates whether the sprite correctly counts characters at matching alphabet positions.
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

  // Define character position counting test cases
  const testCases = [
    { input: "xbcefg", expected: 2, description: "counts characters at matching positions in xbcefg" },
    { input: "ABcED", expected: 3, description: "counts characters at matching positions in ABcED" },
    { input: "AbgdeF", expected: 5, description: "counts characters at matching positions in AbgdeF" }
  ];

  // Keywords used to detect the input prompt from the sprite
  const questionKeywords = ["input", "string", "enter"];
  let timeoutTimer = null;

  try {
    console.log('[Count Char Position] Begin evaluation');

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
        console.log(`[Count Char Position] Running test case ${i + 1}: ${testCase.description}`);

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

        console.log(`[Count Char Position] Test case ${i + 1} result: ${testResult}`);
      } catch (error) {
        console.log(`[Count Char Position] Test case ${i + 1} failed with error:`, error.message);
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
    console.log('[Count Char Position] Done', payload);
    return payload;
  } catch (err) {
    console.log('[Count Char Position] Error:', err.message);
    try { vm.runtime.stopAll(); } catch {}
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();
    throw err;
  }
};
