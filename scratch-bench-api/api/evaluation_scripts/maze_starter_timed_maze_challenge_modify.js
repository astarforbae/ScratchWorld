/**
 * Instruction: This is a basic maze navigation game where players control a ball sprite using arrow keys to move through a maze. The ball bounces off blue walls and the goal is to reach a target sprite that displays 'You win!' when touched. Enhance the Maze Starter by adding two variables: timeLeft and score. On green flag: set timeLeft to 60 and score to 0. Start a forever loop that waits 1 second and decreases timeLeft by 1 until it reaches 0, at which point the game ends and all scripts should stop. While moving, if the Ball is touching the wall color, change score by -1 and push the Ball back. When the Ball reaches the goal, award a +50 score bonus and stop the timer.
 * Unit Test Semantic Goals:
 * 1) Variables 'timeLeft' and 'score' both exist on stage.
 * 2) On green flag, 'timeLeft' initializes to 60 and 'score' initializes to 0.
 * 3) During gameplay, 'timeLeft' decreases by about 1 each second.
 * 4) On wall contact, 'score' decreases and 'Ball' shows blocked/pushback movement.
 * 5) On goal contact, 'score' increases by about 50 and 'timeLeft' stops changing.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;
  const ballName = (config && config.ballSpriteName) || "Ball";
  const goalX = (config && config.goalX) != null ? Number(config.goalX) : 200;
  const goalY = (config && config.goalY) != null ? Number(config.goalY) : -150;

  const toFiniteNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const findStageVariable = (varName) => {
    const stage = vm.runtime.getTargetForStage();
    if (!stage || !stage.variables) return null;
    for (const variable of Object.values(stage.variables)) {
      if (variable && variable.name === varName) return variable;
    }
    return null;
  };

  const getNumericVariableValue = (varName) => {
    const variable = findStageVariable(varName);
    return variable ? toFiniteNumber(variable.value) : null;
  };

  const waitForVariableChange = async (varName, initialValue, timeoutMs = 2500) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const current = getNumericVariableValue(varName);
      if (current !== null && initialValue !== null && current !== initialValue) {
        return current;
      }
      await EU.wait(100);
    }
    return getNumericVariableValue(varName);
  };

  const pressOneOf = async (keys, durationMs = 120) => {
    try {
      for (const key of keys) {
        vm.runtime.ioDevices.keyboard.postData({ key, isDown: true });
      }
      await EU.wait(durationMs);
    } finally {
      for (const key of keys) {
        vm.runtime.ioDevices.keyboard.postData({ key, isDown: false });
      }
    }
  };

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
      await EU.wait(200);
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
    details.push(await runCase("variables_timeleft_and_score_exist", async () => {
      const timeLeftVar = findStageVariable("timeLeft");
      const scoreVar = findStageVariable("score");
      return {
        passed: !!timeLeftVar && !!scoreVar,
        meta: {
          has_timeLeft: !!timeLeftVar,
          has_score: !!scoreVar,
        },
      };
    }));

    details.push(await runCase("green_flag_sets_timeleft_60_and_score_0", async () => {
      const timeLeft = getNumericVariableValue("timeLeft");
      const score = getNumericVariableValue("score");
      const timeOk = timeLeft !== null && Math.abs(timeLeft - 60) < 0.001;
      const scoreOk = score !== null && Math.abs(score) < 0.001;
      return {
        passed: timeOk && scoreOk,
        meta: {
          observed_timeLeft: timeLeft,
          observed_score: score,
        },
      };
    }));

    details.push(await runCase("timeleft_decreases_about_one_per_second", async () => {
      const values = [];
      for (let i = 0; i < 4; i++) {
        values.push(getNumericVariableValue("timeLeft"));
        await EU.wait(1050);
      }
      const numeric = values.filter(v => v !== null);
      const deltas = [];
      for (let i = 1; i < numeric.length; i++) deltas.push(numeric[i] - numeric[i - 1]);
      const nearMinusOne = deltas.filter(d => d <= -0.8 && d >= -1.2).length;
      const monotonicDown = deltas.every(d => d <= 0);
      return {
        passed: numeric.length >= 3 && nearMinusOne >= 2 && monotonicDown,
        meta: {
          sampled_values: values,
          deltas,
          near_minus_one_count: nearMinusOne,
          monotonic_decrease: monotonicDown,
        },
      };
    }));

    details.push(await runCase("wall_touch_penalizes_score_and_pushes_ball_back", async () => {
      const ball = EU.findSprite(vm, ballName, ["Ball", "Sprite1", "ball"]);
      if (!ball) {
        return { passed: false, error: "Ball sprite not found", meta: {} };
      }

      const beforeScore = getNumericVariableValue("score");
      const wallProbePoints = [
        { x: -130, y: 30 },
        { x: -120, y: 10 },
        { x: -100, y: 0 },
        { x: -145, y: 55 },
      ];

      let penaltyObserved = false;
      let backwardSteps = 0;
      let stalledSteps = 0;

      for (const point of wallProbePoints) {
        ball.setXY(point.x, point.y);
        await EU.wait(100);
        let last = EU.getSpritePosition(ball);
        for (let i = 0; i < 9; i++) {
          await pressOneOf(["ArrowRight", "Right", "d"], 110);
          const cur = EU.getSpritePosition(ball);
          const dx = cur.x - last.x;
          if (dx < -0.5) backwardSteps++;
          if (Math.abs(dx) < 0.8) stalledSteps++;
          last = cur;

          const nowScore = getNumericVariableValue("score");
          if (beforeScore !== null && nowScore !== null && nowScore < beforeScore) {
            penaltyObserved = true;
          }
        }
        if (penaltyObserved) break;
      }

      const afterScore = await waitForVariableChange("score", beforeScore, 1200);
      const scoreDelta = (beforeScore !== null && afterScore !== null) ? afterScore - beforeScore : null;
      const pushbackObserved = backwardSteps >= 1 || stalledSteps >= 2;

      return {
        passed: penaltyObserved && pushbackObserved,
        meta: {
          score_before: beforeScore,
          score_after: afterScore,
          score_delta: scoreDelta,
          penalty_observed: penaltyObserved,
          backward_steps: backwardSteps,
          stalled_steps: stalledSteps,
          pushback_observed: pushbackObserved,
        },
      };
    }));

    details.push(await runCase("goal_touch_adds_50_and_stops_timer", async () => {
      const ball = EU.findSprite(vm, ballName, ["Ball", "Sprite1", "ball"]);
      if (!ball) {
        return { passed: false, error: "Ball sprite not found", meta: {} };
      }

      const scoreBefore = getNumericVariableValue("score");
      ball.setXY(goalX, goalY);
      await EU.wait(700);

      const scoreAfter = await waitForVariableChange("score", scoreBefore, 2500);
      const timeAtGoal = getNumericVariableValue("timeLeft");
      await EU.wait(1300);
      const timeLater = getNumericVariableValue("timeLeft");

      const scoreDelta = (scoreBefore !== null && scoreAfter !== null) ? scoreAfter - scoreBefore : null;
      const scoreBonusOk = scoreDelta !== null && scoreDelta >= 45;
      const timerStopped = timeAtGoal !== null && timeLater !== null && Math.abs(timeLater - timeAtGoal) < 0.001;

      return {
        passed: scoreBonusOk && timerStopped,
        meta: {
          score_before: scoreBefore,
          score_after: scoreAfter,
          score_delta: scoreDelta,
          time_at_goal: timeAtGoal,
          time_later: timeLater,
          timer_stopped: timerStopped,
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
