/**
 * Instruction: Starting from a Scratch project with a single default sprite named 'Sprite1' and 3 backdrops, you should complete the following: 1) When the green flag is clicked, make the stage automatically switch to the next backdrop every 2 seconds. 2) Ensure the backdrop switching loops forever.
 * Unit Test Semantic Goals:
 * 1) Stage contains at least 3 backdrops before playback starts.
 * 2) Green flag triggers automatic switch to the next backdrop.
 * 3) At least 3 distinct backdrops appear during execution.
 * 4) Backdrop transitions occur at roughly 2-second intervals.
 * 5) Backdrop sequence loops by repeating a previously shown backdrop.
 */
module.exports = async (vm, config, cleanup) => {
    const EU = window.EvaluationUtils;
    const timeoutSec = (config && config.timeout) ? config.timeout : 20;
    const caseTimeoutMs = timeoutSec * 1000;

    const collectHistory = async (durationMs = 9000) => {
        const stage = vm.runtime.getTargetForStage();
        if (!stage || !stage.sprite) return null;

        EU.startVM(vm);
        await EU.wait(200);

        const history = [{ index: stage.currentCostume, timestamp: Date.now() }];
        const start = Date.now();
        let lastIndex = stage.currentCostume;
        while (Date.now() - start < durationMs) {
            const currentIndex = stage.currentCostume;
            if (currentIndex !== lastIndex) {
                history.push({ index: currentIndex, timestamp: Date.now() });
                lastIndex = currentIndex;
            }
            await EU.wait(100);
        }
        return { stage, history };
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
        details.push(await runCase("stage_has_at_least_three_backdrops", async () => {
            const stage = vm.runtime.getTargetForStage();
            const backdropCount = (stage && stage.sprite && stage.sprite.costumes) ? stage.sprite.costumes.length : 0;
            return { passed: backdropCount >= 3, meta: { backdrop_count: backdropCount } };
        }));

        details.push(await runCase("green_flag_triggers_backdrop_change", async () => {
            const data = await collectHistory(5000);
            if (!data) return { passed: false, error: "Stage not found", meta: {} };
            const changed = data.history.length > 1;
            return { passed: changed, meta: { changes: data.history.length - 1 } };
        }));

        details.push(await runCase("three_distinct_backdrops_appear", async () => {
            const data = await collectHistory(9000);
            if (!data) return { passed: false, error: "Stage not found", meta: {} };
            const distinct = new Set(data.history.map(item => item.index)).size;
            return { passed: distinct >= 3, meta: { distinct_backdrops: distinct } };
        }));

        details.push(await runCase("backdrop_change_interval_is_about_two_seconds", async () => {
            const data = await collectHistory(9000);
            if (!data) return { passed: false, error: "Stage not found", meta: {} };
            const intervals = [];
            for (let i = 1; i < data.history.length; i++) {
                intervals.push(data.history[i].timestamp - data.history[i - 1].timestamp);
            }
            const valid = intervals.filter(ms => Math.abs(ms - 2000) <= 1000).length;
            return {
                passed: valid >= 2,
                meta: { interval_count: intervals.length, valid_interval_count: valid }
            };
        }));

        details.push(await runCase("backdrop_sequence_loops", async () => {
            const data = await collectHistory(10000);
            if (!data) return { passed: false, error: "Stage not found", meta: {} };
            const counts = {};
            for (const item of data.history) {
                counts[item.index] = (counts[item.index] || 0) + 1;
            }
            const repeated = Object.values(counts).some(count => count >= 2);
            return { passed: repeated, meta: { counts } };
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
