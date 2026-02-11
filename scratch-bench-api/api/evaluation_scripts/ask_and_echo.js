/**
 * Instruction: Starting from an empty Scratch project with a single default sprite named 'Sprite1', you should complete the following: 1) When the green flag is clicked, use 'ask and wait' to ask 'What is your name?'. 2) After the user enters an answer, make Sprite1 say exactly the same text they typed for 2 seconds.
 * Unit Test Semantic Goals:
 * 1) 'Sprite1' asks 'What is your name?' for the user's name after green flag.
 * 2) 'Sprite1' repeats the exact provided answer text.
 */
module.exports = async (vm, config, cleanup) => {
    const EU = window.EvaluationUtils;
    const timeoutSec = (config && config.timeout) ? config.timeout : 10;
    const spriteName = config.spriteName || "Sprite1";
    const testAnswer = "TestUser123";

    const details = [];

    const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
        caseName,
        timeoutMs: timeoutSec * 1000,
        beforeCase: async () => {
            try { vm.runtime.stopAll(); } catch (e) {}
        },
        run: async () => runner(),
        afterCase: async () => {
            try { vm.runtime.stopAll(); } catch (e) {}
        },
    });

    const detectQuestionCase = async () => {
        return await new Promise((resolve) => {
            let settled = false;
            let listener = null;
            const settle = (passed, error = null, meta = {}) => {
                if (settled) return;
                settled = true;
                if (listener) {
                    try { vm.runtime.off("SAY", listener); } catch (e) {}
                }
                resolve({ passed, error, meta });
            };

            listener = (target, type, text) => {
                if (!target || !target.sprite || target.sprite.name !== spriteName) return;
                const content = String(text || "").trim();
                if (content === "What is your name?") {
                    settle(true, null, { observed_text: content });
                }
            };

            try {
                vm.runtime.on("SAY", listener);
                EU.startVM(vm);
            } catch (e) {
                settle(false, String(e && e.message ? e.message : e), {});
            }
        });
    };

    const detectEchoCase = async () => {
        return await new Promise((resolve) => {
            let settled = false;
            let listener = null;
            let answered = false;
            const settle = (passed, error = null, meta = {}) => {
                if (settled) return;
                settled = true;
                if (listener) {
                    try { vm.runtime.off("SAY", listener); } catch (e) {}
                }
                resolve({ passed, error, meta });
            };

            listener = (target, type, text) => {
                if (!target || !target.sprite || target.sprite.name !== spriteName) return;
                const content = String(text || "");
                const lower = content.toLowerCase();

                if (!answered && lower.includes("what is your name")) {
                    answered = true;
                    setTimeout(() => {
                        try { vm.runtime.emit("ANSWER", testAnswer); } catch (e) {}
                    }, 120);
                    return;
                }

                if (answered && content === testAnswer) {
                    settle(true, null, { echoed_text: content });
                }
            };

            try {
                vm.runtime.on("SAY", listener);
                EU.startVM(vm);
            } catch (e) {
                settle(false, String(e && e.message ? e.message : e), {});
            }
        });
    };

    try {
        details.push(await runCase("sprite_asks_exact_name_question", detectQuestionCase));
        details.push(await runCase("sprite_echoes_exact_answer_text", detectEchoCase));

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
        if (typeof cleanup === "function") cleanup();
    }
};
