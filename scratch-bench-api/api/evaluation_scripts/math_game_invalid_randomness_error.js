/**
 * Instruction: This is an educational math quiz game featuring a character named Frank who asks addition problems. The game starts with a fixed question (3+3) and then generates random addition problems, providing visual and audio feedback for correct and incorrect answers. But now in this Math Game, after completing the first question, the program should generate random addition questions. However, there's a bug where the first number in these addition questions is always 1 instead of being truly random. For example, questions appear as '1 + 5', '1 + 3', '1 + 8' instead of having varied first numbers. Please help me fix this randomness issue so that both numbers in the addition questions are properly randomized.
 * Unit Test Semantic Goals:
 * 1) After answering the first question, the first addend across follow-up questions is not always 1.
 * 2) Across follow-up questions, both addends vary (at least two distinct first addends and two distinct second addends).
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;
  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;

  const spriteCandidates = (config && config.spriteName)
    ? [String(config.spriteName)]
    : ["Frank", "Sprite1"];

  const findQuizSprite = () => {
    for (const name of spriteCandidates) {
      const sprite = EU.findSprite(vm, name, []);
      if (sprite) return sprite;
    }
    return (vm.runtime.targets || []).find(t => t.isOriginal && t.sprite && t.sprite.name !== "Stage") || null;
  };

  const collectFollowupQuestions = async (targetFollowups = 4, maxWaitMs = 15000) => {
    const quizSprite = findQuizSprite();
    if (!quizSprite) {
      return {
        sprite_found: false,
        sprite_name: null,
        all_questions: [],
        followup_questions: [],
        first_addends: [],
        second_addends: [],
      };
    }

    let sayListener = null;
    let timeoutTimer = null;
    let done = false;
    let questionCount = 0;
    let firstAnswered = false;

    const allQuestions = [];
    const followups = [];

    const finish = (resolve) => {
      if (done) return;
      done = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (sayListener) {
        try { vm.runtime.off("SAY", sayListener); } catch (e) {}
      }
      resolve({
        sprite_found: true,
        sprite_name: quizSprite.sprite ? quizSprite.sprite.name : null,
        all_questions: allQuestions,
        followup_questions: followups,
        first_addends: followups.map(q => q.a),
        second_addends: followups.map(q => q.b),
      });
    };

    return await new Promise((resolve) => {
      sayListener = (target, type, text) => {
        if (!target || !target.sprite) return;
        if (target.sprite.name !== quizSprite.sprite.name) return;

        const raw = String(text || "");
        const match = raw.match(/(\d+)\s*\+\s*(\d+)/);
        if (!match) return;

        const a = Number(match[1]);
        const b = Number(match[2]);
        const answer = a + b;

        questionCount += 1;
        allQuestions.push({ raw, a, b });
        if (firstAnswered) {
          followups.push({ raw, a, b });
        }

        setTimeout(() => {
          vm.runtime.emit("ANSWER", String(answer));
        }, 220);

        if (!firstAnswered) {
          firstAnswered = true;
        }

        if (followups.length >= targetFollowups) {
          setTimeout(() => finish(resolve), 250);
        }
      };

      vm.runtime.on("SAY", sayListener);
      EU.startVM(vm);
      timeoutTimer = setTimeout(() => finish(resolve), maxWaitMs);
    });
  };

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
    },
    run: async () => runner(),
    afterCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
    },
  });

  const details = [];

  try {
    details.push(await runCase("first_addend_not_fixed_to_1_after_first_question", async () => {
      const observation = await collectFollowupQuestions(4, 15000);
      const firsts = observation.first_addends;
      const uniqueFirsts = [...new Set(firsts)];
      const allOnes = firsts.length > 0 && firsts.every(n => n === 1);

      const passed = observation.sprite_found &&
        firsts.length >= 3 &&
        !allOnes &&
        uniqueFirsts.length > 1;

      return {
        passed,
        meta: {
          sprite_found: observation.sprite_found,
          sprite_name: observation.sprite_name,
          first_addends: firsts,
          unique_first_addends: uniqueFirsts,
          followup_question_count: firsts.length,
          all_first_addends_are_1: allOnes,
        },
      };
    }));

    details.push(await runCase("both_addends_vary_across_followup_questions", async () => {
      const observation = await collectFollowupQuestions(5, 15000);
      const firsts = observation.first_addends;
      const seconds = observation.second_addends;
      const uniqueFirsts = [...new Set(firsts)];
      const uniqueSeconds = [...new Set(seconds)];

      const passed = observation.sprite_found &&
        firsts.length >= 3 &&
        uniqueFirsts.length > 1 &&
        uniqueSeconds.length > 1;

      return {
        passed,
        meta: {
          sprite_found: observation.sprite_found,
          sprite_name: observation.sprite_name,
          first_addends: firsts,
          second_addends: seconds,
          unique_first_addends: uniqueFirsts,
          unique_second_addends: uniqueSeconds,
          followup_question_count: firsts.length,
        },
      };
    }));

    const passedTests = details.filter(item => item.passed).length;
    const totalTests = details.length;
    return {
      success: passedTests === totalTests,
      passed_tests: passedTests,
      total_tests: totalTests,
      partial_success_rate: totalTests ? passedTests / totalTests : 0,
      details,
    };
  } finally {
    try { vm.runtime.stopAll(); } catch (e) {}
    if (typeof cleanup === "function") cleanup();
  }
};
