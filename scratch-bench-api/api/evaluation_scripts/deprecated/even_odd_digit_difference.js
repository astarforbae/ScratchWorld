/**
 * @evaluation: even_odd_digit_difference
 *
 * Validates even-odd digit difference calculation:
 * 1) Correctly identifies 12345 as not divisible by 11 (False)
 * 2) Correctly identifies 1212112 as divisible by 11 (True)
 * 3) Correctly identifies 1212 as not divisible by 11 (False)
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 30);
  const timeoutMs = timeoutSec * 1000;

  let timeoutTimer = null;

  try {
    console.log('[Even Odd Digit Difference] Begin');

    // Global timeout guard
    await new Promise((resolve, reject) => {
      timeoutTimer = EU.createTimeout(timeoutMs, () => reject(new Error('Timeout')));
      resolve();
    });

    const testCases = [
      { input: "12345", expected: "False" },
      { input: "1212112", expected: "True" },
      { input: "1212", expected: "False" }
    ];

    const questionKeywords = ['input'];
    const testConfig = {
      timeout: timeoutSec,
      spriteName: "Sprite1"
    };

    const testResult = await EU.runQuestionAnswerTests(
      vm, 
      testCases, 
      questionKeywords, 
      testConfig, 
      cleanup
    );

    const success = !!testResult;
    const results = {
      evenOddDigitDifferenceCalculation: success
    };

    const passedTests = Object.values(results).filter(Boolean).length;
    const totalTests = Object.keys(results).length;

    const payload = {
      success: success,
      passed_tests: passedTests,
      total_tests: totalTests,
      partial_success_rate: totalTests ? passedTests / totalTests : 0,
      details: Object.keys(results).map((k) => ({ name: k, passed: !!results[k] }))
    };

    if (timeoutTimer) clearTimeout(timeoutTimer);
    console.log('[Even Odd Digit Difference] Done', payload);
    return payload;
  } catch (err) {
    console.log('[Even Odd Digit Difference] Error:', err.message);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();
    throw err;
  }
};
