/**
 * Instruction: Starting from an empty Scratch project with a single default sprite named 'Sprite1', you should complete the following: 1) When the green flag is clicked, make Sprite1 perform a random walk. 2) In a forever loop, turn a small random amount and move several steps. 3) If Sprite1 touches the stage edge, bounce and continue wandering. 4) The motion should appear continuous and random.
 * Unit Test Semantic Goals:
 * 1) 'Sprite1' moves continuously after green flag in a forever loop.
 * 2) 'Sprite1' repeatedly changes heading by random small turns.
 * 3) On edge contact, 'Sprite1' bounces and continues wandering.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;

  const findSprite = () => EU.findSprite(vm, "Sprite1", ["Sprite1", "Cat"]);

  const isNearEdge = (pos, edges, margin = 20) =>
    pos.x <= edges.left + margin ||
    pos.x >= edges.right - margin ||
    pos.y <= edges.bottom + margin ||
    pos.y >= edges.top - margin;

  const sampleWalk = async (durationMs = 4200, intervalMs = 150) => {
    const sprite = findSprite();
    if (!sprite) return { error: "Sprite1 not found" };

    const edges = EU.getStageEdges(vm);
    const samples = [];
    const startedAt = Date.now();
    while (Date.now() - startedAt < durationMs) {
      const pos = EU.getSpritePosition(sprite);
      samples.push({
        x: Number(pos.x),
        y: Number(pos.y),
        direction: Number(sprite.direction),
        near_edge: isNearEdge(pos, edges, 20),
        t: Date.now(),
      });
      await EU.wait(intervalMs);
    }
    return { samples, edges };
  };

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
      await EU.wait(160);
      EU.startVM(vm);
      await EU.wait(500);
    },
    run: async () => runner(),
    afterCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
    },
  });

  const details = [];
  try {
    details.push(await runCase("sprite1_moves_continuously_after_start", async () => {
      const sampled = await sampleWalk(3600, 150);
      if (sampled.error) return { passed: false, error: sampled.error, meta: {} };

      const points = sampled.samples;
      let movingSteps = 0;
      let totalPath = 0;
      for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - points[i - 1].x;
        const dy = points[i].y - points[i - 1].y;
        const step = Math.sqrt(dx * dx + dy * dy);
        if (step >= 1.5) movingSteps++;
        totalPath += step;
      }

      return {
        passed: movingSteps >= 12 && totalPath >= 80,
        meta: {
          sample_count: points.length,
          moving_steps: movingSteps,
          total_path_length: Number(totalPath.toFixed(2)),
        },
      };
    }));

    details.push(await runCase("sprite1_repeatedly_changes_heading", async () => {
      const sampled = await sampleWalk(3800, 140);
      if (sampled.error) return { passed: false, error: sampled.error, meta: {} };

      const dirs = sampled.samples.map(item => item.direction);
      const directionChanges = [];
      for (let i = 1; i < dirs.length; i++) {
        const diff = Math.abs(dirs[i] - dirs[i - 1]);
        const normalized = diff > 180 ? 360 - diff : diff;
        directionChanges.push(normalized);
      }
      const notableChanges = directionChanges.filter(change => change >= 8).length;
      const roundedUniqueDirs = [...new Set(dirs.map(value => Math.round(value / 5) * 5))].length;

      return {
        passed: notableChanges >= 4 && roundedUniqueDirs >= 5,
        meta: {
          sample_count: dirs.length,
          notable_direction_changes: notableChanges,
          rounded_unique_directions: roundedUniqueDirs,
          direction_changes: directionChanges.slice(0, 14),
        },
      };
    }));

    details.push(await runCase("sprite1_bounces_at_edge_and_continues", async () => {
      const sampled = await sampleWalk(5200, 130);
      if (sampled.error) return { passed: false, error: sampled.error, meta: {} };

      const points = sampled.samples;
      let edgeEntryIndex = -1;
      for (let i = 0; i < points.length; i++) {
        if (points[i].near_edge) {
          edgeEntryIndex = i;
          break;
        }
      }

      let movedAwayFromEdge = false;
      let continuedMoving = false;
      if (edgeEntryIndex >= 0 && edgeEntryIndex + 3 < points.length) {
        for (let i = edgeEntryIndex + 1; i < points.length; i++) {
          if (!points[i].near_edge) {
            movedAwayFromEdge = true;
            break;
          }
        }
        let postMovement = 0;
        for (let i = edgeEntryIndex + 1; i < points.length; i++) {
          const dx = points[i].x - points[i - 1].x;
          const dy = points[i].y - points[i - 1].y;
          postMovement += Math.sqrt(dx * dx + dy * dy);
        }
        continuedMoving = postMovement >= 20;
      }

      return {
        passed: edgeEntryIndex >= 0 && movedAwayFromEdge && continuedMoving,
        meta: {
          edge_entry_index: edgeEntryIndex,
          moved_away_from_edge: movedAwayFromEdge,
          continued_moving_after_edge: continuedMoving,
          sample_count: points.length,
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
