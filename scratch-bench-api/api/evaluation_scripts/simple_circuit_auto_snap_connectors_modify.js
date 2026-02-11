/**
 * Instruction: This is an interactive circuit simulation where users can drag and connect a battery, switch, and lightbulb to complete an electrical circuit. When all components are properly connected and the switch is turned on, the lightbulb illuminates with sound effects. Please add a functionality that when the Battery sprite is dragged close to the terminal position (-180, 5), it automatically glides to that exact position. The snapping should occur when the Battery is within a Manhattan distance of 50 from the target position (|x - (-180)| + |y - 5| < 50).
 * Unit Test Semantic Goals:
 * 1) 'Battery' within Manhattan distance < 50 of (-180, 5) snaps.
 * 2) Snapped 'Battery' lands exactly at terminal position (-180, 5).
 * 3) At Manhattan distance >= 50, 'Battery' does not auto-snap.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;
  const batteryName = (config && config.batterySpriteName) || 'Battery';
  const targetX = -180;
  const targetY = 5;
  const snapThreshold = 50; // Manhattan distance threshold

  const getBattery = () => {
    const battery = EU.findSprite(vm, batteryName, ['battery', 'Battery', 'power', 'Power']);
    if (!battery) throw new Error('Battery sprite not found');
    return battery;
  };

  const moveBatteryToPosition = async (battery, x, y) => {
    battery.setXY(x, y);
    await EU.wait(300); // Allow time for position change to register
  };

  const calculateManhattanDistance = (x1, y1, x2, y2) => {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
  };

  const waitForBatteryToSnap = async (battery, maxWaitTime = 3000) => {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      const currentPos = EU.getSpritePosition(battery);
      const distanceToTarget = calculateManhattanDistance(currentPos.x, currentPos.y, targetX, targetY);
      
      // Check if battery has snapped to target position (within 5 pixels tolerance)
      if (distanceToTarget <= 5) {
        console.log(`[Auto Snap Test] Battery snapped to target! Position: (${currentPos.x}, ${currentPos.y})`);
        return true;
      }
      
      await EU.wait(100);
    }
    
    return false;
  };

  // Test case execution function
  const runTest = async (testName, testFn) => {
    console.log(`[Simple Circuit Auto Snap] Starting ${testName}`);

    const caseResult = await EU.runCaseWithTimeout({
      caseName: testName,
      timeoutMs: caseTimeoutMs,
      beforeCase: async () => {
        try { vm.runtime.stopAll(); } catch (e) {}
        await EU.wait(250);
        EU.startVM(vm);
        await EU.wait(600);
      },
      run: async () => {
        const result = await testFn();
        return {
          passed: true,
          meta: result && typeof result === 'object' ? result : {},
        };
      },
      afterCase: async () => {
        try { vm.runtime.stopAll(); } catch (e) {}
      },
    });

    if (caseResult.passed) {
      console.log(`[Simple Circuit Auto Snap] ${testName} ✓ Passed`);
    } else {
      console.log(`[Simple Circuit Auto Snap] ${testName} ✗ Failed: ${caseResult.error}`);
    }
    return { success: caseResult.passed, error: caseResult.error, result: caseResult.meta };
  };

  // Test 1: Battery Snap Within Threshold Test
  const testBatterySnapWithinThreshold = async () => {
    const battery = getBattery();
    await EU.wait(300);

    // Place battery within Manhattan distance of 50
    await moveBatteryToPosition(battery, -160, 15); // Distance = 30
    console.log('Placed battery at (-160, 15), Manhattan distance: 30');
    await EU.wait(1000);

    // Wait for snapping to occur
    const snapped = await waitForBatteryToSnap(battery);
    if (!snapped) throw new Error('Battery did not snap to target within threshold');
    return true;
  };

  // Test 2: Battery No Snap At Boundary Test
  const testBatteryNoSnapAtBoundary = async () => {
    const battery = getBattery();
    await EU.wait(300);

    // Place battery exactly at Manhattan distance of 50
    await moveBatteryToPosition(battery, -155, 30); // Distance = 50
    console.log('Placed battery at (-155, 30), Manhattan distance: 50');
    await EU.wait(2000);

    const finalPos = EU.getSpritePosition(battery);
    const distanceToTarget = calculateManhattanDistance(finalPos.x, finalPos.y, targetX, targetY);
    console.log(`Final distance from target: ${distanceToTarget}`);
    
    // Battery should not have snapped (distance should still be >= 50)
    if (distanceToTarget < 50) throw new Error('Battery incorrectly snapped at boundary');
    return true;
  };

  // Test 3: Battery No Snap Outside Threshold Test
  const testBatteryNoSnapOutsideThreshold = async () => {
    const battery = getBattery();
    await EU.wait(300);

    // Place battery just outside Manhattan distance of 50
    await moveBatteryToPosition(battery, -154, 30); // Distance = 51
    console.log('Placed battery at (-154, 30), Manhattan distance: 51');
    await EU.wait(2000);

    const finalPos = EU.getSpritePosition(battery);
    const distanceToTarget = calculateManhattanDistance(finalPos.x, finalPos.y, targetX, targetY);
    console.log(`Final distance from target: ${distanceToTarget}`);
    
    // Battery should not have snapped (distance should still be > 50)
    if (distanceToTarget <= 50) throw new Error('Battery incorrectly snapped outside threshold');
    return true;
  };

  // Test 4: Battery Gradual Movement Snap Test
  const testBatteryGradualMovementSnap = async () => {
    const battery = getBattery();
    await EU.wait(300);

    // Start outside snap zone
    await moveBatteryToPosition(battery, -100, 50); // Distance = 125
    await EU.wait(500);
    
    // Move closer, still outside
    await moveBatteryToPosition(battery, -140, 25); // Distance = 60
    await EU.wait(500);
    
    // Move into snap zone
    await moveBatteryToPosition(battery, -165, 15); // Distance = 25
    console.log('Moved battery into snap zone at (-165, 15), Manhattan distance: 25');
    await EU.wait(1000);

    // Wait for snapping to occur
    const snapped = await waitForBatteryToSnap(battery);
    if (!snapped) throw new Error('Battery did not snap when moved gradually into zone');
    return true;
  };

  try {
    const testResults = [];

    // Test 1: Battery Snap Within Threshold Test
    const test1Result = await runTest("Battery Snap Within Threshold Test", testBatterySnapWithinThreshold);
    testResults.push({ name: "Battery Snap Within Threshold Test", ...test1Result });

    // Test 2: Battery No Snap At Boundary Test
    const test2Result = await runTest("Battery No Snap At Boundary Test", testBatteryNoSnapAtBoundary);
    testResults.push({ name: "Battery No Snap At Boundary Test", ...test2Result });

    // Test 3: Battery No Snap Outside Threshold Test
    const test3Result = await runTest("Battery No Snap Outside Threshold Test", testBatteryNoSnapOutsideThreshold);
    testResults.push({ name: "Battery No Snap Outside Threshold Test", ...test3Result });

    // Test 4: Battery Gradual Movement Snap Test
    const test4Result = await runTest("Battery Gradual Movement Snap Test", testBatteryGradualMovementSnap);
    testResults.push({ name: "Battery Gradual Movement Snap Test", ...test4Result });

    // Calculate results
    const passedTests = testResults.filter(result => result.success).length;
    const totalTests = testResults.length;
    const allPassed = passedTests === totalTests;
    const successRate = totalTests > 0 ? (passedTests / totalTests) * 100 : 0;

    // Stop VM and clear timeout
    try { vm.runtime.stopAll(); } catch {}
    if (typeof cleanup === 'function') cleanup();

    const payload = {
      success: allPassed,
      passed_tests: passedTests,
      total_tests: totalTests,
      partial_success_rate: totalTests > 0 ? passedTests / totalTests : 0,
      details: testResults.map(result => ({
        name: result.name,
        passed: result.success
      }))
    };

    if (allPassed) {
      console.log(`[Auto Snap Connectors Test] ✓ All tests passed (${passedTests}/${totalTests})`);
    } else {
      console.log(`[Auto Snap Connectors Test] ✗ Some tests failed (${passedTests}/${totalTests})`);
    }

    return payload;

  } catch (err) {
    console.error('[Auto Snap Connectors Test] Error during evaluation:', err);
    const payload = {
      success: false,
      passed_tests: 0,
      total_tests: 3,
      partial_success_rate: 0,
      details: []
    };
    return payload;
  } finally {
    try { vm.runtime.stopAll(); } catch (e) {}
    if (typeof cleanup === 'function') cleanup();
  }
};
