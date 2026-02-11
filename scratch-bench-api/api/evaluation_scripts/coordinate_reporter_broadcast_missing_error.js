/**
 * Instruction: This is an interactive coordinate reporting tool where a sprite displays its current X and Y position on screen. Users can drag the sprite around or use input prompts to move it by specific amounts, with real-time coordinate feedback and mode switching between drag and input modes. The project now stops immediately after clicking the green flag; fix it so it behaves correctly.
 * Unit Test Semantic Goals:
 * 1) Green flag keeps drag mode active with live X/Y coordinate reporting.
 * 2) Clicking 'Button' switches to input mode and triggers input prompts.
 * 3) Completing prompted inputs restores drag mode and live X/Y updates.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const caseTimeoutMs = (config && config.timeout ? config.timeout : 20) * 1000;
  const buttonName = (config && config.buttonSpriteName) || 'Button';
  const buttonFallbacks = ['Input Numbers', 'Input', 'Numbers', 'Enter'];
  const mainSpriteName = (config && config.mainSpriteName) || 'Sprite1';
  const mainFallbacks = ['Cat', 'Sprite', 'Sprite 1'];
  const answers = (config && config.answers) || ['10', '-5']; // default 2-step input

  const stage = vm.runtime.getTargetForStage();

  // Global SAY listener state for prompts/answers
  let listeningForInput = false;
  let promptCount = 0;
  let lastPromptTime = 0;
  let answerIndex = 0;

  const restartProject = async () => {
    try { vm.runtime.stopAll(); } catch (e) {}
    EU.startVM(vm);
    await EU.wait(300);
  };

  const getButton = () => {
    const btn = EU.findSprite(vm, buttonName, buttonFallbacks);
    if (!btn) throw new Error('Button sprite not found');
    return btn;
  };

  const getMain = () => {
    const sp = EU.findSprite(vm, mainSpriteName, mainFallbacks);
    if (!sp) throw new Error('Main sprite not found');
    return sp;
  };

  const clickButton = async (buttonSprite) => {
    vm.runtime.startHats('event_whenthisspriteclicked', null, buttonSprite);
    await EU.wait(200);
  };

  const waitForVisibility = async (sprite, expected, maxWait = 2000, label = 'Sprite') => {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      if (!!sprite.visible === !!expected) return true;
      await EU.wait(100);
    }
    console.log(`[Visibility] ${label} expected visible=${expected} but is ${sprite.visible}`);
    return false;
  };

  const waitForFirstPrompt = async (maxWait = 3000) => {
    const start = Date.now();
    const baseline = promptCount;
    while (Date.now() - start < maxWait) {
      if (promptCount > baseline) return true;
      await EU.wait(100);
    }
    return false;
  };

  const waitForInputCompletion = async (idleMs = 800, maxDuration = 6000) => {
    const start = Date.now();
    while (Date.now() - start < maxDuration) {
      const idle = Date.now() - lastPromptTime;
      if (promptCount > 0 && idle >= idleMs) return true;
      await EU.wait(100);
    }
    return false;
  };

  // Detect prompts and answer them
  const globalSayHandler = (target, type, text) => {
    try {
      const msg = String(text || '').toLowerCase();
      const promptKeywords = ['enter', 'input', 'type', 'x', 'y', 'coordinate', 'change'];
      const isPrompt = msg.includes('?') && promptKeywords.some(k => msg.includes(k));
      if (listeningForInput && isPrompt) {
        promptCount += 1;
        lastPromptTime = Date.now();
        const ans = String(answerIndex < answers.length ? answers[answerIndex] : 0);
        answerIndex += 1;
        console.log(`[Prompt] "${text}" -> answering "${ans}"`);
        setTimeout(() => {
          try { vm.runtime.emit('ANSWER', ans); } catch (e) {}
        }, 200);
      }
    } catch (e) {
      // ignore
    }
  };

  // Drag the main sprite a bit and detect if it says coordinates
  const dragAndDetectCoords = async (mainSprite) => {
    let saidCoords = false;
    const name = mainSprite && mainSprite.sprite ? mainSprite.sprite.name : '';
    const coordListener = (target, type, text) => {
      try {
        if (!target || !target.sprite || target.sprite.name !== name) return;
        const s = String(text || '').toLowerCase();
        // heuristic: contains numbers and mentions x/y/coord
        const hasNumber = /-?\d+(?:\.\d+)?/.test(s);
        const mentionsXY = s.includes('x') || s.includes('y') || s.includes('coord');
        if (hasNumber && mentionsXY) {
          saidCoords = true;
        }
      } catch (e) {}
    };

    vm.runtime.on('SAY', coordListener);

    const startPos = EU.getSpritePosition(mainSprite);
    // Simulate short drag moves
    EU.simulateMouseDown(vm, startPos.x, startPos.y);
    await EU.wait(80);
    const steps = 3;
    for (let i = 1; i <= steps; i++) {
      const newX = startPos.x + i * 15;
      const newY = startPos.y + i * 10;
      EU.simulateMouseMove(vm, newX, newY);
      if (mainSprite.setXY) mainSprite.setXY(newX, newY);
      await EU.wait(120);
    }
    EU.simulateMouseUp(vm);
    await EU.wait(300);

    try { vm.runtime.off('SAY', coordListener); } catch (e) {}
    return saidCoords;
  };

  const runTestCase = async (label, setupFn, checkFn) => {
    await restartProject();
    const btn = getButton();
    const main = getMain();
    await EU.wait(200);

    await setupFn(btn, main);
    await EU.wait(200);

    const passed = await checkFn(btn, main);
    console.log(`[Coord Reporter] ${label}: ${passed ? 'PASS' : 'FAIL'}`);
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
    vm.runtime.on('SAY', globalSayHandler);

    const details = [];

    details.push(await runTimedCase(
      "drag_mode_active_and_coordinate_reporting_works",
      async () => runTestCase(
        'Drag mode active and coordinate reporting works',
        async (btn, main) => {},
        async (btn, main) => {
          const vis = await waitForVisibility(btn, true, 1500, 'Button');
          if (!vis) return false;
          const said = await dragAndDetectCoords(main);
          return said;
        }
      )
    ));

    details.push(await runTimedCase(
      "transition_to_input_mode_triggers_prompts",
      async () => runTestCase(
        'Transition to input mode triggers prompts',
        async (btn, main) => {
          listeningForInput = true;
          promptCount = 0;
          lastPromptTime = 0;
          answerIndex = 0;
          await waitForVisibility(btn, true, 1500, 'Button');
        },
        async (btn, main) => {
          await clickButton(btn);
          const hidden = await waitForVisibility(btn, false, 2000, 'Button');
          const sawPrompt = await waitForFirstPrompt(3000);
          return hidden && sawPrompt;
        }
      )
    ));

    details.push(await runTimedCase(
      "input_completes_and_returns_to_drag_mode",
      async () => runTestCase(
        'Input completes and returns to drag mode',
        async (btn, main) => {
          listeningForInput = true;
          promptCount = 0;
          lastPromptTime = 0;
          answerIndex = 0;
          await waitForVisibility(btn, true, 1500, 'Button');
        },
        async (btn, main) => {
          await clickButton(btn);
          const hidden = await waitForVisibility(btn, false, 2000, 'Button');
          const sawPrompt = await waitForFirstPrompt(3000);
          if (!hidden || !sawPrompt) return false;

          const completed = await waitForInputCompletion(800, 5000);
          listeningForInput = false;
          if (!completed) return false;

          const visibleAgain = await waitForVisibility(btn, true, 2500, 'Button');
          if (!visibleAgain) return false;

          const said = await dragAndDetectCoords(main);
          return said;
        }
      )
    ));

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
