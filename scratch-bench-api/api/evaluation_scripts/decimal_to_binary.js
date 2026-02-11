/**
 * Instruction: Complete the given Scratch starter project that takes a positive integer as input and converts it into its binary representation (a string of 0s and 1s). The sprite should say the binary string.
 * Unit Test Semantic Goals:
 * 1) Input "5" must output exactly "101".
 * 2) Input "10" must output exactly "1010".
 * 3) Input "99" must output exactly "1100011".
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);
  const testCases = [
    { name: "input_5_expected_101", input: "5", expected: "101" },
    { name: "input_10_expected_1010", input: "10", expected: "1010" },
    { name: "input_99_expected_1100011", input: "99", expected: "1100011" },
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
