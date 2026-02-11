/**
 * @evaluation: check_string
 *
 * Validates that the sprite correctly identifies strings containing both letters and numbers.
 * Tests multiple input cases and verifies correct string validation.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 15);
  const timeoutMs = timeoutSec * 1000;

  // Test cases for string validation
  const testCases = [
    { input: "thishasboth29", expected: "true", description: "String with both letters and numbers" },
    { input: "python", expected: "false", description: "String with only letters" },
    { input: "string", expected: "false", description: "Another string with only letters" }
  ];

  const questionKeywords = ['string', 'enter', 'input'];
  let timeoutTimer = null;

  try {
    console.log('[Check String] Begin evaluation');

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
        console.log(`[Check String] Running test case ${i + 1}: ${testCase.description}`);
        
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
        
        console.log(`[Check String] Test case ${i + 1} result: ${testResult}`);
      } catch (error) {
        console.log(`[Check String] Test case ${i + 1} failed with error:`, error.message);
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

    console.log('[Check String] Done', payload);
    return payload;
  } catch (err) {
    console.log('[Check String] Error:', err.message);
    try { vm.runtime.stopAll(); } catch {}
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();
    throw err;
  }
};
