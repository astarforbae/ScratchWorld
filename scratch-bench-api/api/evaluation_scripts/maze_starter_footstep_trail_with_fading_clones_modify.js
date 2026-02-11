/**
 * Instruction: This is a basic maze navigation game where players control a ball sprite using arrow keys to move through a maze. The ball bounces off blue walls and the goal is to reach a target sprite that displays 'You win!' when touched. Create a clone-based trail effect. In the Ball sprite, periodically create clones while moving. In 'when I start as a clone', set the clone's ghost effect to 0, then in a repeat loop increase ghost by a small amount until the clone becomes invisible, then delete the clone. Ensure clones do not affect gameplay by spacing clone creation.
 * Unit Test Semantic Goals:
 * 1) While moving, 'Ball' creates at least 2 trail clones.
 * 2) At least 1 clone increases ghost effect over time (fade behavior).
 * 3) At least 1 trail clone is removed after fading.
 * 4) Peak active trail clones stays at or below 30.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;

  const ballName = (config && config.ballSpriteName) || "Ball";

  const isBallCloneOf = (ball, t) => {
    return !!(ball && t && !t.isOriginal && t.sprite && ball.sprite && t.sprite.name === ball.sprite.name);
  };

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
      EU.startVM(vm);
      await EU.wait(600);
    },
    run: async () => runner(),
    afterCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
    },
  });

  const details = [];

  try {
    details.push(await runCase("movement_creates_trail_clones", async () => {
      const ball = EU.findSprite(vm, ballName, ["Ball", "Sprite1", "ball"]);
      if (!ball) return { passed: false, error: "Ball sprite not found", meta: {} };

      let clonesCreated = 0;
      const createdHandler = (t) => {
        if (isBallCloneOf(ball, t)) clonesCreated += 1;
      };
      vm.runtime.on("targetWasCreated", createdHandler);
      try {
        await EU.wait(800);
        await EU.simulateKeyPress(vm, "ArrowRight", 1200);
        await EU.wait(200);
        await EU.simulateKeyPress(vm, "ArrowUp", 1200);
        await EU.wait(200);
        await EU.simulateKeyPress(vm, "ArrowLeft", 1200);
        await EU.wait(1000);
      } finally {
        try { vm.runtime.off("targetWasCreated", createdHandler); } catch (e) {}
      }

      return {
        passed: clonesCreated >= 2,
        meta: { clones_created: clonesCreated },
      };
    }));

    details.push(await runCase("trail_clones_increase_ghost_effect", async () => {
      const ball = EU.findSprite(vm, ballName, ["Ball", "Sprite1", "ball"]);
      if (!ball) return { passed: false, error: "Ball sprite not found", meta: {} };

      const observed = new Map();
      let sampler = null;

      const createdHandler = (t) => {
        if (!isBallCloneOf(ball, t)) return;
        const g = (t.effects && typeof t.effects.ghost === "number") ? t.effects.ghost : 0;
        observed.set(t.id, { startGhost: g, maxGhost: g });
      };

      vm.runtime.on("targetWasCreated", createdHandler);
      try {
        await EU.wait(800);
        sampler = setInterval(() => {
          try {
            const activeClones = (vm.runtime.targets || []).filter(t => isBallCloneOf(ball, t));
            activeClones.forEach((clone) => {
              const g = (clone.effects && typeof clone.effects.ghost === "number") ? clone.effects.ghost : 0;
              const rec = observed.get(clone.id);
              if (rec) rec.maxGhost = Math.max(rec.maxGhost, g);
            });
          } catch (e) {}
        }, 100);

        await EU.simulateKeyPress(vm, "ArrowRight", 1200);
        await EU.wait(200);
        await EU.simulateKeyPress(vm, "ArrowUp", 1200);
        await EU.wait(3000);
      } finally {
        if (sampler) clearInterval(sampler);
        try { vm.runtime.off("targetWasCreated", createdHandler); } catch (e) {}
      }

      const fadedCount = Array.from(observed.values()).filter((rec) => {
        const inc = rec.maxGhost - rec.startGhost;
        return rec.maxGhost >= 40 || inc >= 20;
      }).length;

      return {
        passed: fadedCount >= 1,
        meta: {
          observed_clone_count: observed.size,
          faded_clone_count: fadedCount,
        },
      };
    }));

    details.push(await runCase("trail_clones_delete_after_fading", async () => {
      const ball = EU.findSprite(vm, ballName, ["Ball", "Sprite1", "ball"]);
      if (!ball) return { passed: false, error: "Ball sprite not found", meta: {} };

      let clonesDeleted = 0;
      const removedHandler = (t) => {
        if (isBallCloneOf(ball, t)) clonesDeleted += 1;
      };

      vm.runtime.on("targetWasRemoved", removedHandler);
      try {
        await EU.wait(800);
        await EU.simulateKeyPress(vm, "ArrowRight", 1200);
        await EU.wait(200);
        await EU.simulateKeyPress(vm, "ArrowUp", 1200);
        await EU.wait(3000);
      } finally {
        try { vm.runtime.off("targetWasRemoved", removedHandler); } catch (e) {}
      }

      return {
        passed: clonesDeleted >= 1,
        meta: { clones_deleted: clonesDeleted },
      };
    }));

    details.push(await runCase("active_clone_count_stays_bounded", async () => {
      const ball = EU.findSprite(vm, ballName, ["Ball", "Sprite1", "ball"]);
      if (!ball) return { passed: false, error: "Ball sprite not found", meta: {} };

      let peakActiveClones = 0;
      let sampler = null;

      try {
        await EU.wait(800);
        sampler = setInterval(() => {
          try {
            const activeClones = (vm.runtime.targets || []).filter(t => isBallCloneOf(ball, t));
            if (activeClones.length > peakActiveClones) peakActiveClones = activeClones.length;
          } catch (e) {}
        }, 100);

        await EU.simulateKeyPress(vm, "ArrowRight", 1200);
        await EU.wait(200);
        await EU.simulateKeyPress(vm, "ArrowUp", 1200);
        await EU.wait(200);
        await EU.simulateKeyPress(vm, "ArrowLeft", 1200);
        await EU.wait(2000);
      } finally {
        if (sampler) clearInterval(sampler);
      }

      return {
        passed: peakActiveClones <= 30,
        meta: {
          peak_active_clones: peakActiveClones,
          max_allowed: 30,
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
