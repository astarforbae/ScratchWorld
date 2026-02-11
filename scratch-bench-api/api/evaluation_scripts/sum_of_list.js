/**
 * Instruction: Complete the given Scratch starter project that calculates the sum of a list of numbers. First, ask the user for the count of numbers to be entered. Then, ask for each number one by one. Finally, the sprite should say the sum.
 * Unit Test Semantic Goals:
 * 1) Input [5, 1, 2, 3, 4, 5] outputs 15.
 * 2) Input [3, 10, 20, 30] outputs 60.
 * 3) Input [3, -1, -2, -3] outputs -6.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 10);
  const cloneValue = (value) => Array.isArray(value) ? value.slice() : value;

  const captureVariableSnapshot = () => {
    const snapshot = {};
    const targets = (vm.runtime && vm.runtime.targets) || [];
    for (const target of targets) {
      if (!target || !target.isOriginal) continue;
      const vars = target.variables || {};
      const targetSnapshot = {};
      for (const varId of Object.keys(vars)) {
        const variable = vars[varId];
        if (!variable) continue;
        targetSnapshot[varId] = cloneValue(variable.value);
      }
      snapshot[target.id] = targetSnapshot;
    }
    return snapshot;
  };

  const restoreVariableSnapshot = (snapshot) => {
    const targets = (vm.runtime && vm.runtime.targets) || [];
    let restoredTargets = 0;
    let restoredVariables = 0;
    for (const target of targets) {
      if (!target || !target.isOriginal) continue;
      const targetSnapshot = snapshot[target.id];
      if (!targetSnapshot) continue;
      restoredTargets++;
      const vars = target.variables || {};
      for (const varId of Object.keys(targetSnapshot)) {
        if (!Object.prototype.hasOwnProperty.call(vars, varId)) continue;
        vars[varId].value = cloneValue(targetSnapshot[varId]);
        restoredVariables++;
      }
    }
    return { restored_targets: restoredTargets, restored_variables: restoredVariables };
  };

  const initialSnapshot = captureVariableSnapshot();
  const testCases = [
    {
      name: "input_5_1_2_3_4_5_outputs_15",
      input: "[5, 1, 2, 3, 4, 5]",
      expected: 15,
    },
    {
      name: "input_3_10_20_30_outputs_60",
      input: "[3, 10, 20, 30]",
      expected: 60,
    },
    {
      name: "input_3_-1_-2_-3_outputs_-6",
      input: "[3, -1, -2, -3]",
      expected: -6,
    },
  ];
  const questionKeywords = ["ask", "enter", "input", "number", "value", "list", "?"];
  const qaConfig = {
    timeout: timeoutSec,
    spriteName: "Sprite1",
    beforeEachCase: ({ caseNumber }) => ({
      case_number: caseNumber,
      ...restoreVariableSnapshot(initialSnapshot),
    }),
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
