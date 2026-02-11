/**
 * Instruction: Starting from an empty Scratch project with two backdrops and two default sprites named 'Previous' and 'Next', you should complete the following: 1) When the 'Next' button sprite is clicked, switch to the next backdrop. 2) When the 'Previous' button sprite is clicked, switch to the previous backdrop.
 * Unit Test Semantic Goals:
 * 1) Clicking sprite 'Next' changes stage backdrop index.
 * 2) Clicking sprite 'Previous' returns stage backdrop index to the prior value.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;

  const findSpriteByName = (name) =>
    (vm.runtime.targets || []).find(
      t => t.isOriginal && t.sprite && t.sprite.name.toLowerCase() === String(name).toLowerCase()
    ) || null;

  const getStageInfo = () => {
    const stage = vm.runtime.getTargetForStage();
    const count = stage && stage.sprite && Array.isArray(stage.sprite.costumes)
      ? stage.sprite.costumes.length
      : 0;
    return { stage, count };
  };

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
      await EU.wait(160);
      EU.startVM(vm);
      await EU.wait(500);
    },
    run: async () => runner(),
    afterCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
    },
  });

  const details = [];
  try {
    details.push(await runCase("next_button_changes_backdrop", async () => {
      const nextButton = findSpriteByName("Next");
      const { stage, count } = getStageInfo();
      if (!nextButton) return { passed: false, error: "Next sprite not found", meta: {} };
      if (!stage || count < 2) return { passed: false, error: "Expected at least 2 backdrops", meta: { backdrop_count: count } };

      const initial = stage.currentCostume;
      vm.runtime.startHats("event_whenthisspriteclicked", null, nextButton);
      await EU.wait(600);
      const after = stage.currentCostume;

      return {
        passed: after !== initial,
        meta: {
          backdrop_count: count,
          initial_backdrop_index: initial,
          after_next_click_index: after,
        },
      };
    }));

    details.push(await runCase("previous_button_returns_to_prior_backdrop", async () => {
      const nextButton = findSpriteByName("Next");
      const previousButton = findSpriteByName("Previous");
      const { stage, count } = getStageInfo();
      if (!nextButton) return { passed: false, error: "Next sprite not found", meta: {} };
      if (!previousButton) return { passed: false, error: "Previous sprite not found", meta: {} };
      if (!stage || count < 2) return { passed: false, error: "Expected at least 2 backdrops", meta: { backdrop_count: count } };

      const initial = stage.currentCostume;
      vm.runtime.startHats("event_whenthisspriteclicked", null, nextButton);
      await EU.wait(500);
      const afterNext = stage.currentCostume;
      vm.runtime.startHats("event_whenthisspriteclicked", null, previousButton);
      await EU.wait(700);
      const afterPrevious = stage.currentCostume;

      return {
        passed: afterNext !== initial && afterPrevious === initial,
        meta: {
          backdrop_count: count,
          initial_backdrop_index: initial,
          after_next_click_index: afterNext,
          after_previous_click_index: afterPrevious,
        },
      };
    }));

    const passedTests = details.filter(item => item.passed).length;
    const totalTests = details.length;
    return {
      success: passedTests === totalTests,
      passed_tests: passedTests,
      total_tests: totalTests,
      partial_success_rate: totalTests ? passedTests / totalTests : 0,
      details,
    };
  } finally {
    try { vm.runtime.stopAll(); } catch (e) {}
    if (typeof cleanup === "function") cleanup();
  }
};
