/**
 * Instruction: Starting from an empty Scratch project with a single default sprite named 'Sprite1', you should complete the following: 1) When the green flag is clicked, make Sprite1 move to the mouse pointer immediately and continuously point toward the mouse pointer. 2) Ensure this runs in a forever loop.
 * Unit Test Semantic Goals:
 * 1) On green flag, 'Sprite1' quickly moves close to the mouse pointer position.
 * 2) After start, 'Sprite1' keeps following multiple mouse positions (forever-loop behavior).
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 15);
  const caseTimeoutMs = timeoutSec * 1000;

  const findFollowerSprite = () =>
    EU.findSprite(vm, "Sprite1", []) ||
    (vm.runtime.targets || []).find(t => t.isOriginal && t.sprite && t.sprite.name !== "Stage") ||
    null;

  const moveMouse = (x, y) => {
    if (typeof EU.simulateMouseMove === "function") {
      EU.simulateMouseMove(vm, x, y);
      return;
    }
    if (vm.runtime.ioDevices && vm.runtime.ioDevices.mouse) {
      vm.runtime.ioDevices.mouse._scratchX = x;
      vm.runtime.ioDevices.mouse._scratchY = y;
    }
  };

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
      await EU.wait(120);
      EU.startVM(vm);
      await EU.wait(450);
    },
    run: async () => runner(),
    afterCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
    },
  });

  const details = [];
  try {
    details.push(await runCase("sprite1_moves_near_mouse_immediately_after_start", async () => {
      const sprite = findFollowerSprite();
      if (!sprite) return { passed: false, error: "Sprite1 not found", meta: {} };

      const target = { x: 140, y: 95 };
      moveMouse(target.x, target.y);
      await EU.wait(450);

      const pos = EU.getSpritePosition(sprite);
      const distance = EU.calculateDistance(pos, target);
      return {
        passed: distance <= 24,
        meta: {
          target_x: target.x,
          target_y: target.y,
          observed_x: Number(pos.x.toFixed(2)),
          observed_y: Number(pos.y.toFixed(2)),
          distance_to_target: Number(distance.toFixed(2)),
        },
      };
    }));

    details.push(await runCase("sprite1_continuously_follows_multiple_mouse_positions", async () => {
      const sprite = findFollowerSprite();
      if (!sprite) return { passed: false, error: "Sprite1 not found", meta: {} };

      const positions = [
        { x: -150, y: 110 },
        { x: 120, y: -80 },
        { x: 40, y: 40 },
        { x: -30, y: -120 },
      ];

      const sampled = [];
      let closeCount = 0;
      for (const point of positions) {
        moveMouse(point.x, point.y);
        await EU.wait(430);
        const pos = EU.getSpritePosition(sprite);
        const distance = EU.calculateDistance(pos, point);
        if (distance <= 24) closeCount++;
        sampled.push({
          target_x: point.x,
          target_y: point.y,
          observed_x: Number(pos.x.toFixed(2)),
          observed_y: Number(pos.y.toFixed(2)),
          distance: Number(distance.toFixed(2)),
        });
      }

      return {
        passed: closeCount >= 3,
        meta: {
          close_count: closeCount,
          total_positions: positions.length,
          samples: sampled,
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
