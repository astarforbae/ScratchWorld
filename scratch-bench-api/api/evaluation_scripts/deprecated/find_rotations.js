/**
 * @evaluation: find_rotations
 *
 * Validates minimum string rotations calculation:
 * 1) Correctly finds 1 rotation for string "aaaa"
 * 2) Correctly finds 2 rotations for string "ab"
 * 3) Correctly finds 3 rotations for string "abc"
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 15);
  const timeoutMs = timeoutSec * 1000;

  let timeoutTimer = null;

  try {
    console.log('[Find Rotations] Begin');

    // Global timeout guard
    await new Promise((resolve, reject) => {
      timeoutTimer = EU.createTimeout(timeoutMs, () => reject(new Error('Timeout')));
      resolve();
    });

    const testCases = [
      { input: "aaaa", expected: 1 },
      { input: "ab", expected: 2 },
      { input: "abc", expected: 3 }
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
      findRotationsCalculation: success
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
    console.log('[Find Rotations] Done', payload);
    return payload;
  } catch (err) {
    console.log('[Find Rotations] Error:', err.message);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();
    throw err;
  }
};
