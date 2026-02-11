/**
 * @evaluation: change_sprite_x_by_value
 *
 * Validates the following behaviors for sprite X coordinate change:
 * 1) Target sprite is found and exists on stage
 * 2) Sprite's X coordinate changes by the expected amount (50 pixels)
 * 3) Change occurs within reasonable time frame
 * 4) Final position is within tolerance of expected value
 * 5) VM execution state is proper
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 5);
  const timeoutMs = timeoutSec * 1000;
  const spriteName = config.spriteName || "Sprite1";
  const expectedDelta = 50;
  const tolerance = 1;

  // Likely sprite names
  const spriteCandidateNames = [spriteName, 'Sprite1'];

  const findTargetSprite = () => {
    for (const n of spriteCandidateNames) {
      const t = EU.findSprite(vm, n, []);
      if (t) return t;
    }
    return vm.runtime.targets.find(t => t.isOriginal && t.sprite && t.sprite.name !== 'Stage');
  };

  let timeoutTimer = null;

  const restartProject = async () => {
    try { vm.runtime.stopAll(); } catch {}
    EU.startVM(vm);
    await EU.wait(400);
  };

  // Test case 1: Check if target sprite exists
  const testSpriteExists = async () => {
    const sprite = findTargetSprite();
    return {
      passed: !!sprite,
      details: sprite ? `Sprite found: ${sprite.sprite.name}` : 'Target sprite not found'
    };
  };

  // Test case 2: Check initial position capture
  const testInitialPositionCapture = async () => {
    const sprite = findTargetSprite();
    if (!sprite) {
      return { passed: false, details: 'Target sprite not found' };
    }

    const initialX = sprite.x;
    return {
      passed: typeof initialX === 'number' && !isNaN(initialX),
      details: `Initial X position: ${initialX}`
    };
  };

  // Test case 3: Check X coordinate change
  const testXCoordinateChange = async () => {
    return new Promise((resolve) => {
      const sprite = findTargetSprite();
      if (!sprite) {
        resolve({ passed: false, details: 'Target sprite not found' });
        return;
      }

      const initialX = sprite.x;
      let positionChanged = false;
      let finalX = initialX;
      let actualDelta = 0;

      const checkChange = () => {
        const currentX = sprite.x;
        if (Math.abs(currentX - initialX) > tolerance) {
          finalX = currentX;
          actualDelta = finalX - initialX;
          positionChanged = true;
        }
      };

      const interval = setInterval(checkChange, 100);

      setTimeout(() => {
        clearInterval(interval);
        const deltaError = Math.abs(actualDelta - expectedDelta);
        resolve({
          passed: positionChanged && deltaError <= tolerance,
          details: `Initial: ${initialX.toFixed(2)}, Final: ${finalX.toFixed(2)}, Delta: ${actualDelta.toFixed(2)}, Expected: ${expectedDelta}, Error: ${deltaError.toFixed(2)}`
        });
      }, 4000);
    });
  };

  // Test case 4: Check movement timing
  const testMovementTiming = async () => {
    return new Promise((resolve) => {
      const sprite = findTargetSprite();
      if (!sprite) {
        resolve({ passed: false, details: 'Target sprite not found' });
        return;
      }

      const initialX = sprite.x;
      let movementStartTime = null;
      let movementEndTime = null;
      let hasStartedMoving = false;

      const checkTiming = () => {
        const currentX = sprite.x;
        const hasMoved = Math.abs(currentX - initialX) > tolerance;

        if (hasMoved && !hasStartedMoving) {
          hasStartedMoving = true;
          movementStartTime = Date.now();
        }

        if (hasStartedMoving && Math.abs(Math.abs(currentX - initialX) - expectedDelta) <= tolerance) {
          movementEndTime = Date.now();
        }
      };

      const interval = setInterval(checkTiming, 50);

      setTimeout(() => {
        clearInterval(interval);
        const movementDuration = movementEndTime && movementStartTime ? 
          movementEndTime - movementStartTime : null;
        const reasonableTiming = movementDuration && movementDuration < 3000; // Within 3 seconds
        
        resolve({
          passed: !!movementStartTime && reasonableTiming,
          details: `Movement started: ${!!movementStartTime}, Duration: ${movementDuration}ms, Reasonable: ${reasonableTiming}`
        });
      }, 4500);
    });
  };

  // Test case 5: Check VM execution state
  const testVMExecution = async () => {
    const threadsRunning = vm.runtime.threads.length > 0;
    const vmActive = vm.runtime.currentStepTime !== null;
    
    return {
      passed: threadsRunning || vmActive,
      details: `Threads: ${vm.runtime.threads.length}, VM active: ${vmActive}`
    };
  };

  try {
    console.log('[Change Sprite X by Value] Begin evaluation');

    // Global timeout guard
    await new Promise((resolve, reject) => {
      timeoutTimer = EU.createTimeout(timeoutMs, () => reject(new Error('Timeout')));
      resolve();
    });

    await restartProject();
    await EU.wait(300);

    // Run all test cases
    const testResults = {
      spriteExists: await testSpriteExists(),
      initialPositionCapture: await testInitialPositionCapture(),
      xCoordinateChange: await testXCoordinateChange(),
      movementTiming: await testMovementTiming(),
      vmExecution: await testVMExecution()
    };

    const results = {
      spriteExists: testResults.spriteExists.passed,
      initialPositionCapture: testResults.initialPositionCapture.passed,
      xCoordinateChange: testResults.xCoordinateChange.passed,
      movementTiming: testResults.movementTiming.passed,
      vmExecution: testResults.vmExecution.passed
    };

    const passedTests = Object.values(results).filter(Boolean).length;
    const totalTests = Object.keys(results).length;

    const payload = {
      success: passedTests === totalTests,
      passed_tests: passedTests,
      total_tests: totalTests,
      partial_success_rate: totalTests ? passedTests / totalTests : 0,
      details: Object.keys(results).map((k) => ({ 
        name: k, 
        passed: !!results[k],
        details: testResults[k].details
      })),
    };

    try { vm.runtime.stopAll(); } catch {}
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();

    console.log('[Change Sprite X by Value] Done', payload);
    return payload;
  } catch (err) {
    console.log('[Change Sprite X by Value] Error:', err.message);
    try { vm.runtime.stopAll(); } catch {}
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();
    throw err;
  }
};
