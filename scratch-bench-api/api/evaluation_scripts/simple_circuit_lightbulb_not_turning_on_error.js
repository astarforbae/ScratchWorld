/**
 * Instruction: This is an interactive circuit simulation where users can drag and connect a battery, switch, and lightbulb to complete an electrical circuit. When all components are properly connected and the switch is turned on, the lightbulb illuminates with sound effects. But now in this Simple Circuit project, even when 'ON or OFF' is ON and 'connections complete' equals 3, the Lightbulb does not turn on and remains in its OFF visual state. Please help me fix this issue so that the lightbulb turns on when the circuit is complete and the switch is ON.
 * Unit Test Semantic Goals:
 * 1) With 'ON or OFF'='ON' and 'connections complete'=3, 'Lightbulb' is ON.
 * 2) With 'ON or OFF'='OFF', 'Lightbulb' stays OFF even at 3 connections.
 * 3) With 'connections complete' < 3, 'Lightbulb' stays OFF.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;
  const bulbName = (config && config.bulbSpriteName) || 'Lightbulb';
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

  const setVar = (target, name, value) => {
    const v = findVar(target, name);
    if (!v) throw new Error(`Variable "${name}" not found on target "${target && target.sprite ? target.sprite.name : 'Stage'}"`);
    v.value = value;
    return true;
  };

  const getBulb = () => {
    const bulb = EU.findSprite(vm, bulbName, ['Bulb', 'Lamp']);
    if (!bulb) throw new Error('Lightbulb sprite not found');
    return bulb;
  };

  const isBulbOn = (bulb) => {
    try {
      const idx = bulb.currentCostume;
      const name = (bulb.sprite && bulb.sprite.costumes && bulb.sprite.costumes[idx] && bulb.sprite.costumes[idx].name) || '';
      const nameLc = String(name).toLowerCase();
      // Heuristic: any costume name containing 'on' indicates ON state
      if (nameLc.includes('on')) return true;
      // Fallback: if ghost effect is very low while ON conditions are met, consider it ON (tolerant)
      const ghost = (bulb.effects && typeof bulb.effects.ghost === 'number') ? bulb.effects.ghost : null;
      if (ghost !== null && ghost <= 20) {
        // Only treat as ON if costume name does not explicitly say 'off'
        if (!nameLc.includes('off')) return true;
      }
    } catch (e) {
      // ignore and treat as OFF
    }
    return false;
  };

  const isBulbOff = (bulb) => {
    try {
      const idx = bulb.currentCostume;
      const name = (bulb.sprite && bulb.sprite.costumes && bulb.sprite.costumes[idx] && bulb.sprite.costumes[idx].name) || '';
      const nameLc = String(name).toLowerCase();
      if (nameLc.includes('off')) return true;
      // If costume name not informative, treat high ghost effect as OFF
      const ghost = (bulb.effects && typeof bulb.effects.ghost === 'number') ? bulb.effects.ghost : null;
      if (ghost !== null && ghost >= 80 && !nameLc.includes('on')) return true;
    } catch (e) {
      // ignore
    }
    return false;
  };

  // Test case execution function
  const runTest = async (testName, testFn) => {
    console.log(`[Simple Circuit Lightbulb] Starting ${testName}`);

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
      console.log(`[Simple Circuit Lightbulb] ${testName} ✓ Passed`);
    } else {
      console.log(`[Simple Circuit Lightbulb] ${testName} ✗ Failed: ${caseResult.error}`);
    }
    return { success: caseResult.passed, error: caseResult.error, result: caseResult.meta };
  };

  // Test 1: Bulb OFF When Incomplete Circuit Test
  const testBulbOffIncompleteCircuit = async () => {
    if (!stage) throw new Error('Stage not found');
    
    const bulb = getBulb();
    await EU.wait(300);

    // Set incomplete circuit conditions
    setVar(stage, 'ON or OFF', 'ON');
    setVar(stage, 'connections complete', 2);
    await EU.wait(800);

    const isOff = isBulbOff(bulb) || !isBulbOn(bulb);
    if (!isOff) throw new Error('Bulb should remain OFF when connections < 3');
    return true;
  };

  // Test 2: Bulb ON When Complete Circuit Test
  const testBulbOnCompleteCircuit = async () => {
    if (!stage) throw new Error('Stage not found');
    
    const bulb = getBulb();
    await EU.wait(300);

    // Set complete circuit conditions
    setVar(stage, 'ON or OFF', 'ON');
    setVar(stage, 'connections complete', 3);
    await EU.wait(800);

    const isOn = isBulbOn(bulb);
    if (!isOn) throw new Error('Bulb should turn ON when ON=ON and connections=3');
    return true;
  };

  // Test 3: Bulb OFF When Switch OFF Test
  const testBulbOffSwitchOff = async () => {
    if (!stage) throw new Error('Stage not found');
    
    const bulb = getBulb();
    await EU.wait(300);

    // Set switch OFF conditions
    setVar(stage, 'ON or OFF', 'OFF');
    setVar(stage, 'connections complete', 3);
    await EU.wait(800);

    const isOff = isBulbOff(bulb) || !isBulbOn(bulb);
    if (!isOff) throw new Error('Bulb should remain OFF when switch is OFF');
    return true;
  };

  try {
    const testResults = [];

    // Test 1: Bulb OFF When Incomplete Circuit Test
    const test1Result = await runTest("Bulb OFF When Incomplete Circuit Test", testBulbOffIncompleteCircuit);
    testResults.push({ name: "Bulb OFF When Incomplete Circuit Test", ...test1Result });

    // Test 2: Bulb ON When Complete Circuit Test
    const test2Result = await runTest("Bulb ON When Complete Circuit Test", testBulbOnCompleteCircuit);
    testResults.push({ name: "Bulb ON When Complete Circuit Test", ...test2Result });

    // Test 3: Bulb OFF When Switch OFF Test
    const test3Result = await runTest("Bulb OFF When Switch OFF Test", testBulbOffSwitchOff);
    testResults.push({ name: "Bulb OFF When Switch OFF Test", ...test3Result });

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
      console.log(`[Lightbulb Test] ✓ All tests passed (${passedTests}/${totalTests})`);
    } else {
      console.log(`[Lightbulb Test] ✗ Some tests failed (${passedTests}/${totalTests})`);
    }

    return payload;

  } catch (err) {
    console.error('[Lightbulb Test] Error during evaluation:', err);
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
