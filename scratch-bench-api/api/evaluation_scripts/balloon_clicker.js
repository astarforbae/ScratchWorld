/**
 * Instruction: Starting from an empty Scratch project with a single default sprite named 'balloon', you should complete the following: 1) Create a variable named 'score' and initialize it to 0 when the green flag is clicked. 2) Each time the balloon is clicked, increase 'score' by 1 and immediately move the balloon to a random position on the stage.
 * Unit Test Semantic Goals:
 * 1) 'balloon' sprite exists and variable 'score' is created.
 * 2) Green flag initializes 'score' to exactly 0.
 * 3) Each 'balloon' click increases 'score' by exactly 1.
 * 4) Each 'balloon' click moves it to a new random stage position.
 */
module.exports = async (vm, config, cleanup) => {
    const EU = window.EvaluationUtils;
    const timeoutSec = (config && config.timeout) ? config.timeout : 20;
    const caseTimeoutMs = timeoutSec * 1000;
    const balloonName = "balloon";
    const scoreVarName = "score";

    const getBalloonAndScore = () => {
        const balloon = EU.findSprite(vm, balloonName, ["Sprite1"]);
        const scoreVar = EU.findVariableByName(vm, scoreVarName);
        return { balloon, scoreVar };
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
        details.push(await runCase("balloon_and_score_variable_exist", async () => {
            const { balloon, scoreVar } = getBalloonAndScore();
            return {
                passed: !!(balloon && scoreVar),
                meta: { has_balloon: !!balloon, has_score: !!scoreVar }
            };
        }));

        details.push(await runCase("green_flag_sets_score_to_zero", async () => {
            const { balloon, scoreVar } = getBalloonAndScore();
            if (!balloon || !scoreVar) {
                return { passed: false, error: "Missing balloon or score variable", meta: {} };
            }
            EU.startVM(vm);
            await EU.wait(500);
            return {
                passed: Number(scoreVar.value) === 0,
                meta: { observed_score: Number(scoreVar.value) }
            };
        }));

        details.push(await runCase("each_click_increases_score_by_one", async () => {
            const { balloon, scoreVar } = getBalloonAndScore();
            if (!balloon || !scoreVar) {
                return { passed: false, error: "Missing balloon or score variable", meta: {} };
            }
            EU.startVM(vm);
            await EU.wait(400);

            const clickCount = 3;
            let incrementsCorrect = 0;
            for (let i = 0; i < clickCount; i++) {
                const before = Number(scoreVar.value);
                await EU.clickSprite(vm, balloon);
                await EU.wait(350);
                const after = Number(scoreVar.value);
                if (after === before + 1) incrementsCorrect++;
            }
            return {
                passed: incrementsCorrect === clickCount,
                meta: { increments_correct: incrementsCorrect, click_count: clickCount }
            };
        }));

        details.push(await runCase("each_click_moves_balloon_position", async () => {
            const { balloon, scoreVar } = getBalloonAndScore();
            if (!balloon || !scoreVar) {
                return { passed: false, error: "Missing balloon or score variable", meta: {} };
            }
            EU.startVM(vm);
            await EU.wait(400);

            const clickCount = 3;
            let movedCount = 0;
            for (let i = 0; i < clickCount; i++) {
                const before = { x: balloon.x, y: balloon.y };
                await EU.clickSprite(vm, balloon);
                await EU.wait(350);
                const after = { x: balloon.x, y: balloon.y };
                if (before.x !== after.x || before.y !== after.y) movedCount++;
            }
            return {
                passed: movedCount === clickCount,
                meta: { moved_count: movedCount, click_count: clickCount }
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
        if (typeof cleanup === "function") cleanup();
    }
};
