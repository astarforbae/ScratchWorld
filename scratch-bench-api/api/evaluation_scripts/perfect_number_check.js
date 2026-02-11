/**
 * Instruction: Complete the given Scratch starter project that checks if a given positive integer is a perfect number (equal to the sum of its proper divisors). The sprite should say 'True' if it is, and 'False' otherwise.
 * Unit Test Semantic Goals:
 * 1) Input `6` must produce output `True`.
 * 2) Input `28` must produce output `True`.
 * 3) Input `12` must produce output `False`.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);

  try {
    const testCases = [
      {
        name: "input_6_outputs_true",
        input: "6",
        expected: "True",
      },
      {
        name: "input_28_outputs_true",
        input: "28",
        expected: "True",
      },
      {
        name: "input_12_outputs_false",
        input: "12",
        expected: "False",
      },
    ];

    return await EU.runQuestionAnswerTestsDetailed(
      vm,
      testCases,
      ["ask", "enter", "input", "number", "value", "?"],
      {
        timeout: timeoutSec,
        spriteName: "Sprite1",
      }
    );
  } finally {
    if (typeof cleanup === "function") cleanup();
  }
};
