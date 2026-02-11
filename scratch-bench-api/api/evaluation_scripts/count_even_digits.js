/**
 * Instruction: Complete the given Scratch starter project that counts the number of even digits in a given positive integer. The sprite should say the count.
 * Unit Test Semantic Goals:
 * 1) Input "123456" must output exactly 3.
 * 2) Input "135" must output exactly 0.
 * 3) Input "202" must output exactly 3.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);
  const testCases = [
    { name: "input_123456_expected_3", input: "123456", expected: 3 },
    { name: "input_135_expected_0", input: "135", expected: 0 },
    { name: "input_202_expected_3", input: "202", expected: 3 },
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
