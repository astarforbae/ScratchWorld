/**
 * Instruction: This is an interactive circuit simulation where users can drag and connect a battery, switch, and lightbulb to complete an electrical circuit. When all components are properly connected and the switch is turned on, the lightbulb illuminates with sound effects. But now in this Simple Circuit project, when the Battery is placed at the correct connector position, it does not appear connected to the circuit: the 'connections complete' variable does not increase and the circuit remains incomplete. Please help me fix this issue so that the battery is properly connected to the circuit and the 'connections complete' count increases accordingly.
 * Unit Test Semantic Goals:
 * 1) Placing 'Battery' at correct connector increases 'connections complete'.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;
  const batteryName = (config && config.batterySpriteName) || 'Battery';
  const stage = vm.runtime.getTargetForStage();

  const findVar = (target, name) => {
    if (!target || !target.variables) return null;
    for (const id of Object.keys(target.variables)) {
      const v = target.variables[id];
      if (v && typeof v.name === 'string' && v.name.toLowerCase() === String(name).toLowerCase()) {
        return v;
      }
    }
    return null;
  };

  const getVar = (target, name) => {
    const v = findVar(target, name);
    return v ? v.value : null;
  };

  const setVar = (target, name, value) => {
    const v = findVar(target, name);
    if (!v) throw new Error(`Variable "${name}" not found on target "${target && target.sprite ? target.sprite.name : 'Stage'}"`);
    v.value = value;
    return true;
  };

  const getBattery = () => {
    const battery = EU.findSprite(vm, batteryName, ['battery', 'Battery', 'power', 'Power']);
    if (!battery) throw new Error('Battery sprite not found');
    return battery;
  };

  const moveBatteryToPosition = async (battery, x, y) => {
    battery.setXY(x, y);
    await EU.wait(300); // Allow time for position change to register
  };

  // Test case execution function
  const runTest = async (testName, testFn) => {
    console.log(`[Simple Circuit Battery] Starting ${testName}`);

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
      console.log(`[Simple Circuit Battery] ${testName} ✓ Passed`);
    } else {
      console.log(`[Simple Circuit Battery] ${testName} ✗ Failed: ${caseResult.error}`);
    }
    return { success: caseResult.passed, error: caseResult.error, result: caseResult.meta };
  };

  // Test: Battery Connection Test
  const testBatteryConnection = async () => {
    if (!stage) throw new Error('Stage not found');
    
    const battery = getBattery();
    await EU.wait(300);

    // Record initial connections count
    const initialConnections = getVar(stage, 'connections complete') || 0;
    console.log(`Initial connections: ${initialConnections}`);
    
    // Move battery to the correct terminal position
    const terminalPositions = [
      { x: -180, y: 5 },   // Known correct terminal position
    ];

    // Try each potential terminal position
    for (const pos of terminalPositions) {
      await moveBatteryToPosition(battery, pos.x, pos.y);
      await EU.wait(1000);
      
      const currentConnections = getVar(stage, 'connections complete') || 0;
      console.log(`Current connections: ${currentConnections}`);
      if (currentConnections > initialConnections) {
        console.log(`Found working terminal at (${pos.x}, ${pos.y})`);
        return true;
      }
    }
    
    throw new Error('Battery placement did not increase connections count');
  };

  try {
    const testResults = [];

    // Test 1: Battery Connection Test
    const test1Result = await runTest("Battery Connection Test", testBatteryConnection);
    testResults.push({ name: "Battery Connection Test", ...test1Result });

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
      console.log(`[Battery Connection Test] ✓ All tests passed (${passedTests}/${totalTests})`);
    } else {
      console.log(`[Battery Connection Test] ✗ Some tests failed (${passedTests}/${totalTests})`);
    }

    return payload;

  } catch (err) {
    console.error('[Battery Connection Test] Error during evaluation:', err);
    const payload = {
      success: false,
      passed_tests: 0,
      total_tests: 2,
      partial_success_rate: 0,
      details: []
    };
    return payload;
  } finally {
    try { vm.runtime.stopAll(); } catch (e) {}
    if (typeof cleanup === 'function') cleanup();
  }
};
