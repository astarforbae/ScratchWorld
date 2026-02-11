/**
 * Instruction: This is a basic maze navigation game where players control a ball sprite using arrow keys to move through a maze. The ball bounces off blue walls and the goal is to reach a target sprite that displays 'You win!' when touched. The ball should start at the maze entrance at the left top of the stage. But now in this Maze Starter, the ball starts in the center of the stage. Please help me fix this start position issue so that the ball starts at the maze entrance at the left top of the stage.
 * Unit Test Semantic Goals:
 * 1) On start, 'Ball' is visible and positioned in the top-left entrance region (x <= -80 and y >= 50).
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;

  const ballName = (config && config.ballName) || "Ball";

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
    details.push(await runCase("ball_starts_in_left_top_entrance_region", async () => {
      const ball = EU.findSprite(vm, ballName, ["Ball", "Sprite1", "ball"]);
      if (!ball) {
        return { passed: false, error: "Ball sprite not found", meta: {} };
      }

      const pos = EU.getSpritePosition(ball);
      const inStageRange =
        pos.x >= -240 && pos.x <= 240 &&
        pos.y >= -180 && pos.y <= 180;
      const inTopLeft = pos.x <= -80 && pos.y >= 50;

      return {
        passed: !!ball.visible && inStageRange && inTopLeft,
        meta: {
          visible: !!ball.visible,
          x: Number(pos.x.toFixed(2)),
          y: Number(pos.y.toFixed(2)),
          in_stage_range: inStageRange,
          in_top_left_region: inTopLeft,
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
