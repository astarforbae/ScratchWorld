/**
 * Instruction: Starting from an empty Scratch project with a single default sprite named 'Sprite1', you should complete the following: 1) When the green flag is clicked, wait for mouse clicks. 2) Each time the mouse is clicked, make Sprite1 glide for 1 second to the mouse’s position at the moment of the click. 3) Ensure this works repeatedly for multiple clicks.
 * Unit Test Semantic Goals:
 * 1) 'Sprite1' responds to repeated mouse clicks after green flag.
 * 2) Each click makes 'Sprite1' glide for 1 second to click position.
 * 3) Motion is continuous glide, not instant teleport, across multiple clicks.
 */
module.exports = async (vm, config, cleanup) => {
    const EU = window.EvaluationUtils;
    const timeoutSec = (config && config.timeout ? config.timeout : 20);
    const caseTimeoutMs = timeoutSec * 1000;
    const spriteName = "Sprite1";
    const clickHoldMs = 120;

    const testPositions = [
        { x: 100, y: 50 },
        { x: -80, y: -60 },
        { x: 150, y: -100 },
        { x: -120, y: 80 },
    ];

    const findSprite = () => (
        EU.findSprite(vm, spriteName, []) ||
        (vm.runtime.targets || []).find(t => t.isOriginal && t.sprite && t.sprite.name !== "Stage")
    );

    const clickAndTrack = async (sprite, targetPos, maxWaitMs = 3200) => {
        const history = [];
        let reached = false;

        EU.simulateMouseMove(vm, targetPos.x, targetPos.y);
        const clickPromise = EU.simulateMouseClick(vm, targetPos.x, targetPos.y, {
            holdMs: clickHoldMs,
            beforeDownMs: 20,
            afterUpMs: 0,
        });
        const start = Date.now();

        while (Date.now() - start < maxWaitMs) {
            const currentPos = { x: Number(sprite.x) || 0, y: Number(sprite.y) || 0, t: Date.now() };
            history.push(currentPos);
            const dist = EU.calculateDistance(currentPos, targetPos);
            if (dist < 15) {
                reached = true;
                break;
            }
            await EU.wait(50);
        }
        await clickPromise;

        let maxStep = 0;
        for (let i = 1; i < history.length; i++) {
            const step = EU.calculateDistance(history[i], history[i - 1]);
            if (step > maxStep) maxStep = step;
        }

        const durationSec = history.length ? (history[history.length - 1].t - history[0].t) / 1000 : 0;
        const endPos = history.length
            ? { x: history[history.length - 1].x, y: history[history.length - 1].y }
            : { x: Number(sprite.x) || 0, y: Number(sprite.y) || 0 };
        const finalDistance = EU.calculateDistance(endPos, targetPos);
        return {
            reached,
            durationSec,
            sampleCount: history.length,
            maxStep,
            finalDistance,
            endPos,
            targetPos,
        };
    };

    const collectSequenceMetrics = async () => {
        const sprite = findSprite();
        if (!sprite) return null;

        EU.startVM(vm);
        await EU.wait(300);

        const results = [];
        for (let i = 0; i < testPositions.length; i++) {
            const target = testPositions[i];
            const one = await clickAndTrack(sprite, target);
            results.push(one);
            await EU.wait(250);
        }

        const reachedCount = results.filter(r => r.reached).length;
        const smoothCount = results.filter(r => r.sampleCount >= 4).length;
        const validDurationCount = results.filter(r => r.durationSec >= 0.4 && r.durationSec <= 2.2).length;
        const approxOneSecondCount = results.filter(r => r.durationSec >= 0.6 && r.durationSec <= 1.6).length;
        const teleportCount = results.filter(r => r.maxStep > 80).length;

        const metrics = {
            reached_count: reachedCount,
            smooth_count: smoothCount,
            valid_duration_count: validDurationCount,
            approx_one_second_count: approxOneSecondCount,
            teleport_count: teleportCount,
            total: results.length,
            per_click_results: results,
        };
        return metrics;
    };

    const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
        caseName,
        timeoutMs: caseTimeoutMs,
        beforeCase: async () => {
            try { vm.runtime.stopAll(); } catch (e) {}
            try { EU.simulateMouseUp(vm); } catch (e) {}
        },
        run: async () => runner(),
        afterCase: async () => {
            try { EU.simulateMouseUp(vm); } catch (e) {}
            try { vm.runtime.stopAll(); } catch (e) {}
        },
    });

    const details = [];
    try {
        details.push(await runCase("sprite_responds_to_repeated_clicks", async () => {
            const metrics = await collectSequenceMetrics();
            if (!metrics) return { passed: false, error: "Sprite not found", meta: {} };
            const passed = metrics.reached_count >= 3;
            return {
                passed,
                meta: metrics,
            };
        }));

        details.push(await runCase("each_click_glides_about_one_second_to_target", async () => {
            const metrics = await collectSequenceMetrics();
            if (!metrics) return { passed: false, error: "Sprite not found", meta: {} };
            const passed = metrics.approx_one_second_count >= 2 && metrics.valid_duration_count >= 3;
            return {
                passed,
                meta: metrics,
            };
        }));

        details.push(await runCase("movement_is_continuous_not_teleport", async () => {
            const metrics = await collectSequenceMetrics();
            if (!metrics) return { passed: false, error: "Sprite not found", meta: {} };
            const passed = metrics.teleport_count === 0 && metrics.smooth_count >= 3;
            return {
                passed,
                meta: metrics,
            };
        }));

        const passedTests = details.filter(item => item.passed).length;
        const totalTests = details.length;
        const payload = {
            success: passedTests === totalTests,
            passed_tests: passedTests,
            total_tests: totalTests,
            partial_success_rate: totalTests ? passedTests / totalTests : 0,
            details,
        };
        return payload;
    } finally {
        if (typeof cleanup === "function") cleanup();
    }
};
