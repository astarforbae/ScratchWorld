/**
 * Instruction: Starting from an empty Scratch project with a single default sprite named 'Sprite1', you should complete the following: when the green flag is clicked, hide 'Sprite1' immediately, wait 2 seconds, then show 'Sprite1' again.
 * Unit Test Semantic Goals:
 * 1) After green flag, 'Sprite1' transitions from visible to hidden immediately.
 * 2) After hiding, 'Sprite1' becomes visible again after about 2 seconds (1.5-2.5 seconds).
 * 3) Visibility order is strictly hide first, then show.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;
  const spriteName = (config && config.spriteName) || "Sprite1";

  const getSprite = () => EU.findSprite(vm, spriteName, ["Sprite1", "Cat"]);

  const observeVisibility = async (durationMs = 6000, sampleMs = 50) => {
    const sprite = getSprite();
    if (!sprite) {
      return {
        spriteFound: false,
        initialVisible: null,
        transitions: [],
      };
    }

    const transitions = [];
    let previousVisible = !!sprite.visible;

    EU.startVM(vm);
    const startedAt = Date.now();

    while (Date.now() - startedAt < durationMs) {
      const currentVisible = !!sprite.visible;
      if (currentVisible !== previousVisible) {
        transitions.push({
          from: previousVisible,
          to: currentVisible,
          t: Date.now() - startedAt,
        });
        previousVisible = currentVisible;
      }
      await EU.wait(sampleMs);
    }

    return {
      spriteFound: true,
      initialVisible: true,
      transitions,
    };
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
    details.push(await runCase("sprite_hides_immediately_after_green_flag", async () => {
      const data = await observeVisibility(2500, 50);
      if (!data.spriteFound) return { passed: false, error: "Sprite1 not found", meta: {} };

      const firstHide = data.transitions.find(step => step.from === true && step.to === false) || null;
      const passed = !!firstHide && firstHide.t <= 700;
      return {
        passed,
        meta: {
          hide_timestamp_ms: firstHide ? firstHide.t : null,
          transitions: data.transitions,
        },
      };
    }));

    details.push(await runCase("sprite_shows_again_about_two_seconds_after_hide", async () => {
      const data = await observeVisibility(6000, 50);
      if (!data.spriteFound) return { passed: false, error: "Sprite1 not found", meta: {} };

      const hideTransition = data.transitions.find(step => step.from === true && step.to === false) || null;
      const showTransition = hideTransition
        ? data.transitions.find(step => step.t > hideTransition.t && step.from === false && step.to === true) || null
        : null;
      const delaySec = (hideTransition && showTransition) ? (showTransition.t - hideTransition.t) / 1000 : null;
      const passed = delaySec !== null && delaySec >= 1.5 && delaySec <= 2.5;

      return {
        passed,
        meta: {
          hide_timestamp_ms: hideTransition ? hideTransition.t : null,
          show_timestamp_ms: showTransition ? showTransition.t : null,
          hide_to_show_seconds: delaySec !== null ? Number(delaySec.toFixed(3)) : null,
        },
      };
    }));

    details.push(await runCase("visibility_order_is_hide_then_show", async () => {
      const data = await observeVisibility(6000, 50);
      if (!data.spriteFound) return { passed: false, error: "Sprite1 not found", meta: {} };

      const first = data.transitions[0] || null;
      const firstShowAfterHide = data.transitions.find((step, index) =>
        index > 0 && step.from === false && step.to === true
      );
      const passed = !!first && first.from === true && first.to === false && !!firstShowAfterHide;

      return {
        passed,
        meta: {
          transition_count: data.transitions.length,
          first_transition: first,
          has_show_after_hide: !!firstShowAfterHide,
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
