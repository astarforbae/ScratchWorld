/**
 * Instruction: This is a simple flying game where a cat sprite can be controlled with arrow keys to fly up and down while buildings scroll continuously across the screen from right to left, creating a side-scrolling flight experience. Please implement a looping day–night cycle using the Stage’s graphic effects. Gradually adjust the Stage’s brightness effect each frame so that it transitions smoothly from bright (day) to dark (night) and back again. The transition should be continuous, and gameplay should remain unaffected throughout the cycle.
 * Unit Test Semantic Goals:
 * 1) Stage brightness effect value changes over time (not static).
 * 2) Brightness trend reverses direction at least once (bright→dark or dark→bright).
 * 3) Brightness trend reverses at least twice over a longer window, indicating a loop.
 * 4) 'Buildings' keeps moving while brightness changes are happening.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 30);
  const caseTimeoutMs = timeoutSec * 1000;

  const buildingNames = (config && config.buildingsSpriteName)
    ? [String(config.buildingsSpriteName)]
    : ["Buildings", "Building", "Obstacle", "Pipes"];

  const findBuildings = () => {
    for (const name of buildingNames) {
      const sprite = EU.findSprite(vm, name, ["buildings", "build"]);
      if (sprite) return sprite;
    }
    return null;
  };

  const sampleBrightnessAndMovement = async (durationMs = 6000, intervalMs = 120) => {
    const stage = vm.runtime.getTargetForStage();
    const buildings = findBuildings();

    const brightness = [];
    let movementDistance = 0;
    let lastBuildingPos = buildings ? EU.getSpritePosition(buildings) : null;

    const startedAt = Date.now();
    while (Date.now() - startedAt < durationMs) {
      if (stage && stage.effects && typeof stage.effects.brightness === "number") {
        brightness.push(stage.effects.brightness);
      }

      if (buildings) {
        const cur = EU.getSpritePosition(buildings);
        if (lastBuildingPos) {
          movementDistance += Math.hypot(cur.x - lastBuildingPos.x, cur.y - lastBuildingPos.y);
        }
        lastBuildingPos = cur;
      }

      await EU.wait(intervalMs);
    }

    return { brightness, movement_distance: movementDistance };
  };

  const smooth = (values) => {
    if (!Array.isArray(values) || values.length === 0) return [];
    return values.map((value, i, arr) => {
      const left = arr[Math.max(0, i - 1)];
      const right = arr[Math.min(arr.length - 1, i + 1)];
      return (left + value + right) / 3;
    });
  };

  const analyzeBrightness = (samples) => {
    const smoothed = smooth(samples);
    if (smoothed.length < 8) {
      return { changed: false, range: 0, direction_changes: 0 };
    }

    const minValue = Math.min(...smoothed);
    const maxValue = Math.max(...smoothed);
    const range = maxValue - minValue;

    let prevDir = 0;
    let directionChanges = 0;
    for (let i = 1; i < smoothed.length; i++) {
      const delta = smoothed[i] - smoothed[i - 1];
      let dir = 0;
      if (delta > 0.12) dir = 1;
      else if (delta < -0.12) dir = -1;
      if (dir !== 0) {
        if (prevDir !== 0 && dir !== prevDir) directionChanges += 1;
        prevDir = dir;
      }
    }

    return {
      changed: range > 3,
      range,
      direction_changes: directionChanges,
      sample_count: smoothed.length,
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
    details.push(await runCase("brightness_changes_over_time", async () => {
      EU.startVM(vm);
      await EU.wait(500);
      const observation = await sampleBrightnessAndMovement(5000, 120);
      const analysis = analyzeBrightness(observation.brightness);
      return {
        passed: analysis.changed,
        meta: {
          sample_count: analysis.sample_count,
          range: Number(analysis.range.toFixed(2)),
          direction_changes: analysis.direction_changes,
        },
      };
    }));

    details.push(await runCase("brightness_reverses_direction", async () => {
      EU.startVM(vm);
      await EU.wait(500);
      const observation = await sampleBrightnessAndMovement(6500, 120);
      const analysis = analyzeBrightness(observation.brightness);
      return {
        passed: analysis.changed && analysis.direction_changes >= 1,
        meta: {
          sample_count: analysis.sample_count,
          range: Number(analysis.range.toFixed(2)),
          direction_changes: analysis.direction_changes,
        },
      };
    }));

    details.push(await runCase("brightness_cycle_loops", async () => {
      EU.startVM(vm);
      await EU.wait(500);
      const observation = await sampleBrightnessAndMovement(10000, 120);
      const analysis = analyzeBrightness(observation.brightness);
      return {
        passed: analysis.changed && analysis.direction_changes >= 2,
        meta: {
          sample_count: analysis.sample_count,
          range: Number(analysis.range.toFixed(2)),
          direction_changes: analysis.direction_changes,
        },
      };
    }));

    details.push(await runCase("buildings_move_while_brightness_changes", async () => {
      const buildings = findBuildings();
      if (!buildings) {
        return { passed: false, error: "Buildings sprite not found", meta: {} };
      }

      EU.startVM(vm);
      await EU.wait(500);
      const observation = await sampleBrightnessAndMovement(5000, 120);
      const analysis = analyzeBrightness(observation.brightness);
      const passed = analysis.changed && observation.movement_distance > 10;

      return {
        passed,
        meta: {
          brightness_range: Number(analysis.range.toFixed(2)),
          movement_distance: Number(observation.movement_distance.toFixed(2)),
          direction_changes: analysis.direction_changes,
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
