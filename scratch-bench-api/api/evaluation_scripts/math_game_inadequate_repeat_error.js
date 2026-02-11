/**
 * Instruction: This is an educational math quiz game featuring a character named Frank who asks addition problems. The game starts with a fixed question (3+3) and then generates random addition problems, providing visual and audio feedback for correct and incorrect answers. But now in this Math Game, after answering the first question correctly, the program should continue presenting new math questions indefinitely in a forever loop. However, there's a bug where the game only shows 3 additional questions and then stops. Please help me fix this issue so that the game creates a forever loop of questions after the initial question.
 * Unit Test Semantic Goals:
 * 1) After answering the first question correctly, the game asks more than 3 additional "a+b" questions.
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

  const observeQuestionLoop = async (waitMs = 12000) => {
    const quizSprite = findQuizSprite();
    if (!quizSprite) {
      return {
        sprite_found: false,
        sprite_name: null,
        question_count: 0,
        answered_count: 0,
        observed_questions: [],
      };
    }

    let sayListener = null;
    let timeoutTimer = null;
    let finished = false;

    let questionCount = 0;
    let answeredCount = 0;
    const observedQuestions = [];

    let lastQuestionText = null;
    let lastQuestionAt = 0;

    const finish = (resolve) => {
      if (finished) return;
      finished = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (sayListener) {
        try { vm.runtime.off("SAY", sayListener); } catch (e) {}
      }
      resolve({
        sprite_found: true,
        sprite_name: quizSprite.sprite ? quizSprite.sprite.name : null,
        question_count: questionCount,
        answered_count: answeredCount,
        observed_questions: observedQuestions,
      });
    };

    return await new Promise((resolve) => {
      sayListener = (target, type, text) => {
        if (!target || !target.sprite) return;
        if (target.sprite.name !== quizSprite.sprite.name) return;

        const raw = String(text || "");
        const match = raw.match(/(\d+)\s*\+\s*(\d+)/);
        if (!match) return;

        const now = Date.now();
        if (lastQuestionText === raw && (now - lastQuestionAt) < 700) {
          return;
        }
        lastQuestionText = raw;
        lastQuestionAt = now;

        questionCount += 1;
        observedQuestions.push(raw);

        const a = Number(match[1]);
        const b = Number(match[2]);
        const answer = a + b;
        setTimeout(() => {
          vm.runtime.emit("ANSWER", String(answer));
          answeredCount += 1;
        }, 220);

        if (questionCount > 4) {
          setTimeout(() => finish(resolve), 300);
        }
      };

      vm.runtime.on("SAY", sayListener);
      EU.startVM(vm);
      timeoutTimer = setTimeout(() => finish(resolve), waitMs);
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
    details.push(await runCase("after_first_correct_answer_questions_continue_beyond_three_more", async () => {
      const observation = await observeQuestionLoop(13000);
      const passed = observation.sprite_found && observation.question_count > 4;
      return {
        passed,
        meta: {
          sprite_found: observation.sprite_found,
          sprite_name: observation.sprite_name,
          question_count: observation.question_count,
          answered_count: observation.answered_count,
          observed_questions: observation.observed_questions,
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
