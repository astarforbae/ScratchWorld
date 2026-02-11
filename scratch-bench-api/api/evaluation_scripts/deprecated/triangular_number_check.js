/**
 * @evaluation: triangular_number_check
 *
 * Create a Scratch program that checks if a given positive integer is a triangular number. The sprite should say 'True' if it is, and 'False' otherwise.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 30);
  const timeoutMs = timeoutSec * 1000;

  let timeoutTimer = null;

  try {
    console.log('[Triangular Number Check] Begin');

    // Global timeout guard
    await new Promise((resolve, reject) => {
      timeoutTimer = EU.createTimeout(timeoutMs, () => reject(new Error('Timeout')));
      resolve();
    });

    const testCases = [
      {
            "input": "1",
            "expected": "True"
      },
      {
            "input": "3",
            "expected": "True"
      },
      {
            "input": "4",
            "expected": "False"
      }
];

    const questionKeywords = ['input', 'number', 'string', 'enter', 'value', '?', 'list'];
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
      triangularNumberCheck: success
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
    console.log('[Triangular Number Check] Done', payload);
    return payload;

  } catch (err) {
    console.log('[Triangular Number Check] Error:', err.message);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();
    throw err;
  }
};
