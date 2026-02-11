/**
 * Instruction: This is a basic Pong-style game where a ball bounces around the screen and players control a paddle that follows the mouse. The ball changes direction when hitting the paddle and the game ends when the ball touches red areas. But now in this Pong Game, the pong ball doesn't move when the green flag is clicked. The ball should start moving automatically when the game begins. Please help me fix this issue so the ball starts moving with proper velocity when the green flag is clicked.
 * Unit Test Semantic Goals:
 * 1) 'Ball' starts moving automatically when green flag is clicked.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;

  const ballName = (config && config.ballName) || "Ball";
  const movementThreshold = (config && config.movementThreshold ? Number(config.movementThreshold) : 12);

  const findBall = () => EU.findSprite(vm, ballName, ["Ball", "Sprite1", "ball"]);

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
      await EU.wait(160);
      EU.startVM(vm);
      await EU.wait(550);
    },
    run: async () => runner(),
    afterCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
    },
  });

  const details = [];
  try {
    details.push(await runCase("ball_moves_after_green_flag", async () => {
      const ball = findBall();
      if (!ball) return { passed: false, error: "Ball sprite not found", meta: {} };

      const start = { x: Number(ball.x), y: Number(ball.y) };
      let maxDistance = 0;
      const trajectory = [];
      const startedAt = Date.now();
      while (Date.now() - startedAt < 2600) {
        const pos = { x: Number(ball.x), y: Number(ball.y) };
        const distance = EU.calculateDistance(start, pos);
        if (distance > maxDistance) maxDistance = distance;
        trajectory.push({
          x: Number(pos.x.toFixed(2)),
          y: Number(pos.y.toFixed(2)),
          distance_from_start: Number(distance.toFixed(2)),
        });
        await EU.wait(100);
      }

      return {
        passed: maxDistance > movementThreshold,
        meta: {
          movement_threshold: movementThreshold,
          max_distance_from_start: Number(maxDistance.toFixed(2)),
          sampled_trajectory: trajectory.slice(0, 12),
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
