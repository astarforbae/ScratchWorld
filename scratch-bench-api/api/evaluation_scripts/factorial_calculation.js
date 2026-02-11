/**
 * Instruction: Complete the given Scratch starter project that calculates the factorial of a given positive integer. The sprite should say the result.
 * Unit Test Semantic Goals:
 * 1) Returns factorial 120 when input is 5.
 * 2) Returns factorial 6 when input is 3.
 * 3) Returns factorial 1 when input is 1.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);

  const testCases = [
    { name: "input_5_expected_120", input: "5", expected: 120 },
    { name: "input_3_expected_6", input: "3", expected: 6 },
    { name: "input_1_expected_1", input: "1", expected: 1 },
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
