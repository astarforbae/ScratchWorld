/**
 * Instruction: Starting from a Scratch project with two sprites named 'Sprite1' and 'Sprite2', you should complete the following: 1) When the green flag is clicked, make Sprite1 say 'Hello!' for 2 seconds. 2) After Sprite1 finishes, make Sprite2 say 'Hi there!' for 2 seconds. 3) This conversation must be coordinated using message broadcasting and receiving between the sprites.
 * Unit Test Semantic Goals:
 * 1) Project contains both 'Sprite1' and 'Sprite2'.
 * 2) 'Sprite1' emits a SAY message containing 'hello' after green flag.
 * 3) 'Sprite2' emits a SAY message containing 'hi there' after Sprite1's 'hello'.
 * 4) Project contains broadcast send/receive blocks for coordination.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = Math.max(6000, Math.min(timeoutSec * 1000, 10000));

  const findSprite1 = () => EU.findSprite(vm, "Sprite1", []) || null;
  const findSprite2 = () => EU.findSprite(vm, "Sprite2", []) || null;

  const hasBroadcastBlocks = () => {
    const opcodes = new Set([
      "event_broadcast",
      "event_broadcastandwait",
      "event_whenbroadcastreceived",
    ]);
    for (const target of vm.runtime.targets || []) {
      if (!target || !target.isOriginal || !target.blocks || !target.blocks._blocks) continue;
      for (const id of Object.keys(target.blocks._blocks)) {
        const block = target.blocks._blocks[id];
        if (block && opcodes.has(block.opcode)) return true;
      }
    }
    return false;
  };

  const waitForSay = ({ timeoutMs, matcher, startVm }) => new Promise((resolve) => {
    let settled = false;
    const startedAt = Date.now();
    const events = [];

    const settle = (payload) => {
      if (settled) return;
      settled = true;
      try { vm.runtime.off("SAY", onSay); } catch (e) {}
      clearTimeout(timerId);
      resolve(payload);
    };

    const onSay = (target, type, text) => {
      if (!target || !target.sprite) return;
      const speaker = String(target.sprite.name || "");
      const content = String(text || "");
      const event = {
        speaker,
        text: content,
        elapsed_ms: Date.now() - startedAt,
      };
      events.push(event);
      if (matcher(event, events)) {
        settle({
          matched: true,
          event,
          events,
        });
      }
    };

    const timerId = setTimeout(() => {
      settle({
        matched: false,
        event: null,
        events,
      });
    }, timeoutMs);

    vm.runtime.on("SAY", onSay);
    if (startVm) {
      try { EU.startVM(vm); } catch (e) {}
    }
  });

  const waitForConversationSequence = ({ timeoutMs, startVm, sprite1Name, sprite2Name }) => new Promise((resolve) => {
    let settled = false;
    const startedAt = Date.now();
    const events = [];
    let helloEvent = null;
    let hiEvent = null;
    let hiBeforeHello = false;

    const settle = (payload) => {
      if (settled) return;
      settled = true;
      try { vm.runtime.off("SAY", onSay); } catch (e) {}
      clearTimeout(timerId);
      resolve(payload);
    };

    const onSay = (target, type, text) => {
      if (!target || !target.sprite) return;
      const speaker = String(target.sprite.name || "");
      const content = String(text || "");
      const lowered = content.toLowerCase();
      const event = {
        speaker,
        text: content,
        elapsed_ms: Date.now() - startedAt,
      };
      events.push(event);

      const isHello = speaker === sprite1Name && lowered.includes("hello");
      const isHiThere = speaker === sprite2Name && lowered.includes("hi") && lowered.includes("there");
      if (isHello && !helloEvent) {
        helloEvent = event;
      }
      if (isHiThere && !helloEvent) {
        hiBeforeHello = true;
      }
      if (isHiThere && helloEvent && !hiEvent) {
        hiEvent = event;
      }
      if (helloEvent && hiEvent) {
        settle({
          matched: true,
          hello_event: helloEvent,
          hi_event: hiEvent,
          hi_before_hello: hiBeforeHello,
          events,
        });
      }
    };

    const timerId = setTimeout(() => {
      settle({
        matched: false,
        hello_event: helloEvent,
        hi_event: hiEvent,
        hi_before_hello: hiBeforeHello,
        events,
      });
    }, timeoutMs);

    vm.runtime.on("SAY", onSay);
    if (startVm) {
      try { EU.startVM(vm); } catch (e) {}
    }
  });

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
      await EU.wait(180);
    },
    run: async () => runner(),
    afterCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
    },
  });

  const details = [];
  try {
    details.push(await runCase("project_contains_sprite1_and_sprite2", async () => {
      const sprite1 = findSprite1();
      const sprite2 = findSprite2();
      return {
        passed: !!sprite1 && !!sprite2,
        meta: {
          sprite1_found: !!sprite1,
          sprite2_found: !!sprite2,
        },
      };
    }));

    details.push(await runCase("sprite1_says_hello_after_green_flag", async () => {
      const sprite1 = findSprite1();
      if (!sprite1) return { passed: false, error: "Sprite1 not found", meta: {} };

      const result = await waitForSay({
        timeoutMs: 5000,
        startVm: true,
        matcher: (event) => event.speaker === sprite1.sprite.name && event.text.toLowerCase().includes("hello"),
      });
      return {
        passed: result.matched,
        meta: {
          matched_text: result.event ? result.event.text : null,
          elapsed_ms: result.event ? result.event.elapsed_ms : null,
        },
      };
    }));

    details.push(await runCase("sprite2_says_hi_there_after_sprite1_hello", async () => {
      const sprite1 = findSprite1();
      const sprite2 = findSprite2();
      if (!sprite1 || !sprite2) {
        return {
          passed: false,
          error: "Sprite1 or Sprite2 not found",
          meta: { sprite1_found: !!sprite1, sprite2_found: !!sprite2 },
        };
      }

      const sequence = await waitForConversationSequence({
        timeoutMs: 7000,
        startVm: true,
        sprite1Name: sprite1.sprite.name,
        sprite2Name: sprite2.sprite.name,
      });
      const orderCorrect = sequence.matched && !sequence.hi_before_hello;
      return {
        passed: !!orderCorrect,
        meta: {
          hello_elapsed_ms: sequence.hello_event ? sequence.hello_event.elapsed_ms : null,
          hi_elapsed_ms: sequence.hi_event ? sequence.hi_event.elapsed_ms : null,
          hello_text: sequence.hello_event ? sequence.hello_event.text : null,
          hi_text: sequence.hi_event ? sequence.hi_event.text : null,
          hi_before_hello: sequence.hi_before_hello,
        },
      };
    }));

    details.push(await runCase("project_uses_broadcast_blocks_for_coordination", async () => {
      const usesBroadcast = hasBroadcastBlocks();
      return {
        passed: usesBroadcast,
        meta: {
          uses_broadcast_blocks: usesBroadcast,
        },
      };
    }));

    const passedTests = details.filter(item => item.passed).length;
    const totalTests = details.length;
    return {
      success: passedTests === totalTests,
      passed_tests: passedTests,
      total_tests: totalTests,
      partial_success_rate: totalTests > 0 ? passedTests / totalTests : 0,
      details,
    };
  } finally {
    try { vm.runtime.stopAll(); } catch (e) {}
    if (typeof cleanup === "function") cleanup();
  }
};
