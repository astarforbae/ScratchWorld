/**
 * Instruction: Starting from an empty Scratch project with a single default sprite named 'Sprite1', you should complete the following: When the green flag is clicked, make Sprite1 say 'hello'.
 * Unit Test Semantic Goals:
 * 1) On green flag, 'Sprite1' says exactly 'hello'.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 5);
  const caseTimeoutMs = timeoutSec * 1000;

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
      await EU.wait(120);
    },
    run: async () => runner(),
    afterCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
    },
  });

  const details = [];
  try {
    details.push(await runCase("sprite1_says_exact_hello_on_green_flag", async () => {
      return await new Promise((resolve) => {
        let settled = false;
        let timer = null;
        let sayListener = null;

        const settle = (passed, meta = {}) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          if (sayListener) {
            try { vm.runtime.off("SAY", sayListener); } catch (e) {}
          }
          resolve({ passed, meta });
        };

        sayListener = (target, type, text) => {
          const speaker = target && target.sprite ? target.sprite.name : null;
          if (speaker && speaker !== "Sprite1") return;
          const spoken = String(text || "");
          settle(spoken === "hello", {
            speaker,
            spoken_text: spoken,
          });
        };

        timer = setTimeout(() => {
          settle(false, {
            speaker: null,
            spoken_text: null,
            timeout: true,
          });
        }, 2000);

        vm.runtime.on("SAY", sayListener);
        EU.startVM(vm);
      });
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
