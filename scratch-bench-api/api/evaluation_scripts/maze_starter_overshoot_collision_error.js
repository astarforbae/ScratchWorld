/**
 * Instruction: This is a basic maze navigation game where players control a ball sprite using arrow keys to move through a maze. The ball bounces off blue walls and the goal is to reach a target sprite that displays 'You win!' when touched. But now in this Maze Starter, movement steps are too large and cause collision checks to miss walls. Please help me fix this movement issue so that the ball moves in the correct directions with a proper step size.
 * Unit Test Semantic Goals:
 * 1) During repeated short Right-arrow input bursts, per-sample movement step stays at or below 25 pixels.
 * 2) No oversized movement spike suggests wall-collision checks are not being skipped by overshoot.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;

  const ballName = (config && config.ballName) || "Ball";

  const pressOneOf = async (keys, durationMs = 80) => {
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
    details.push(await runCase("movement_step_size_avoids_overshoot", async () => {
      const ball = EU.findSprite(vm, ballName, ["Ball", "Sprite1", "ball"]);
      if (!ball) {
        return { passed: false, error: "Ball sprite not found", meta: {} };
      }

      let last = EU.getSpritePosition(ball);
      let maxStep = 0;
      const sampledSteps = [];
      const durationMs = 2200;
      const startedAt = Date.now();

      while (Date.now() - startedAt < durationMs) {
        await pressOneOf(["ArrowRight", "Right", "d"], 80);
        const cur = EU.getSpritePosition(ball);
        const step = Math.hypot(cur.x - last.x, cur.y - last.y);
        sampledSteps.push(Number(step.toFixed(2)));
        if (step > maxStep) maxStep = step;
        last = cur;
      }

      const threshold = 25;
      return {
        passed: maxStep <= threshold,
        meta: {
          max_step: Number(maxStep.toFixed(2)),
          step_threshold: threshold,
          sampled_steps: sampledSteps,
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
