/**
 * @evaluation: get_pell
 *
 * Validates Pell number calculation:
 * 1) Correctly calculates Pell number for input 4 (expected: 12)
 * 2) Correctly calculates Pell number for input 7 (expected: 169)
 * 3) Correctly calculates Pell number for input 8 (expected: 408)
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 15);
  const timeoutMs = timeoutSec * 1000;

  let timeoutTimer = null;

  try {
    console.log('[Get Pell] Begin');

    // Global timeout guard
    await new Promise((resolve, reject) => {
      timeoutTimer = EU.createTimeout(timeoutMs, () => reject(new Error('Timeout')));
      resolve();
    });

    const testCases = [
      { input: "4", expected: 12 },
      { input: "7", expected: 169 },
      { input: "8", expected: 408 }
    ];

    const questionKeywords = ['number', 'enter', 'input'];
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
      pellNumberCalculation: success
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
    console.log('[Get Pell] Done', payload);
    return payload;
  } catch (err) {
    console.log('[Get Pell] Error:', err.message);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();
    throw err;
  }
};
