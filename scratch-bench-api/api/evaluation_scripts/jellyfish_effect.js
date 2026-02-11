/**
 * Instruction: Starting from an empty Scratch project with a single default sprite named 'jellyfish', you should complete the following: 1) When the green flag is clicked, hide the jellyfish sprite. 2) Continuously create clones of the jellyfish at random X positions along the bottom. 3) For each clone, make it rise upward at a constant speed until it reaches the top edge, then delete the clone.
 * Unit Test Semantic Goals:
 * 1) 'jellyfish' is hidden after the green flag starts the project.
 * 2) At least 3 'jellyfish' clones spawn from the stage bottom.
 * 3) At least 2 bottom clones rise upward by more than 50 units.
 * 4) At least 1 rising clone is deleted near the top edge.
 * 5) Clone spawn X positions vary across multiple distinct values.
 */
module.exports = async (vm, config, cleanup) => {
    const EU = window.EvaluationUtils;
    const timeoutSec = (config && config.timeout ? config.timeout : 20);
    const caseTimeoutMs = Math.max(2600, Math.min(4200, Math.floor((timeoutSec * 1000 - 1000) / 5)));
    const observeDurationMs = Math.max(2200, caseTimeoutMs - 300);

    const cases = [
        {
            name: "original_jellyfish_hidden_after_start",
            evaluate: metrics => metrics.original_hidden === true,
        },
        {
            name: "three_bottom_clones_spawn",
            evaluate: metrics => metrics.bottom_start_clones >= 3,
        },
        {
            name: "two_bottom_clones_rise_above_50",
            evaluate: metrics => metrics.rising_bottom_clones >= 2,
        },
        {
            name: "one_clone_deleted_near_top",
            evaluate: metrics => metrics.deleted_near_top >= 1,
        },
        {
            name: "spawn_positions_vary_on_x_axis",
            evaluate: metrics => metrics.unique_spawn_x_buckets >= 2,
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
                    const metrics = await observeJellyfishBehavior(vm, EU, observeDurationMs);
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

function findJellyfishSprite(vm) {
    const targets = (vm && vm.runtime && vm.runtime.targets) || [];
    const sprite = targets.find(target => {
        if (!target || !target.isOriginal || !target.sprite || !target.sprite.name) return false;
        const lower = String(target.sprite.name).toLowerCase();
        return lower.includes("jellyfish") || lower === "sprite1";
    });
    return sprite || null;
}

async function observeJellyfishBehavior(vm, EU, durationMs) {
    const runtime = vm && vm.runtime;
    if (!runtime) {
        return {
            original_hidden: false,
            bottom_start_clones: 0,
            rising_bottom_clones: 0,
            deleted_near_top: 0,
            unique_spawn_x_buckets: 0,
        };
    }

    const observedClones = new Map();
    let originalHidden = false;
    const sampleIntervalMs = 80;
    const start = Date.now();

    EU.startVM(vm);
    await EU.wait(150);

    while (Date.now() - start < durationMs) {
        const original = findJellyfishSprite(vm);
        if (original && original.visible === false) {
            originalHidden = true;
        }

        const spriteName = original && original.sprite ? original.sprite.name : null;
        const activeClones = (runtime.targets || []).filter(target =>
            target &&
            !target.isOriginal &&
            target.sprite &&
            spriteName &&
            target.sprite.name === spriteName
        );

        const activeIds = new Set();
        for (const clone of activeClones) {
            activeIds.add(clone.id);
            if (!observedClones.has(clone.id)) {
                observedClones.set(clone.id, {
                    initialX: Number(clone.x) || 0,
                    initialY: Number(clone.y) || 0,
                    maxY: Number(clone.y) || 0,
                    deleted: false,
                });
            } else {
                const state = observedClones.get(clone.id);
                state.maxY = Math.max(state.maxY, Number(clone.y) || 0);
            }
        }

        for (const [cloneId, state] of observedClones.entries()) {
            if (!state.deleted && !activeIds.has(cloneId)) {
                state.deleted = true;
            }
        }

        await EU.wait(sampleIntervalMs);
    }

    const all = Array.from(observedClones.values());
    const bottomStart = all.filter(one => one.initialY <= -120);
    const risingBottom = bottomStart.filter(one => (one.maxY - one.initialY) > 50);
    const deletedNearTop = bottomStart.filter(one => one.deleted && one.maxY >= 120);
    const uniqueXBuckets = new Set(bottomStart.map(one => Math.round(one.initialX / 20)));

    return {
        original_hidden: originalHidden,
        bottom_start_clones: bottomStart.length,
        rising_bottom_clones: risingBottom.length,
        deleted_near_top: deletedNearTop.length,
        unique_spawn_x_buckets: uniqueXBuckets.size,
    };
}
