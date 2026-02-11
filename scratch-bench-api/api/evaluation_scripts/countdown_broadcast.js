/**
 * Instruction: Starting from an empty Scratch project with a single default sprite named 'Sprite1', you should complete the following: 1) Create a variable named 'timer'. 2) When the green flag is clicked, set 'timer' to 5. 3) Repeatedly wait 1 second and change 'timer' by -1 until it reaches 0. 4) When 'timer' becomes 0, broadcast a message named 'timeup' and make Sprite1 say 'Time's up!' for 2 seconds.
 * Unit Test Semantic Goals:
 * 1) The variable named exactly 'timer' starts at 5 and reaches 0 after green flag.
 * 2) Countdown follows 5 -> 4 -> 3 -> 2 -> 1 -> 0 with roughly 1-second decrements.
 * 3) When timer reaches 0, broadcast message 'timeup' and say text containing "Time's up".
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 25);
  const caseTimeoutMs = timeoutSec * 1000;
  const spriteName = (config && config.spriteName) || "Sprite1";

  const findTimerVariableRef = () => {
    const sprite = EU.findSprite(vm, spriteName, ["Cat", "Sprite"]);
    const stage = vm.runtime.getTargetForStage();
    const lookupTargets = [sprite, stage].filter(Boolean);

    for (const target of lookupTargets) {
      const variables = target.variables || {};
      for (const id of Object.keys(variables)) {
        const variable = variables[id];
        if (variable && String(variable.name || "").toLowerCase() === "timer") {
          return { target, id };
        }
      }
    }
    return null;
  };

  const readTimerValue = (timerRef) => {
    if (!timerRef || !timerRef.target || !timerRef.id) return null;
    const variables = timerRef.target.variables || {};
    const variable = variables[timerRef.id];
    if (!variable) return null;
    const numeric = Number(variable.value);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const observeCountdown = async (durationMs = 9000) => {
    let timerRef = findTimerVariableRef();
    const changes = [];
    let reachedZeroAt = null;
    let sawFive = false;
    let broadcastDetected = false;
    let messageDetected = false;

    const stopBroadcastDetection = EU.detectBroadcast(vm, "timeup", () => {
      broadcastDetected = true;
    });

    const sayListener = (target, type, text) => {
      if (!target || !target.sprite || target.sprite.name !== spriteName) return;
      const normalized = String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (normalized.includes("time s up") || normalized.includes("times up")) {
        messageDetected = true;
      }
    };

    vm.runtime.on("SAY", sayListener);
    try {
      EU.startVM(vm);

      const startedAt = Date.now();
      while (Date.now() - startedAt < durationMs) {
        if (!timerRef) timerRef = findTimerVariableRef();

        if (timerRef) {
          const currentValue = readTimerValue(timerRef);
          if (currentValue !== null) {
            const lastValue = changes.length ? changes[changes.length - 1].value : null;
            if (lastValue !== currentValue) {
              changes.push({ value: currentValue, t: Date.now() - startedAt });
              if (currentValue === 5) sawFive = true;
              if (sawFive && currentValue === 0 && reachedZeroAt === null) reachedZeroAt = Date.now();
            }
          }
        }

        if (reachedZeroAt !== null && Date.now() - reachedZeroAt >= 2200) break;
        await EU.wait(100);
      }
    } finally {
      try { vm.runtime.off("SAY", sayListener); } catch (e) {}
      try { stopBroadcastDetection(); } catch (e) {}
    }

    return {
      timerFound: !!timerRef,
      changes,
      reachedZero: reachedZeroAt !== null,
      broadcastDetected,
      messageDetected,
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
    details.push(await runCase("timer_starts_at_5_and_reaches_0", async () => {
      const observation = await observeCountdown(9000);
      const values = observation.changes.map(item => item.value);
      const firstFiveIndex = values.indexOf(5);
      const lastZeroIndex = values.lastIndexOf(0);
      const startsAtFive = firstFiveIndex !== -1;
      const reachesZero = firstFiveIndex !== -1 && lastZeroIndex > firstFiveIndex;
      return {
        passed: observation.timerFound && startsAtFive && reachesZero,
        meta: {
          timer_found: observation.timerFound,
          observed_values: values,
        },
      };
    }));

    details.push(await runCase("timer_decrements_by_one_about_every_second", async () => {
      const observation = await observeCountdown(9000);
      const values = observation.changes.map(item => item.value);
      const expectedOrder = [5, 4, 3, 2, 1, 0];
      let orderIndex = 0;
      for (const value of values) {
        if (value === expectedOrder[orderIndex]) orderIndex += 1;
        if (orderIndex === expectedOrder.length) break;
      }

      const stepIntervals = [];
      for (let i = 1; i < observation.changes.length; i++) {
        const prev = observation.changes[i - 1];
        const curr = observation.changes[i];
        if (prev.value - curr.value === 1) {
          stepIntervals.push(curr.t - prev.t);
        }
      }
      const nearOneSecondCount = stepIntervals.filter(ms => ms >= 650 && ms <= 1700).length;
      const passed = orderIndex === expectedOrder.length && stepIntervals.length >= 4 && nearOneSecondCount >= 4;
      return {
        passed,
        meta: {
          observed_values: values,
          step_intervals_ms: stepIntervals,
          near_one_second_count: nearOneSecondCount,
        },
      };
    }));

    details.push(await runCase("timeup_broadcast_and_times_up_message_when_zero", async () => {
      const observation = await observeCountdown(9000);
      return {
        passed: observation.reachedZero && observation.broadcastDetected && observation.messageDetected,
        meta: {
          reached_zero: observation.reachedZero,
          broadcast_detected: observation.broadcastDetected,
          message_detected: observation.messageDetected,
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
