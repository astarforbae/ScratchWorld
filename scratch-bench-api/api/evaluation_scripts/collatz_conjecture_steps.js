/**
 * Instruction: Complete the given Scratch starter project that takes a positive integer n. If n is even, divide it by 2; if odd, multiply by 3 and add 1. Repeat until n becomes 1. The sprite should say the total number of steps taken.
 * Unit Test Semantic Goals:
 * 1) Returns 0 steps for input 1.
 * 2) Returns 1 step for input 2.
 * 3) Returns 7 steps for input 3.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);

  const testCases = [
    { name: "input_1_expected_0", input: "1", expected: 0 },
    { name: "input_2_expected_1", input: "2", expected: 1 },
    { name: "input_3_expected_7", input: "3", expected: 7 },
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
