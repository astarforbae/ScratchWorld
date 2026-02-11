/**
 * Instruction: This is an animated party scene with dancing characters and changing backgrounds. Features a ghost that glides back and forth, a dancing character named Casey with multiple costume animations, and cycling backdrops with background music. But now Ben's costume is not changing. Please help me fix this issue.
 * Unit Test Semantic Goals:
 * 1) Sprite 'Ben' changes to at least one different costume index during runtime.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;
  const spriteName = (config && config.spriteName) || "Ben";

  const findSpriteByName = (name) =>
    (vm.runtime.targets || []).find(
      t => t.isOriginal && t.sprite && t.sprite.name.toLowerCase() === String(name).toLowerCase()
    ) || null;

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
      await EU.wait(160);
      EU.startVM(vm);
      await EU.wait(700);
    },
    run: async () => runner(),
    afterCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
    },
  });

  const details = [];
  try {
    details.push(await runCase("ben_costume_changes_during_runtime", async () => {
      const targetSprite = findSpriteByName(spriteName);
      if (!targetSprite) {
        return { passed: false, error: `Sprite '${spriteName}' not found`, meta: {} };
      }

      const samples = [];
      const startedAt = Date.now();
      while (Date.now() - startedAt < 8000) {
        samples.push(targetSprite.currentCostume);
        await EU.wait(350);
      }

      const unique = [...new Set(samples)];
      const changed = unique.length > 1;
      return {
        passed: changed,
        meta: {
          sprite_name: targetSprite.sprite ? targetSprite.sprite.name : spriteName,
          sampled_costume_indices: samples,
          unique_costume_indices: unique,
          unique_count: unique.length,
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
