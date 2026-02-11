/**
 * Instruction: Complete the given Scratch starter project that asks the user to input 5 numbers one by one, adds them to a list, sorts the list in ascending order, and then says the sorted numbers joined by spaces.
 * Unit Test Semantic Goals:
 * 1) Input `[5, 1, 4, 2, 8]` outputs `1 2 4 5 8`.
 * 2) Input `[1, 2, 3, 4, 5]` outputs `1 2 3 4 5`.
 * 3) Input `[5, 4, 3, 2, 1]` outputs `1 2 3 4 5`.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);
  const listNameCandidates = ["numberlist", "number list", "number_list", "numbers"];

  const findAllListVariables = () => {
    const seenIds = new Set();
    const listVariables = [];
    const targets = (vm && vm.runtime && vm.runtime.targets) || [];
    for (const target of targets) {
      const vars = (target && target.variables) || {};
      for (const id of Object.keys(vars)) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        const variable = vars[id];
        if (variable && variable.type === "list") {
          listVariables.push(variable);
        }
      }
    }
    return listVariables;
  };

  const findNumberListVariable = () => {
    const listVariables = findAllListVariables();
    const exact = listVariables.find((v) => listNameCandidates.includes(String(v.name || "").toLowerCase()));
    if (exact) return exact;
    const loose = listVariables.find((v) => {
      const lowered = String(v.name || "").toLowerCase();
      return lowered.includes("number") && lowered.includes("list");
    });
    if (loose) return loose;
    return listVariables.length > 0 ? listVariables[0] : null;
  };

  const resetNumberList = () => {
    const listVar = findNumberListVariable();
    if (!listVar) {
      return {
        list_name: null,
        list_len_before: null,
        list_len_after_reset: null,
      };
    }
    const beforeLen = Array.isArray(listVar.value) ? listVar.value.length : 0;
    listVar.value = [];
    return {
      list_name: listVar.name || null,
      list_len_before: beforeLen,
      list_len_after_reset: 0,
    };
  };

  const getNumberListLengthMeta = () => {
    const listVar = findNumberListVariable();
    if (!listVar) {
      return {
        list_name_after_case: null,
        list_len_after_case: null,
      };
    }
    return {
      list_name_after_case: listVar.name || null,
      list_len_after_case: Array.isArray(listVar.value) ? listVar.value.length : 0,
    };
  };

  const testCases = [
      {
        name: "input_5_1_4_2_8_outputs_1_2_4_5_8",
        input: "[5, 1, 4, 2, 8]",
        expected: "1 2 4 5 8",
      },
      {
        name: "input_1_2_3_4_5_outputs_1_2_3_4_5",
        input: "[1, 2, 3, 4, 5]",
        expected: "1 2 3 4 5",
      },
      {
        name: "input_5_4_3_2_1_outputs_1_2_3_4_5",
        input: "[5, 4, 3, 2, 1]",
        expected: "1 2 3 4 5",
      },
  ];
  const questionKeywords = ["ask", "enter", "input", "number", "value", "list", "?"];
  const qaConfig = {
    timeout: timeoutSec,
    spriteName: "Sprite1",
    beforeEachCase: ({ caseNumber }) => ({
      case_number: caseNumber,
      ...resetNumberList(),
    }),
    afterEachCase: () => getNumberListLengthMeta(),
  };
  try {
    return await EU.runQuestionAnswerTestsDetailed(
      vm,
      testCases,
      questionKeywords,
      qaConfig
    );
  } finally {
    if (typeof cleanup === "function") cleanup();
  }
};
