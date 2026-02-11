/**
 * Instruction: This is an interactive circuit simulation where users can drag and connect a battery, switch, and lightbulb to complete an electrical circuit. When all components are properly connected and the switch is turned on, the lightbulb illuminates with sound effects. But now in this Simple Circuit project, the Switch turns on but immediately flips back OFF even when the circuit is complete (connections complete = 3). Please help me fix this issue so that the Switch turns ON when the circuit is complete and the lightbulb illuminates with sound effects.
 * Unit Test Semantic Goals:
 * 1) With 'connections complete' < 3, 'Switch' cannot stay ON.
 * 2) With 'connections complete'=3, 'Switch' stays ON after delay.
 * 3) Clicking ON 'Switch' toggles it back OFF.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 25);
  const caseTimeoutMs = timeoutSec * 1000;
  const stage = vm.runtime.getTargetForStage();
  const switchSpriteName = (config && config.switchSpriteName) || 'Switch';

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

  const setVar = (target, name, value) => {
    const v = findVar(target, name);
    if (!v) throw new Error(`Variable "${name}" not found on target "${target && target.sprite ? target.sprite.name : 'Stage'}"`);
    v.value = value;
    return true;
  };

  const getVarValue = (target, name) => {
    const v = findVar(target, name);
    return v ? v.value : undefined;
  };

  const getSwitch = () => {
    const sw = EU.findSprite(vm, switchSpriteName, ['Switch', 'Button', 'Toggle']);
    if (!sw) throw new Error('Switch sprite not found');
    return sw;
  };

  const isSwitchCostumeOn = (sw) => {
    try {
      const idx = sw.currentCostume;
      const name = (sw.sprite && sw.sprite.costumes && sw.sprite.costumes[idx] && sw.sprite.costumes[idx].name) || '';
      const nameLc = String(name).toLowerCase();
      if (nameLc.includes('on')) return true;
      const ghost = (sw.effects && typeof sw.effects.ghost === 'number') ? sw.effects.ghost : null;
      if (ghost !== null && ghost <= 20 && !nameLc.includes('off')) return true;
    } catch (e) {}
    return false;
  };

  const isSwitchOn = (sw) => {
    // Prefer stage variable if present
    const val = getVarValue(stage, 'ON or OFF');
    if (typeof val !== 'undefined' && val !== null) {
      const s = String(val).toLowerCase();
      if (s === 'on') return true;
      if (s === 'off') return false;
    }
    // Fallback to switch costume heuristic
    return isSwitchCostumeOn(sw);
  };

  const clickSwitch = async (sw, options = {}) => {
    // Prefer directly triggering the Scratch hat for "when this sprite clicked"
    try {
      vm.runtime.startHats('event_whenthisspriteclicked', null, sw);
      await EU.wait(options.postDelayMs || 120);
      return;
    } catch (e) {
      // Fallback: simulate a physical mouse click on the sprite position
      const x = sw.x;
      const y = sw.y;
      EU.simulateMouseMove(vm, x, y);
      await EU.wait(options.preDelayMs || 50);
      EU.simulateMouseDown(vm, x, y);
      await EU.wait(options.downMs || 80);
      EU.simulateMouseUp(vm);
      await EU.wait(options.postDelayMs || 120);
    }
  };

  // Test case execution function
  const runTest = async (testName, testFn) => {
    console.log(`[Simple Circuit Switch] Starting ${testName}`);

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
      console.log(`[Simple Circuit Switch] ${testName} ✓ Passed`);
    } else {
      console.log(`[Simple Circuit Switch] ${testName} ✗ Failed: ${caseResult.error}`);
    }
    return { success: caseResult.passed, error: caseResult.error, result: caseResult.meta };
  };

  // Test 1: Incomplete Circuit Test
  const testIncompleteCircuit = async () => {
    if (!stage) throw new Error('Stage not found');
    
    const sw = getSwitch();
    await EU.wait(250);

    // Ensure circuit incomplete
    try { setVar(stage, 'connections complete', 2); } catch (e) {}
    try { setVar(stage, 'ON or OFF', 'OFF'); } catch (e) {}
    await EU.wait(200);

    await clickSwitch(sw);
    await EU.wait(700);

    const onNow = isSwitchOn(sw);
    // Accept either OFF or briefly ON then OFF; final should be OFF
    if (onNow !== false) {
      throw new Error('Incomplete circuit should prevent switch from staying ON');
    }
    
    return { switchState: onNow };
  };

  // Test 2: Complete Circuit Persistence Test
  const testCompleteCircuitPersistence = async () => {
    if (!stage) throw new Error('Stage not found');
    
    const sw = getSwitch();
    await EU.wait(250);
    
    try { setVar(stage, 'connections complete', 3); } catch (e) {}
    try { setVar(stage, 'ON or OFF', 'OFF'); } catch (e) {}
    await EU.wait(200);

    await clickSwitch(sw);

    // Immediate check (after short delay)
    await EU.wait(200);
    const onAfterClick = isSwitchOn(sw);

    // Persist check after 1.2s more
    await EU.wait(1200);
    const onAfterDelay = isSwitchOn(sw);

    if (onAfterClick !== true) {
      throw new Error('Switch should turn ON immediately when circuit is complete');
    }
    if (onAfterDelay !== true) {
      throw new Error('Switch should stay ON for extended period when circuit is complete');
    }
    
    return { onAfterClick, onAfterDelay };
  };

  // Test 3: Toggle OFF Test
  const testToggleOff = async () => {
    if (!stage) throw new Error('Stage not found');
    
    const sw = getSwitch();
    await EU.wait(250);
    
    try { setVar(stage, 'connections complete', 3); } catch (e) {}
    try { setVar(stage, 'ON or OFF', 'OFF'); } catch (e) {}
    await EU.wait(150);

    // Turn ON
    await clickSwitch(sw);
    await EU.wait(250);
    const onNow = isSwitchOn(sw);

    // Toggle OFF
    await clickSwitch(sw);
    await EU.wait(400);
    const onAfterToggle = isSwitchOn(sw);

    if (onNow !== true) {
      throw new Error('Switch should turn ON first');
    }
    if (onAfterToggle !== false) {
      throw new Error('Switch should toggle OFF when clicked again');
    }
    
    return { onNow, onAfterToggle };
  };

  try {
    const testResults = [];

    // Test 1: Incomplete Circuit Test
    const test1Result = await runTest("Incomplete Circuit Test", testIncompleteCircuit);
    testResults.push({ name: "Incomplete Circuit Test", ...test1Result });

    // Test 2: Complete Circuit Persistence Test
    const test2Result = await runTest("Complete Circuit Persistence Test", testCompleteCircuitPersistence);
    testResults.push({ name: "Complete Circuit Persistence Test", ...test2Result });

    // Test 3: Toggle OFF Test
    const test3Result = await runTest("Toggle OFF Test", testToggleOff);
    testResults.push({ name: "Toggle OFF Test", ...test3Result });

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
      console.log(`[Switch Immediate Turn Off Test] ✓ All tests passed (${passedTests}/${totalTests})`);
    } else {
      console.log(`[Switch Immediate Turn Off Test] ✗ Some tests failed (${passedTests}/${totalTests})`);
    }

    return payload;

  } catch (err) {
    console.error('[Switch Immediate Turn Off Test] Error during evaluation:', err);
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
