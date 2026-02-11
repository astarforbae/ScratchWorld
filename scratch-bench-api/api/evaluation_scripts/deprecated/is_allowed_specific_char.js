/**
 * @evaluation: is_allowed_specific_char
 *
 * Validates the following behaviors for the Character Validation project:
 * 1) Correctly validates string with allowed characters (ABCDEFabcdef123450 -> true)
 * 2) Correctly rejects string with disallowed characters (*&%@#!}{ -> false)
 * 3) Correctly validates another allowed string (HELLOhowareyou98765 -> true)
 *
 * The evaluation runs multiple test cases and returns a comprehensive result.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 15);
  const timeoutMs = timeoutSec * 1000;

  let timeoutTimer = null;

  const restartProject = async () => {
    try { vm.runtime.stopAll(); } catch {}
    EU.startVM(vm);
    await EU.wait(400);
  };

  const testCases = [
    { input: "ABCDEFabcdef123450", expected: "true", name: "allowed_chars_test1" },
    { input: "*&%@#!}{", expected: "false", name: "disallowed_chars_test" },
    { input: "HELLOhowareyou98765", expected: "true", name: "allowed_chars_test2" }
  ];

  const questionKeywords = ['string', 'enter', 'input'];

  try {
    console.log('[Character Validation] Begin');

    // Global timeout guard
    await new Promise((resolve, reject) => {
      timeoutTimer = EU.createTimeout(timeoutMs, () => reject(new Error('Timeout')));
      resolve();
    });

    await restartProject();
    await EU.wait(300);

    const results = {};
    
    for (const testCase of testCases) {
      try {
        const result = await EU.runQuestionAnswerTests(
          vm,
          [testCase],
          questionKeywords,
          { timeout: timeoutSec, spriteName: "Sprite1" },
          () => {}
        );
        results[testCase.name] = !!result;
      } catch (error) {
        console.log(`[Character Validation] Test ${testCase.name} failed:`, error.message);
        results[testCase.name] = false;
      }
      await restartProject();
      await EU.wait(200);
    }

    const passedTests = Object.values(results).filter(Boolean).length;
    const totalTests = Object.keys(results).length;

    const payload = {
      success: passedTests === totalTests,
      passed_tests: passedTests,
      total_tests: totalTests,
      partial_success_rate: totalTests ? passedTests / totalTests : 0,
      details: Object.keys(results).map((k) => ({ name: k, passed: !!results[k] })),
    };

    try { vm.runtime.stopAll(); } catch {}
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();

    console.log('[Character Validation] Done', payload);
    return payload;
  } catch (err) {
    console.log('[Character Validation] Error:', err.message);
    try { vm.runtime.stopAll(); } catch {}
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();
    throw err;
  }
};
