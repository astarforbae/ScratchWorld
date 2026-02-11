/**
 * Instruction: Complete the given Scratch starter project that counts the number of divisors of a given positive integer. The sprite should say the count.
 * Unit Test Semantic Goals:
 * 1) Input "6" must output exactly 4.
 * 2) Input "7" must output exactly 2.
 * 3) Input "12" must output exactly 6.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);
  const testCases = [
    { name: "input_6_expected_4", input: "6", expected: 4 },
    { name: "input_7_expected_2", input: "7", expected: 2 },
    { name: "input_12_expected_6", input: "12", expected: 6 },
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
