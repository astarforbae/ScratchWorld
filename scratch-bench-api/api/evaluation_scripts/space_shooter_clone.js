/**
 * Instruction: Starting from an empty Scratch project with a single default sprite named 'Sprite1', you should complete the following: 1) When the green flag is clicked, allow the player to press the space key to create a clone that starts at Sprite1's current x,y. 2) For each clone, move it upward repeatedly until it reaches the top edge, then delete the clone. 3) Support multiple presses of space to fire multiple clones over time.
 * Unit Test Semantic Goals:
 * 1) Pressing Space creates a clone near current 'Sprite1' x,y.
 * 2) A created clone's y-position increases repeatedly (upward movement).
 * 3) A created clone reaches near the top edge and is deleted.
 * 4) Repeated Space presses create multiple distinct clones.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 25);
  const caseTimeoutMs = Math.max(8000, Math.min(timeoutSec * 1000, 15000));
  const spriteName = (config && config.spriteName) || "Sprite1";

  const findMainSprite = () =>
    EU.findSprite(vm, spriteName, []) ||
    (vm.runtime.targets || []).find(t => t.isOriginal && t.sprite && t.sprite.name !== "Stage") ||
    null;

  const getActiveClones = (mainSprite) =>
    (vm.runtime.targets || []).filter(
      t => !t.isOriginal && t.sprite && mainSprite && t.sprite.name === mainSprite.sprite.name
    );

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
      await EU.wait(200);
    },
    run: async () => {
      EU.startVM(vm);
      await EU.wait(600);
      return runner();
    },
    afterCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
    },
  });

  const details = [];
  try {
    details.push(await runCase("space_key_creates_clone_near_sprite1_position", async () => {
      const mainSprite = findMainSprite();
      if (!mainSprite) return { passed: false, error: "Sprite1 not found", meta: {} };

      const basePos = EU.getSpritePosition(mainSprite);
      const created = [];
      const onCreate = (newTarget) => {
        if (!newTarget || newTarget.isOriginal || !newTarget.sprite) return;
        if (newTarget.sprite.name !== mainSprite.sprite.name) return;
        created.push({
          id: newTarget.id,
          x: Number(newTarget.x),
          y: Number(newTarget.y),
        });
      };

      vm.runtime.on("targetWasCreated", onCreate);
      try {
        await EU.simulateKeyPress(vm, " ", 90);
        const waitStart = Date.now();
        while (Date.now() - waitStart < 2200 && created.length === 0) {
          await EU.wait(60);
        }
      } finally {
        try { vm.runtime.off("targetWasCreated", onCreate); } catch (e) {}
      }

      if (created.length === 0) {
        return {
          passed: false,
          error: "No clone created after pressing Space",
          meta: { created_count: 0 },
        };
      }

      const firstClone = created[0];
      const distance = EU.calculateDistance(
        { x: firstClone.x, y: firstClone.y },
        basePos
      );
      return {
        passed: distance <= 45,
        meta: {
          created_count: created.length,
          base_x: Number(basePos.x.toFixed(2)),
          base_y: Number(basePos.y.toFixed(2)),
          clone_x: Number(firstClone.x.toFixed(2)),
          clone_y: Number(firstClone.y.toFixed(2)),
          distance_from_sprite: Number(distance.toFixed(2)),
        },
      };
    }));

    details.push(await runCase("created_clone_moves_upward_repeatedly", async () => {
      const mainSprite = findMainSprite();
      if (!mainSprite) return { passed: false, error: "Sprite1 not found", meta: {} };

      let trackedClone = null;
      const onCreate = (newTarget) => {
        if (!newTarget || newTarget.isOriginal || !newTarget.sprite) return;
        if (newTarget.sprite.name !== mainSprite.sprite.name) return;
        if (!trackedClone) trackedClone = newTarget;
      };
      vm.runtime.on("targetWasCreated", onCreate);

      try {
        await EU.simulateKeyPress(vm, " ", 90);

        const startWait = Date.now();
        while (Date.now() - startWait < 2400 && !trackedClone) {
          await EU.wait(60);
        }
        if (!trackedClone) {
          return {
            passed: false,
            error: "Clone was not created for movement sampling",
            meta: {},
          };
        }

        const sampledY = [];
        for (let i = 0; i < 12; i++) {
          if (!trackedClone || !vm.runtime.targets.find(t => t.id === trackedClone.id)) break;
          sampledY.push(Number(trackedClone.y));
          await EU.wait(120);
        }

        if (sampledY.length < 3) {
          return {
            passed: false,
            error: "Insufficient clone samples to evaluate upward movement",
            meta: { sampled_y: sampledY.map(v => Number(v.toFixed(2))) },
          };
        }

        let movingSteps = 0;
        let upwardSteps = 0;
        for (let i = 1; i < sampledY.length; i++) {
          const delta = sampledY[i] - sampledY[i - 1];
          if (Math.abs(delta) > 0.5) movingSteps++;
          if (delta > 0.5) upwardSteps++;
        }
        const netDelta = sampledY[sampledY.length - 1] - sampledY[0];
        const upwardRatio = movingSteps > 0 ? upwardSteps / movingSteps : 0;

        return {
          passed: netDelta >= 20 && movingSteps >= 3 && upwardRatio >= 0.7,
          meta: {
            sampled_y: sampledY.map(v => Number(v.toFixed(2))),
            net_delta_y: Number(netDelta.toFixed(2)),
            moving_steps: movingSteps,
            upward_steps: upwardSteps,
            upward_ratio: Number(upwardRatio.toFixed(2)),
          },
        };
      } finally {
        try { vm.runtime.off("targetWasCreated", onCreate); } catch (e) {}
      }
    }));

    details.push(await runCase("clone_reaches_top_edge_and_gets_deleted", async () => {
      const mainSprite = findMainSprite();
      if (!mainSprite) return { passed: false, error: "Sprite1 not found", meta: {} };

      const createdIds = new Set();
      let deletedCount = 0;
      let maxY = -Infinity;
      const topEdge = EU.getStageEdges(vm).top;
      const topThreshold = topEdge - 30;

      const onCreate = (newTarget) => {
        if (!newTarget || newTarget.isOriginal || !newTarget.sprite) return;
        if (newTarget.sprite.name !== mainSprite.sprite.name) return;
        createdIds.add(newTarget.id);
      };
      const onRemove = (target) => {
        if (!target || target.isOriginal || !target.sprite) return;
        if (target.sprite.name !== mainSprite.sprite.name) return;
        deletedCount++;
      };
      vm.runtime.on("targetWasCreated", onCreate);
      vm.runtime.on("targetWasRemoved", onRemove);

      try {
        await EU.simulateKeyPress(vm, " ", 90);
        const start = Date.now();
        while (Date.now() - start < 6500) {
          const clones = getActiveClones(mainSprite);
          for (const clone of clones) {
            if (clone.y > maxY) maxY = Number(clone.y);
          }
          if (deletedCount > 0) break;
          await EU.wait(100);
        }
      } finally {
        try { vm.runtime.off("targetWasCreated", onCreate); } catch (e) {}
        try { vm.runtime.off("targetWasRemoved", onRemove); } catch (e) {}
      }

      const reachedTop = Number.isFinite(maxY) && maxY >= topThreshold;
      return {
        passed: createdIds.size > 0 && deletedCount > 0 && reachedTop,
        meta: {
          created_count: createdIds.size,
          deleted_count: deletedCount,
          max_observed_y: Number.isFinite(maxY) ? Number(maxY.toFixed(2)) : null,
          top_threshold: Number(topThreshold.toFixed(2)),
        },
      };
    }));

    details.push(await runCase("multiple_space_presses_create_multiple_distinct_clones", async () => {
      const mainSprite = findMainSprite();
      if (!mainSprite) return { passed: false, error: "Sprite1 not found", meta: {} };

      const createdIds = new Set();
      const createdTimes = [];
      const onCreate = (newTarget) => {
        if (!newTarget || newTarget.isOriginal || !newTarget.sprite) return;
        if (newTarget.sprite.name !== mainSprite.sprite.name) return;
        createdIds.add(newTarget.id);
        createdTimes.push(Date.now());
      };
      vm.runtime.on("targetWasCreated", onCreate);

      try {
        await EU.simulateKeyPress(vm, " ", 90);
        await EU.wait(260);
        await EU.simulateKeyPress(vm, " ", 90);
        await EU.wait(260);
        await EU.simulateKeyPress(vm, " ", 90);
        await EU.wait(1300);
      } finally {
        try { vm.runtime.off("targetWasCreated", onCreate); } catch (e) {}
      }

      const spanMs = createdTimes.length >= 2 ? createdTimes[createdTimes.length - 1] - createdTimes[0] : 0;
      return {
        passed: createdIds.size >= 2 && spanMs >= 120,
        meta: {
          key_presses: 3,
          distinct_clones_created: createdIds.size,
          creation_span_ms: spanMs,
        },
      };
    }));

    const passedTests = details.filter(item => item.passed).length;
    const totalTests = details.length;
    return {
      success: passedTests === totalTests,
      passed_tests: passedTests,
      total_tests: totalTests,
      partial_success_rate: totalTests > 0 ? passedTests / totalTests : 0,
      details,
    };
  } finally {
    try { vm.runtime.stopAll(); } catch (e) {}
    if (typeof cleanup === "function") cleanup();
  }
};
