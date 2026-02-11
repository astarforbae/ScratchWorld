/**
 * Instruction: Complete the given Scratch starter project that converts a given temperature from Celsius to Fahrenheit. The sprite should say the converted temperature.
 * Unit Test Semantic Goals:
 * 1) Converts 0 Celsius to 32 Fahrenheit.
 * 2) Converts 100 Celsius to 212 Fahrenheit.
 * 3) Converts -40 Celsius to -40 Fahrenheit.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);

  const testCases = [
    { name: "input_0_expected_32", input: "0", expected: 32 },
    { name: "input_100_expected_212", input: "100", expected: 212 },
    { name: "input_minus40_expected_minus40", input: "-40", expected: -40 },
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
