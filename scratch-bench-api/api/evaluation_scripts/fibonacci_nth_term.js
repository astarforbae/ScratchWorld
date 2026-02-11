/**
 * Instruction: Complete the given Scratch starter project that takes a positive integer N as input and outputs the Nth number in the Fibonacci sequence (1, 1, 2, 3, 5...). The sprite should say the result.
 * Unit Test Semantic Goals:
 * 1) Input "1" must output exactly 1.
 * 2) Input "2" must output exactly 1.
 * 3) Input "6" must output exactly 8.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);
  const testCases = [
    { name: "input_1_expected_1", input: "1", expected: 1 },
    { name: "input_2_expected_1", input: "2", expected: 1 },
    { name: "input_6_expected_8", input: "6", expected: 8 },
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
