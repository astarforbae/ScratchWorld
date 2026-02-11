/**
 * Instruction: Create an interactive circuit simulation where users can drag and connect a battery, switch, and lightbulb to complete an electrical circuit. Modify blocks so that when the components are correctly connected and the switch is turned on, the lightbulb lights up and then gradually decreases in brightness over time. Ensure that turning the switch off and then back on resets the lightbulb to its normal brightness level.
 * Unit Test Semantic Goals:
 * 1) With complete circuit and switch ON, 'Lightbulb' brightness decreases over time.
 * 2) Turning switch OFF then ON resets 'Lightbulb' to initial brightness.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 5);
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

  const setVarIfPresent = (target, name, value) => {
    const v = findVar(target, name);
    if (!v) return false;
    v.value = value;
    return true;
  };

  const getBulb = () => {
    const bulb = EU.findSprite(vm, bulbName, ['Bulb', 'Lamp', 'lightbulb']);
    if (!bulb) throw new Error('Lightbulb sprite not found');
    return bulb;
  };

  const getBulbBrightness = (bulb) => {
    try {
      // Brightness effect: positive = brighter, negative = dimmer/darker (0 = normal)
      const brightness = (bulb.effects && typeof bulb.effects.brightness === 'number') ? bulb.effects.brightness : 0;
      console.log(`[DEBUG] getBulbBrightness: ${brightness}`);
      return brightness;
    } catch (e) {
      console.log('[DEBUG] getBulbBrightness: error', e);
      return 0;
    }
  };

  const bulbLooksOn = (bulb) => {
    try {
      const idx = bulb.currentCostume;
      const name = (bulb.sprite && bulb.sprite.costumes && bulb.sprite.costumes[idx] && bulb.sprite.costumes[idx].name) || '';
      const nameLc = String(name).toLowerCase();
      console.log(`[DEBUG] bulbLooksOn: costume name="${name}", includes('on')=${nameLc.includes('on')}`);
      if (nameLc.includes('on')) return true;
    } catch (e) {
      console.log('[DEBUG] bulbLooksOn: error checking costume', e);
    }
    // Fallback: a relatively bright bulb is considered ON
    const brightness = getBulbBrightness(bulb);
    const isOn = brightness < 80;
    console.log(`[DEBUG] bulbLooksOn: brightness=${brightness}, isOn=${isOn}`);
    return isOn;
  };

  const turnCircuitOn = async () => {
    setVarIfPresent(stage, 'ON or OFF', 'ON');
    setVarIfPresent(stage, 'connections complete', 3);
    await EU.wait(100);
  };

  const turnCircuitOff = async () => {
    setVarIfPresent(stage, 'ON or OFF', 'OFF');
    await EU.wait(100);
  };

  const waitForBulbOn = async (bulb, maxWaitMs = 1200) => {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (bulbLooksOn(bulb)) return true;
      await EU.wait(120);
    }
    throw new Error('Lightbulb did not turn on after enabling the circuit');
  };

  // Test case execution function with per-case timeout
  const runTest = async (testName, testFn) => {
    console.log(`[Simple Circuit Brightness] Starting ${testName}`);

    const caseResult = await EU.runCaseWithTimeout({
      caseName: testName,
      timeoutMs: caseTimeoutMs,
      beforeCase: async () => {
        try { vm.runtime.stopAll(); } catch (e) {}
        await EU.wait(200);
        EU.startVM(vm);
        await EU.wait(500);
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
      console.log(`[Simple Circuit Brightness] ${testName} ✓ Passed`);
    } else {
      console.log(`[Simple Circuit Brightness] ${testName} ✗ Failed: ${caseResult.error}`);
    }
    return { success: caseResult.passed, error: caseResult.error, result: caseResult.meta };
  };

  // Test 1: Brightness Decrease Test
  const testBrightnessDecrease = async () => {
    if (!stage) throw new Error('Stage not found');

    const bulb = getBulb();
    console.log('[DEBUG] Test 1: Starting Brightness Decrease Test');

    await turnCircuitOn();
    console.log('[DEBUG] Test 1: Circuit turned ON');
    
    await waitForBulbOn(bulb);
    console.log('[DEBUG] Test 1: Bulb is ON');

    const samples = [];
    const initialBrightness = getBulbBrightness(bulb);
    samples.push({ t: 0, brightness: initialBrightness });
    console.log(`[DEBUG] Test 1: Initial brightness = ${initialBrightness}`);
    
    for (let i = 1; i <= 3; i++) {
      await EU.wait(1000);
      const currentBrightness = getBulbBrightness(bulb);
      samples.push({ t: i * 1000, brightness: currentBrightness });
      console.log(`[DEBUG] Test 1: Sample ${i} (t=${i * 1000}ms): brightness = ${currentBrightness}`);
    }

    const finalBrightness = samples[samples.length - 1].brightness;
    const delta = finalBrightness - initialBrightness;
    console.log(`[DEBUG] Test 1: Final brightness = ${finalBrightness}, delta = ${delta}`);
    console.log(`[DEBUG] Test 1: All samples:`, JSON.stringify(samples));
    
    // Expect brightness effect to decrease (become more negative), making the bulb dimmer/darker
    if (delta >= -1) {
      throw new Error(`Bulb brightness did not decrease after being turned on. Initial: ${initialBrightness}, Final: ${finalBrightness}, Delta: ${delta} (expected negative delta)`);
    }

    return { samples, delta };
  };

  // Test 2: Brightness Recovery Test
  const testBrightnessRecovery = async () => {
    if (!stage) throw new Error('Stage not found');

    const bulb = getBulb();
    console.log('[DEBUG] Test 2: Starting Brightness Recovery Test');

    await turnCircuitOn();
    await waitForBulbOn(bulb);
    const firstInitial = getBulbBrightness(bulb);
    console.log(`[DEBUG] Test 2: First activation initial brightness = ${firstInitial}`);

    // Let brightness degrade for a moment
    await EU.wait(1500);
    const degraded = getBulbBrightness(bulb);
    console.log(`[DEBUG] Test 2: After degradation brightness = ${degraded}`);

    await turnCircuitOff();
    console.log('[DEBUG] Test 2: Circuit turned OFF');
    await EU.wait(300);

    await turnCircuitOn();
    console.log('[DEBUG] Test 2: Circuit turned ON again');
    await waitForBulbOn(bulb);
    const secondInitial = getBulbBrightness(bulb);
    console.log(`[DEBUG] Test 2: Second activation initial brightness = ${secondInitial}`);

    const delta = Math.abs(secondInitial - firstInitial);
    console.log(`[DEBUG] Test 2: Delta between first and second initial = ${delta}`);
    
    if (delta > 2) {
      throw new Error(`Bulb did not reset to the same initial brightness on reactivation. First: ${firstInitial}, Second: ${secondInitial}, Delta: ${delta}`);
    }

    return { firstInitial, secondInitial, delta };
  };

  try {
    const testResults = [];

    const test1Result = await runTest('Brightness Decrease Test', testBrightnessDecrease);
    testResults.push({ name: 'Brightness Decrease Test', ...test1Result });

    const test2Result = await runTest('Brightness Recovery Test', testBrightnessRecovery);
    testResults.push({ name: 'Brightness Recovery Test', ...test2Result });

    const passedTests = testResults.filter(result => result.success).length;
    const totalTests = testResults.length;
    const allPassed = passedTests === totalTests;

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
      console.log(`[Variable Brightness Test] ✓ All tests passed (${passedTests}/${totalTests})`);
    } else {
      console.log(`[Variable Brightness Test] ✗ Some tests failed (${passedTests}/${totalTests})`);
    }

    return payload;

  } catch (err) {
    console.error('[Variable Brightness Test] Error during evaluation:', err);
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
