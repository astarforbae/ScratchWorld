/**
 * Instruction: This is a basic Pong-style game where a ball bounces around the screen and players control a paddle that follows the mouse. The ball changes direction when hitting the paddle and the game ends when the ball touches red areas. But now in this Pong Game, the game doesn't end even when the pong ball touches the bottom of the screen. Please help me fix this issue so the game properly ends when the ball reaches the bottom.
 * Unit Test Semantic Goals:
 * 1) When 'Ball' reaches bottom red area, it does not continue bouncing gameplay.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 15);
  const caseTimeoutMs = timeoutSec * 1000;

  const ballName = (config && config.ballName) || "Ball";
  const paddleName = (config && config.paddleName) || "Paddle";
  const bottomThresholdConfig = (config && config.bottomThreshold ? Number(config.bottomThreshold) : null);

  const findBall = () => EU.findSprite(vm, ballName, ["Ball", "Sprite1", "ball"]);
  const findPaddle = () => EU.findSprite(vm, paddleName, ["Paddle", "paddle", "Player"]);

  const containsGameOverText = (value) => {
    const text = String(value || "").toLowerCase();
    return (
      text.includes("game over") ||
      text.includes("you lose") ||
      text.includes("lose") ||
      text.includes("lost") ||
      text.includes("end")
    );
  };

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
      await EU.wait(160);
      EU.startVM(vm);
      await EU.wait(500);
    },
    run: async () => runner(),
    afterCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
    },
  });

  const details = [];
  try {
    details.push(await runCase("ball_reaching_bottom_enters_end_state", async () => {
      const ball = findBall();
      const paddle = findPaddle();
      if (!ball) return { passed: false, error: "Ball sprite not found", meta: {} };
      if (paddle) paddle.setXY(-180, paddle.y);
      const stageEdges = EU.getStageEdges(vm);
      const bottomThreshold = Number.isFinite(bottomThresholdConfig)
        ? bottomThresholdConfig
        : Number(stageEdges.bottom + 10);

      let sawGameOverSignal = false;
      const sayTexts = [];
      const broadcastSignals = [];
      const teardownBroadcast = EU.setupBroadcastDetection(vm, (msg) => {
        broadcastSignals.push(String(msg || ""));
        if (containsGameOverText(msg)) sawGameOverSignal = true;
      });
      const sayListener = (target, type, text) => {
        const content = String(text || "");
        sayTexts.push(content);
        if (containsGameOverText(content)) sawGameOverSignal = true;
      };
      vm.runtime.on("SAY", sayListener);

      ball.setXY(120, 120);
      await EU.wait(120);

      const samples = [];
      let reachedBottom = false;
      let bottomIndex = -1;
      let bottomContactY = null;
      let postBottomPath = 0;
      let runtimeStoppedAfterBottom = false;
      let forceDownward = true;
      let postBottomSampleCount = 0;
      let maxYAfterBottom = null;
      let zeroThreadStreak = 0;

      const startedAt = Date.now();
      while (Date.now() - startedAt < 8500) {
        if (paddle) paddle.setXY(-180, paddle.y);
        if (forceDownward) {
          try { ball.setDirection(180); } catch (e) {}
        }
        const point = {
          x: Number(ball.x),
          y: Number(ball.y),
          direction: Number(ball.direction),
          runtime_running: !!vm.runtime.isRunning,
          thread_count: Array.isArray(vm.runtime.threads) ? vm.runtime.threads.length : null,
        };
        const prev = samples.length ? samples[samples.length - 1] : null;
        if (prev && reachedBottom) {
          const dx = point.x - prev.x;
          const dy = point.y - prev.y;
          postBottomPath += Math.sqrt(dx * dx + dy * dy);
        }
        samples.push(point);

        if (!reachedBottom && point.y <= bottomThreshold) {
          reachedBottom = true;
          bottomIndex = samples.length - 1;
          bottomContactY = point.y;
          maxYAfterBottom = point.y;
          forceDownward = false;
        }

        if (reachedBottom) {
          postBottomSampleCount += 1;
          if (maxYAfterBottom === null || point.y > maxYAfterBottom) maxYAfterBottom = point.y;
          if (point.thread_count !== null && point.thread_count === 0) {
            zeroThreadStreak += 1;
          } else {
            zeroThreadStreak = 0;
          }
          if (zeroThreadStreak >= 3) {
            runtimeStoppedAfterBottom = true;
            break;
          }
        }
        if (reachedBottom && sawGameOverSignal) break;
        await EU.wait(40);
      }

      try { vm.runtime.off("SAY", sayListener); } catch (e) {}
      try { teardownBroadcast(); } catch (e) {}

      const hasEndStateSignal = sawGameOverSignal || runtimeStoppedAfterBottom;
      const upwardRebound = (reachedBottom && bottomContactY !== null && maxYAfterBottom !== null)
        ? maxYAfterBottom - bottomContactY
        : null;
      const lowPostBottomMotion = reachedBottom &&
        postBottomSampleCount >= 6 &&
        postBottomPath <= 12 &&
        upwardRebound !== null &&
        upwardRebound <= 8;

      return {
        passed: reachedBottom && (hasEndStateSignal || lowPostBottomMotion),
        meta: {
          bottom_threshold: bottomThreshold,
          reached_bottom: reachedBottom,
          bottom_index: bottomIndex,
          runtime_stopped_after_bottom: runtimeStoppedAfterBottom,
          saw_game_over_signal: sawGameOverSignal,
          post_bottom_sample_count: postBottomSampleCount,
          upward_rebound: upwardRebound !== null ? Number(upwardRebound.toFixed(2)) : null,
          zero_thread_streak: zeroThreadStreak,
          post_bottom_path: Number(postBottomPath.toFixed(2)),
          say_texts: sayTexts.slice(0, 10),
          broadcast_signals: broadcastSignals.slice(0, 10),
          tail_samples: bottomIndex >= 0 ? samples.slice(bottomIndex, Math.min(samples.length, bottomIndex + 10)) : [],
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
