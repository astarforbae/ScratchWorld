/**
 * Instruction: This is a visual effects demonstration where star sprites follow the mouse cursor, creating colorful trailing effects. Clicking on stars triggers sound effects and color changes, with clones that move randomly and fade away over time. Please create a variable named 'degree'. When the green flag is clicked, set 'degree' to 0. In the main loop that follows the mouse (not inside the clone loop), gradually increase 'degree' over time. For each clone, set their direction to the value of 'degree' when they are created, then proceed with the existing clone behavior (movement, fade/shrink during its repeat, and delete).
 * Unit Test Semantic Goals:
 * 1) Variable 'degree' exists and starts at 0 on green flag.
 * 2) The stage variable 'degree' increases over time during runtime.
 * 3) Clone initial directions generally increase over creation order (tracking 'degree').
 * 4) Clone behavior still shows per-clone direction stability, fading, and deletion.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 25);
  const caseTimeoutMs = timeoutSec * 1000;

  const trailCandidateNames = ["Mouse Trail", "Trail", "Star", "Sprite1"];

  const findTrailSprite = () => {
    for (const name of trailCandidateNames) {
      const sprite = EU.findSprite(vm, name, []);
      if (sprite) return sprite;
    }
    return (vm.runtime.targets || []).find(
      t => t.isOriginal && t.sprite && t.sprite.name !== "Stage"
    ) || null;
  };

  const toFiniteNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const getDegreeValue = () => {
    const stage = vm.runtime.getTargetForStage();
    if (!stage || !stage.variables) return null;
    for (const variable of Object.values(stage.variables)) {
      if (!variable || typeof variable.name !== "string") continue;
      if (variable.name.trim().toLowerCase() === "degree") {
        return toFiniteNumber(variable.value);
      }
    }
    return null;
  };

  const sampleDegree = async (durationMs = 1500, intervalMs = 120) => {
    const samples = [];
    const startedAt = Date.now();
    while (Date.now() - startedAt < durationMs) {
      samples.push(getDegreeValue());
      await EU.wait(intervalMs);
    }
    return samples;
  };

  const normDir = (value) => {
    let num = Number(value) || 0;
    num = ((num % 360) + 360) % 360;
    return num;
  };

  const circularDiff = (a, b) => {
    const delta = normDir(b) - normDir(a);
    return ((delta + 540) % 360) - 180;
  };

  const checkMonotoneIncreasingInitialDirs = (records) => {
    if (!Array.isArray(records) || records.length < 4) return false;
    const sorted = [...records].sort((a, b) => a.createdAt - b.createdAt);
    const usable = sorted.length >= 2 ? sorted.slice(1) : [];
    if (usable.length < 4) return false;

    const dirs = usable.map(item => normDir(item.initialDir));
    let wrapped = false;
    for (let i = 0; i < dirs.length - 1; i++) {
      const current = dirs[i];
      const next = dirs[i + 1];
      const directDiff = next - current;
      if (directDiff > 0.5) continue;
      if (!wrapped && current >= 300 && next <= 60) {
        wrapped = true;
        continue;
      }
      return false;
    }
    return true;
  };

  const analyzeDirectionStability = (samplesMap) => {
    let stableCount = 0;
    let fadedCount = 0;

    for (const record of samplesMap.values()) {
      if (!record || !Array.isArray(record.dirs)) continue;
      const dirs = record.dirs.length >= 2 ? record.dirs.slice(1) : [];
      if (dirs.length >= 3) {
        const base = normDir(dirs[0]);
        const centered = dirs.map(value => circularDiff(base, value));
        const mean = centered.reduce((sum, value) => sum + value, 0) / centered.length;
        const variance = centered.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / centered.length;
        const stdev = Math.sqrt(variance);
        if (stdev <= 10) stableCount++;
      }

      if (Array.isArray(record.ghosts) && record.ghosts.length >= 2) {
        const startGhost = record.ghosts[0];
        const maxGhost = record.ghosts.reduce((max, value) => Math.max(max, value), 0);
        if (typeof startGhost === "number" && typeof maxGhost === "number") {
          if (maxGhost - startGhost >= 10 || maxGhost >= 40) fadedCount++;
        }
      }
    }

    return { stableCount, fadedCount };
  };

  const runSamplingWindow = async (durationMs = 3600) => new Promise((resolve) => {
    const trail = findTrailSprite();
    const isTrailClone = (target) => {
      if (!target || target.isOriginal || !target.sprite || !trail || !trail.sprite) return false;
      return target.sprite.name === trail.sprite.name;
    };

    const cloneRecords = [];
    const samples = new Map();
    let clonesCreated = 0;
    let clonesDeleted = 0;
    let peakActive = 0;

    const onCreate = (target) => {
      try {
        if (!isTrailClone(target)) return;
        clonesCreated++;
        const initialDir = normDir(target.direction);
        cloneRecords.push({ id: target.id, createdAt: Date.now(), initialDir });
        if (!samples.has(target.id)) {
          samples.set(target.id, { dirs: [initialDir], ghosts: [], deleted: false });
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

    const edges = EU.getStageEdges(vm);
    const path = [
      { x: 0, y: 0 },
      { x: edges.left + 60, y: edges.bottom + 40 },
      { x: edges.right - 60, y: edges.top - 40 },
      { x: 0, y: 0 },
    ];
    let pathIndex = 0;
    const mouseMover = setInterval(() => {
      const point = path[pathIndex % path.length];
      EU.simulateMouseMove(vm, point.x, point.y);
      pathIndex++;
    }, 260);

    const sampler = setInterval(() => {
      try {
        const active = (vm.runtime.targets || []).filter(isTrailClone);
        peakActive = Math.max(peakActive, active.length);
        for (const clone of active) {
          const record = samples.get(clone.id) || { dirs: [], ghosts: [], deleted: false };
          record.dirs.push(normDir(clone.direction));
          record.ghosts.push(
            clone.effects && typeof clone.effects.ghost === "number" ? clone.effects.ghost : 0
          );
          samples.set(clone.id, record);
        }
      } catch (e) {}
    }, 100);

    setTimeout(() => {
      clearInterval(mouseMover);
      clearInterval(sampler);
      try { vm.runtime.off("targetWasCreated", onCreate); } catch (e) {}
      try { vm.runtime.off("targetWasRemoved", onRemove); } catch (e) {}
      resolve({ cloneRecords, samples, clonesCreated, clonesDeleted, peakActive });
    }, durationMs);
  });

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
      await EU.wait(160);
      EU.startVM(vm);
      await EU.wait(420);
    },
    run: async () => runner(),
    afterCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
    },
  });

  const details = [];
  try {
    details.push(await runCase("degree_variable_exists_and_starts_at_zero", async () => {
      // Restart again inside this case so sampling captures the first moments after green flag.
      try { vm.runtime.stopAll(); } catch (e) {}
      await EU.wait(30);
      EU.startVM(vm);
      const samples = await sampleDegree(420, 20);
      const numeric = samples.filter(value => value !== null);
      const first = numeric.length ? numeric[0] : null;
      const minValue = numeric.length ? Math.min(...numeric) : null;
      const deltas = [];
      for (let i = 1; i < numeric.length; i++) deltas.push(numeric[i] - numeric[i - 1]);
      const hasResetDrop = deltas.some(delta => delta <= -8);
      const hasDegreeVariable = getDegreeValue() !== null;
      const startsNearZero = minValue !== null && minValue <= 1;
      const resetsToLowBand = minValue !== null && minValue <= 20 && hasResetDrop;

      return {
        passed: hasDegreeVariable && (startsNearZero || resetsToLowBand),
        meta: {
          has_degree_variable: hasDegreeVariable,
          degree_samples: samples,
          first_numeric_sample: first,
          min_numeric_sample: minValue,
          deltas,
          has_reset_drop: hasResetDrop,
          starts_near_zero: startsNearZero,
          resets_to_low_band: resetsToLowBand,
        },
      };
    }));

    details.push(await runCase("degree_increases_over_time", async () => {
      const samples = await sampleDegree(1900, 120);
      const numeric = samples.filter(value => value !== null);
      const deltas = [];
      for (let i = 1; i < numeric.length; i++) deltas.push(numeric[i] - numeric[i - 1]);
      const positiveSteps = deltas.filter(delta => delta > 0.2).length;
      const netIncrease = numeric.length >= 2 ? numeric[numeric.length - 1] - numeric[0] : null;

      return {
        passed: numeric.length >= 5 && netIncrease !== null && netIncrease > 1 && positiveSteps >= 2,
        meta: {
          degree_samples: samples,
          deltas,
          positive_step_count: positiveSteps,
          net_increase: netIncrease,
        },
      };
    }));

    details.push(await runCase("clone_initial_direction_tracks_degree_progression", async () => {
      const { cloneRecords, samples, clonesCreated } = await runSamplingWindow(3800);

      const adjustedRecords = cloneRecords.map((record) => {
        const sample = samples.get(record.id);
        if (sample && Array.isArray(sample.dirs)) {
          if (sample.dirs.length >= 2) return { ...record, initialDir: normDir(sample.dirs[1]) };
          if (sample.dirs.length >= 1) return { ...record, initialDir: normDir(sample.dirs[0]) };
        }
        return record;
      });

      const monotoneOk = checkMonotoneIncreasingInitialDirs(adjustedRecords);
      return {
        passed: clonesCreated >= 3 && monotoneOk,
        meta: {
          clones_created: clonesCreated,
          adjusted_initial_dirs: adjustedRecords.slice(0, 12).map(item => Number(item.initialDir.toFixed(2))),
          monotone_increase: monotoneOk,
        },
      };
    }));

    details.push(await runCase("clone_behavior_fade_and_delete_is_preserved", async () => {
      const { samples, clonesCreated, clonesDeleted, peakActive } = await runSamplingWindow(3400);
      const { stableCount, fadedCount } = analyzeDirectionStability(samples);
      const sampleCount = [...samples.values()].length;
      const stabilityThreshold = Math.max(1, Math.floor(sampleCount * 0.5));
      const stabilityOk = stableCount >= stabilityThreshold;
      const fadeOk = fadedCount >= 1;
      const deletionOk = clonesDeleted >= 1;
      const noBuildup = peakActive <= 80;

      return {
        passed: clonesCreated >= 2 && stabilityOk && fadeOk && deletionOk && noBuildup,
        meta: {
          clones_created: clonesCreated,
          clones_deleted: clonesDeleted,
          sample_count: sampleCount,
          stable_count: stableCount,
          faded_count: fadedCount,
          peak_active_clones: peakActive,
          stability_threshold: stabilityThreshold,
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
