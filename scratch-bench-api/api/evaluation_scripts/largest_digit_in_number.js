/**
 * Instruction: Complete the given Scratch starter project that takes a positive integer as input and finds the largest digit within that number. The sprite should say the result.
 * Unit Test Semantic Goals:
 * 1) Input "1293" must output exactly 9.
 * 2) Input "505" must output exactly 5.
 * 3) Input "111" must output exactly 1.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);
  const testCases = [
    { name: "input_1293_expected_9", input: "1293", expected: 9 },
    { name: "input_505_expected_5", input: "505", expected: 5 },
    { name: "input_111_expected_1", input: "111", expected: 1 },
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
