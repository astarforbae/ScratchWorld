/**
 * Instruction: This is an interactive circuit simulation where users can drag and connect a battery, a switch, and a lightbulb to complete an electrical circuit. When all components are properly connected and the switch is turned on, the lightbulb illuminates with sound effects. Please add a simple 10-second countdown timer implemented on the Stage. 1. The countdown variable must be named "timeLeft". 2. When the "timeLeft" countdown finishes (reaches 0), stop all scripts.
 * Unit Test Semantic Goals:
 * 1) Stage variable 'timeLeft' initializes at 10 (or immediate 9).
 * 2) 'timeLeft' decreases by 1 roughly every second.
 * 3) Countdown continues until 'timeLeft' reaches exactly 0.
 * 4) When 'timeLeft'=0, all scripts stop.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 30);
  const caseTimeoutMs = timeoutSec * 1000;
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

  const waitForTimerChange = async (expectedValue, maxWaitTime = 2000) => {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      const currentValue = getVar(stage, 'timeLeft');
      if (currentValue === expectedValue) {
        console.log(`[Timer Test] Timer reached expected value: ${expectedValue}`);
        return true;
      }
      await EU.wait(100);
    }
    
    return false;
  };

  // Test case execution function
  const runTest = async (testName, testFn) => {
    console.log(`[Simple Circuit Timer] Starting ${testName}`);

    const caseResult = await EU.runCaseWithTimeout({
      caseName: testName,
      timeoutMs: caseTimeoutMs,
      beforeCase: async () => {
        try { vm.runtime.stopAll(); } catch (e) {}
        await EU.wait(250);
        EU.startVM(vm);
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
      console.log(`[Simple Circuit Timer] ${testName} ✓ Passed`);
    } else {
      console.log(`[Simple Circuit Timer] ${testName} ✗ Failed: ${caseResult.error}`);
    }
    return { success: caseResult.passed, error: caseResult.error, result: caseResult.meta };
  };

  // Test 1: Timer Initialization Test
  const testTimerInitialization = async () => {
    if (!stage) throw new Error('Stage not found');
    
    // Give extra time for variable initialization
    await EU.wait(100);

    const timeLeft = getVar(stage, 'timeLeft');
    if (timeLeft === null || timeLeft === undefined) {
      throw new Error('timeLeft variable not found');
    }
    
    // Check both exact match and numeric equivalence
    const numTimeLeft = Number(timeLeft);
    if (numTimeLeft !== 10 && numTimeLeft !== 9) {
      throw new Error(`timeLeft should start at 10 (or immediately drop to 9), but got: ${timeLeft}`);
    }
    
    return { initialTimeLeft: numTimeLeft };
  };

  // Test 2: Timer Countdown Test
  const testTimerCountdown = async () => {
    if (!stage) throw new Error('Stage not found');
    
    const initialValue = getVar(stage, 'timeLeft');
    if (initialValue === null || initialValue === undefined) {
      throw new Error('timeLeft variable not found');
    }
    
    // Wait for approximately 1 second and check if it decreased
    const decreased = await waitForTimerChange(initialValue - 1, 1500);
    if (!decreased) {
      throw new Error(`Timer should decrease by 1 after 1 second. Started at ${initialValue}`);
    }
    
    return { initialValue, decreasedCorrectly: decreased };
  };

  // Test 3: Timer Continuity Test
  const testTimerContinuity = async () => {
    if (!stage) throw new Error('Stage not found');
    
    const startValue = getVar(stage, 'timeLeft');
    if (startValue === null || startValue === undefined) {
      throw new Error('timeLeft variable not found');
    }
    
    // Wait for 2 more seconds and verify it decreased by 2
    await EU.wait(2500);
    const endValue = getVar(stage, 'timeLeft');
    
    // Should have decreased by approximately 2 (allowing for timing variations)
    const expectedDecrease = 2;
    const actualDecrease = startValue - endValue;
    
    if (Math.abs(actualDecrease - expectedDecrease) > 1) {
      throw new Error(`Timer should decrease by ~2 in 2 seconds. Started at ${startValue}, ended at ${endValue}, decrease: ${actualDecrease}`);
    }
    
    return { startValue, endValue, actualDecrease };
  };

  // Test 4: Timer Stop Test
  const testTimerStop = async () => {
    if (!stage) throw new Error('Stage not found');
    
    // Wait for timer to get close to 0
    let timeLeft = getVar(stage, 'timeLeft');
    while (timeLeft > 2) {
      await EU.wait(500);
      timeLeft = getVar(stage, 'timeLeft');
      if (timeLeft === null || timeLeft === undefined) {
        throw new Error('timeLeft variable disappeared during countdown');
      }
    }

    // Wait for timer to reach 0 and project to stop
    const reachedZero = await waitForTimerChange(0, 3000);
    if (!reachedZero) {
      throw new Error('Timer did not reach 0 within expected time');
    }
    
    // Give a moment for stop all to execute
    await EU.wait(500);
    
    // Check if project stopped (check if timer stops changing)
    const timeLeftBefore = getVar(stage, 'timeLeft');
    await EU.wait(1500);
    const timeLeftAfter = getVar(stage, 'timeLeft');
    
    // If timer stopped changing at 0, the project likely stopped
    if (timeLeftBefore !== 0 || timeLeftAfter !== 0) {
      throw new Error(`Timer should stop at 0. Before: ${timeLeftBefore}, After: ${timeLeftAfter}`);
    }
    
    return { timeLeftBefore, timeLeftAfter, projectStopped: true };
  };

  try {
    const testResults = [];

    // Test 1: Timer Initialization Test
    const test1Result = await runTest("Timer Initialization Test", testTimerInitialization);
    testResults.push({ name: "Timer Initialization Test", ...test1Result });

    // Test 2: Timer Countdown Test
    const test2Result = await runTest("Timer Countdown Test", testTimerCountdown);
    testResults.push({ name: "Timer Countdown Test", ...test2Result });

    // Test 3: Timer Continuity Test
    const test3Result = await runTest("Timer Continuity Test", testTimerContinuity);
    testResults.push({ name: "Timer Continuity Test", ...test3Result });

    // Test 4: Timer Stop Test
    const test4Result = await runTest("Timer Stop Test", testTimerStop);
    testResults.push({ name: "Timer Stop Test", ...test4Result });

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
      console.log(`[Timed Assembly Challenge Test] ✓ All tests passed (${passedTests}/${totalTests})`);
    } else {
      console.log(`[Timed Assembly Challenge Test] ✗ Some tests failed (${passedTests}/${totalTests})`);
    }

    return payload;

  } catch (err) {
    console.error('[Timed Assembly Challenge Test] Error during evaluation:', err);
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
