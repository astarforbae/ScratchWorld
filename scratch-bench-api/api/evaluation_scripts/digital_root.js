/**
 * Instruction: Complete the given Scratch starter project that calculates the digital root of a given positive integer. The digital root is obtained by recursively summing the digits of the number until a single-digit number remains. The sprite should say the result.
 * Unit Test Semantic Goals:
 * 1) Returns digital root 7 when input is 16.
 * 2) Returns digital root 6 when input is 942.
 * 3) Returns digital root 6 when input is 12345.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);

  const testCases = [
    { name: "input_16_expected_7", input: "16", expected: 7 },
    { name: "input_942_expected_6", input: "942", expected: 6 },
    { name: "input_12345_expected_6", input: "12345", expected: 6 },
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
