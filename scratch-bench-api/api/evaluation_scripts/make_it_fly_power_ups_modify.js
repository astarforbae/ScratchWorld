/**
 * Instruction: This is a simple flying game where a cat sprite can be controlled with arrow keys to fly up and down while buildings scroll continuously across the screen from right to left, creating a side-scrolling flight experience. We want to add a feature where collecting a power-up item slows down the buildings. The project already includes a 'Power Up' sprite and a `glideDuration` variable to control the 'Buildings' sprite's speed. Please program the 'Power Up' sprite to generate a clone every few seconds at a random y-position on the right side of the screen that moves toward the left. When the cat touches a 'Power Up' clone, delete the clone and increase the `glideDuration` of the buildings to slow them down.
 * Unit Test Semantic Goals:
 * 1) A 'Power Up' clone appears on the right side and moves left.
 * 2) Successive 'Power Up' clone spawns use varied y-positions.
 * 3) Cat touching a 'Power Up' clone removes that clone.
 * 4) Collecting a clone increases `glideDuration`.
 * 5) Multiple pickups cumulatively slow Buildings' leftward speed.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 30);
  const caseTimeoutMs = timeoutSec * 1000;

  const catNames = (config && config.catSpriteName)
    ? [String(config.catSpriteName)]
    : ["Cat", "Sprite1", "Player", "Cat1 Flying"];
  const buildingsNames = (config && config.buildingsSpriteName)
    ? [String(config.buildingsSpriteName)]
    : ["Buildings", "Building", "Pipes", "Obstacle"];
  const powerUpNames = (config && config.powerUpSpriteName)
    ? [String(config.powerUpSpriteName)]
    : ["Power Up", "PowerUp", "Power"];

  const findByNames = (names, fallbacks = []) => {
    for (const name of names) {
      const sprite = EU.findSprite(vm, name, fallbacks);
      if (sprite) return sprite;
    }
    return null;
  };

  const nameMatches = (spriteName, candidates) => {
    const lowered = String(spriteName || "").toLowerCase();
    return candidates.some(candidate => lowered.includes(String(candidate).toLowerCase()));
  };

  const listPowerUpClones = () => {
    return (vm.runtime.targets || []).filter(target => {
      if (target.isOriginal) return false;
      if (!target.sprite || !target.sprite.name) return false;
      return nameMatches(target.sprite.name, powerUpNames);
    });
  };

  const waitForNewPowerUpClone = async (seen, timeoutMs = 9000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const clones = listPowerUpClones();
      for (const clone of clones) {
        if (!seen.has(clone) && clone.visible !== false) {
          seen.add(clone);
          return clone;
        }
      }
      await EU.wait(100);
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

  const readVariableNumber = (name) => {
    const hit = findVariableByName(name);
    if (!hit) return { found: false, value: null };
    const numeric = Number(hit.variable.value);
    return { found: true, value: Number.isFinite(numeric) ? numeric : null };
  };

  const sampleLeftwardSpeed = async (sprite, activeMs = 1500, intervalMs = 20) => {
    let elapsed = 0;
    const dxSamples = [];

    let last = EU.getSpritePosition(sprite);
    const wallStart = Date.now();
    const maxWallMs = activeMs * 4;

    while (elapsed < activeMs && (Date.now() - wallStart) < maxWallMs) {
      await EU.wait(intervalMs);
      const cur = EU.getSpritePosition(sprite);
      const dx = cur.x - last.x;

      // Nonredundant leftward frames only: x changed and movement is leftward.
      if (dx <= 0 && cur.x !== last.x) {
        dxSamples.push(Math.abs(dx));
        elapsed += intervalMs;
      }
      last = cur;
    }

    const avgDx = dxSamples.length
      ? dxSamples.reduce((sum, value) => sum + value, 0) / dxSamples.length
      : 0;
    return {
      elapsed,
      avg_speed: avgDx,
      dx_sample_count: dxSamples.length,
    };
  };

  const measureBuildingsSpeed = async (buildings) => {
    const pos = EU.getSpritePosition(buildings);
    buildings.setXY(220, pos.y);
    await EU.wait(250);
    return await sampleLeftwardSpeed(buildings, 1500, 20);
  };

  const collectOnePowerUp = async (cat, seen, timeoutMs = 9000) => {
    const clone = await waitForNewPowerUpClone(seen, timeoutMs);
    if (!clone) return { ok: false, reason: "no_clone" };

    const pos = EU.getSpritePosition(clone);
    cat.setXY(pos.x, pos.y);
    await EU.wait(700);

    const cloneStillVisible = clone.visible !== false && (vm.runtime.targets || []).includes(clone);
    return {
      ok: !cloneStillVisible,
      clone,
      clone_still_visible: cloneStillVisible,
      position: pos,
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
    details.push(await runCase("power_up_spawns_on_right_and_moves_left", async () => {
      EU.startVM(vm);
      await EU.wait(500);

      const seen = new Set();
      const clone = await waitForNewPowerUpClone(seen, 9000);
      if (!clone) {
        return { passed: false, error: "No Power Up clone spawned", meta: {} };
      }

      const start = EU.getSpritePosition(clone);
      await EU.wait(450);
      const end = EU.getSpritePosition(clone);

      const passed = start.x > 100 && end.x < start.x - 2;
      return {
        passed,
        meta: {
          start_x: Number(start.x.toFixed(2)),
          start_y: Number(start.y.toFixed(2)),
          end_x: Number(end.x.toFixed(2)),
          end_y: Number(end.y.toFixed(2)),
          delta_x: Number((end.x - start.x).toFixed(2)),
        },
      };
    }));

    details.push(await runCase("power_up_spawn_y_positions_vary", async () => {
      EU.startVM(vm);
      await EU.wait(500);

      const seen = new Set();
      const yPositions = [];
      const startedAt = Date.now();
      while (yPositions.length < 3 && (Date.now() - startedAt) < 17000) {
        const clone = await waitForNewPowerUpClone(seen, 6000);
        if (!clone) break;
        const pos = EU.getSpritePosition(clone);
        yPositions.push(pos.y);
      }

      const rounded = yPositions.map(y => Number(y.toFixed(1)));
      const distinct = new Set(rounded).size;
      const passed = yPositions.length >= 2 && distinct >= 2;

      return {
        passed,
        meta: {
          y_positions: rounded,
          distinct_count: distinct,
        },
      };
    }));

    details.push(await runCase("touching_power_up_deletes_clone", async () => {
      const cat = findByNames(catNames, ["cat"]);
      if (!cat) return { passed: false, error: "Cat sprite not found", meta: {} };

      EU.startVM(vm);
      await EU.wait(500);

      const seen = new Set();
      const collection = await collectOnePowerUp(cat, seen, 9000);
      return {
        passed: collection.ok,
        meta: {
          collection_ok: collection.ok,
          reason: collection.reason || null,
          clone_still_visible: collection.clone_still_visible,
          position: collection.position || null,
        },
      };
    }));

    details.push(await runCase("pickup_increases_glideDuration", async () => {
      const cat = findByNames(catNames, ["cat"]);
      if (!cat) return { passed: false, error: "Cat sprite not found", meta: {} };

      EU.startVM(vm);
      await EU.wait(500);

      const before = readVariableNumber("glideDuration");
      const seen = new Set();
      const collection = await collectOnePowerUp(cat, seen, 9000);
      await EU.wait(250);
      const after = readVariableNumber("glideDuration");

      const passed = collection.ok && before.found && after.found &&
        before.value !== null && after.value !== null && after.value > before.value;

      return {
        passed,
        meta: {
          collected: collection.ok,
          glide_duration_before: before.value,
          glide_duration_after: after.value,
          delta: (before.value !== null && after.value !== null)
            ? Number((after.value - before.value).toFixed(3))
            : null,
        },
      };
    }));

    details.push(await runCase("multiple_pickups_cumulatively_slow_buildings", async () => {
      const cat = findByNames(catNames, ["cat"]);
      const buildings = findByNames(buildingsNames, ["buildings", "pipes"]);
      if (!cat || !buildings) {
        return {
          passed: false,
          error: "Cat or Buildings sprite not found",
          meta: { cat_found: !!cat, buildings_found: !!buildings },
        };
      }

      EU.startVM(vm);
      await EU.wait(700);

      const seen = new Set();
      const speedBefore = await measureBuildingsSpeed(buildings);

      const collect1 = await collectOnePowerUp(cat, seen, 9000);
      if (!collect1.ok) {
        return { passed: false, error: "First power-up collection failed", meta: { first_collection: collect1 } };
      }
      await EU.wait(300);
      const speedAfter1 = await measureBuildingsSpeed(buildings);

      const collect2 = await collectOnePowerUp(cat, seen, 9000);
      if (!collect2.ok) {
        return { passed: false, error: "Second power-up collection failed", meta: { second_collection: collect2 } };
      }
      await EU.wait(300);
      const speedAfter2 = await measureBuildingsSpeed(buildings);

      const speedDeltaThreshold = 0.04;
      const slowedOnce = speedAfter1.avg_speed < speedBefore.avg_speed - speedDeltaThreshold;
      const slowedTwice = speedAfter2.avg_speed < speedAfter1.avg_speed - speedDeltaThreshold;
      const passed = slowedOnce && slowedTwice;

      return {
        passed,
        meta: {
          speed_before: Number(speedBefore.avg_speed.toFixed(2)),
          speed_after_1: Number(speedAfter1.avg_speed.toFixed(2)),
          speed_after_2: Number(speedAfter2.avg_speed.toFixed(2)),
          speed_delta_threshold: speedDeltaThreshold,
          sampling_interval_ms: 20,
          dx_sample_count_before: speedBefore.dx_sample_count,
          dx_sample_count_after_1: speedAfter1.dx_sample_count,
          dx_sample_count_after_2: speedAfter2.dx_sample_count,
          slowed_once: slowedOnce,
          slowed_twice: slowedTwice,
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
