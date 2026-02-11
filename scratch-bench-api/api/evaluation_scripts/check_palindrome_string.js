/**
 * Instruction: Complete the given Scratch starter project that takes a string as input and checks if it is a palindrome. The sprite should say 'True' if it is, and 'False' otherwise.
 * Unit Test Semantic Goals:
 * 1) Returns True for palindrome "radar".
 * 2) Returns False for non-palindrome "hello".
 * 3) Returns True for palindrome "12321".
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);

  const testCases = [
    { name: "input_radar_expected_true", input: "radar", expected: "True" },
    { name: "input_hello_expected_false", input: "hello", expected: "False" },
    { name: "input_12321_expected_true", input: "12321", expected: "True" },
  ];

  try {
    return await EU.runQuestionAnswerTestsDetailed(
      vm,
      testCases,
      ["input", "string", "enter", "value", "?"],
      { timeout: timeoutSec, spriteName: "Sprite1" }
    );
  } finally {
    if (typeof cleanup === "function") cleanup();
  }
};
