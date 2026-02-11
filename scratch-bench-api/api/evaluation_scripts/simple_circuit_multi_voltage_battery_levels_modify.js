/**
 * Instruction: This is an interactive circuit simulation where users can drag and connect a battery, switch, and lightbulb to complete an electrical circuit. When all components are properly connected and the switch is turned on, the lightbulb illuminates with sound effects. Please add a 'Voltage' variable with discrete levels (3V, 6V). Implement a click handler on the Battery to cycle through levels. When 'ON or OFF' = ON and 'connections complete' = 3, scale the Lightbulb's brightness (brightness effect) according to Voltage level.
 * Unit Test Semantic Goals:
 * 1) Variable 'Voltage' initializes to exactly 3V or 6V.
 * 2) Clicking 'Battery' cycles 'Voltage' between 3V and 6V.
 * 3) Repeated clicks visit both 'Voltage' states.
 * 4) With 'ON or OFF'='ON' and 'connections complete'=3, brightness responds to 'Voltage'.
 * 5) 'Voltage'=6V yields brighter 'Lightbulb' than 3V.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 25);
  const caseTimeoutMs = timeoutSec * 1000;
  const batteryName = (config && config.batterySpriteName) || 'Battery';
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
    const battery = EU.findSprite(vm, batteryName, ['battery', 'power', 'cell']);
    if (!battery) throw new Error('Battery sprite not found');
    return battery;
  };

  const getBulb = () => {
    const bulb = EU.findSprite(vm, bulbName, ['Bulb', 'Lamp', 'lightbulb']);
    if (!bulb) throw new Error('Lightbulb sprite not found');
    return bulb;
  };

  const getBulbBrightness = (bulb) => {
    try {
      // Check brightness effect (0 = brightest, 100 = darkest)
      const brightness = (bulb.effects && typeof bulb.effects.brightness === 'number') ? bulb.effects.brightness : 0;
      return brightness;
    } catch (e) {
      return 0;
    }
  };

  const clickBattery = async (battery) => {
    try {
      // Simulate click on battery sprite
      const clickEvent = {
        isDown: true,
        canvasX: battery.x + 240, // Convert to canvas coordinates
        canvasY: 180 - battery.y,
        target: battery
      };
      
      vm.runtime.targets.forEach(target => {
        if (target === battery) {
          target.blocks.runAllMonitored(target);
        }
      });
      
      // Trigger click event
      vm.runtime.startHats('event_whenthisspriteclicked', null, battery);
      await EU.wait(300); // Allow time for click handler to execute
    } catch (e) {
      console.log(`[Battery Click] Error clicking battery: ${e.message}`);
    }
  };

  const waitForVoltageChange = async (target, expectedValue, maxWaitTime = 1500) => {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      const currentValue = getVar(target, 'Voltage');
      if (currentValue === expectedValue || Number(currentValue) === expectedValue) {
        console.log(`[Voltage Test] Voltage reached expected value: ${expectedValue}`);
        return true;
      }
      await EU.wait(100);
    }
    
    return false;
  };

  // Test case execution function
  const runTest = async (testName, testFn) => {
    console.log(`[Simple Circuit Multi Voltage] Starting ${testName}`);

    const caseResult = await EU.runCaseWithTimeout({
      caseName: testName,
      timeoutMs: caseTimeoutMs,
      beforeCase: async () => {
        try { vm.runtime.stopAll(); } catch (e) {}
        await EU.wait(250);
        EU.startVM(vm);
        await EU.wait(800);
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
      console.log(`[Simple Circuit Multi Voltage] ${testName} ✓ Passed`);
    } else {
      console.log(`[Simple Circuit Multi Voltage] ${testName} ✗ Failed: ${caseResult.error}`);
    }
    return { success: caseResult.passed, error: caseResult.error, result: caseResult.meta };
  };

  // Test 1: Voltage Variable Initialization Test
  const testVoltageInitialization = async () => {
    if (!stage) throw new Error('Stage not found');
    
    const battery = getBattery();
    const bulb = getBulb();
    await EU.wait(1000); // Wait for variable initialization

    // Check for voltage variable on battery or stage
    let voltage = getVar(battery, 'Voltage');
    if (voltage === null) {
      voltage = getVar(stage, 'Voltage');
    }
    
    if (voltage === null) {
      throw new Error('Voltage variable not found on battery or stage');
    }
    
    // Check if voltage is one of the expected values (3 or 6)
    const numVoltage = Number(voltage);
    if (numVoltage !== 3 && numVoltage !== 6) {
      throw new Error(`Invalid voltage value: ${voltage}. Expected 3 or 6.`);
    }
    
    return { initialVoltage: numVoltage };
  };

  // Test 2: Voltage Cycling Test
  const testVoltageCycling = async () => {
    if (!stage) throw new Error('Stage not found');
    
    const battery = getBattery();
    const bulb = getBulb();
    await EU.wait(500);

    // Get initial voltage
    let voltage = getVar(battery, 'Voltage') || getVar(stage, 'Voltage');
    const initialVoltage = Number(voltage);
    
    // Click battery to cycle voltage
    await clickBattery(battery);
    await EU.wait(500);
    
    // Check new voltage
    voltage = getVar(battery, 'Voltage') || getVar(stage, 'Voltage');
    const newVoltage = Number(voltage);
    
    // Voltage should have changed to the other valid value
    const expectedVoltage = initialVoltage === 3 ? 6 : 3;
    if (newVoltage !== expectedVoltage) {
      throw new Error(`Voltage should have changed from ${initialVoltage}V to ${expectedVoltage}V, but got ${newVoltage}V`);
    }
    
    return { initialVoltage, newVoltage };
  };

  // Test 3: Multiple Voltage Levels Test
  const testMultipleVoltageLevels = async () => {
    if (!stage) throw new Error('Stage not found');
    
    const battery = getBattery();
    const bulb = getBulb();
    await EU.wait(500);

    const voltagesEncountered = new Set();
    
    // Record initial voltage
    let voltage = getVar(battery, 'Voltage') || getVar(stage, 'Voltage');
    voltagesEncountered.add(Number(voltage));
    
    // Click battery multiple times to see both voltage levels
    for (let i = 0; i < 3; i++) {
      await clickBattery(battery);
      await EU.wait(400);
      
      voltage = getVar(battery, 'Voltage') || getVar(stage, 'Voltage');
      voltagesEncountered.add(Number(voltage));
    }
    
    // Should have encountered both 3V and 6V
    if (!voltagesEncountered.has(3) || !voltagesEncountered.has(6)) {
      throw new Error(`Should encounter both 3V and 6V, but only found: ${Array.from(voltagesEncountered)}`);
    }
    
    return { voltagesEncountered: Array.from(voltagesEncountered) };
  };

  // Test 4: Brightness Change Test
  const testBrightnessChange = async () => {
    if (!stage) throw new Error('Stage not found');
    
    const battery = getBattery();
    const bulb = getBulb();
    
    // Set circuit to ON and complete
    setVar(stage, 'ON or OFF', 'ON');
    setVar(stage, 'connections complete', 3);
    await EU.wait(500);

    // Get initial voltage and brightness
    let voltage = getVar(battery, 'Voltage') || getVar(stage, 'Voltage');
    const initialVoltage = Number(voltage);
    const initialBrightness = getBulbBrightness(bulb);
    
    // Click battery to change voltage
    await clickBattery(battery);
    await EU.wait(700);
    
    // Get new voltage and brightness
    voltage = getVar(battery, 'Voltage') || getVar(stage, 'Voltage');
    const newVoltage = Number(voltage);
    const newBrightness = getBulbBrightness(bulb);
    
    // Voltage should have changed and brightness should be different
    if (newVoltage === initialVoltage) {
      throw new Error('Voltage should have changed after clicking battery');
    }
    if (newBrightness === initialBrightness) {
      throw new Error('Brightness should have changed when voltage changed');
    }
    
    return { initialVoltage, newVoltage, initialBrightness, newBrightness };
  };

  // Test 5: Voltage-Brightness Correlation Test
  const testVoltageBrightnessCorrelation = async () => {
    if (!stage) throw new Error('Stage not found');
    
    const battery = getBattery();
    const bulb = getBulb();
    
    // Set circuit to ON and complete
    setVar(stage, 'ON or OFF', 'ON');
    setVar(stage, 'connections complete', 3);
    await EU.wait(500);

    const brightnessAtVoltages = {};
    
    // Test brightness at both voltage levels
    for (let targetVoltage of [3, 6]) {
      // Click battery until we get the target voltage
      let attempts = 0;
      let currentVoltage;
      do {
        if (attempts > 0) {
          await clickBattery(battery);
          await EU.wait(400);
        }
        currentVoltage = Number(getVar(battery, 'Voltage') || getVar(stage, 'Voltage'));
        attempts++;
      } while (currentVoltage !== targetVoltage && attempts < 5);
      
      if (currentVoltage === targetVoltage) {
        await EU.wait(500); // Allow brightness to update
        const brightness = getBulbBrightness(bulb);
        brightnessAtVoltages[targetVoltage] = brightness;
      }
    }
    
    // Check if we got readings for both voltages
    if (brightnessAtVoltages[3] === undefined || brightnessAtVoltages[6] === undefined) {
      throw new Error('Could not measure brightness at both voltage levels');
    }
    
    // Higher voltage (6V) should be brighter, meaning LOWER brightness effect value
    // In Scratch: 0=normal, positive=darker, negative=brighter
    // So 6V should have lower brightness effect than 3V (more negative or less positive)
    const brightness3V = brightnessAtVoltages[3];
    const brightness6V = brightnessAtVoltages[6];
    
    if (brightness6V <= brightness3V) {
      throw new Error(`6V should be brighter (lower brightness effect) than 3V. Got 3V=${brightness3V}, 6V=${brightness6V}`);
    }
    
    return { brightness3V, brightness6V };
  };

  try {
    const testResults = [];

    // Test 1: Voltage Variable Initialization Test
    const test1Result = await runTest("Voltage Variable Initialization Test", testVoltageInitialization);
    testResults.push({ name: "Voltage Variable Initialization Test", ...test1Result });

    // Test 2: Voltage Cycling Test
    const test2Result = await runTest("Voltage Cycling Test", testVoltageCycling);
    testResults.push({ name: "Voltage Cycling Test", ...test2Result });

    // Test 3: Multiple Voltage Levels Test
    const test3Result = await runTest("Multiple Voltage Levels Test", testMultipleVoltageLevels);
    testResults.push({ name: "Multiple Voltage Levels Test", ...test3Result });

    // Test 4: Brightness Change Test
    const test4Result = await runTest("Brightness Change Test", testBrightnessChange);
    testResults.push({ name: "Brightness Change Test", ...test4Result });

    // Test 5: Voltage-Brightness Correlation Test
    const test5Result = await runTest("Voltage-Brightness Correlation Test", testVoltageBrightnessCorrelation);
    testResults.push({ name: "Voltage-Brightness Correlation Test", ...test5Result });

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
      console.log(`[Multi Voltage Battery Test] ✓ All tests passed (${passedTests}/${totalTests})`);
    } else {
      console.log(`[Multi Voltage Battery Test] ✗ Some tests failed (${passedTests}/${totalTests})`);
    }

    return payload;

  } catch (err) {
    console.error('[Multi Voltage Battery Test] Error during evaluation:', err);
    const payload = {
      success: false,
      passed_tests: 0,
      total_tests: 4,
      partial_success_rate: 0,
      details: []
    };
    return payload;
  } finally {
    try { vm.runtime.stopAll(); } catch (e) {}
    if (typeof cleanup === 'function') cleanup();
  }
};
