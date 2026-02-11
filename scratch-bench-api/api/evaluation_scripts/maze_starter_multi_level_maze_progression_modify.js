/**
 * Instruction: This is a basic maze navigation game in which players use the arrow keys to control a Ball sprite moving through a maze. The Ball bounces off blue wall sprites, and the objective is to reach the Goal sprite. Create a variable called currentLevel for all sprites and set it to 1 at the start of the game. The Stage has been designed with three backdrops, which represent three levels in the game. When the Ball touches the Goal, increase currentLevel by 1, switch the Stage to the next existing backdrop, and reset the Ball’s x and y position to the same starting location for the new level. This process should repeat as the player progresses through the three levels. When the final level (Level 3) is completed, the Goal should display the message “You win!” to indicate that the player has finished the game.
 * Unit Test Semantic Goals:
 * 1) At start, variable 'currentLevel' equals 1.
 * 2) Reaching goal from level 1 increments 'currentLevel' to 2 and changes backdrop index.
 * 3) After level-up, Ball resets near its initial x/y position.
 * 4) After completing level 3, a win message is said (or scripts stop as terminal success).
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;

  const ballName = (config && config.ballSpriteName) || "Ball";
  const goalX = (config && config.goalX) != null ? config.goalX : 200;
  const goalY = (config && config.goalY) != null ? config.goalY : -150;

  const getVariableValue = (varName) => {
    const lowered = String(varName || "").toLowerCase();
    for (const target of vm.runtime.targets || []) {
      const vars = target.variables || {};
      for (const id of Object.keys(vars)) {
        const variable = vars[id];
        if (variable && String(variable.name || "").toLowerCase() === lowered) {
          return variable.value;
        }
      }
    }
    return null;
  };

  const waitForBackdropChange = async (initialIndex, timeoutMs = 3000) => {
    const stage = vm.runtime.getTargetForStage();
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (stage && stage.currentCostume !== initialIndex) {
        return { changed: true, new_index: stage.currentCostume };
      }
      await EU.wait(100);
    }
    return { changed: false, new_index: stage ? stage.currentCostume : null };
  };

  const waitForLevelValue = async (expected, timeoutMs = 3000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const val = getVariableValue("currentLevel");
      if (String(val) === String(expected)) return true;
      await EU.wait(100);
    }
    return false;
  };

  const waitForWinOrStop = (timeoutMs = 4000) => new Promise((resolve) => {
    let timer = null;
    let interval = null;
    const sayHandler = (target, type, text) => {
      const msg = String(text || "").toLowerCase();
      if (
        msg.includes("you win") ||
        msg.includes("win!") ||
        msg.includes("victory") ||
        msg.includes("congratulations")
      ) {
        cleanupWait();
        resolve({ win: true, stopped: false, text: String(text || "") });
      }
    };

    const cleanupWait = () => {
      try { vm.runtime.off("SAY", sayHandler); } catch (e) {}
      if (interval) clearInterval(interval);
      if (timer) clearTimeout(timer);
    };

    vm.runtime.on("SAY", sayHandler);
    interval = setInterval(() => {
      if (!EU.isVMRunning(vm)) {
        cleanupWait();
        resolve({ win: false, stopped: true, text: null });
      }
    }, 100);

    timer = setTimeout(() => {
      cleanupWait();
      resolve({ win: false, stopped: false, text: null });
    }, timeoutMs);
  });

  const moveBallToGoalAndWaitLevel = async (ball, expectedLevel = null, timeoutMs = 3000) => {
    ball.setXY(goalX, goalY);
    if (expectedLevel == null) {
      await EU.wait(900);
      return true;
    }

    const levelReached = await waitForLevelValue(expectedLevel, timeoutMs);
    if (!levelReached) {
      throw new Error(`Level did not advance to ${expectedLevel}`);
    }
    return true;
  };

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
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
    details.push(await runCase("current_level_initializes_to_1", async () => {
      const ball = EU.findSprite(vm, ballName, ["Ball", "Sprite1", "ball"]);
      if (!ball) return { passed: false, error: "Ball sprite not found", meta: {} };

      await EU.wait(800);
      const initialLevel = getVariableValue("currentLevel");
      return {
        passed: String(initialLevel) === "1",
        meta: { initial_level: initialLevel },
      };
    }));

    details.push(await runCase("goal_touch_advances_level_and_backdrop", async () => {
      const ball = EU.findSprite(vm, ballName, ["Ball", "Sprite1", "ball"]);
      const stage = vm.runtime.getTargetForStage();
      if (!ball || !stage) {
        return {
          passed: false,
          error: "Ball or Stage not found",
          meta: { ball_found: !!ball, stage_found: !!stage },
        };
      }

      await EU.wait(800);
      const initialBackdropIndex = stage.currentCostume;
      await moveBallToGoalAndWaitLevel(ball, 2, 3000);
      const backdrop = await waitForBackdropChange(initialBackdropIndex, 3000);

      return {
        passed: backdrop.changed,
        meta: {
          initial_backdrop_index: initialBackdropIndex,
          new_backdrop_index: backdrop.new_index,
          backdrop_changed: backdrop.changed,
          current_level: getVariableValue("currentLevel"),
        },
      };
    }));

    details.push(await runCase("ball_resets_to_start_after_level_up", async () => {
      const ball = EU.findSprite(vm, ballName, ["Ball", "Sprite1", "ball"]);
      if (!ball) return { passed: false, error: "Ball sprite not found", meta: {} };

      await EU.wait(800);
      const startPos = EU.getSpritePosition(ball);
      await moveBallToGoalAndWaitLevel(ball, 2, 3000);
      const afterPos = EU.getSpritePosition(ball);
      const resetDistance = EU.calculateDistance(afterPos, startPos);

      return {
        passed: resetDistance <= 30,
        meta: {
          start_x: Number(startPos.x.toFixed(2)),
          start_y: Number(startPos.y.toFixed(2)),
          after_x: Number(afterPos.x.toFixed(2)),
          after_y: Number(afterPos.y.toFixed(2)),
          reset_distance: Number(resetDistance.toFixed(2)),
        },
      };
    }));

    details.push(await runCase("final_level_completion_triggers_win_terminal_state", async () => {
      const ball = EU.findSprite(vm, ballName, ["Ball", "Sprite1", "ball"]);
      if (!ball) return { passed: false, error: "Ball sprite not found", meta: {} };

      await EU.wait(800);
      await moveBallToGoalAndWaitLevel(ball, 2, 3000);
      await moveBallToGoalAndWaitLevel(ball, 3, 3000);
      await moveBallToGoalAndWaitLevel(ball, null, 3000);

      const finalResult = await waitForWinOrStop(Math.min(caseTimeoutMs, 4000));
      return {
        passed: finalResult.win || finalResult.stopped,
        meta: {
          win_detected: finalResult.win,
          runtime_stopped: finalResult.stopped,
          win_text: finalResult.text,
          final_level_value: getVariableValue("currentLevel"),
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
