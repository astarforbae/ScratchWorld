/**
 * Instruction: Starting from the provided Scratch project with a single default sprite named 'Sprite1' and a sprite named 'Target', you should complete the following: 1) When the green flag is clicked, set Sprite1 to be draggable. 2) When Sprite1 is dragged to touch the 'Target' sprite, make Sprite1 say 'Success!' for 2 seconds.
 * Unit Test Semantic Goals:
 * 1) After green flag, 'Sprite1' has draggable enabled.
 * 2) Dragging 'Sprite1' to touch 'Target' makes it say text containing "Success!".
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 25);
  const caseTimeoutMs = timeoutSec * 1000;
  const mainSpriteName = (config && config.mainSpriteName) || "Sprite1";
  const targetSpriteName = (config && config.targetSpriteName) || "Target";

  const getMainSprite = () => EU.findSprite(vm, mainSpriteName, ["Sprite1", "Cat"]);
  const getTargetSprite = () => EU.findSprite(vm, targetSpriteName, ["Target"]);

  const detectSuccessMessage = async (action, timeoutMs = 5000) => {
    let detected = false;
    let observedText = "";

    const sayListener = (target, type, text) => {
      const normalized = String(text || "").toLowerCase();
      if (normalized.includes("success")) {
        detected = true;
        observedText = String(text || "");
      }
    };

    vm.runtime.on("SAY", sayListener);
    try {
      await action();
      const start = Date.now();
      while (!detected && Date.now() - start < timeoutMs) {
        await EU.wait(80);
      }
    } finally {
      try { vm.runtime.off("SAY", sayListener); } catch (e) {}
    }

    return { detected, observedText };
  };

  const dragSpriteToTarget = async (mainSprite, targetSprite) => {
    const from = EU.getSpritePosition(mainSprite);
    const to = EU.getSpritePosition(targetSprite);

    EU.simulateMouseMove(vm, from.x, from.y);
    EU.simulateMouseDown(vm, from.x, from.y);
    await EU.wait(80);

    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const ratio = i / steps;
      const x = from.x + (to.x - from.x) * ratio;
      const y = from.y + (to.y - from.y) * ratio;
      EU.simulateMouseMove(vm, x, y);
      if (typeof mainSprite.setXY === "function") mainSprite.setXY(x, y);
      await EU.wait(120);
    }

    EU.simulateMouseUp(vm);
    await EU.wait(250);

    if (typeof mainSprite.setXY === "function") {
      mainSprite.setXY(to.x, to.y);
      await EU.wait(250);
    }
  };

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
      try { EU.simulateMouseUp(vm); } catch (e) {}
    },
    run: async () => runner(),
    afterCase: async () => {
      try { EU.simulateMouseUp(vm); } catch (e) {}
      try { vm.runtime.stopAll(); } catch (e) {}
    },
  });

  const details = [];

  try {
    details.push(await runCase("sprite1_becomes_draggable_after_green_flag", async () => {
      EU.startVM(vm);
      await EU.wait(900);
      const mainSprite = getMainSprite();
      const targetSprite = getTargetSprite();
      return {
        passed: !!mainSprite && !!mainSprite.draggable,
        meta: {
          main_sprite_found: !!mainSprite,
          target_sprite_found: !!targetSprite,
          draggable: !!(mainSprite && mainSprite.draggable),
        },
      };
    }));

    details.push(await runCase("dragging_to_target_triggers_success_message", async () => {
      EU.startVM(vm);
      await EU.wait(900);

      const mainSprite = getMainSprite();
      const targetSprite = getTargetSprite();
      if (!mainSprite || !targetSprite) {
        return {
          passed: false,
          error: "Required sprites not found",
          meta: {
            main_sprite_found: !!mainSprite,
            target_sprite_found: !!targetSprite,
          },
        };
      }

      const detection = await detectSuccessMessage(async () => {
        await dragSpriteToTarget(mainSprite, targetSprite);
      });
      const finalMainPos = EU.getSpritePosition(mainSprite);
      const targetPos = EU.getSpritePosition(targetSprite);
      const finalDistance = EU.calculateDistance(finalMainPos, targetPos);

      return {
        passed: detection.detected,
        meta: {
          success_message_detected: detection.detected,
          observed_text: detection.observedText,
          final_distance_to_target: Number(finalDistance.toFixed(2)),
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
    try { EU.simulateMouseUp(vm); } catch (e) {}
    try { vm.runtime.stopAll(); } catch (e) {}
    if (typeof cleanup === "function") cleanup();
  }
};
