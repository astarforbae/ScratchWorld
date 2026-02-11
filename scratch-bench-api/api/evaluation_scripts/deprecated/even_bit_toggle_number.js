/**
 * @evaluation: even_bit_toggle_number
 *
 * Validates even bit toggle functionality:
 * 1) Correctly toggles even-positioned bits for input 10 (expected: 0)
 * 2) Correctly toggles even-positioned bits for input 20 (expected: 30)
 * 3) Correctly toggles even-positioned bits for input 30 (expected: 20)
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 15);
  const timeoutMs = timeoutSec * 1000;

  let timeoutTimer = null;

  try {
    console.log('[Even Bit Toggle] Begin');

    // Global timeout guard
    await new Promise((resolve, reject) => {
      timeoutTimer = EU.createTimeout(timeoutMs, () => reject(new Error('Timeout')));
      resolve();
    });

    const testCases = [
      { input: "10", expected: 0 },
      { input: "20", expected: 30 },
      { input: "30", expected: 20 }
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
      evenBitToggleCalculation: success
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
    console.log('[Even Bit Toggle Number] Done', payload);
    return payload;
  } catch (err) {
    console.log('[Even Bit Toggle] Error:', err.message);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();
    throw err;
  }
};
