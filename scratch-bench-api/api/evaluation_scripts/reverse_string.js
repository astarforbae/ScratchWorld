/**
 * Instruction: Complete the given Scratch starter project that takes a string as input and reverses it. The sprite should say the reversed string.
 * Unit Test Semantic Goals:
 * 1) Input `hello` must produce output `olleh`.
 * 2) Input `scratch` must produce output `hctarcs`.
 * 3) Input `12345` must produce output `54321`.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);

  try {
    const testCases = [
      {
        name: "input_hello_outputs_olleh",
        input: "hello",
        expected: "olleh",
      },
      {
        name: "input_scratch_outputs_hctarcs",
        input: "scratch",
        expected: "hctarcs",
      },
      {
        name: "input_12345_outputs_54321",
        input: "12345",
        expected: "54321",
      },
    ];

    return await EU.runQuestionAnswerTestsDetailed(
      vm,
      testCases,
      ["ask", "enter", "input", "number", "string", "value", "?"],
      {
        timeout: timeoutSec,
        spriteName: "Sprite1",
      }
    );
  } finally {
    if (typeof cleanup === "function") cleanup();
  }
};
