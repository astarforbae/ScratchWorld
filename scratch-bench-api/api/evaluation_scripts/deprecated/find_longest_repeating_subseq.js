/**
 * @evaluation: find_longest_repeating_subseq
 *
 * Validates longest repeating subsequence calculation:
 * 1) Correctly finds length 3 for string "AABEBCDD"
 * 2) Correctly finds length 2 for string "aabb"
 * 3) Correctly finds length 1 for string "aab"
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 15);
  const timeoutMs = timeoutSec * 1000;

  let timeoutTimer = null;

  try {
    console.log('[Find Longest Repeating Subseq] Begin');

    // Global timeout guard
    await new Promise((resolve, reject) => {
      timeoutTimer = EU.createTimeout(timeoutMs, () => reject(new Error('Timeout')));
      resolve();
    });

    const testCases = [
      { input: "AABEBCDD", expected: 3 },
      { input: "aabb", expected: 2 },
      { input: "aab", expected: 1 }
    ];

    const questionKeywords = ['string', 'enter', 'input'];
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
      longestRepeatingSubsequenceCalculation: success
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
    console.log('[Find Longest Repeating Subseq] Done', payload);
    return payload;
  } catch (err) {
    console.log('[Find Longest Repeating Subseq] Error:', err.message);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();
    throw err;
  }
};
