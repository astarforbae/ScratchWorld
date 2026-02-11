/**
 * Instruction: Starting from an empty Scratch project with a single default sprite named 'ball', you should complete the following: 1) When the green flag is clicked, allow the user to move the ball using the arrow keys: up, down, left, and right. 2) Ensure the movement responds continuously while keys are pressed.
 * Unit Test Semantic Goals:
 * 1) Up Arrow input moves the ball upward (positive y direction).
 * 2) Down Arrow input moves the ball downward (negative y direction).
 * 3) Right Arrow input moves the ball rightward (positive x direction).
 * 4) Left Arrow input moves the ball leftward (negative x direction).
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;

  const spriteCandidates = (config && config.spriteName)
    ? [String(config.spriteName)]
    : ["ball", "Ball", "Sprite1"];

  const findBall = () => {
    for (const name of spriteCandidates) {
      const sprite = EU.findSprite(vm, name, ["ball", "Ball"]);
      if (sprite) return sprite;
    }
    return null;
  };

  const releaseMovementKeys = () => {
    EU.simulateKeyUp(vm, "ArrowUp");
    EU.simulateKeyUp(vm, "ArrowDown");
    EU.simulateKeyUp(vm, "ArrowLeft");
    EU.simulateKeyUp(vm, "ArrowRight");
  };

  const sampleKeyMotion = async (ball, key, axis, expectedSign, holdMs = 900, sampleMs = 90) => {
    const values = [];
    const readAxis = () => (axis === "x" ? (Number(ball.x) || 0) : (Number(ball.y) || 0));

    values.push(readAxis());
    EU.simulateKeyDown(vm, key);
    const start = Date.now();
    while (Date.now() - start < holdMs) {
      await EU.wait(sampleMs);
      values.push(readAxis());
    }
    EU.simulateKeyUp(vm, key);

    let movingSteps = 0;
    let directionalSteps = 0;
    for (let i = 1; i < values.length; i++) {
      const delta = values[i] - values[i - 1];
      if (Math.abs(delta) < 0.5) continue;
      movingSteps += 1;
      if ((expectedSign > 0 && delta > 0) || (expectedSign < 0 && delta < 0)) {
        directionalSteps += 1;
      }
    }

    const netDelta = values[values.length - 1] - values[0];
    const directionalRatio = movingSteps ? (directionalSteps / movingSteps) : 0;
    return { values, netDelta, movingSteps, directionalSteps, directionalRatio };
  };

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
      releaseMovementKeys();
      const ball = findBall();
      if (ball) {
        try { ball.setXY(0, 0); } catch (e) {}
      }
    },
    run: async () => runner(),
    afterCase: async () => {
      releaseMovementKeys();
      try { vm.runtime.stopAll(); } catch (e) {}
    },
  });

  const checkDirectionalCase = async (caseName, key, axis, expectedSign) => {
    return await runCase(caseName, async () => {
      const ball = findBall();
      if (!ball) {
        return { passed: false, error: "Ball sprite not found", meta: {} };
      }

      EU.startVM(vm);
      await EU.wait(300);
      try { ball.setXY(0, 0); } catch (e) {}
      await EU.wait(120);

      const observation = await sampleKeyMotion(ball, key, axis, expectedSign);
      const signedDelta = expectedSign * observation.netDelta;
      const passed = signedDelta >= 8 && observation.movingSteps >= 1 && observation.directionalRatio >= 0.6;

      return {
        passed,
        meta: {
          axis,
          key,
          net_delta: Number(observation.netDelta.toFixed(2)),
          moving_steps: observation.movingSteps,
          directional_steps: observation.directionalSteps,
          directional_ratio: Number(observation.directionalRatio.toFixed(3)),
          sampled_values: observation.values.map(v => Number(v.toFixed(2))),
        },
      };
    });
  };

  const details = [];

  try {
    details.push(await checkDirectionalCase("up_arrow_moves_ball_upward", "ArrowUp", "y", 1));
    details.push(await checkDirectionalCase("down_arrow_moves_ball_downward", "ArrowDown", "y", -1));
    details.push(await checkDirectionalCase("right_arrow_moves_ball_rightward", "ArrowRight", "x", 1));
    details.push(await checkDirectionalCase("left_arrow_moves_ball_leftward", "ArrowLeft", "x", -1));

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
    releaseMovementKeys();
    try { vm.runtime.stopAll(); } catch (e) {}
    if (typeof cleanup === "function") cleanup();
  }
};
