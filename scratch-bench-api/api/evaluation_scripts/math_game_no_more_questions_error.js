/**
 * Instruction: This is an educational math quiz game featuring a character named Frank who asks addition problems. The game starts with a fixed question (3+3) and then generates random addition problems, providing visual and audio feedback for correct and incorrect answers. But now in this Math Game, when the player correctly answers the first question, the project ends instead of continuing with additional questions. Please help me fix this issue so that the game continues with more questions after each correct answer.
 * Unit Test Semantic Goals:
 * 1) After correctly answering the first "3+3" question with "6", a second addition question is asked.
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

  const observeSecondQuestion = async (maxWaitMs = 12000) => {
    const quizSprite = findQuizSprite();
    if (!quizSprite) {
      return {
        sprite_found: false,
        sprite_name: null,
        question_count: 0,
        questions: [],
      };
    }

    let sayListener = null;
    let timeoutTimer = null;
    let done = false;

    let questionCount = 0;
    const questions = [];

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
        question_count: questionCount,
        questions,
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
        questions.push({ raw, a, b });

        setTimeout(() => {
          vm.runtime.emit("ANSWER", String(answer));
        }, 220);

        if (questionCount >= 2) {
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
    details.push(await runCase("second_question_appears_after_first_correct_answer", async () => {
      const observation = await observeSecondQuestion(12000);
      const firstQuestion = observation.questions[0] || null;
      const firstIsThreePlusThree = !!firstQuestion && firstQuestion.a === 3 && firstQuestion.b === 3;
      const passed = observation.sprite_found && firstIsThreePlusThree && observation.question_count >= 2;

      return {
        passed,
        meta: {
          sprite_found: observation.sprite_found,
          sprite_name: observation.sprite_name,
          question_count: observation.question_count,
          first_question: firstQuestion,
          second_question: observation.questions[1] || null,
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
