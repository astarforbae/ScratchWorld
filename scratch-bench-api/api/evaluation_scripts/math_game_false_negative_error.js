/**
 * Instruction: This is an educational math quiz game featuring a character named Frank who asks addition problems. The game starts with a fixed question (3+3) and then generates random addition problems, providing visual and audio feedback for correct and incorrect answers. But now in this Math Game, when the player enters the correct answer (for example, entering 6 for the question 3+3), the sprite incorrectly says 'wrong' instead of recognizing it as the correct answer. Please help me fix this false negative error so that correct answers are properly recognized and validated.
 * Unit Test Semantic Goals:
 * 1) For question "3+3", submitting "6" is recognized as correct by positive feedback text.
 * 2) After submitting the correct answer, the sprite does not produce "wrong" or "incorrect" feedback.
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

  const normalizeText = (text) => String(text || "").toLowerCase();

  const runQuestionAndAnswer = async (waitMs = 7000) => {
    const quizSprite = findQuizSprite();
    if (!quizSprite) {
      return {
        sprite_found: false,
        sprite_name: null,
        question_text: null,
        submitted_answer: null,
        positive_detected: false,
        negative_detected: false,
        responses_after_answer: [],
        question_numbers: null,
      };
    }

    let sayListener = null;
    let settleTimer = null;
    let timeoutTimer = null;
    let finished = false;

    let questionText = null;
    let questionNumbers = null;
    let submittedAnswer = null;
    let positiveDetected = false;
    let negativeDetected = false;
    const responsesAfterAnswer = [];

    const positivePattern = /\b(correct|right|great|good\s*job|well\s*done|yes)\b/i;
    const negativePattern = /\b(wrong|incorrect)\b/i;

    const finish = (resolve) => {
      if (finished) return;
      finished = true;
      if (settleTimer) clearTimeout(settleTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (sayListener) {
        try { vm.runtime.off("SAY", sayListener); } catch (e) {}
      }
      resolve({
        sprite_found: true,
        sprite_name: quizSprite.sprite ? quizSprite.sprite.name : null,
        question_text: questionText,
        submitted_answer: submittedAnswer,
        positive_detected: positiveDetected,
        negative_detected: negativeDetected,
        responses_after_answer: responsesAfterAnswer,
        question_numbers: questionNumbers,
      });
    };

    return await new Promise((resolve) => {
      sayListener = (target, type, text) => {
        if (!target || !target.sprite) return;
        if (target.sprite.name !== quizSprite.sprite.name) return;

        const raw = String(text || "");
        const normalized = normalizeText(raw);

        if (submittedAnswer === null) {
          const match = normalized.match(/(\d+)\s*\+\s*(\d+)/);
          if (match) {
            const a = Number(match[1]);
            const b = Number(match[2]);
            questionNumbers = { left: a, right: b };
            questionText = raw;
            submittedAnswer = a + b;
            setTimeout(() => {
              vm.runtime.emit("ANSWER", String(submittedAnswer));
            }, 250);
            return;
          }
        }

        if (submittedAnswer !== null) {
          responsesAfterAnswer.push(raw);
          if (positivePattern.test(normalized)) {
            positiveDetected = true;
          }
          if (negativePattern.test(normalized)) {
            negativeDetected = true;
          }

          if (positiveDetected || negativeDetected) {
            settleTimer = setTimeout(() => finish(resolve), 250);
          }
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
    details.push(await runCase("question_3_plus_3_accepts_answer_6", async () => {
      const observation = await runQuestionAndAnswer(8000);
      const isThreePlusThree = !!observation.question_numbers &&
        observation.question_numbers.left === 3 &&
        observation.question_numbers.right === 3;
      const passed = observation.sprite_found &&
        isThreePlusThree &&
        observation.submitted_answer === 6 &&
        observation.positive_detected;

      return {
        passed,
        meta: {
          sprite_found: observation.sprite_found,
          sprite_name: observation.sprite_name,
          question_text: observation.question_text,
          submitted_answer: observation.submitted_answer,
          positive_detected: observation.positive_detected,
          negative_detected: observation.negative_detected,
        },
      };
    }));

    details.push(await runCase("correct_answer_does_not_trigger_wrong_feedback", async () => {
      const observation = await runQuestionAndAnswer(8000);
      const passed = observation.sprite_found &&
        observation.submitted_answer !== null &&
        observation.positive_detected &&
        !observation.negative_detected;

      return {
        passed,
        meta: {
          sprite_found: observation.sprite_found,
          sprite_name: observation.sprite_name,
          submitted_answer: observation.submitted_answer,
          positive_detected: observation.positive_detected,
          negative_detected: observation.negative_detected,
          responses_after_answer: observation.responses_after_answer,
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
