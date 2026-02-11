/**
 * Instruction: Starting from an empty Scratch project with a single default sprite named 'Sprite1', you should complete the following: 1) When the green flag is clicked, make Sprite1 move horizontally across the stage. 2) If Sprite1 touches the edge, make it bounce and face the direction it is moving. 3) Ensure this behavior runs in a forever loop.
 * Unit Test Semantic Goals:
 * 1) 'Sprite1' exists and starts moving horizontally after green flag.
 * 2) 'Sprite1' reverses X direction when touching the right edge.
 * 3) 'Sprite1' reverses X direction when touching the left edge.
 * 4) 'Sprite1' faces the current movement direction after each bounce.
 */
module.exports = async (vm, config, cleanup) => {
    const EU = window.EvaluationUtils;
    const timeoutSec = (config && config.timeout) ? config.timeout : 20;
    const caseTimeoutMs = timeoutSec * 1000;

    const collectMotion = async (durationMs = 6000) => {
        const cat = EU.findSprite(vm, "Sprite1", ["cat"]);
        if (!cat) return null;

        EU.startVM(vm);
        await EU.wait(200);

        const history = [];
        const start = Date.now();
        while (Date.now() - start < durationMs) {
            history.push({ x: Number(cat.x) || 0, direction: Number(cat.direction) || 0 });
            await EU.wait(100);
        }
        return { cat, history };
    };

    const findBounce = (history, fromDir, toDir) => {
        for (let i = 1; i < history.length; i++) {
            if (history[i - 1].direction === fromDir && history[i].direction === toDir) return true;
        }
        return false;
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
        details.push(await runCase("sprite_moves_horizontally_after_green_flag", async () => {
            const data = await collectMotion(3500);
            if (!data) return { passed: false, error: "Sprite not found", meta: {} };
            const moved = data.history.some(frame => Math.abs(frame.x - data.history[0].x) > 20);
            return { passed: moved, meta: { samples: data.history.length } };
        }));

        details.push(await runCase("sprite_bounces_off_right_edge", async () => {
            const data = await collectMotion(6500);
            if (!data) return { passed: false, error: "Sprite not found", meta: {} };
            const bounced = findBounce(data.history, 90, -90);
            return { passed: bounced, meta: { bounce_detected: bounced } };
        }));

        details.push(await runCase("sprite_bounces_off_left_edge", async () => {
            const data = await collectMotion(6500);
            if (!data) return { passed: false, error: "Sprite not found", meta: {} };
            const bounced = findBounce(data.history, -90, 90);
            return { passed: bounced, meta: { bounce_detected: bounced } };
        }));

        details.push(await runCase("sprite_faces_movement_direction_after_bounce", async () => {
            const data = await collectMotion(6500);
            if (!data) return { passed: false, error: "Sprite not found", meta: {} };

            let movingFrames = 0;
            let alignedFrames = 0;
            for (let i = 1; i < data.history.length; i++) {
                const deltaX = data.history[i].x - data.history[i - 1].x;
                if (Math.abs(deltaX) < 1) continue;
                movingFrames++;
                if (deltaX > 0 && data.history[i].direction > 0) alignedFrames++;
                if (deltaX < 0 && data.history[i].direction < 0) alignedFrames++;
            }
            const ratio = movingFrames > 0 ? alignedFrames / movingFrames : 0;
            return {
                passed: movingFrames > 5 && ratio >= 0.7,
                meta: { moving_frames: movingFrames, aligned_frames: alignedFrames, alignment_ratio: ratio }
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
