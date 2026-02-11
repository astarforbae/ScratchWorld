/**
 * Instruction: This is a simple flying game where a cat sprite can be controlled with arrow keys to fly up and down while buildings scroll continuously across the screen from right to left, creating a side-scrolling flight experience. Please implement a gravity system: create a variable velocityY. In a forever loop, change velocityY by a negative amount and change y by velocityY. When the flap key is pressed (space), set velocityY to a positive impulse. Remove edge bounce from vertical motion for consistent physics. Do not control the cat with the up or down arrow keys; only space should trigger flaps.
 * Unit Test Semantic Goals:
 * 1) Variable 'velocityY' exists and its value updates while the game runs.
 * 2) Without key input, Cat descends and 'velocityY' reaches negative values.
 * 3) Pressing Space causes an upward impulse (rise in y and positive 'velocityY').
 * 4) Up/Down Arrow keys do not create the same flap impulse as Space.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 30);
  const caseTimeoutMs = timeoutSec * 1000;

  const catNames = (config && config.catSpriteName)
    ? [String(config.catSpriteName)]
    : ["Cat", "Sprite1", "Player", "Cat1 Flying"];

  const findCat = () => {
    for (const name of catNames) {
      const sprite = EU.findSprite(vm, name, ["cat"]);
      if (sprite) return sprite;
    }
    return null;
  };

  const findVariableByName = (name) => {
    const lowered = String(name).toLowerCase();
    for (const target of vm.runtime.targets || []) {
      const vars = target.variables || {};
      for (const id of Object.keys(vars)) {
        const variable = vars[id];
        if (variable && String(variable.name || "").toLowerCase() === lowered) {
          return { target, id, variable };
        }
      }
    }
    return null;
  };

  const readVelocityY = () => {
    const hit = findVariableByName("velocityY");
    if (!hit) return { found: false, value: null };
    const numeric = Number(hit.variable.value);
    return { found: true, value: Number.isFinite(numeric) ? numeric : null };
  };

  const observeMotionAndVelocity = async (cat, durationMs = 1200, intervalMs = 80) => {
    const yValues = [];
    const velocityValues = [];

    const startY = Number(cat.y) || 0;
    const startedAt = Date.now();
    while (Date.now() - startedAt < durationMs) {
      yValues.push(Number(cat.y) || 0);
      velocityValues.push(readVelocityY().value);
      await EU.wait(intervalMs);
    }

    const endY = Number(cat.y) || 0;
    const minY = yValues.length ? Math.min(...yValues) : startY;
    const maxY = yValues.length ? Math.max(...yValues) : startY;
    const finiteVelocities = velocityValues.filter(v => Number.isFinite(v));

    return {
      start_y: startY,
      end_y: endY,
      min_y: minY,
      max_y: maxY,
      y_values: yValues,
      velocity_values: velocityValues,
      min_velocity: finiteVelocities.length ? Math.min(...finiteVelocities) : null,
      max_velocity: finiteVelocities.length ? Math.max(...finiteVelocities) : null,
      unique_velocity_count: new Set(finiteVelocities.map(v => Number(v.toFixed(3)))).size,
    };
  };

  const measureImpulseFromKey = async (cat, key) => {
    const beforeY = Number(cat.y) || 0;
    await EU.simulateKeyPress(vm, key, 180);
    const obs = await observeMotionAndVelocity(cat, 800, 70);
    return {
      key,
      rise: obs.max_y - beforeY,
      max_velocity: obs.max_velocity,
      min_velocity: obs.min_velocity,
      y_values: obs.y_values,
      velocity_values: obs.velocity_values,
    };
  };

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
      EU.simulateKeyUp(vm, "ArrowUp");
      EU.simulateKeyUp(vm, "ArrowDown");
      EU.simulateKeyUp(vm, " ");
    },
    run: async () => runner(),
    afterCase: async () => {
      EU.simulateKeyUp(vm, "ArrowUp");
      EU.simulateKeyUp(vm, "ArrowDown");
      EU.simulateKeyUp(vm, " ");
      try { vm.runtime.stopAll(); } catch (e) {}
    },
  });

  const details = [];

  try {
    details.push(await runCase("velocityY_variable_exists_and_updates", async () => {
      const cat = findCat();
      if (!cat) return { passed: false, error: "Cat sprite not found", meta: {} };

      EU.startVM(vm);
      await EU.wait(500);
      try { cat.setXY(0, 0); } catch (e) {}
      await EU.wait(150);

      const obs = await observeMotionAndVelocity(cat, 1400, 90);
      const velocityFound = obs.velocity_values.some(v => Number.isFinite(v));
      const passed = velocityFound && obs.unique_velocity_count >= 2;

      return {
        passed,
        meta: {
          velocity_found: velocityFound,
          unique_velocity_count: obs.unique_velocity_count,
          min_velocity: obs.min_velocity,
          max_velocity: obs.max_velocity,
        },
      };
    }));

    details.push(await runCase("idle_descent_and_negative_velocity", async () => {
      const cat = findCat();
      if (!cat) return { passed: false, error: "Cat sprite not found", meta: {} };

      EU.startVM(vm);
      await EU.wait(500);
      try { cat.setXY(0, 0); } catch (e) {}
      await EU.wait(120);

      const obs = await observeMotionAndVelocity(cat, 1400, 80);
      const descent = obs.end_y - obs.start_y;
      const passed = descent <= -8 && obs.min_velocity !== null && obs.min_velocity < 0;

      return {
        passed,
        meta: {
          start_y: Number(obs.start_y.toFixed(2)),
          end_y: Number(obs.end_y.toFixed(2)),
          descent: Number(descent.toFixed(2)),
          min_velocity: obs.min_velocity,
        },
      };
    }));

    details.push(await runCase("space_key_creates_flap_impulse", async () => {
      const cat = findCat();
      if (!cat) return { passed: false, error: "Cat sprite not found", meta: {} };

      EU.startVM(vm);
      await EU.wait(500);
      try { cat.setXY(0, 0); } catch (e) {}
      await EU.wait(150);

      const impulse = await measureImpulseFromKey(cat, " ");
      const passed = impulse.rise >= 8 && impulse.max_velocity !== null && impulse.max_velocity > 0;

      return {
        passed,
        meta: {
          rise: Number(impulse.rise.toFixed(2)),
          max_velocity: impulse.max_velocity,
          min_velocity: impulse.min_velocity,
        },
      };
    }));

    details.push(await runCase("arrow_keys_do_not_trigger_flap_impulse", async () => {
      const cat = findCat();
      if (!cat) return { passed: false, error: "Cat sprite not found", meta: {} };

      EU.startVM(vm);
      await EU.wait(500);
      try { cat.setXY(0, 0); } catch (e) {}
      await EU.wait(150);

      const up = await measureImpulseFromKey(cat, "ArrowUp");
      await EU.wait(180);
      const down = await measureImpulseFromKey(cat, "ArrowDown");

      const passed = up.rise < 5 && down.rise < 5 &&
        (up.max_velocity === null || up.max_velocity < 2) &&
        (down.max_velocity === null || down.max_velocity < 2);

      return {
        passed,
        meta: {
          arrow_up_rise: Number(up.rise.toFixed(2)),
          arrow_up_max_velocity: up.max_velocity,
          arrow_down_rise: Number(down.rise.toFixed(2)),
          arrow_down_max_velocity: down.max_velocity,
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
