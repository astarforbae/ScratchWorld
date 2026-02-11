/**
 * Instruction: Starting from an empty Scratch project with a single default sprite named 'Sprite1', you should complete the following: 1) When the green flag is clicked, move Sprite1 to the right at a constant speed. 2) When Sprite1's x-position goes beyond the right edge of the stage, instantly wrap it to the left edge at the same y-position. 3) Repeat this behavior forever.
 * Unit Test Semantic Goals:
 * 1) After green flag, Sprite1 repeatedly moves right (positive x-step) at a near-constant rate.
 * 2) Crossing the right edge wraps Sprite1 to the left edge while keeping y nearly unchanged.
 * 3) Edge wrapping repeats at least twice, showing continuous looped behavior.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;
  const spriteName = "Sprite1";

  const getRunnerSprite = () => EU.findSprite(vm, spriteName, ["Sprite1", "Cat"]);

  const collectMotionHistory = async (durationMs = 9000, sampleMs = 100) => {
    EU.startVM(vm);
    await EU.wait(300);

    const sprite = getRunnerSprite();
    if (!sprite) {
      return { spriteFound: false, stageEdges: EU.getStageEdges(vm), history: [], wraps: [] };
    }

    const stageEdges = EU.getStageEdges(vm);
    const history = [];
    const wraps = [];

    const startedAt = Date.now();
    let previous = null;

    while (Date.now() - startedAt < durationMs) {
      const point = {
        x: Number(sprite.x) || 0,
        y: Number(sprite.y) || 0,
        t: Date.now() - startedAt,
      };
      history.push(point);

      if (previous) {
        const dx = point.x - previous.x;
        const wrappedFromRightToLeft =
          previous.x > stageEdges.right - 35 &&
          point.x < stageEdges.left + 45 &&
          dx < -150;
        if (wrappedFromRightToLeft) {
          wraps.push({
            from: previous,
            to: point,
            y_delta: Math.abs(point.y - previous.y),
          });
        }
      }

      previous = point;
      await EU.wait(sampleMs);
    }

    return { spriteFound: true, stageEdges, history, wraps };
  };

  const summarizeRightMotion = (history) => {
    let usableSteps = 0;
    let positiveSteps = 0;
    let dxSum = 0;

    for (let i = 1; i < history.length; i++) {
      const dx = history[i].x - history[i - 1].x;
      if (Math.abs(dx) > 150) continue;
      usableSteps += 1;
      dxSum += dx;
      if (dx > 0.5) positiveSteps += 1;
    }

    const positiveRatio = usableSteps ? positiveSteps / usableSteps : 0;
    const avgDx = usableSteps ? dxSum / usableSteps : 0;
    return { usableSteps, positiveSteps, positiveRatio, avgDx };
  };

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
    },
    run: async () => runner(),
    afterCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
    },
  });

  const details = [];

  try {
    details.push(await runCase("sprite_moves_right_at_near_constant_rate", async () => {
      const data = await collectMotionHistory(6000, 100);
      if (!data.spriteFound) return { passed: false, error: "Sprite1 not found", meta: {} };
      const motion = summarizeRightMotion(data.history);
      const passed = motion.usableSteps >= 15 && motion.positiveRatio >= 0.8 && motion.avgDx > 0.5;
      return {
        passed,
        meta: {
          usable_steps: motion.usableSteps,
          positive_steps: motion.positiveSteps,
          positive_ratio: Number(motion.positiveRatio.toFixed(3)),
          average_dx: Number(motion.avgDx.toFixed(3)),
        },
      };
    }));

    details.push(await runCase("right_edge_crossing_wraps_to_left_with_same_y", async () => {
      const data = await collectMotionHistory(9000, 100);
      if (!data.spriteFound) return { passed: false, error: "Sprite1 not found", meta: {} };
      const firstWrap = data.wraps[0] || null;
      const passed = !!firstWrap && firstWrap.y_delta <= 25;
      return {
        passed,
        meta: {
          wrap_count: data.wraps.length,
          first_wrap_y_delta: firstWrap ? Number(firstWrap.y_delta.toFixed(2)) : null,
        },
      };
    }));

    details.push(await runCase("wrapping_repeats_continuously", async () => {
      const data = await collectMotionHistory(12000, 100);
      if (!data.spriteFound) return { passed: false, error: "Sprite1 not found", meta: {} };
      const motion = summarizeRightMotion(data.history);
      const passed = data.wraps.length >= 2 && motion.positiveRatio >= 0.7;
      return {
        passed,
        meta: {
          wrap_count: data.wraps.length,
          positive_ratio: Number(motion.positiveRatio.toFixed(3)),
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
