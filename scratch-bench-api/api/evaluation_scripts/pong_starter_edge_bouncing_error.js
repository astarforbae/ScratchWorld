/**
 * Instruction: This is a basic Pong-style game where a ball bounces around the screen and players control a paddle that follows the mouse. The ball changes direction when hitting the paddle and the game ends when the ball touches red areas. But now in this Pong Game, the pong ball doesn't bounce when it touches the edges (left, right, or top edges of the screen). Please help me fix this issue so the ball properly bounces off the edges with correct physics.
 * Unit Test Semantic Goals:
 * 1) 'Ball' hitting left edge reverses horizontal movement to the right.
 * 2) 'Ball' hitting right edge reverses horizontal movement to the left.
 * 3) 'Ball' hitting top edge reverses vertical movement downward.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;

  const ballName = (config && config.ballName) || "Ball";

  const findBall = () => EU.findSprite(vm, ballName, ["Ball", "Sprite1", "ball"]);

  const forceDirectionFor = async (ball, direction, durationMs = 320, intervalMs = 40) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < durationMs) {
      try { ball.setDirection(direction); } catch (e) {}
      await EU.wait(intervalMs);
    }
  };

  const sampleTrajectory = async (durationMs = 1200, intervalMs = 50) => {
    const samples = [];
    const startedAt = Date.now();
    while (Date.now() - startedAt < durationMs) {
      const ball = findBall();
      if (!ball) break;
      samples.push({
        x: Number(ball.x),
        y: Number(ball.y),
        direction: Number(ball.direction),
      });
      await EU.wait(intervalMs);
    }
    return samples;
  };

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
      await EU.wait(160);
      EU.startVM(vm);
      await EU.wait(450);
    },
    run: async () => runner(),
    afterCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
    },
  });

  const details = [];
  try {
    details.push(await runCase("left_edge_reverses_horizontal_direction", async () => {
      const ball = findBall();
      if (!ball) return { passed: false, error: "Ball sprite not found", meta: {} };

      ball.setXY(-220, 0);
      await forceDirectionFor(ball, -90, 320, 40);
      const samples = await sampleTrajectory(1500, 50);
      const xs = samples.map(s => s.x);
      const minX = xs.length ? Math.min(...xs) : null;
      const firstX = xs.length ? xs[0] : null;
      const lastX = xs.length ? xs[xs.length - 1] : null;

      const startedNearLeft = firstX !== null && firstX <= -140;
      const movedRightAfterNearLeft = minX !== null && lastX !== null && lastX - minX >= 25;
      const touchedExtremeLeftBand = minX !== null && minX <= -150;

      return {
        passed: startedNearLeft && touchedExtremeLeftBand && movedRightAfterNearLeft,
        meta: {
          first_x: firstX,
          min_x: minX,
          last_x: lastX,
          started_near_left: startedNearLeft,
          touched_extreme_left_band: touchedExtremeLeftBand,
          moved_right_after_near_left: movedRightAfterNearLeft,
        },
      };
    }));

    details.push(await runCase("right_edge_reverses_horizontal_direction", async () => {
      const ball = findBall();
      if (!ball) return { passed: false, error: "Ball sprite not found", meta: {} };

      ball.setXY(220, 0);
      await forceDirectionFor(ball, 90, 320, 40);
      const samples = await sampleTrajectory(1500, 50);
      const xs = samples.map(s => s.x);
      const maxX = xs.length ? Math.max(...xs) : null;
      const firstX = xs.length ? xs[0] : null;
      const lastX = xs.length ? xs[xs.length - 1] : null;

      const startedNearRight = firstX !== null && firstX >= 140;
      const movedLeftAfterNearRight = maxX !== null && lastX !== null && maxX - lastX >= 25;
      const touchedExtremeRightBand = maxX !== null && maxX >= 150;

      return {
        passed: startedNearRight && touchedExtremeRightBand && movedLeftAfterNearRight,
        meta: {
          first_x: firstX,
          max_x: maxX,
          last_x: lastX,
          started_near_right: startedNearRight,
          touched_extreme_right_band: touchedExtremeRightBand,
          moved_left_after_near_right: movedLeftAfterNearRight,
        },
      };
    }));

    details.push(await runCase("top_edge_reverses_vertical_direction_downward", async () => {
      const ball = findBall();
      if (!ball) return { passed: false, error: "Ball sprite not found", meta: {} };

      ball.setXY(0, 150);
      await forceDirectionFor(ball, 0, 320, 40);
      const samples = await sampleTrajectory(1600, 50);
      const ys = samples.map(s => s.y);
      const maxY = ys.length ? Math.max(...ys) : null;
      const firstY = ys.length ? ys[0] : null;
      const lastY = ys.length ? ys[ys.length - 1] : null;

      const startedNearTop = firstY !== null && firstY >= 95;
      const movedDownAfterTop = maxY !== null && lastY !== null && maxY - lastY >= 20;
      const touchedExtremeTopBand = maxY !== null && maxY >= 120;

      return {
        passed: startedNearTop && touchedExtremeTopBand && movedDownAfterTop,
        meta: {
          first_y: firstY,
          max_y: maxY,
          last_y: lastY,
          started_near_top: startedNearTop,
          touched_extreme_top_band: touchedExtremeTopBand,
          moved_down_after_top: movedDownAfterTop,
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
