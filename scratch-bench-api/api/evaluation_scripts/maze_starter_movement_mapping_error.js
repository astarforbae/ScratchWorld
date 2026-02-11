/**
 * Instruction: This is a basic maze navigation game where players control a ball sprite using arrow keys to move through a maze. The ball bounces off blue walls and the goal is to reach a target sprite that displays 'You win!' when touched. But now in this Maze Starter, the ball doesn't move when the arrow keys are pressed. Please help me fix this movement issue so that the ball moves in the correct directions with a proper step size.
 * Unit Test Semantic Goals:
 * 1) Up, Down, Right, and Left arrow inputs move 'Ball' in matching y/x directions by more than 2 pixels.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;

  const ballName = (config && config.ballName) || "Ball";

  const pressOneOf = async (keys, durationMs = 500) => {
    try {
      for (const key of keys) vm.runtime.ioDevices.keyboard.postData({ key, isDown: true });
      await EU.wait(durationMs);
    } finally {
      for (const key of keys) vm.runtime.ioDevices.keyboard.postData({ key, isDown: false });
    }
  };

  const sampleMove = async (ball, keys) => {
    const before = EU.getSpritePosition(ball);
    await pressOneOf(keys, 500);
    await EU.wait(200);
    const after = EU.getSpritePosition(ball);
    return { dx: after.x - before.x, dy: after.y - before.y };
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
    details.push(await runCase("arrow_keys_move_ball_in_matching_directions", async () => {
      const ball = EU.findSprite(vm, ballName, ["Ball", "Sprite1", "ball"]);
      if (!ball) {
        return { passed: false, error: "Ball sprite not found", meta: {} };
      }

      const up = await sampleMove(ball, ["ArrowUp", "Up", "w"]);
      const down = await sampleMove(ball, ["ArrowDown", "Down", "s"]);
      const right = await sampleMove(ball, ["ArrowRight", "Right", "d"]);
      const left = await sampleMove(ball, ["ArrowLeft", "Left", "a"]);

      const stepMin = 2;
      const passed = up.dy > stepMin && down.dy < -stepMin && right.dx > stepMin && left.dx < -stepMin;

      return {
        passed,
        meta: {
          up,
          down,
          right,
          left,
          step_threshold: stepMin,
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
