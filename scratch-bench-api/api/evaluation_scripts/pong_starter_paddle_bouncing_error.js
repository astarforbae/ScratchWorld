/**
 * Instruction: This is a basic Pong-style game where a ball bounces around the screen and players control a paddle that follows the mouse. The ball changes direction when hitting the paddle and the game ends when the ball touches red areas. But now in this Pong Game, the pong ball doesn't bounce correctly when it touches the paddle. Please help me fix this issue so the ball properly bounces off the paddle with correct physics.
 * Unit Test Semantic Goals:
 * 1) Detect the first sharp turn near paddle contact.
 * 2) After that turn, 5 deduplicated frames keep the same direction.
 * 3) Among those 5 frames, frames 3-5 have dy > 5.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 15);
  const caseTimeoutMs = timeoutSec * 1000;

  const ballName = (config && config.ballName) || "Ball";
  const paddleName = (config && config.paddleName) || "Paddle";

  const findBall = () => EU.findSprite(vm, ballName, ["Ball", "Sprite1", "ball"]);
  const findPaddle = () => EU.findSprite(vm, paddleName, ["Paddle", "paddle", "Player"]);

  const angleDiff = (a, b) => {
    let diff = Math.abs((Number(a) || 0) - (Number(b) || 0)) % 360;
    if (diff > 180) diff = 360 - diff;
    return diff;
  };

  const setMouseScratchCoords = (x, y = -150) => {
    const mouse = vm && vm.runtime && vm.runtime.ioDevices && vm.runtime.ioDevices.mouse;
    if (!mouse) return;
    mouse._scratchX = x;
    mouse._scratchY = y;
    mouse._clientX = x;
    mouse._clientY = y;
  };

  const setTargetPose = (target, x, y, direction) => {
    if (!target) return;
    try {
      if (typeof target.setXY === "function") target.setXY(x, y);
      else {
        target.x = x;
        target.y = y;
      }
    } catch (e) {
      target.x = x;
      target.y = y;
    }
    try {
      if (typeof target.setDirection === "function") target.setDirection(direction);
      else target.direction = direction;
    } catch (e) {
      target.direction = direction;
    }
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
    details.push(await runCase("ball_bounces_up_after_hitting_paddle", async () => {
      const ball = findBall();
      const paddle = findPaddle();
      if (!ball) return { passed: false, error: "Ball sprite not found", meta: {} };
      if (!paddle) return { passed: false, error: "Paddle sprite not found", meta: {} };

      const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
      const sampleIntervalMs = 20;
      const seededPaddleY = Number(paddle.y);

      setTargetPose(ball, 0, 120, 180);
      try {
        if (typeof paddle.setXY === "function") paddle.setXY(0, seededPaddleY);
        else paddle.x = 0;
      } catch (e) {
        paddle.x = 0;
      }
      setMouseScratchCoords(0, seededPaddleY);
      await EU.wait(120);

      const isDuplicateFrame = (a, b) =>
        !!a && !!b && a.x === b.x && a.y === b.y && a.direction === b.direction;

      let sampleCount = 0;
      let prev = null;
      let firstTurnIndex = -1;
      let firstTurnAngle = null;
      const firstFivePostUnique = [];
      const startedAt = Date.now();

      while (Date.now() - startedAt < 7800) {
        setMouseScratchCoords(clamp(Number(ball.x), -220, 220), Number(paddle.y));
        await EU.wait(sampleIntervalMs);

        const point = {
          x: Number(ball.x),
          y: Number(ball.y),
          direction: Number(ball.direction),
          paddle_x: Number(paddle.x),
          paddle_y: Number(paddle.y),
        };
        point.dy = prev ? Number((point.y - prev.y).toFixed(3)) : null;
        point.dy_to_paddle = Number((point.y - point.paddle_y).toFixed(3));
        point.dx_to_paddle = Number((point.x - point.paddle_x).toFixed(3));
        sampleCount += 1;

        if (firstTurnIndex < 0 && prev) {
          const nearPaddleAtTurn =
            Math.abs(prev.dx_to_paddle) <= 42 &&
            prev.dy_to_paddle >= -10 &&
            prev.dy_to_paddle <= 60;
          const turnAngle = angleDiff(prev.direction, point.direction);
          if (nearPaddleAtTurn && turnAngle >= 95) {
            firstTurnIndex = sampleCount - 1;
            firstTurnAngle = Number(turnAngle.toFixed(3));
          }
        }

        if (firstTurnIndex >= 0) {
          const lastUnique = firstFivePostUnique.length
            ? firstFivePostUnique[firstFivePostUnique.length - 1]
            : null;
          if (!isDuplicateFrame(point, lastUnique)) {
            firstFivePostUnique.push({
              sample_id: sampleCount,
              direction: point.direction,
              dy: point.dy,
              x: point.x,
              y: point.y,
            });
          }
          if (firstFivePostUnique.length >= 5) break;
        }

        prev = point;
      }

      const postFiveSameDirection =
        firstFivePostUnique.length === 5 &&
        firstFivePostUnique.every(item => item.direction === firstFivePostUnique[0].direction);
      const postTrailingThreeDyGt5 =
        firstFivePostUnique.length === 5 &&
        firstFivePostUnique.slice(2).every(item => item.dy !== null && item.dy > 5);
      const passed = firstTurnIndex >= 0 && postFiveSameDirection && postTrailingThreeDyGt5;

      return {
        passed,
        meta: {
          sample_count: sampleCount,
          first_turn_index: firstTurnIndex,
          first_turn_angle: firstTurnAngle,
          first_five_post_unique: firstFivePostUnique,
          post_five_same_direction: postFiveSameDirection,
          post_trailing_three_dy_gt_5: postTrailingThreeDyGt5,
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
