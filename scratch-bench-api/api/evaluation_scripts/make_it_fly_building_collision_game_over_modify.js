/**
 * Instruction: This is a simple flying game where a cat sprite can be controlled with arrow keys to fly up and down while buildings scroll continuously across the screen from right to left, creating a side-scrolling flight experience. Please add a collision detection system that when the cat touches the Buildings sprite, trigger a game over: stop the player's and Buildings' movement, display a "Game Over" message for 2 seconds, and stop all
 * Unit Test Semantic Goals:
 * 1) Before collision, 'Buildings' moves leftward across the stage.
 * 2) Forcing Cat to touch 'Buildings' produces a SAY message containing "game over".
 * 3) After collision, Cat and 'Buildings' become stationary.
 * 4) After collision, runtime scripts stop (game-over stop-all behavior).
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 30);
  const caseTimeoutMs = timeoutSec * 1000;

  const catNames = (config && config.catSpriteName)
    ? [String(config.catSpriteName)]
    : ["Cat", "Sprite1", "Player", "Cat1 Flying"];
  const buildingNames = (config && config.buildingsSpriteName)
    ? [String(config.buildingsSpriteName)]
    : ["Buildings", "Building", "Obstacle", "Pipes"];

  const findByNames = (names, fallbacks = []) => {
    for (const name of names) {
      const sprite = EU.findSprite(vm, name, fallbacks);
      if (sprite) return sprite;
    }
    return null;
  };

  const sampleMovement = async (sprite, durationMs = 1200, intervalMs = 120) => {
    const points = [];
    let distance = 0;
    let leftSteps = 0;

    let last = EU.getSpritePosition(sprite);
    points.push(last);

    const start = Date.now();
    while (Date.now() - start < durationMs) {
      await EU.wait(intervalMs);
      const cur = EU.getSpritePosition(sprite);
      const dx = cur.x - last.x;
      const dy = cur.y - last.y;
      distance += Math.hypot(dx, dy);
      if (dx < -0.5) leftSteps += 1;
      points.push(cur);
      last = cur;
    }

    const first = points[0] || { x: 0, y: 0 };
    const lastPoint = points[points.length - 1] || first;
    return {
      distance,
      left_steps: leftSteps,
      net_dx: lastPoint.x - first.x,
      sample_count: points.length,
    };
  };

  const triggerCollision = async (cat, buildings) => {
    const bPos = EU.getSpritePosition(buildings);
    cat.setXY(bPos.x, bPos.y);
    await EU.wait(120);
    cat.setXY(bPos.x, bPos.y);
    await EU.wait(120);
  };

  const waitForGameOverSay = async (timeoutMs = 4500) => {
    let sayListener = null;
    let timeoutTimer = null;
    let done = false;

    return await new Promise((resolve) => {
      const finish = (result) => {
        if (done) return;
        done = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (sayListener) {
          try { vm.runtime.off("SAY", sayListener); } catch (e) {}
        }
        resolve(result);
      };

      sayListener = (target, type, text) => {
        const normalized = String(text || "").toLowerCase();
        if (normalized.includes("game over")) {
          finish({ detected: true, text: String(text || ""), speaker: target && target.sprite ? target.sprite.name : null });
        }
      };

      vm.runtime.on("SAY", sayListener);
      timeoutTimer = setTimeout(() => finish({ detected: false, text: null, speaker: null }), timeoutMs);
    });
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
    details.push(await runCase("buildings_move_leftward_before_collision", async () => {
      const cat = findByNames(catNames, ["cat"]);
      const buildings = findByNames(buildingNames, ["build", "buildings"]);
      if (!cat || !buildings) {
        return {
          passed: false,
          error: "Required sprites not found",
          meta: { cat_found: !!cat, buildings_found: !!buildings },
        };
      }

      EU.startVM(vm);
      await EU.wait(500);
      try { cat.setXY(-220, 0); } catch (e) {}

      const movement = await sampleMovement(buildings, 1500, 120);
      const passed = movement.distance > 8 && (movement.net_dx < -5 || movement.left_steps >= 3);
      return {
        passed,
        meta: {
          distance: Number(movement.distance.toFixed(2)),
          net_dx: Number(movement.net_dx.toFixed(2)),
          left_steps: movement.left_steps,
          sample_count: movement.sample_count,
        },
      };
    }));

    details.push(await runCase("collision_triggers_game_over_message", async () => {
      const cat = findByNames(catNames, ["cat"]);
      const buildings = findByNames(buildingNames, ["build", "buildings"]);
      if (!cat || !buildings) {
        return {
          passed: false,
          error: "Required sprites not found",
          meta: { cat_found: !!cat, buildings_found: !!buildings },
        };
      }

      EU.startVM(vm);
      await EU.wait(500);

      const sayPromise = waitForGameOverSay(4500);
      await triggerCollision(cat, buildings);
      const sayObservation = await sayPromise;

      return {
        passed: sayObservation.detected,
        meta: {
          detected: sayObservation.detected,
          speaker: sayObservation.speaker,
          text: sayObservation.text,
        },
      };
    }));

    details.push(await runCase("collision_stops_cat_and_buildings_motion", async () => {
      const cat = findByNames(catNames, ["cat"]);
      const buildings = findByNames(buildingNames, ["build", "buildings"]);
      if (!cat || !buildings) {
        return {
          passed: false,
          error: "Required sprites not found",
          meta: { cat_found: !!cat, buildings_found: !!buildings },
        };
      }

      EU.startVM(vm);
      await EU.wait(500);
      await triggerCollision(cat, buildings);
      await EU.wait(500);

      const catMovement = await sampleMovement(cat, 1000, 100);
      const buildingsMovement = await sampleMovement(buildings, 1000, 100);
      const catStable = catMovement.distance <= 2;
      const buildingsStable = buildingsMovement.distance <= 2;

      return {
        passed: catStable && buildingsStable,
        meta: {
          cat_distance: Number(catMovement.distance.toFixed(2)),
          buildings_distance: Number(buildingsMovement.distance.toFixed(2)),
          cat_stable: catStable,
          buildings_stable: buildingsStable,
        },
      };
    }));

    details.push(await runCase("collision_stops_runtime_scripts", async () => {
      const cat = findByNames(catNames, ["cat"]);
      const buildings = findByNames(buildingNames, ["build", "buildings"]);
      if (!cat || !buildings) {
        return {
          passed: false,
          error: "Required sprites not found",
          meta: { cat_found: !!cat, buildings_found: !!buildings },
        };
      }

      EU.startVM(vm);
      await EU.wait(500);
      await triggerCollision(cat, buildings);

      const startedAt = Date.now();
      let stopped = false;
      while (Date.now() - startedAt < 3500) {
        if (!EU.isVMRunning(vm)) {
          stopped = true;
          break;
        }
        await EU.wait(100);
      }

      return {
        passed: stopped,
        meta: { runtime_stopped: stopped },
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
