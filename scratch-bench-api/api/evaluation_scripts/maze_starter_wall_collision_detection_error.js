/**
 * Instruction: This is a basic maze navigation game where players control a ball sprite using arrow keys to move through a maze. The ball bounces off blue walls and the goal is to reach a target sprite that displays 'You win!' when touched. But now in this Maze Starter, the ball can pass through maze walls. Please help me fix this wall collision detection issue so that the ball cannot clip through walls.
 * Unit Test Semantic Goals:
 * 1) Holding right movement causes repeated block/pushback samples instead of continuous clipping through walls.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;
  const ballName = (config && config.ballName) || "Ball";

  const pressOneOf = async (keys, durationMs = 120) => {
    try {
      for (const key of keys) vm.runtime.ioDevices.keyboard.postData({ key, isDown: true });
      await EU.wait(durationMs);
    } finally {
      for (const key of keys) vm.runtime.ioDevices.keyboard.postData({ key, isDown: false });
    }
  };

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
      await EU.wait(250);
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
    details.push(await runCase("ball_is_blocked_by_walls_when_moving_right", async () => {
      const ball = EU.findSprite(vm, ballName, ["Ball", "Sprite1", "ball"]);
      if (!ball) {
        return { passed: false, error: "Ball sprite not found", meta: {} };
      }

      let last = EU.getSpritePosition(ball);
      const deltas = [];
      let stalledSamples = 0;
      let backwardSamples = 0;

      for (let i = 0; i < 28; i++) {
        await pressOneOf(["ArrowRight", "Right", "d"], 120);
        const cur = EU.getSpritePosition(ball);
        const dx = cur.x - last.x;
        if (Math.abs(dx) < 0.8) stalledSamples++;
        if (dx < -0.5) backwardSamples++;
        deltas.push(Number(dx.toFixed(2)));
        last = cur;
      }

      const totalDx = deltas.reduce((sum, value) => sum + value, 0);
      const blockObserved = stalledSamples >= 5 || backwardSamples >= 2;
      const clippedFar = totalDx > 300;

      return {
        passed: blockObserved && !clippedFar,
        meta: {
          stalled_samples: stalledSamples,
          backward_samples: backwardSamples,
          total_dx: Number(totalDx.toFixed(2)),
          clipped_far: clippedFar,
          sampled_dx: deltas.slice(0, 12),
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
