/**
 * Instruction: Complete the given Scratch starter project that finds the highest power of 2 less than or equal to a given number. The sprite should say the result.
 * Unit Test Semantic Goals:
 * 1) Input "10" must output exactly 8.
 * 2) Input "16" must output exactly 16.
 * 3) Input "1" must output exactly 1.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);
  const testCases = [
    { name: "input_10_expected_8", input: "10", expected: 8 },
    { name: "input_16_expected_16", input: "16", expected: 16 },
    { name: "input_1_expected_1", input: "1", expected: 1 },
  ];

  try {
    return await EU.runQuestionAnswerTestsDetailed(
      vm,
      testCases,
      ["input", "number", "string", "enter", "value", "?", "list"],
      { timeout: timeoutSec, spriteName: "Sprite1" }
    );
  } finally {
    if (typeof cleanup === "function") cleanup();
  }
};
