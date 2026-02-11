/**
 * Instruction: Complete the given Scratch starter project that checks if a given positive integer is a Harshad number (divisible by the sum of its digits). The sprite should say 'True' if it is, and 'False' otherwise.
 * Unit Test Semantic Goals:
 * 1) Returns True for Harshad number 18.
 * 2) Returns False for non-Harshad number 19.
 * 3) Returns True for Harshad number 21.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);

  const testCases = [
    { name: "input_18_expected_true", input: "18", expected: "True" },
    { name: "input_19_expected_false", input: "19", expected: "False" },
    { name: "input_21_expected_true", input: "21", expected: "True" },
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
