/**
 * Instruction: This is a basic Pong-style game where a ball bounces around the screen and players control a paddle that follows the mouse. The ball changes direction when hitting the paddle and the game ends when the ball touches red areas. But now in this Pong Game, the Paddle's movement is inconsistent with the mouse movement. Please help me fix this issue.
 * Unit Test Semantic Goals:
 * 1) 'Paddle' X position follows mouse X across multiple targets.
 * 2) 'Paddle' movement remains horizontal without major Y drift.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;

  const paddleName = (config && config.paddleName) || "Paddle";
  const tolerance = (config && config.tolerance ? Number(config.tolerance) : 10);

  const findPaddle = () => EU.findSprite(vm, paddleName, ["Paddle", "Sprite1", "paddle"]);

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
      await EU.wait(180);
    },
    run: async () => runner(),
    afterCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
    },
  });

  const setMouseScratchCoords = (x, y = 0) => {
    const mouse = vm && vm.runtime && vm.runtime.ioDevices && vm.runtime.ioDevices.mouse;
    if (mouse) {
      mouse._scratchX = x;
      mouse._scratchY = y;
      mouse._clientX = x;
      mouse._clientY = y;
    }
  };

  const testTargets = [-200, -100, 0, 100, 200];

  const collectFollowSamples = async () => {
    const paddle = findPaddle();
    if (!paddle) return { error: "Paddle sprite not found" };

    const paddleStarted = EU.startSingleSpriteScript(vm, paddle.sprite ? paddle.sprite.name : paddleName);
    if (!paddleStarted) EU.startVM(vm);
    await EU.wait(450);

    const baselineY = Number(paddle.y);
    const samples = [];
    for (const targetX of testTargets) {
      setMouseScratchCoords(targetX, baselineY);
      await EU.wait(500);
      const observedX = Number(paddle.x);
      const observedY = Number(paddle.y);
      samples.push({
        target_x: targetX,
        observed_x: Number(observedX.toFixed(2)),
        observed_y: Number(observedY.toFixed(2)),
        x_distance: Number(Math.abs(observedX - targetX).toFixed(2)),
        y_drift: Number(Math.abs(observedY - baselineY).toFixed(2)),
      });
    }
    return { baselineY, samples };
  };

  const details = [];
  try {
    details.push(await runCase("paddle_x_follows_mouse_targets", async () => {
      const collected = await collectFollowSamples();
      if (collected.error) return { passed: false, error: collected.error, meta: {} };

      const passCount = collected.samples.filter(item => item.x_distance <= tolerance).length;
      return {
        passed: passCount >= 4,
        meta: {
          tolerance,
          pass_count: passCount,
          total_targets: testTargets.length,
          samples: collected.samples,
        },
      };
    }));

    details.push(await runCase("paddle_y_has_no_major_drift", async () => {
      const collected = await collectFollowSamples();
      if (collected.error) return { passed: false, error: collected.error, meta: {} };

      const maxDrift = collected.samples.reduce((max, item) => Math.max(max, item.y_drift), 0);
      return {
        passed: maxDrift <= 12,
        meta: {
          baseline_y: collected.baselineY,
          max_y_drift: Number(maxDrift.toFixed(2)),
          samples: collected.samples,
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
