/**
 * Instruction: This is an interactive coordinate reporting tool where a sprite displays its current X and Y position on screen. Users can drag the sprite around or use input prompts to move it by specific amounts, with real-time coordinate feedback and mode switching between drag and input modes. But now the Input Numbers button (the 'Button' sprite) disappears when clicked and doesn't reappear, fix this issue so users can switch modes seamlessly.
 * Unit Test Semantic Goals:
 * 1) 'Button' ('Input Numbers') is visible when drag mode starts.
 * 2) Clicking 'Button' enters input mode and hides 'Button'.
 * 3) After input sequence completion, 'Button' becomes visible again.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const caseTimeoutMs = (config && config.timeout ? config.timeout : 25) * 1000;
  const buttonName = (config && config.buttonSpriteName) || 'Input Numbers';
  const buttonFallbacks = ['Input', 'Button', 'Input Button', 'Enter Numbers', 'Numbers'];
  const stage = vm.runtime.getTargetForStage();

  // Global input handling state
  let listeningForInput = false;
  let promptCount = 0;
  let lastPromptTime = 0;
  let answerIndex = 0;
  const answerSequence = (config && config.answers) || ['10', '20', '0'];

  const restartProject = async () => {
    try { vm.runtime.stopAll(); } catch (e) {}
    EU.startVM(vm);
    await EU.wait(500);
  };

  const getButton = () => {
    const btn = EU.findSprite(vm, buttonName, buttonFallbacks);
    if (!btn) throw new Error('Input Numbers button sprite not found');
    return btn;
  };

  const clickButton = async (buttonSprite) => {
    // Trigger "when this sprite clicked"
    vm.runtime.startHats('event_whenthisspriteclicked', null, buttonSprite);
    await EU.wait(200);
  };

  const waitForVisibility = async (sprite, expected, maxWait = 2000, label = 'Button') => {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      if (!!sprite.visible === !!expected) return true;
      await EU.wait(100);
    }
    console.log(`[Visibility] ${label} expected visible=${expected} but is ${sprite.visible}`);
    return false;
  };

  const waitForFirstPrompt = async (maxWait = 4000) => {
    const start = Date.now();
    const initialCount = promptCount;
    while (Date.now() - start < maxWait) {
      if (promptCount > initialCount) return true;
      await EU.wait(100);
    }
    return false;
  };

  const waitForInputCompletion = async (idleMs = 1200, maxDuration = 8000) => {
    const start = Date.now();
    // Ensure we have at least one prompt first
    while (Date.now() - start < maxDuration) {
      const elapsedSinceLastPrompt = Date.now() - lastPromptTime;
      if (promptCount > 0 && elapsedSinceLastPrompt >= idleMs) {
        return true;
      }
      await EU.wait(100);
    }
    return false; 
  };

  // Global SAY event listener to detect prompts and auto-answer
  const globalSayHandler = (target, type, text) => {
    try {
      const textStr = String(text || '').toLowerCase();
      // Consider it a prompt if it has a question mark and contains typical keywords
      const promptKeywords = ['enter', 'input', 'type', 'number', 'x', 'y', 'coordinate', 'value'];
      const isPrompt = textStr.includes('?') && promptKeywords.some(k => textStr.includes(k));

      if (listeningForInput && isPrompt) {
        promptCount += 1;
        lastPromptTime = Date.now();

        const ans = String(
          answerIndex < answerSequence.length ? answerSequence[answerIndex] : 0
        );
        answerIndex += 1;
        console.log(`[Input] Detected prompt: "${text}" -> answering "${ans}"`);

        // Answer shortly after prompt to simulate user typing
        setTimeout(() => {
          try {
            vm.runtime.emit('ANSWER', ans);
          } catch (e) {
            console.log(`[Input] Failed to emit ANSWER: ${e.message}`);
          }
        }, 250);
      }
    } catch (e) {
      // ignore
    }
  };

  const runTestCase = async (label, setupFn, checkFn) => {
    await restartProject();
    const button = getButton();
    await EU.wait(250);

    // Apply per-test setup
    await setupFn(button);

    // Wait a bit for scripts to react
    await EU.wait(300);

    const passed = await checkFn(button);
    console.log(`[Coordinate Reporter] ${label}: ${passed ? 'PASS' : 'FAIL'}`);
    return passed;
  };

  const runTimedCase = async (caseName, testRunner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
    },
    run: async () => {
      const passed = await testRunner();
      return { passed: !!passed, meta: {} };
    },
    afterCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
    }
  });

  try {
    if (!stage) throw new Error('Stage not found');

    // Attach global SAY listener
    vm.runtime.on('SAY', globalSayHandler);

    const details = [];

    details.push(await runTimedCase(
      "button_visible_at_start",
      async () => runTestCase(
        'Button visible at start (drag mode)',
        async (button) => {},
        async (button) => await waitForVisibility(button, true, 2500, 'Input Button')
      )
    ));

    details.push(await runTimedCase(
      "button_hides_when_clicked",
      async () => runTestCase(
        'Button hides when clicked (entering input mode)',
        async (button) => {
          await waitForVisibility(button, true, 2000);
        },
        async (button) => {
          await clickButton(button);
          const hiddenOk = await waitForVisibility(button, false, 2500);
          return hiddenOk;
        }
      )
    ));

    details.push(await runTimedCase(
      "button_reappears_after_input_sequence",
      async () => runTestCase(
        'Button reappears after completing input sequence',
        async (button) => {
          await waitForVisibility(button, true, 2000);
          listeningForInput = true;
          promptCount = 0;
          lastPromptTime = 0;
          answerIndex = 0;
        },
        async (button) => {
          await clickButton(button);
          const sawPrompt = await waitForFirstPrompt(5000);
          if (!sawPrompt) {
            listeningForInput = false;
            return false;
          }

          const completed = await waitForInputCompletion(1200, 9000);
          listeningForInput = false;
          if (!completed) return false;

          const becameVisible = await waitForVisibility(button, true, 3000);
          return becameVisible;
        }
      )
    ));

    // Build structured result
    const passedTests = details.filter(item => item.passed).length;
    const totalTests = details.length;
    const allPassed = passedTests === totalTests;

    const payload = {
      success: allPassed,
      passed_tests: passedTests,
      total_tests: totalTests,
      partial_success_rate: totalTests ? passedTests / totalTests : 0,
      details
    };

    try { vm.runtime.off('SAY', globalSayHandler); } catch (e) {}
    vm.runtime.stopAll();
    cleanup();
    return payload;
  } catch (err) {
    try { vm.runtime.off('SAY', globalSayHandler); } catch (e) {}
    vm.runtime.stopAll();
    cleanup();
    throw err;
  }
};
