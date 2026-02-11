/**
 * Instruction: Complete the given Scratch starter project that takes a number as input. If the number is even, output the number itself; if it is odd, output double the number. The sprite should say the result.
 * Unit Test Semantic Goals:
 * 1) Input "4" must output exactly 4.
 * 2) Input "3" must output exactly 6.
 * 3) Input "0" must output exactly 0.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);
  const testCases = [
    { name: "input_4_expected_4", input: "4", expected: 4 },
    { name: "input_3_expected_6", input: "3", expected: 6 },
    { name: "input_0_expected_0", input: "0", expected: 0 },
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
