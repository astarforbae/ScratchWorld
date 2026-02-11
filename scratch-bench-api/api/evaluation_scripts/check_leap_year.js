/**
 * Instruction: Complete the given Scratch starter project that checks if a given year (positive integer) is a leap year. The sprite should say 'True' if it is, and 'False' otherwise.
 * Unit Test Semantic Goals:
 * 1) Returns True for leap year 2000.
 * 2) Returns True for leap year 2020.
 * 3) Returns False for non-leap year 2100.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);

  const testCases = [
    { name: "input_2000_expected_true", input: "2000", expected: "True" },
    { name: "input_2020_expected_true", input: "2020", expected: "True" },
    { name: "input_2100_expected_false", input: "2100", expected: "False" },
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
