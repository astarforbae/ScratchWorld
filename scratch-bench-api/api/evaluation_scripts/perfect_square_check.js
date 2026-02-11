/**
 * Instruction: Complete the given Scratch starter project that checks if a given positive integer is a perfect square. The sprite should say 'True' if it is, and 'False' otherwise.
 * Unit Test Semantic Goals:
 * 1) Input `16` must produce output `True`.
 * 2) Input `15` must produce output `False`.
 * 3) Input `1` must produce output `True`.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);

  try {
    const testCases = [
      {
        name: "input_16_outputs_true",
        input: "16",
        expected: "True",
      },
      {
        name: "input_15_outputs_false",
        input: "15",
        expected: "False",
      },
      {
        name: "input_1_outputs_true",
        input: "1",
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
