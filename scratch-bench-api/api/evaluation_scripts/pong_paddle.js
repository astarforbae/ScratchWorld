/**
 * Instruction: Starting from an empty Scratch project with a single default sprite named 'Paddle', you should complete the following: 1) When the green flag is clicked, make the paddle move only horizontally by following the mouse's X position. 3) Ensure it stays near the bottom of the stage.
 * Unit Test Semantic Goals:
 * 1) 'Paddle' stays near the bottom of the stage.
 * 2) 'Paddle' follows the mouse X position across multiple targets.
 * 3) 'Paddle' movement is horizontal only (no significant Y drift).
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;

  const paddleCandidates = ["Paddle", "Sprite1", "paddle"];
  const toleranceX = (config && config.tolerance ? Number(config.tolerance) : 18);
  const bottomThreshold = (config && config.bottomThreshold ? Number(config.bottomThreshold) : -120);

  const findPaddle = () => {
    for (const name of paddleCandidates) {
      const sprite = EU.findSprite(vm, name, []);
      if (sprite) return sprite;
    }
    return (vm.runtime.targets || []).find(
      t => t.isOriginal && t.sprite && t.sprite.name !== "Stage"
    ) || null;
  };

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
      await EU.wait(160);
      EU.startVM(vm);
      await EU.wait(650);
    },
    run: async () => runner(),
    afterCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
    },
  });

  const details = [];
  try {
    details.push(await runCase("paddle_stays_near_stage_bottom", async () => {
      const paddle = findPaddle();
      if (!paddle) return { passed: false, error: "Paddle sprite not found", meta: {} };

      const y = Number(paddle.y);
      return {
        passed: y <= bottomThreshold,
        meta: {
          observed_y: Number(y.toFixed(2)),
          bottom_threshold: bottomThreshold,
        },
      };
    }));

    details.push(await runCase("paddle_follows_mouse_x_positions", async () => {
      const paddle = findPaddle();
      if (!paddle) return { passed: false, error: "Paddle sprite not found", meta: {} };

      const targets = [-180, -90, 0, 90, 180];
      const baselineY = Number(paddle.y);
      const samples = [];
      let passCount = 0;
      let maxYDrift = 0;

      for (const targetX of targets) {
        EU.simulateMouseMove(vm, targetX, baselineY);
        await EU.wait(420);
        const observedX = Number(paddle.x);
        const observedY = Number(paddle.y);
        const dx = Math.abs(observedX - targetX);
        const yDrift = Math.abs(observedY - baselineY);
        if (dx <= toleranceX) passCount++;
        if (yDrift > maxYDrift) maxYDrift = yDrift;
        samples.push({
          target_x: targetX,
          observed_x: Number(observedX.toFixed(2)),
          observed_y: Number(observedY.toFixed(2)),
          distance_x: Number(dx.toFixed(2)),
          y_drift: Number(yDrift.toFixed(2)),
        });
      }

      return {
        passed: passCount >= 4 && maxYDrift <= 20,
        meta: {
          tolerance_x: toleranceX,
          pass_count: passCount,
          total_targets: targets.length,
          max_y_drift: Number(maxYDrift.toFixed(2)),
          samples,
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
