/**
 * @evaluation: closest_num
 *
 * Validates that the sprite correctly finds the closest smaller number to a given input.
 * Tests multiple input cases and verifies correct calculation.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 15);
  const timeoutMs = timeoutSec * 1000;

  // Test cases for closest smaller number calculation
  const testCases = [
    { input: "11", expected: 10, description: "Find closest smaller number to 11" },
    { input: "7", expected: 6, description: "Find closest smaller number to 7" },
    { input: "12", expected: 11, description: "Find closest smaller number to 12" }
  ];

  const questionKeywords = ['input'];
  let timeoutTimer = null;

  try {
    console.log('[Closest Number] Begin evaluation');

    // Global timeout guard
    await new Promise((resolve, reject) => {
      timeoutTimer = EU.createTimeout(timeoutMs, () => reject(new Error('Timeout')));
      resolve();
    });

    const results = {};
    let passedTests = 0;

    // Run each test case
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      const testName = `test_case_${i + 1}_${testCase.input}`;
      
      try {
        console.log(`[Closest Number] Running test case ${i + 1}: ${testCase.description}`);
        
        const testConfig = {
          timeout: 10,
          spriteName: "Sprite1"
        };

        const testResult = await EU.runQuestionAnswerTests(
          vm,
          [testCase],
          questionKeywords,
          testConfig,
          () => {} // Empty cleanup for individual tests
        );

        results[testName] = testResult;
        if (testResult) {
          passedTests++;
        }
        
        console.log(`[Closest Number] Test case ${i + 1} result: ${testResult}`);
      } catch (error) {
        console.log(`[Closest Number] Test case ${i + 1} failed with error:`, error.message);
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
    cleanup();

    console.log('[Closest Number] Done', payload);
    return payload;
  } catch (err) {
    console.log('[Closest Number] Error:', err.message);
    try { vm.runtime.stopAll(); } catch {}
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();
    throw err;
  }
};
