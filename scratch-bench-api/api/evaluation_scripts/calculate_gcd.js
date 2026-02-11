/**
 * Instruction: Complete the given Scratch starter project that takes two positive integers as input one after another and calculates their Greatest Common Divisor (GCD). The sprite should say the result.
 * Unit Test Semantic Goals:
 * 1) Returns gcd 6 for inputs 12 and 18.
 * 2) Returns gcd 1 for inputs 7 and 13.
 * 3) Returns gcd 10 for inputs 20 and 10.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);

  const testCases = [
    { name: "input_12_18_expected_6", input: "[12, 18]", expected: 6 },
    { name: "input_7_13_expected_1", input: "[7, 13]", expected: 1 },
    { name: "input_20_10_expected_10", input: "[20, 10]", expected: 10 },
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
