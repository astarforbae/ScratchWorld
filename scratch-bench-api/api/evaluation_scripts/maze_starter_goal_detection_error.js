/**
 * Instruction: This is a basic maze navigation game where players control a ball sprite using arrow keys to move through a maze. The ball bounces off blue walls and the goal is to reach a target sprite that displays 'You win!' when touched. But now in this Maze Starter, the maze doesn't recognize when the ball reaches the goal and doesn't trigger a win response. Please help me fix this goal detection issue so that the maze properly recognizes when the ball reaches the goal and triggers a win response.
 * Unit Test Semantic Goals:
 * 1) Moving 'Ball' to the goal position triggers a SAY message containing "you win", "win!", "victory", or "congratulations".
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;

  const ballName = (config && config.ballSpriteName) || "Ball";
  const goalX = (config && config.goalX) != null ? config.goalX : 200;
  const goalY = (config && config.goalY) != null ? config.goalY : -150;

  const waitForWin = (timeoutMs) => new Promise((resolve) => {
    let timer = null;
    const handler = (target, type, text) => {
      try {
        const msg = String(text || "").toLowerCase();
        if (
          msg.includes("you win") ||
          msg.includes("win!") ||
          msg.includes("victory") ||
          msg.includes("congratulations")
        ) {
          cleanupListener();
          resolve({ detected: true, text: String(text || ""), speaker: target && target.sprite ? target.sprite.name : null });
        }
      } catch (e) {}
    };
    const cleanupListener = () => {
      try { vm.runtime.off("SAY", handler); } catch (e) {}
      if (timer) clearTimeout(timer);
    };
    vm.runtime.on("SAY", handler);
    timer = setTimeout(() => {
      cleanupListener();
      resolve({ detected: false, text: null, speaker: null });
    }, timeoutMs);
  });

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
    details.push(await runCase("ball_reaches_goal_and_win_message_is_displayed", async () => {
      const ball = EU.findSprite(vm, ballName, ["Ball", "Sprite1", "ball"]);
      if (!ball) {
        return { passed: false, error: "Ball sprite not found", meta: {} };
      }

      await EU.wait(400);
      const waitPromise = waitForWin(Math.min(caseTimeoutMs, 4000));
      ball.setXY(goalX, goalY);
      const win = await waitPromise;

      return {
        passed: win.detected,
        meta: {
          ball_name: ball.sprite ? ball.sprite.name : ballName,
          goal_x: goalX,
          goal_y: goalY,
          win_detected: win.detected,
          win_text: win.text,
          speaker: win.speaker,
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
