/**
 * Instruction: Complete the given Scratch starter project that checks if a given positive integer greater than 1 is a prime number. The sprite should say 'True' if it is, and 'False' otherwise.
 * Unit Test Semantic Goals:
 * 1) Input `7` must produce output `True`.
 * 2) Input `10` must produce output `False`.
 * 3) Input `13` must produce output `True`.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);

  try {
    const testCases = [
      {
        name: "input_7_outputs_true",
        input: "7",
        expected: "True",
      },
      {
        name: "input_10_outputs_false",
        input: "10",
        expected: "False",
      },
      {
        name: "input_13_outputs_true",
        input: "13",
        expected: "True",
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
