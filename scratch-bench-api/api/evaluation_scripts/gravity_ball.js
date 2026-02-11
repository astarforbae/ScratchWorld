/**
 * Instruction: Starting from an empty Scratch project with a single default sprite named 'ball', you should complete the following: 1) When the green flag is clicked, position the ball at the top of the stage and make it fall downward with increasing speed (simulate gravity). 2) When the ball hits the bottom of the stage, make it bounce upward but to a lower height each time. 3) Ensure the ball eventually comes to rest at the bottom.
 * Unit Test Semantic Goals:
 * 1) 'ball' starts near the top of the stage after green flag.
 * 2) 'ball' reverses upward after touching the bottom edge.
 * 3) 'ball' bounce peaks decrease across repeated bottom impacts.
 */
module.exports = async (vm, config, cleanup) => {
    const EU = window.EvaluationUtils;
    const timeoutSec = (config && config.timeout ? config.timeout : 20);
    const caseTimeoutMs = Math.max(3200, Math.min(5200, Math.floor((timeoutSec * 1000 - 1200) / 3)));
    const observeDurationMs = Math.max(2600, caseTimeoutMs - 400);

    const cases = [
        {
            name: "ball_starts_near_top_after_flag",
            evaluate: metrics => metrics.initial_y > 100,
        },
        {
            name: "ball_bounces_up_after_bottom_contact",
            evaluate: metrics => metrics.bounce_after_bottom === true,
        },
        {
            name: "bounce_heights_decrease_over_time",
            evaluate: metrics => metrics.decreasing_peaks === true,
        },
    ];

    const details = [];
    try {
        for (let i = 0; i < cases.length; i++) {
            const oneCase = cases[i];
            const result = await EU.runCaseWithTimeout({
                caseName: oneCase.name,
                timeoutMs: caseTimeoutMs,
                beforeCase: async () => {
                    try { vm.runtime.stopAll(); } catch (e) {}
                },
                run: async () => {
                    const metrics = await observeGravityBehavior(vm, EU, observeDurationMs);
                    return {
                        passed: oneCase.evaluate(metrics),
                        meta: metrics,
                    };
                },
                afterCase: async () => {
                    try { vm.runtime.stopAll(); } catch (e) {}
                },
            });
            details.push(result);
            if (i < cases.length - 1) await EU.wait(120);
        }

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

function findBallSprite(vm) {
    const targets = (vm && vm.runtime && vm.runtime.targets) || [];
    const ball = targets.find(target => {
        if (!target || !target.isOriginal || !target.sprite || !target.sprite.name) return false;
        const name = String(target.sprite.name).toLowerCase();
        return name.includes("ball") || name === "sprite1";
    });
    return ball || null;
}

async function observeGravityBehavior(vm, EU, durationMs) {
    const ball = findBallSprite(vm);
    if (!ball) {
        return {
            initial_y: 0,
            bounce_after_bottom: false,
            decreasing_peaks: false,
        };
    }

    const history = [];
    const sampleIntervalMs = 60;
    const start = Date.now();

    EU.startVM(vm);
    await EU.wait(120);

    while (Date.now() - start < durationMs) {
        history.push({
            y: Number(ball.y) || 0,
            t: Date.now() - start,
        });
        await EU.wait(sampleIntervalMs);
    }

    if (history.length < 3) {
        return {
            initial_y: Number(ball.y) || 0,
            bounce_after_bottom: false,
            decreasing_peaks: false,
        };
    }

    const initialY = history[0].y;
    let bounceAfterBottom = false;

    for (let i = 0; i < history.length - 2; i++) {
        if (history[i].y > -140) continue;
        const windowEnd = Math.min(history.length, i + 45);
        for (let j = i + 1; j < windowEnd; j++) {
            if (history[j].y - history[i].y >= 25) {
                bounceAfterBottom = true;
                break;
            }
        }
        if (bounceAfterBottom) break;
    }

    const peaks = [];
    for (let i = 1; i < history.length - 1; i++) {
        const prev = history[i - 1].y;
        const curr = history[i].y;
        const next = history[i + 1].y;
        if (curr > prev && curr > next && curr > -120) {
            peaks.push(curr);
        }
    }

    const decreasingPeaks = peaks.length >= 2 && peaks[1] < peaks[0] - 5;

    return {
        initial_y: initialY,
        bounce_after_bottom: bounceAfterBottom,
        decreasing_peaks: decreasingPeaks,
    };
}
