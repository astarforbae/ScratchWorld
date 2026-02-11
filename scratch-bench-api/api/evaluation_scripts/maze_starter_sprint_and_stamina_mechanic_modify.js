/**
 * Instruction: This is a basic maze navigation game where players control a ball sprite using arrow keys to move through a maze. The ball bounces off blue walls and the goal is to reach a target sprite that displays 'You win!' when touched. Add a sprint mode toggled by the space key, using a 'stamina' variable (0-20). When sprinting, the ball moves 15 steps and stamina decreases by 1 per tick; if stamina reaches 0, it must automatically switch back to normal mode. When in normal mode, the ball moves 10 steps and stamina regenerates by 1 per tick. Complete the remaining blocks.
 * Unit Test Semantic Goals:
 * 1) Variable 'stamina' exists and starts at 20.
 * 2) Pressing Space toggles sprint mode on.
 * 3) In sprint mode, Right-arrow movement is faster and stamina decreases.
 * 4) When stamina reaches 0, sprint auto-disables and movement returns near normal speed.
 * 5) In normal mode, stamina regenerates and does not exceed 20.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;

  const ballName = (config && config.ballSpriteName) || "Ball";

  const findBall = () => EU.findSprite(vm, ballName, ["Ball", "Sprite1", "ball"]);

  const findVariableByName = (name) => {
    const lowered = String(name || "").toLowerCase();
    for (const target of vm.runtime.targets || []) {
      const vars = target.variables || {};
      for (const id of Object.keys(vars)) {
        const variable = vars[id];
        if (variable && String(variable.name || "").toLowerCase() === lowered) {
          return variable.value;
        }
      }
    }
    return null;
  };

  const readStamina = () => {
    const raw = findVariableByName("stamina");
    const n = Number(raw);
    return {
      raw,
      value: Number.isFinite(n) ? n : null,
      found: raw !== null,
    };
  };

  const readSprintFlag = () => {
    const raw = findVariableByName("isAccelerating");
    const normalized = String(raw == null ? "" : raw).trim().toLowerCase();
    const bool = normalized === "true" || normalized === "1" || normalized === "yes";
    return { raw, bool, found: raw !== null };
  };

  const measureMovementDistance = async (ball, key = "ArrowRight", durationMs = 120) => {
    const startPos = EU.getSpritePosition(ball);
    EU.simulateKeyDown(vm, key);
    await EU.wait(durationMs);
    EU.simulateKeyUp(vm, key);
    const endPos = EU.getSpritePosition(ball);
    return EU.calculateDistance(startPos, endPos);
  };

  const drainStaminaToZero = async (maxMs = 15000) => {
    const samples = [];
    const startedAt = Date.now();
    EU.simulateKeyDown(vm, "ArrowRight");
    try {
      while (Date.now() - startedAt < maxMs) {
        await EU.wait(20);
        const stamina = readStamina();
        samples.push(stamina.value);
        if (stamina.value !== null && stamina.value <= 0) {
          return { reached_zero: true, samples };
        }
      }
      return { reached_zero: false, samples };
    } finally {
      EU.simulateKeyUp(vm, "ArrowRight");
    }
  };

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
      EU.simulateKeyUp(vm, "ArrowRight");
      EU.simulateKeyUp(vm, " ");
      EU.startVM(vm);
      await EU.wait(700);
    },
    run: async () => runner(),
    afterCase: async () => {
      EU.simulateKeyUp(vm, "ArrowRight");
      EU.simulateKeyUp(vm, " ");
      try { vm.runtime.stopAll(); } catch (e) {}
    },
  });

  const details = [];

  try {
    details.push(await runCase("stamina_variable_exists_and_starts_at_20", async () => {
      const ball = findBall();
      if (!ball) return { passed: false, error: "Ball sprite not found", meta: {} };

      const stamina = readStamina();
      return {
        passed: stamina.found && stamina.value === 20,
        meta: {
          stamina_found: stamina.found,
          stamina_raw: stamina.raw,
          stamina_value: stamina.value,
        },
      };
    }));

    details.push(await runCase("space_key_enables_sprint_mode", async () => {
      const ball = findBall();
      if (!ball) return { passed: false, error: "Ball sprite not found", meta: {} };

      const beforeStamina = readStamina();
      const beforeFlag = readSprintFlag();

      await EU.simulateKeyPress(vm, " ", 120);
      await EU.wait(120);
      const afterFlag = readSprintFlag();

      // If flag variable is absent, use stamina drop after movement as fallback signal.
      EU.simulateKeyDown(vm, "ArrowRight");
      await EU.wait(900);
      EU.simulateKeyUp(vm, "ArrowRight");

      const afterStamina = readStamina();
      const staminaDropped =
        beforeStamina.value !== null &&
        afterStamina.value !== null &&
        afterStamina.value < beforeStamina.value;

      const sprintEnabled = (afterFlag.found && afterFlag.bool && (!beforeFlag.found || !beforeFlag.bool)) || staminaDropped;
      return {
        passed: sprintEnabled,
        meta: {
          before_flag: beforeFlag.raw,
          after_flag: afterFlag.raw,
          before_stamina: beforeStamina.value,
          after_stamina: afterStamina.value,
          stamina_dropped: staminaDropped,
        },
      };
    }));

    details.push(await runCase("sprint_movement_is_faster_and_consumes_stamina", async () => {
      const ball = findBall();
      if (!ball) return { passed: false, error: "Ball sprite not found", meta: {} };

      ball.setXY(0, 0);
      await EU.wait(200);
      const normalDistance = await measureMovementDistance(ball, "ArrowRight", 120);

      await EU.simulateKeyPress(vm, " ", 120);
      await EU.wait(120);

      ball.setXY(0, 0);
      await EU.wait(200);
      const staminaBefore = readStamina();
      const sprintDistance = await measureMovementDistance(ball, "ArrowRight", 120);

      EU.simulateKeyDown(vm, "ArrowRight");
      await EU.wait(900);
      EU.simulateKeyUp(vm, "ArrowRight");
      const staminaAfter = readStamina();

      const staminaDropped =
        staminaBefore.value !== null &&
        staminaAfter.value !== null &&
        staminaAfter.value < staminaBefore.value;
      const passed = sprintDistance > normalDistance * 1.2 && staminaDropped;

      return {
        passed,
        meta: {
          normal_distance: Number(normalDistance.toFixed(2)),
          sprint_distance: Number(sprintDistance.toFixed(2)),
          stamina_before: staminaBefore.value,
          stamina_after: staminaAfter.value,
          stamina_dropped: staminaDropped,
        },
      };
    }));

    details.push(await runCase("stamina_zero_auto_disables_sprint_and_returns_near_normal_speed", async () => {
      const ball = findBall();
      if (!ball) return { passed: false, error: "Ball sprite not found", meta: {} };

      ball.setXY(0, 0);
      await EU.wait(200);
      const normalDistance = await measureMovementDistance(ball, "ArrowRight", 120);

      await EU.simulateKeyPress(vm, " ", 120);
      await EU.wait(200);
      const drained = await drainStaminaToZero(15000);
      await EU.wait(400);

      const flagAfterZero = readSprintFlag();
      ball.setXY(0, 0);
      await EU.wait(200);
      const postZeroDistance = await measureMovementDistance(ball, "ArrowRight", 120);

      const autoDisabled = !flagAfterZero.found || !flagAfterZero.bool;
      const backToNormal = postZeroDistance <= normalDistance * 1.25;
      const passed = drained.reached_zero && autoDisabled && backToNormal;

      return {
        passed,
        meta: {
          reached_zero: drained.reached_zero,
          zero_drain_samples: drained.samples,
          sprint_flag_after_zero: flagAfterZero.raw,
          normal_distance: Number(normalDistance.toFixed(2)),
          post_zero_distance: Number(postZeroDistance.toFixed(2)),
          auto_disabled: autoDisabled,
          back_to_normal_speed: backToNormal,
        },
      };
    }));

    details.push(await runCase("normal_mode_regenerates_stamina_up_to_cap_20", async () => {
      const ball = findBall();
      if (!ball) return { passed: false, error: "Ball sprite not found", meta: {} };

      await EU.simulateKeyPress(vm, " ", 120);
      await EU.wait(120);
      EU.simulateKeyDown(vm, "ArrowRight");
      await EU.wait(900);
      EU.simulateKeyUp(vm, "ArrowRight");

      // Ensure sprint toggled off to allow normal regen path.
      await EU.simulateKeyPress(vm, " ", 120);
      await EU.wait(120);

      const beforeRegen = readStamina();
      await EU.wait(3000);
      const afterRegen = readStamina();
      await EU.wait(2000);
      const finalStamina = readStamina();

      const regenDetected =
        beforeRegen.value !== null &&
        afterRegen.value !== null &&
        afterRegen.value > beforeRegen.value;
      const capped = finalStamina.value !== null && finalStamina.value <= 20;

      return {
        passed: regenDetected && capped,
        meta: {
          stamina_before_regen: beforeRegen.value,
          stamina_after_regen: afterRegen.value,
          stamina_final: finalStamina.value,
          regen_detected: regenDetected,
          capped_at_20: capped,
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
    EU.simulateKeyUp(vm, "ArrowRight");
    EU.simulateKeyUp(vm, " ");
    try { vm.runtime.stopAll(); } catch (e) {}
    if (typeof cleanup === "function") cleanup();
  }
};
