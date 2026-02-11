/**
 * @evaluation: bouncing_cat_manual
 *
 * Validates the following behaviors for the bouncing cat project:
 * 1) Cat sprite is found and visible on stage
 * 2) Cat moves horizontally and bounces off edges
 * 3) Cat reaches both left and right edges during execution
 * 4) Movement is continuous and consistent
 * 5) Edge detection works properly
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const timeoutMs = timeoutSec * 1000;

  // Likely sprite names for the cat
  const catCandidateNames = ['Sprite1', 'Cat', 'cat'];

  const findCat = () => {
    for (const n of catCandidateNames) {
      const t = EU.findSprite(vm, n, []);
      if (t) return t;
    }
    // Fallback to first non-stage sprite
    return vm.runtime.targets.find(t => t.isOriginal && t.sprite && t.sprite.name !== 'Stage');
  };

  let timeoutTimer = null;

  const restartProject = async () => {
    try { vm.runtime.stopAll(); } catch {}
    EU.startVM(vm);
    await EU.wait(400);
  };

  // Test case 1: Check if cat sprite exists and is visible
  const testCatExists = async () => {
    const cat = findCat();
    return {
      passed: !!(cat && cat.visible),
      details: cat ? `Cat found: ${cat.sprite.name}, visible: ${cat.visible}` : 'Cat sprite not found'
    };
  };

  // Test case 2: Check horizontal movement
  const testHorizontalMovement = async () => {
    return new Promise((resolve) => {
      const cat = findCat();
      if (!cat) {
        resolve({ passed: false, details: 'Cat sprite not found' });
        return;
      }

      let initialX = cat.x;
      let hasMovedSignificantly = false;
      let movementSamples = [];
      
      const checkMovement = () => {
        const currentX = cat.x;
        movementSamples.push(currentX);
        
        if (Math.abs(currentX - initialX) > 50) {
          hasMovedSignificantly = true;
        }
      };

      const interval = setInterval(checkMovement, 100);
      
      setTimeout(() => {
        clearInterval(interval);
        const xRange = Math.max(...movementSamples) - Math.min(...movementSamples);
        resolve({
          passed: hasMovedSignificantly && xRange > 100,
          details: `Movement range: ${xRange.toFixed(2)}, significant movement: ${hasMovedSignificantly}`
        });
      }, 3000);
    });
  };

  // Test case 3: Check edge bouncing behavior
  const testEdgeBouncing = async () => {
    return new Promise((resolve) => {
      const cat = findCat();
      if (!cat) {
        resolve({ passed: false, details: 'Cat sprite not found' });
        return;
      }

      let hasReachedRightEdge = false;
      let hasReachedLeftEdge = false;
      let edgeCollisions = 0;
      
      const checkEdges = () => {
        const x = cat.x;
        const isTouchingEdge = cat.isTouchingEdge();
        
        if (isTouchingEdge) {
          edgeCollisions++;
          const stageWidth = vm.runtime.constructor.STAGE_WIDTH || 480;
          const isRightEdge = x > (stageWidth / 2 - 50);
          const isLeftEdge = x < -(stageWidth / 2 - 50);
          
          if (isRightEdge) hasReachedRightEdge = true;
          if (isLeftEdge) hasReachedLeftEdge = true;
        }
      };

      const interval = setInterval(checkEdges, 50);
      
      setTimeout(() => {
        clearInterval(interval);
        resolve({
          passed: hasReachedRightEdge && hasReachedLeftEdge && edgeCollisions >= 2,
          details: `Right edge: ${hasReachedRightEdge}, Left edge: ${hasReachedLeftEdge}, Collisions: ${edgeCollisions}`
        });
      }, 8000);
    });
  };

  // Test case 4: Check movement continuity
  const testMovementContinuity = async () => {
    return new Promise((resolve) => {
      const cat = findCat();
      if (!cat) {
        resolve({ passed: false, details: 'Cat sprite not found' });
        return;
      }

      let positions = [];
      let stationaryCount = 0;
      
      const checkContinuity = () => {
        const x = cat.x;
        positions.push(x);
        
        if (positions.length >= 10) {
          const recent = positions.slice(-10);
          const range = Math.max(...recent) - Math.min(...recent);
          if (range < 5) stationaryCount++;
          positions = positions.slice(-20); // Keep only recent positions
        }
      };

      const interval = setInterval(checkContinuity, 100);
      
      setTimeout(() => {
        clearInterval(interval);
        const isMovingContinuously = stationaryCount < 5; // Allow some brief pauses
        resolve({
          passed: isMovingContinuously,
          details: `Stationary periods: ${stationaryCount}, continuous movement: ${isMovingContinuously}`
        });
      }, 5000);
    });
  };

  // Test case 5: Check VM execution state
  const testVMExecution = async () => {
    const threadsRunning = vm.runtime.threads.length > 0;
    const vmRunning = !vm.runtime._steppingInterval === null;
    
    return {
      passed: threadsRunning,
      details: `Threads running: ${vm.runtime.threads.length}, VM active: ${vmRunning}`
    };
  };

  try {
    console.log('[Bouncing Cat Manual] Begin evaluation');

    // Global timeout guard
    await new Promise((resolve, reject) => {
      timeoutTimer = EU.createTimeout(timeoutMs, () => reject(new Error('Timeout')));
      resolve();
    });

    await restartProject();
    await EU.wait(500); // Allow initialization

    // Run all test cases
    const testResults = {
      catExists: await testCatExists(),
      horizontalMovement: await testHorizontalMovement(),
      edgeBouncing: await testEdgeBouncing(),
      movementContinuity: await testMovementContinuity(),
      vmExecution: await testVMExecution()
    };

    const results = {
      catExists: testResults.catExists.passed,
      horizontalMovement: testResults.horizontalMovement.passed,
      edgeBouncing: testResults.edgeBouncing.passed,
      movementContinuity: testResults.movementContinuity.passed,
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

    console.log('[Bouncing Cat Manual] Done', payload);
    return payload;
  } catch (err) {
    console.log('[Bouncing Cat Manual] Error:', err.message);
    try { vm.runtime.stopAll(); } catch {}
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();
    throw err;
  }
};