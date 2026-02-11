/**
 * Instruction: Complete the given Scratch starter project that checks whether the first and last characters of a given string are equal. The sprite should say 'Equal' if they are the same, and 'Not Equal' otherwise.
 * Unit Test Semantic Goals:
 * 1) Returns Equal for input "level".
 * 2) Returns Not Equal for input "hello".
 * 3) Returns Equal for input "a".
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);

  const testCases = [
    { name: "input_level_expected_equal", input: "level", expected: "Equal" },
    { name: "input_hello_expected_not_equal", input: "hello", expected: "Not Equal" },
    { name: "input_a_expected_equal", input: "a", expected: "Equal" },
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
