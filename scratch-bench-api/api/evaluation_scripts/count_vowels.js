/**
 * Instruction: Complete the given Scratch starter project that takes a string as input and counts how many vowels (a, e, i, o, u) it contains (case-insensitive). The sprite should say the count.
 * Unit Test Semantic Goals:
 * 1) Counts 2 vowels in "hello".
 * 2) Counts 0 vowels in "sky".
 * 3) Counts 5 vowels in "AeIoU".
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);

  const testCases = [
    { name: "input_hello_expected_2", input: "hello", expected: 2 },
    { name: "input_sky_expected_0", input: "sky", expected: 0 },
    { name: "input_AeIoU_expected_5", input: "AeIoU", expected: 5 },
  ];

  try {
    return await EU.runQuestionAnswerTestsDetailed(
      vm,
      testCases,
      ["input", "string", "enter", "value", "?"],
      { timeout: timeoutSec, spriteName: "Sprite1" }
    );
  } finally {
    if (typeof cleanup === "function") cleanup();
  }
};
