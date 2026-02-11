/**
 * Instruction: This is a simple flying game where a cat sprite can be controlled with arrow keys to fly up and down while buildings scroll continuously across the screen from right to left, creating a side-scrolling flight experience. Please create a variable score and increase it by one every second. Decrease the glide duration of Buildings over time to make obstacles move faster. Ensure the game runs continuously with visible score updates.
 * Unit Test Semantic Goals:
 * 1) Variable 'score' increases by about +1 each second during play.
 * 2) Glide-duration control variable (for example 'glideDuration' or 'glideTime') decreases over time.
 * 3) Buildings move faster later than at the start.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 30);
  const caseTimeoutMs = timeoutSec * 1000;

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

  const normalizeVariableName = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  const findVariableByName = (name) => {
    const wanted = normalizeVariableName(name);
    for (const target of vm.runtime.targets || []) {
      const vars = target.variables || {};
      for (const id of Object.keys(vars)) {
        const variable = vars[id];
        if (variable && normalizeVariableName(variable.name) === wanted) {
          return { target, id, variable };
        }
      }
    }
    return null;
  };

  const findVariableByAnyName = (names) => {
    for (const name of names) {
      const hit = findVariableByName(name);
      if (hit) return hit;
    }
    return null;
  };

  const readVariableNumber = (name) => {
    const hit = findVariableByName(name);
    if (!hit) return { found: false, value: null };
    const numeric = Number(hit.variable.value);
    return {
      found: true,
      name: String(hit.variable.name || name),
      value: Number.isFinite(numeric) ? numeric : null,
    };
  };

  const readVariableNumberByAnyName = (names) => {
    const hit = findVariableByAnyName(names);
    if (!hit) return { found: false, name: null, value: null };
    const numeric = Number(hit.variable.value);
    return {
      found: true,
      name: String(hit.variable.name || ""),
      value: Number.isFinite(numeric) ? numeric : null,
    };
  };

  const sampleLeftwardDx = async (sprite, activeMs = 900, intervalMs = 20) => {
    let elapsed = 0;
    const dxSamples = [];

    let last = EU.getSpritePosition(sprite);
    const wallStart = Date.now();
    const maxWallMs = activeMs * 4;

    while (elapsed < activeMs && (Date.now() - wallStart) < maxWallMs) {
      await EU.wait(intervalMs);
      const cur = EU.getSpritePosition(sprite);
      const dx = cur.x - last.x;

      // Nonredundant leftward frames only.
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
      avg_dx: avgDx,
      dx_sample_count: dxSamples.length,
    };
  };

  const measureBuildingsDx = async (buildings) => {
    const pos = EU.getSpritePosition(buildings);
    buildings.setXY(220, pos.y);
    await EU.wait(250);
    return await sampleLeftwardDx(buildings, 900, 20);
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
    details.push(await runCase("score_increases_about_once_per_second", async () => {
      EU.startVM(vm);
      await EU.wait(500);

      const values = [];
      for (let i = 0; i < 4; i++) {
        const score = readVariableNumber("score");
        values.push(score);
        await EU.wait(1000);
      }

      const found = values.some(v => v.found && v.value !== null);
      const numericValues = values.map(v => (v.value === null ? null : v.value));
      const deltas = [];
      for (let i = 1; i < numericValues.length; i++) {
        const prev = numericValues[i - 1];
        const cur = numericValues[i];
        if (typeof prev === "number" && Number.isFinite(prev) && typeof cur === "number" && Number.isFinite(cur)) {
          deltas.push(cur - prev);
        }
      }

      const ones = deltas.filter(d => d >= 0.8 && d <= 1.2).length;
      const monotonic = deltas.every(d => d >= -0.1);
      const totalDelta = deltas.reduce((sum, d) => sum + d, 0);
      const passed = found && deltas.length >= 2 && monotonic && ones >= 2 && totalDelta >= 2;

      return {
        passed,
        meta: {
          score_values: numericValues,
          deltas,
          near_one_count: ones,
          total_delta: Number(totalDelta.toFixed(2)),
          monotonic,
        },
      };
    }));

    details.push(await runCase("glide_duration_decreases_over_time", async () => {
      EU.startVM(vm);
      await EU.wait(600);

      const before = readVariableNumberByAnyName(["glideDuration", "glideTime", "glide duration"]);
      await EU.wait(3800);
      const after = readVariableNumberByAnyName(["glideDuration", "glideTime", "glide duration"]);

      const beforeValue = before.value;
      const afterValue = after.value;
      const passed = before.found && after.found &&
        beforeValue !== null && afterValue !== null &&
        afterValue < beforeValue - 0.05;

      return {
        passed,
        meta: {
          variable_name_before: before.name,
          variable_name_after: after.name,
          before: beforeValue,
          after: afterValue,
          delta: (beforeValue !== null && afterValue !== null)
            ? Number((afterValue - beforeValue).toFixed(3))
            : null,
        },
      };
    }));

    details.push(await runCase("buildings_speed_increases_later", async () => {
      const buildings = findByNames(buildingNames, ["buildings", "build"]);
      if (!buildings) {
        return { passed: false, error: "Buildings sprite not found", meta: {} };
      }

      EU.startVM(vm);
      await EU.wait(600);

      const early = await measureBuildingsDx(buildings);
      await EU.wait(3500);
      const later = await measureBuildingsDx(buildings);

      const minSamples = 20;
      const avgDxDelta = later.avg_dx - early.avg_dx;
      const thresholdDx = 0.04;
      const passed = (
        early.dx_sample_count >= minSamples &&
        later.dx_sample_count >= minSamples &&
        avgDxDelta > thresholdDx
      );
      return {
        passed,
        meta: {
          early_avg_dx: Number(early.avg_dx.toFixed(3)),
          later_avg_dx: Number(later.avg_dx.toFixed(3)),
          avg_dx_delta: Number(avgDxDelta.toFixed(3)),
          threshold_dx: thresholdDx,
          early_dx_sample_count: early.dx_sample_count,
          later_dx_sample_count: later.dx_sample_count,
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
