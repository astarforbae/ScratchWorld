/**
 * @evaluation: check_reverse_twice
 *
 * Validates that the sprite correctly checks if a number is one less than twice its reverse.
 * Tests multiple input cases and verifies correct reverse calculation and comparison.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 30);
  const timeoutMs = timeoutSec * 1000;

  // Test cases for reverse twice checking
  const testCases = [
    { input: "70", expected: "False", description: "Number not one less than twice its reverse" },
    { input: "23", expected: "False", description: "Another negative case" },
    { input: "73", expected: "True", description: "Number that is one less than twice its reverse" }
  ];

  const questionKeywords = ['input'];
  let timeoutTimer = null;

  try {
    console.log('[Check Reverse Twice] Begin evaluation');

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
        console.log(`[Check Reverse Twice] Running test case ${i + 1}: ${testCase.description}`);
        
        const testConfig = {
          timeout: 15,
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
        
        console.log(`[Check Reverse Twice] Test case ${i + 1} result: ${testResult}`);
      } catch (error) {
        console.log(`[Check Reverse Twice] Test case ${i + 1} failed with error:`, error.message);
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
    console.log('[Check Reverse Twice] Done', payload);
    return payload;
  } catch (err) {
    console.log('[Check Reverse Twice] Error:', err.message);
    try { vm.runtime.stopAll(); } catch {}
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();
    throw err;
  }
};
