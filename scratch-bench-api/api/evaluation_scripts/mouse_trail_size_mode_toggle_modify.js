/**
 * Instruction: This is a visual effects demonstration where star sprites follow the mouse cursor, creating colorful trailing effects. Clicking on stars triggers sound effects and color changes, with clones that move randomly and fade away over time. Please add a toggle to switch clone sizing behavior when the sprite is clicked. Create a variable named 'size mode' with values 'shrink' or 'grow'. Initialize it to 'shrink' when green flag clicked. Add a 'when this sprite clicked' handler that flips the mode. In the clone's repeat loop, if mode is 'shrink', change size by a negative amount each step (-8); if mode is 'grow', change size by a positive amount (+8). Keep the existing movement and ghost fade, and still delete the clone at the end of the loop.
 * Unit Test Semantic Goals:
 * 1) Variable 'size mode' exists and initializes to 'shrink' on green flag.
 * 2) Clicking the trail sprite toggles 'size mode' from 'shrink' to 'grow'.
 * 3) In 'shrink' mode, clone sizes trend downward over time.
 * 4) In 'grow' mode, clone sizes trend upward after toggle.
 * 5) Clones still move, fade, and delete after their loop.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 28);
  const caseTimeoutMs = timeoutSec * 1000;

  const spriteCandidateNames = ["Mouse Trail", "Star", "Sprite1", "Trail"];

  const findTrailSprite = () => {
    for (const name of spriteCandidateNames) {
      const sprite = EU.findSprite(vm, name, []);
      if (sprite) return sprite;
    }
    return (vm.runtime.targets || []).find(
      t => t.isOriginal && t.sprite && t.sprite.name !== "Stage"
    ) || null;
  };

  const findSizeModeVariable = () => {
    const stage = vm.runtime.getTargetForStage();
    if (!stage || !stage.variables) return null;
    for (const variable of Object.values(stage.variables)) {
      if (!variable || typeof variable.name !== "string") continue;
      const normalized = variable.name.trim().toLowerCase();
      if (normalized === "size mode") return variable;
    }
    return null;
  };

  const getSizeModeValue = () => {
    const variable = findSizeModeVariable();
    if (!variable) return null;
    return String(variable.value || "").trim().toLowerCase();
  };

  const clickSprite = async (sprite) => {
    try {
      vm.runtime.startHats("event_whenthisspriteclicked", null, sprite);
    } catch (e) {
      const pos = EU.getSpritePosition(sprite);
      EU.simulateMouseDown(vm, pos.x, pos.y);
      await EU.wait(80);
      EU.simulateMouseUp(vm);
    }
    await EU.wait(250);
  };

  const linearSlope = (values) => {
    if (!Array.isArray(values) || values.length < 3) return 0;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    for (let i = 0; i < values.length; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumXX += i * i;
    }
    const n = values.length;
    const denominator = n * sumXX - sumX * sumX || 1;
    return (n * sumXY - sumX * sumY) / denominator;
  };

  const runSamplingWindow = async (baseSprite, durationMs = 2600) => new Promise((resolve) => {
    const isClone = (target) => {
      if (!target || target.isOriginal || !target.sprite || !baseSprite || !baseSprite.sprite) return false;
      return target.sprite.name === baseSprite.sprite.name;
    };

    const samples = new Map();
    let clonesCreated = 0;
    let clonesDeleted = 0;
    let peakActive = 0;

    const onCreate = (target) => {
      try {
        if (!isClone(target)) return;
        clonesCreated++;
        if (!samples.has(target.id)) {
          samples.set(target.id, {
            sizes: [],
            ghosts: [],
            positions: [],
            deleted: false,
          });
        }
      } catch (e) {}
    };

    const onRemove = (target) => {
      try {
        if (!target || target.isOriginal) return;
        const record = samples.get(target.id);
        if (record && !record.deleted) record.deleted = true;
        clonesDeleted++;
      } catch (e) {}
    };

    vm.runtime.on("targetWasCreated", onCreate);
    vm.runtime.on("targetWasRemoved", onRemove);

    const sampler = setInterval(() => {
      try {
        const active = (vm.runtime.targets || []).filter(isClone);
        peakActive = Math.max(peakActive, active.length);
        for (const clone of active) {
          const record = samples.get(clone.id) || {
            sizes: [],
            ghosts: [],
            positions: [],
            deleted: false,
          };
          const cloneSize = typeof clone.size === "number" ? clone.size : (clone._size || 0);
          const ghost = clone.effects && typeof clone.effects.ghost === "number" ? clone.effects.ghost : 0;
          record.sizes.push(cloneSize);
          record.ghosts.push(ghost);
          record.positions.push({ x: Number(clone.x || 0), y: Number(clone.y || 0) });
          samples.set(clone.id, record);
        }
      } catch (e) {}
    }, 120);

    setTimeout(() => {
      clearInterval(sampler);
      try { vm.runtime.off("targetWasCreated", onCreate); } catch (e) {}
      try { vm.runtime.off("targetWasRemoved", onRemove); } catch (e) {}
      resolve({ samples, clonesCreated, clonesDeleted, peakActive });
    }, durationMs);
  });

  const analyzeSamples = (samples) => {
    let shrinkingCount = 0;
    let growingCount = 0;
    let fadedCount = 0;
    let movingCount = 0;

    for (const record of samples.values()) {
      if (Array.isArray(record.sizes) && record.sizes.length >= 3) {
        const slope = linearSlope(record.sizes);
        if (slope <= -0.6) shrinkingCount++;
        if (slope >= 0.6) growingCount++;
      }

      if (Array.isArray(record.ghosts) && record.ghosts.length >= 2) {
        const startGhost = record.ghosts[0];
        const maxGhost = record.ghosts.reduce((max, value) => Math.max(max, value), 0);
        if (maxGhost - startGhost >= 15 || maxGhost >= 40) fadedCount++;
      }

      if (Array.isArray(record.positions) && record.positions.length >= 2) {
        let pathLength = 0;
        for (let i = 1; i < record.positions.length; i++) {
          const prev = record.positions[i - 1];
          const curr = record.positions[i];
          const dx = curr.x - prev.x;
          const dy = curr.y - prev.y;
          pathLength += Math.sqrt(dx * dx + dy * dy);
        }
        if (pathLength >= 8) movingCount++;
      }
    }

    return { shrinkingCount, growingCount, fadedCount, movingCount };
  };

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
      await EU.wait(180);
      EU.startVM(vm);
      await EU.wait(650);
    },
    run: async () => runner(),
    afterCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
    },
  });

  const details = [];
  try {
    details.push(await runCase("size_mode_variable_initializes_to_shrink", async () => {
      const mode = getSizeModeValue();
      return {
        passed: mode === "shrink",
        meta: {
          observed_mode: mode,
          has_size_mode_variable: !!findSizeModeVariable(),
        },
      };
    }));

    details.push(await runCase("clicking_sprite_toggles_size_mode_to_grow", async () => {
      const sprite = findTrailSprite();
      if (!sprite) return { passed: false, error: "Trail sprite not found", meta: {} };

      const before = getSizeModeValue();
      await clickSprite(sprite);
      await EU.wait(250);
      const after = getSizeModeValue();

      return {
        passed: before === "shrink" && after === "grow",
        meta: {
          before_mode: before,
          after_mode: after,
        },
      };
    }));

    details.push(await runCase("clone_sizes_shrink_in_shrink_mode", async () => {
      const sprite = findTrailSprite();
      if (!sprite) return { passed: false, error: "Trail sprite not found", meta: {} };

      const mode = getSizeModeValue();
      const windowResult = await runSamplingWindow(sprite, 2600);
      const trends = analyzeSamples(windowResult.samples);

      return {
        passed: mode === "shrink" && windowResult.clonesCreated >= 1 && trends.shrinkingCount >= 1,
        meta: {
          mode_before_sampling: mode,
          clones_created: windowResult.clonesCreated,
          shrinking_count: trends.shrinkingCount,
          growing_count: trends.growingCount,
        },
      };
    }));

    details.push(await runCase("clone_sizes_grow_after_toggle_to_grow_mode", async () => {
      const sprite = findTrailSprite();
      if (!sprite) return { passed: false, error: "Trail sprite not found", meta: {} };

      const before = getSizeModeValue();
      if (before !== "grow") await clickSprite(sprite);
      await EU.wait(220);
      const mode = getSizeModeValue();
      const windowResult = await runSamplingWindow(sprite, 2600);
      const trends = analyzeSamples(windowResult.samples);

      return {
        passed: mode === "grow" && windowResult.clonesCreated >= 1 && trends.growingCount >= 1,
        meta: {
          mode_before_click: before,
          mode_before_sampling: mode,
          clones_created: windowResult.clonesCreated,
          shrinking_count: trends.shrinkingCount,
          growing_count: trends.growingCount,
        },
      };
    }));

    details.push(await runCase("clones_still_move_fade_and_delete", async () => {
      const sprite = findTrailSprite();
      if (!sprite) return { passed: false, error: "Trail sprite not found", meta: {} };

      const windowResult = await runSamplingWindow(sprite, 2800);
      const trends = analyzeSamples(windowResult.samples);
      const noBuildup = windowResult.peakActive <= 60;

      return {
        passed:
          windowResult.clonesCreated >= 1 &&
          windowResult.clonesDeleted >= 1 &&
          trends.fadedCount >= 1 &&
          trends.movingCount >= 1 &&
          noBuildup,
        meta: {
          clones_created: windowResult.clonesCreated,
          clones_deleted: windowResult.clonesDeleted,
          faded_count: trends.fadedCount,
          moving_count: trends.movingCount,
          peak_active_clones: windowResult.peakActive,
          no_buildup: noBuildup,
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
