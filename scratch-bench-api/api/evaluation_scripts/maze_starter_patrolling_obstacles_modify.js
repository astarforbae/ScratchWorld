/**
 * Instruction: This is a basic maze navigation game where players control a ball sprite using arrow keys to move through a maze. The ball bounces off blue walls and the goal is to reach a target sprite that displays 'You win!' when touched. To add an additional gameplay challenge, implement the following feature: make the Obstacle sprite continuously patrol along a path (move and bounce on edge). If the Ball touches the Obstacle, reset Ball to the start position.
 * Unit Test Semantic Goals:
 * 1) A sprite named or matching 'Obstacle' exists.
 * 2) Obstacle patrols with noticeable movement and at least one direction change.
 * 3) Touching Obstacle resets Ball near its initial start position.
 * 4) Obstacle patrol still occurs after restart.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;

  const ballName = (config && config.ballSpriteName) || "Ball";
  const obstacleName = (config && config.obstacleSpriteName) || "Obstacle";

  const findObstacle = () => EU.findSprite(vm, obstacleName, ["Enemy", "Patrol", "Obstacle1", "Guard", "Hazard"]);

  const sampleMovement = async (sprite, durationMs = 3000, intervalMs = 150) => {
    const positions = [];
    let lastPos = EU.getSpritePosition(sprite);
    let lastVel = { x: 0, y: 0 };
    let directionChangeDetected = false;
    let distanceTraveled = 0;

    const start = Date.now();
    while (Date.now() - start < durationMs) {
      await EU.wait(intervalMs);
      const currentPos = EU.getSpritePosition(sprite);
      const vel = EU.calculateVelocity(currentPos, lastPos);
      distanceTraveled += Math.hypot(currentPos.x - lastPos.x, currentPos.y - lastPos.y);
      if (EU.detectBounce(vel, lastVel, "both", 0.1)) directionChangeDetected = true;
      positions.push(currentPos);
      lastVel = vel;
      lastPos = currentPos;
    }

    return { positions, distanceTraveled, directionChangeDetected };
  };

  const waitForBallResetNear = async (ball, targetPos, timeoutMs = 2000, radius = 20) => {
    const start = Date.now();
    while (Date.now() - start <= timeoutMs) {
      const pos = EU.getSpritePosition(ball);
      if (EU.calculateDistance(pos, targetPos) <= radius) return true;
      await EU.wait(50);
    }
    return false;
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
    details.push(await runCase("obstacle_sprite_exists", async () => {
      const ball = EU.findSprite(vm, ballName, ["ball", "Ball", "Sprite1"]);
      const obstacle = findObstacle();
      return {
        passed: !!ball && !!obstacle,
        meta: {
          ball_found: !!ball,
          obstacle_found: !!obstacle,
          obstacle_name: obstacle && obstacle.sprite ? obstacle.sprite.name : null,
        },
      };
    }));

    details.push(await runCase("obstacle_patrols_and_changes_direction", async () => {
      const obstacle = findObstacle();
      if (!obstacle) return { passed: false, error: "Obstacle sprite not found", meta: {} };

      await EU.wait(800);
      const patrol = await sampleMovement(obstacle, 2500, 120);
      const passed = patrol.distanceTraveled > 30 && (patrol.directionChangeDetected || patrol.distanceTraveled > 80);

      return {
        passed,
        meta: {
          distance_traveled: Number(patrol.distanceTraveled.toFixed(2)),
          direction_change_detected: patrol.directionChangeDetected,
        },
      };
    }));

    details.push(await runCase("ball_resets_when_touching_obstacle", async () => {
      const ball = EU.findSprite(vm, ballName, ["ball", "Ball", "Sprite1"]);
      const obstacle = findObstacle();
      if (!ball || !obstacle) {
        return {
          passed: false,
          error: "Ball or Obstacle sprite not found",
          meta: { ball_found: !!ball, obstacle_found: !!obstacle },
        };
      }

      await EU.wait(800);
      const startBallPos = EU.getSpritePosition(ball);
      const obstaclePos = EU.getSpritePosition(obstacle);
      ball.setXY(obstaclePos.x, obstaclePos.y);
      const resetDetected = await waitForBallResetNear(ball, startBallPos, 2000, 25);

      return {
        passed: resetDetected,
        meta: {
          reset_detected: resetDetected,
          start_x: Number(startBallPos.x.toFixed(2)),
          start_y: Number(startBallPos.y.toFixed(2)),
        },
      };
    }));

    details.push(await runCase("obstacle_patrol_persists_after_restart", async () => {
      const obstacle = findObstacle();
      if (!obstacle) return { passed: false, error: "Obstacle sprite not found", meta: {} };

      await EU.wait(800);
      const patrol = await sampleMovement(obstacle, 2000, 120);
      return {
        passed: patrol.distanceTraveled > 25,
        meta: {
          distance_traveled: Number(patrol.distanceTraveled.toFixed(2)),
          direction_change_detected: patrol.directionChangeDetected,
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
