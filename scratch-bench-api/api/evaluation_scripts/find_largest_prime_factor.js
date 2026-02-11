/**
 * Instruction: Complete the given Scratch starter project that takes a positive integer greater than 1 as input and outputs its largest prime factor. The sprite should say the result.
 * Unit Test Semantic Goals:
 * 1) Input "10" must output exactly 5.
 * 2) Input "24" must output exactly 3.
 * 3) Input "13" must output exactly 13.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);
  const testCases = [
    { name: "input_10_expected_5", input: "10", expected: 5 },
    { name: "input_24_expected_3", input: "24", expected: 3 },
    { name: "input_13_expected_13", input: "13", expected: 13 },
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
