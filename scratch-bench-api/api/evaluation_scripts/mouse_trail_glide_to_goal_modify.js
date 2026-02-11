/**
 * Instruction: This is a visual effects demonstration where star sprites follow the mouse cursor, creating colorful trailing effects. Clicking on stars triggers sound effects and color changes, with clones that move randomly and fade away over time. Please implement the following: (1) When the green flag is clicked, place the 'Goal' sprite at a random position on the stage. (2) Make the clones of 'Mouse Trail' glide to the 'Goal' sprite once they are created and finish the glide in about 1 second. After the glide completes, delete the clone.
 * Unit Test Semantic Goals:
 * 1) Sprite 'Goal' exists, is visible, and randomizes position across green-flag restarts.
 * 2) Mouse-trail clones move toward 'Goal' and typically reach it in about 1 second.
 * 3) Clones are deleted after gliding, without excessive clone buildup.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 25);
  const caseTimeoutMs = timeoutSec * 1000;

  const goalCandidateNames = ["Goal", "Target", "Finish"];
  const trailCandidateNames = ["Mouse Trail", "Trail", "Star", "Sprite1"];

  const findByCandidates = (names) => {
    for (const name of names) {
      const sprite = EU.findSprite(vm, name, []);
      if (sprite) return sprite;
    }
    return (vm.runtime.targets || []).find(
      t => t.isOriginal && t.sprite && t.sprite.name !== "Stage"
    ) || null;
  };

  const runSamplingWindow = async (durationMs = 4200) => new Promise((resolve) => {
    const goal = findByCandidates(goalCandidateNames);
    const trail = findByCandidates(trailCandidateNames);
    const goalPos = goal ? EU.getSpritePosition(goal) : { x: 0, y: 0 };

    const isTrailClone = (target) => {
      if (!target || target.isOriginal || !target.sprite || !trail || !trail.sprite) return false;
      return target.sprite.name === trail.sprite.name;
    };

    const samples = new Map();
    let clonesCreated = 0;
    let clonesDeleted = 0;
    let peakActive = 0;

    const onCreate = (target) => {
      try {
        if (!isTrailClone(target)) return;
        clonesCreated++;
        if (!samples.has(target.id)) {
          samples.set(target.id, {
            createdAt: Date.now(),
            distances: [],
            times: [],
            reachedAt: null,
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

    const edges = EU.getStageEdges(vm);
    const path = [
      { x: 0, y: 0 },
      { x: edges.left + 40, y: edges.bottom + 40 },
      { x: edges.right - 40, y: edges.top - 40 },
      { x: 0, y: 0 },
    ];
    let pathIndex = 0;
    const mouseMover = setInterval(() => {
      const point = path[pathIndex % path.length];
      EU.simulateMouseMove(vm, point.x, point.y);
      pathIndex++;
    }, 300);

    const sampler = setInterval(() => {
      try {
        const active = (vm.runtime.targets || []).filter(isTrailClone);
        peakActive = Math.max(peakActive, active.length);
        const now = Date.now();
        for (const clone of active) {
          const record = samples.get(clone.id) || {
            createdAt: now,
            distances: [],
            times: [],
            reachedAt: null,
            deleted: false,
          };
          const clonePos = EU.getSpritePosition(clone);
          const distance = EU.calculateDistance(clonePos, goalPos);
          record.distances.push(distance);
          record.times.push(now);
          if (record.reachedAt === null && distance <= 25) record.reachedAt = now;
          samples.set(clone.id, record);
        }
      } catch (e) {}
    }, 90);

    setTimeout(() => {
      clearInterval(mouseMover);
      clearInterval(sampler);
      try { vm.runtime.off("targetWasCreated", onCreate); } catch (e) {}
      try { vm.runtime.off("targetWasRemoved", onRemove); } catch (e) {}
      resolve({ samples, clonesCreated, clonesDeleted, peakActive, goalPos });
    }, durationMs);
  });

  const analyzeGlideSamples = (samples) => {
    const tolerance = 1.5;
    let evaluated = 0;
    let decreasing = 0;
    const reachedDurationsMs = [];

    for (const record of samples.values()) {
      if (!record || !Array.isArray(record.distances) || record.distances.length < 4) continue;
      evaluated++;
      let monotoneDown = true;
      for (let i = 1; i < record.distances.length; i++) {
        if (!(record.distances[i] <= record.distances[i - 1] + tolerance)) {
          monotoneDown = false;
          break;
        }
      }
      if (monotoneDown) decreasing++;
      if (record.reachedAt !== null && record.createdAt !== null) {
        const duration = record.reachedAt - record.createdAt;
        if (Number.isFinite(duration)) reachedDurationsMs.push(duration);
      }
    }

    const glideRate = evaluated > 0 ? decreasing / evaluated : 0;
    return { evaluated, decreasing, glideRate, reachedDurationsMs };
  };

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
      await EU.wait(180);
      EU.startVM(vm);
      await EU.wait(600);
    },
    run: async () => runner(),
    afterCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
    },
  });

  const details = [];
  try {
    details.push(await runCase("goal_exists_visible_and_randomizes_on_restart", async () => {
      const goal1 = findByCandidates(goalCandidateNames);
      if (!goal1) return { passed: false, error: "Goal sprite not found", meta: {} };
      const pos1 = EU.getSpritePosition(goal1);
      const vis1 = !!goal1.visible;

      try { vm.runtime.stopAll(); } catch (e) {}
      await EU.wait(150);
      EU.startVM(vm);
      await EU.wait(600);

      const goal2 = findByCandidates(goalCandidateNames);
      if (!goal2) return { passed: false, error: "Goal sprite missing after restart", meta: {} };
      const pos2 = EU.getSpritePosition(goal2);
      const vis2 = !!goal2.visible;
      const distance = EU.calculateDistance(pos1, pos2);

      return {
        passed: vis1 && vis2 && distance >= 40,
        meta: {
          first_position: { x: Number(pos1.x.toFixed(2)), y: Number(pos1.y.toFixed(2)) },
          second_position: { x: Number(pos2.x.toFixed(2)), y: Number(pos2.y.toFixed(2)) },
          randomized_distance: Number(distance.toFixed(2)),
          visible_on_both_runs: vis1 && vis2,
        },
      };
    }));

    details.push(await runCase("clones_glide_toward_goal_in_about_one_second", async () => {
      const { samples, clonesCreated } = await runSamplingWindow(4200);
      const analysis = analyzeGlideSamples(samples);
      const nearOneSecond = analysis.reachedDurationsMs.filter(ms => ms >= 650 && ms <= 1600).length;

      return {
        passed: clonesCreated >= 3 && analysis.glideRate >= 0.7 && nearOneSecond >= 1,
        meta: {
          clones_created: clonesCreated,
          evaluated_clones: analysis.evaluated,
          decreasing_clones: analysis.decreasing,
          glide_rate: Number(analysis.glideRate.toFixed(3)),
          reached_durations_ms: analysis.reachedDurationsMs.slice(0, 12),
          near_one_second_count: nearOneSecond,
        },
      };
    }));

    details.push(await runCase("clones_delete_after_glide_without_buildup", async () => {
      const { samples, clonesCreated, clonesDeleted, peakActive } = await runSamplingWindow(4200);
      const analysis = analyzeGlideSamples(samples);
      const deletionRatio = clonesCreated > 0 ? clonesDeleted / clonesCreated : 0;

      return {
        passed: clonesCreated >= 3 && clonesDeleted >= 2 && deletionRatio >= 0.25 && peakActive <= 80,
        meta: {
          clones_created: clonesCreated,
          clones_deleted: clonesDeleted,
          deletion_ratio: Number(deletionRatio.toFixed(3)),
          peak_active_clones: peakActive,
          glide_rate: Number(analysis.glideRate.toFixed(3)),
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
