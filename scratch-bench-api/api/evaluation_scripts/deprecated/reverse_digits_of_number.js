/**
 * @evaluation: reverse_digits_of_number
 *
 * Create a Scratch program that takes a positive integer as input and reverses its digits. The sprite should say the reversed number.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 30);
  const timeoutMs = timeoutSec * 1000;

  let timeoutTimer = null;

  try {
    console.log('[Reverse Digits Of Number] Begin');

    // Global timeout guard
    await new Promise((resolve, reject) => {
      timeoutTimer = EU.createTimeout(timeoutMs, () => reject(new Error('Timeout')));
      resolve();
    });

    const testCases = [
      {
            "input": "123",
            "expected": 321
      },
      {
            "input": "100",
            "expected": 1
      },
      {
            "input": "505",
            "expected": 505
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
      reverseDigitsOfNumber: success
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
    console.log('[Reverse Digits Of Number] Done', payload);
    return payload;

  } catch (err) {
    console.log('[Reverse Digits Of Number] Error:', err.message);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();
    throw err;
  }
};
