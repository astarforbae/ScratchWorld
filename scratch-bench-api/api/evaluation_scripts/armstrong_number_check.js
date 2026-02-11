/**
 * Instruction: Complete the given Scratch starter project to check if a given positive integer is an Armstrong number (equal to the sum of its digits each raised to the power of the number of digits). The sprite should say 'True' if it is, and 'False' otherwise.
 * Unit Test Semantic Goals:
 * 1) Returns True for Armstrong number 153.
 * 2) Returns True for Armstrong number 370.
 * 3) Returns False for non-Armstrong number 123.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);

  const testCases = [
    { name: "input_153_expected_true", input: "153", expected: "True" },
    { name: "input_370_expected_true", input: "370", expected: "True" },
    { name: "input_123_expected_false", input: "123", expected: "False" },
  ];

  try {
    return await EU.runQuestionAnswerTestsDetailed(
      vm,
      testCases,
      ["input", "number", "enter", "value", "?"],
      { timeout: timeoutSec, spriteName: "Sprite1" }
    );
  } finally {
    if (typeof cleanup === "function") cleanup();
  }
};
