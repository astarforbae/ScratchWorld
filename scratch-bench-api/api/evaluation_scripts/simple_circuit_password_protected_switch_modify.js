/**
 * Instruction: This is an interactive circuit simulation where users can drag and connect a battery, switch, and lightbulb to complete an electrical circuit. When all components are properly connected and the switch is turned on, the lightbulb illuminates with sound effects. Please modify the switch behavior so that when clicked, it prompts for a password saying: 'What is the password?'. Set a fixed password ('1234'). Only if the entered password matches exactly and circuit is complete (connections complete = 3) should the switch turn ON. If the password is wrong, the switch should remain OFF. The switch should still be able to turn OFF normally without requiring a password.
 * Unit Test Semantic Goals:
 * 1) Clicking OFF 'Switch' prompts exactly 'What is the password?'.
 * 2) Password '1234' turns 'Switch' ON only when 'connections complete'=3.
 * 3) Wrong password keeps 'Switch' OFF.
 * 4) Clicking ON 'Switch' turns it OFF without password prompt.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 25);
  const caseTimeoutMs = timeoutSec * 1000;
  const switchName = (config && config.switchSpriteName) || 'Switch';
  const stage = vm.runtime.getTargetForStage();
  
  // Global password prompt detection
  let promptDetected = false;

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

  const getSwitch = () => {
    const switchSprite = EU.findSprite(vm, switchName, ['switch', 'Switch', 'button']);
    if (!switchSprite) throw new Error('Switch sprite not found');
    return switchSprite;
  };

  // Global SAY event listener for password prompts
  const globalPasswordHandler = (target, type, text) => {
    try {
      console.log(`[Password Test] SAY event: "${text}"`);
      
      if (text.toLowerCase().includes('password') && text.includes('?')) {
        console.log('[Password Test] Password prompt detected globally');
        promptDetected = true;
      }
    } catch (e) {
      // ignore
    }
  };

  const clickSwitch = async (switchSprite) => {
    // Trigger "when this sprite clicked" event
    vm.runtime.startHats('event_whenthisspriteclicked', null, switchSprite);
    await EU.wait(200);
  };

  const waitForPasswordPrompt = async (maxWaitTime = 5000) => {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      if (promptDetected) {
        return true;
      }
      await EU.wait(100);
    }
    
    return false;
  };

  const consumePromptDetection = () => {
    const wasDetected = promptDetected;
    promptDetected = false; // Reset for next test
    return wasDetected;
  };

  const answerPassword = async (password) => {
    console.log(`[Password Test] Answering with password: "${password}"`);
    vm.runtime.emit('ANSWER', password);
    await EU.wait(500);
  };

  // Test case execution function
  const runTest = async (testName, testFn) => {
    console.log(`[Simple Circuit Password] Starting ${testName}`);

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
      console.log(`[Simple Circuit Password] ${testName} ✓ Passed`);
    } else {
      console.log(`[Simple Circuit Password] ${testName} ✗ Failed: ${caseResult.error}`);
    }
    return { success: caseResult.passed, error: caseResult.error, result: caseResult.meta };
  };

  // Test 1: Password Prompt Test
  const testPasswordPrompt = async () => {
    if (!stage) throw new Error('Stage not found');
    
    const switchSprite = getSwitch();
    
    // Set up global password prompt listener
    vm.runtime.on('SAY', globalPasswordHandler);
    
    // Ensure switch starts in OFF state
    setVar(stage, 'ON or OFF', 'OFF');
    await EU.wait(300);

    // Reset prompt detection before test
    promptDetected = false;
    
    // Click the switch
    await clickSwitch(switchSprite);
    
    // Wait for password prompt
    const detected = await waitForPasswordPrompt();
    
    // Clean up listener
    try { vm.runtime.off('SAY', globalPasswordHandler); } catch {}
    
    if (!detected) {
      throw new Error('Switch should prompt for password when clicked');
    }
    
    return { promptDetected: detected };
  };

  // Test 2: Correct Password Test
  const testCorrectPassword = async () => {
    if (!stage) throw new Error('Stage not found');
    
    const switchSprite = getSwitch();
    
    // Set up global password prompt listener
    vm.runtime.on('SAY', globalPasswordHandler);
    
    // Ensure switch starts in OFF state and circuit is complete
    setVar(stage, 'ON or OFF', 'OFF');
    setVar(stage, 'connections complete', 3);
    await EU.wait(300);

    // Reset prompt detection before test
    promptDetected = false;
    
    // Click the switch
    await clickSwitch(switchSprite);
    
    // Wait for prompt and answer with correct password
    const detected = await waitForPasswordPrompt();
    if (!detected) {
      // Clean up listener
      try { vm.runtime.off('SAY', globalPasswordHandler); } catch {}
      throw new Error('No password prompt detected');
    }
    
    // Consume the prompt detection
    consumePromptDetection();
    
    await answerPassword('1234');
    
    // Check if switch turned ON
    await EU.wait(1000); // Wait for switch to process password
    const switchState = getVar(stage, 'ON or OFF');
    
    // Clean up listener
    try { vm.runtime.off('SAY', globalPasswordHandler); } catch {}
    
    if (switchState !== 'ON') {
      throw new Error(`Switch should turn ON with correct password, but state is: ${switchState}`);
    }
    
    return { switchState };
  };

  // Test 3: Incorrect Password Test
  const testIncorrectPassword = async () => {
    if (!stage) throw new Error('Stage not found');
    
    const switchSprite = getSwitch();
    
    // Set up global password prompt listener
    vm.runtime.on('SAY', globalPasswordHandler);
    
    // Ensure switch starts in OFF state
    setVar(stage, 'ON or OFF', 'OFF');
    await EU.wait(300);

    // Reset prompt detection before test
    promptDetected = false;
    
    // Click the switch
    await clickSwitch(switchSprite);
    
    // Wait for prompt and answer with incorrect password
    const detected = await waitForPasswordPrompt();
    if (!detected) {
      // Clean up listener
      try { vm.runtime.off('SAY', globalPasswordHandler); } catch {}
      throw new Error('No password prompt detected');
    }
    
    // Consume the prompt detection
    consumePromptDetection();
    
    await answerPassword('wrong');
    
    // Check if switch remained OFF
    await EU.wait(1000); // Wait for switch to process password
    const switchState = getVar(stage, 'ON or OFF');
    
    // Clean up listener
    try { vm.runtime.off('SAY', globalPasswordHandler); } catch {}
    
    if (switchState !== 'OFF') {
      throw new Error(`Switch should remain OFF with incorrect password, but state is: ${switchState}`);
    }
    
    return { switchState };
  };

  // Test 4: No Password OFF Test
  const testNoPasswordOff = async () => {
    if (!stage) throw new Error('Stage not found');
    
    const switchSprite = getSwitch();
    
    // Set switch to ON state first
    setVar(stage, 'ON or OFF', 'ON');
    await EU.wait(300);

    const initialState = getVar(stage, 'ON or OFF');
    
    // Click the switch to turn it OFF
    await clickSwitch(switchSprite);
    
    // Wait a moment for the switch to react
    await EU.wait(1000);
    
    // Check if switch turned OFF without password prompt
    const finalState = getVar(stage, 'ON or OFF');
    
    // Should turn OFF without requiring password
    if (finalState !== 'OFF') {
      throw new Error(`Switch should turn OFF without password, but state is: ${finalState}`);
    }
    
    return { initialState, finalState };
  };

  try {
    const testResults = [];

    // Test 1: Password Prompt Test
    const test1Result = await runTest("Password Prompt Test", testPasswordPrompt);
    testResults.push({ name: "Password Prompt Test", ...test1Result });

    // Test 2: Correct Password Test
    const test2Result = await runTest("Correct Password Test", testCorrectPassword);
    testResults.push({ name: "Correct Password Test", ...test2Result });

    // Test 3: Incorrect Password Test
    const test3Result = await runTest("Incorrect Password Test", testIncorrectPassword);
    testResults.push({ name: "Incorrect Password Test", ...test3Result });

    // Test 4: No Password OFF Test
    const test4Result = await runTest("No Password OFF Test", testNoPasswordOff);
    testResults.push({ name: "No Password OFF Test", ...test4Result });

    // Calculate results
    const passedTests = testResults.filter(result => result.success).length;
    const totalTests = testResults.length;
    const allPassed = passedTests === totalTests;
    const successRate = totalTests > 0 ? (passedTests / totalTests) * 100 : 0;

    // Stop VM and clear timeout
    try { vm.runtime.stopAll(); } catch {}
    // Clean up global listener
    try { vm.runtime.off('SAY', globalPasswordHandler); } catch {}

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
      console.log(`[Password Protected Switch Test] ✓ All tests passed (${passedTests}/${totalTests})`);
    } else {
      console.log(`[Password Protected Switch Test] ✗ Some tests failed (${passedTests}/${totalTests})`);
    }

    return payload;

  } catch (err) {
    console.error('[Password Protected Switch Test] Error during evaluation:', err);
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
    // Clean up global listener
    try { vm.runtime.off('SAY', globalPasswordHandler); } catch {}
    if (typeof cleanup === 'function') cleanup();
  }
};
