/**
 * Lean evaluation utilities for active task scripts.
 * Phase 1 focus: per-case execution + per-case timeout for QA-style tests.
 */
const EvaluationUtils = {
    findSprite(vm, spriteName, fallbackNames = []) {
        const names = [spriteName, ...fallbackNames].filter(Boolean).map(n => String(n).toLowerCase());
        for (const name of names) {
            const sprite = vm.runtime.targets.find(
                t => t.isOriginal && t.sprite && t.sprite.name.toLowerCase().includes(name)
            );
            if (sprite) return sprite;
        }
        return null;
    },

    findVariableByName(vm, name) {
        const needle = String(name || "").toLowerCase();
        for (const t of vm.runtime.targets || []) {
            const vars = t.variables || {};
            for (const id of Object.keys(vars)) {
                const v = vars[id];
                if (v && typeof v.name === "string" && v.name.toLowerCase() === needle) return v;
            }
        }
        return null;
    },

    getSpriteVariableValue(sprite, varName) {
        if (!sprite) return null;
        const needle = String(varName || "").toLowerCase();
        const localVars = sprite.variables || {};
        for (const id of Object.keys(localVars)) {
            const v = localVars[id];
            if (v && typeof v.name === "string" && v.name.toLowerCase() === needle) return v.value;
        }
        const stage = sprite.runtime && sprite.runtime.getTargetForStage ? sprite.runtime.getTargetForStage() : null;
        const globalVars = (stage && stage.variables) || {};
        for (const id of Object.keys(globalVars)) {
            const v = globalVars[id];
            if (v && typeof v.name === "string" && v.name.toLowerCase() === needle) return v.value;
        }
        return null;
    },

    getSpritePosition(sprite) {
        return { x: Number(sprite && sprite.x) || 0, y: Number(sprite && sprite.y) || 0 };
    },

    calculateDistance(pos1, pos2) {
        return Math.sqrt(Math.pow((pos2.x || 0) - (pos1.x || 0), 2) + Math.pow((pos2.y || 0) - (pos1.y || 0), 2));
    },

    calculateVelocity(currentPos, lastPos) {
        return {
            x: (currentPos.x || 0) - (lastPos.x || 0),
            y: (currentPos.y || 0) - (lastPos.y || 0)
        };
    },

    getStageEdges(vm) {
        const runtime = vm && vm.runtime;
        const stage = runtime && runtime.getTargetForStage ? runtime.getTargetForStage() : null;
        if (stage && stage.renderer && stage.renderer.gl && stage.renderer.gl.canvas) {
            const width = stage.renderer.gl.canvas.width / 2;
            const height = stage.renderer.gl.canvas.height / 2;
            return { left: -width, right: width, top: height, bottom: -height };
        }
        return { left: -240, right: 240, top: 180, bottom: -180 };
    },

    detectBounce(currentVel, lastVel, axis = "both", threshold = 0.5) {
        const flipped = (cur, last) =>
            Math.abs(last) > threshold &&
            Math.sign(cur) !== Math.sign(last) &&
            Math.sign(cur) !== 0 &&
            Math.sign(last) !== 0;
        if (axis === "x") return flipped(currentVel.x, lastVel.x);
        if (axis === "y") return flipped(currentVel.y, lastVel.y);
        return flipped(currentVel.x, lastVel.x) || flipped(currentVel.y, lastVel.y);
    },

    simulateMouseMove(vm, x, y = null) {
        const mouse = vm && vm.runtime && vm.runtime.ioDevices && vm.runtime.ioDevices.mouse;
        if (!mouse) return;
        mouse._clientX = x;
        mouse._scratchX = x;
        if (y !== null) {
            mouse._clientY = y;
            mouse._scratchY = y;
        }
    },

    simulateMouseDown(vm, x, y) {
        this.simulateMouseMove(vm, x, y);
        const mouse = vm && vm.runtime && vm.runtime.ioDevices && vm.runtime.ioDevices.mouse;
        if (mouse) mouse._isDown = true;
    },

    simulateMouseUp(vm) {
        const mouse = vm && vm.runtime && vm.runtime.ioDevices && vm.runtime.ioDevices.mouse;
        if (mouse) mouse._isDown = false;
    },

    async simulateMouseClick(vm, x, y, options = {}) {
        const holdMs = Math.max(0, Number(options.holdMs ?? 80));
        const beforeDownMs = Math.max(0, Number(options.beforeDownMs ?? 0));
        const afterUpMs = Math.max(0, Number(options.afterUpMs ?? 0));

        // Ensure every call creates a fresh click edge even if prior state leaked.
        this.simulateMouseUp(vm);
        if (x !== undefined && x !== null) this.simulateMouseMove(vm, x, y);
        if (beforeDownMs > 0) await this.wait(beforeDownMs);
        this.simulateMouseDown(vm, x, y);
        if (holdMs > 0) await this.wait(holdMs);
        this.simulateMouseUp(vm);
        if (afterUpMs > 0) await this.wait(afterUpMs);
    },

    async clickSprite(vm, sprite) {
        vm.runtime.startHats("event_whenthisspriteclicked", null, sprite);
        await this.wait(200);
    },

    async simulateKeyPress(vm, key, duration = 100) {
        this.simulateKeyDown(vm, key);
        await this.wait(duration);
        this.simulateKeyUp(vm, key);
    },

    simulateKeyDown(vm, key) {
        if (vm && typeof vm.postIOData === "function") {
            vm.postIOData("keyboard", { key, isDown: true });
        }
    },

    simulateKeyUp(vm, key) {
        if (vm && typeof vm.postIOData === "function") {
            vm.postIOData("keyboard", { key, isDown: false });
        }
    },

    wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    async runCaseWithTimeout(options = {}) {
        const caseName = String(options.caseName || "case");
        const timeoutMs = Math.max(1, Number(options.timeoutMs || 1000));
        const startedAt = Date.now();
        let timedOut = false;
        let timeoutId = null;

        const buildResult = (passed, error = null, meta = {}) => ({
            name: caseName,
            passed: !!passed,
            timeout: !!timedOut,
            duration_ms: Date.now() - startedAt,
            error: error ? String(error) : null,
            meta: meta && typeof meta === "object" ? meta : {}
        });

        try {
            if (typeof options.beforeCase === "function") {
                await options.beforeCase();
            }

            const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                    timedOut = true;
                    reject(new Error(`Timeout after ${timeoutMs / 1000} seconds`));
                }, timeoutMs);
            });

            const runPromise = Promise.resolve()
                .then(() => (typeof options.run === "function" ? options.run() : true));
            const runResult = await Promise.race([runPromise, timeoutPromise]);

            if (typeof runResult === "object" && runResult !== null) {
                const passed = "passed" in runResult ? !!runResult.passed : !!runResult.success;
                return buildResult(passed, runResult.error || null, runResult.meta || {});
            }
            return buildResult(!!runResult, null, {});
        } catch (error) {
            return buildResult(false, error && error.message ? error.message : String(error), {});
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
            if (typeof options.afterCase === "function") {
                try {
                    await options.afterCase();
                } catch (e) {}
            }
        }
    },

    debugSprite(sprite, label = "Sprite", additionalInfo = {}) {
        if (!sprite) {
            console.log(`[Debug] ${label}: Not found`);
            return;
        }
        const pos = this.getSpritePosition(sprite);
        console.log(`[Debug] ${label}:`, {
            position: `(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`,
            visible: sprite.visible,
            size: sprite.size,
            direction: sprite.direction,
            ...additionalInfo
        });
    },

    isVMRunning(vm) {
        return !!(vm && vm.runtime && vm.runtime.isRunning);
    },

    startSingleSpriteScript(vm, spriteName) {
        const sprite = this.findSprite(vm, spriteName);
        if (!sprite) return false;
        vm.start();
        vm.runtime.startHats("event_whenflagclicked", null, sprite);
        return true;
    },

    startVM(vm) {
        vm.start();
        vm.greenFlag();
    },

    setupBroadcastDetection(vm, callback) {
        if (!vm || !vm.runtime || typeof callback !== "function") return () => {};
        const original = vm.runtime.startHats;
        vm.runtime.startHats = function(requestedHatOpcode, optMatchFields, optTarget) {
            try {
                if (
                    requestedHatOpcode === "event_whenbroadcastreceived" &&
                    optMatchFields &&
                    optMatchFields.BROADCAST_OPTION
                ) {
                    callback(optMatchFields.BROADCAST_OPTION, requestedHatOpcode, optMatchFields, optTarget);
                }
            } catch (e) {
                console.warn(`[BroadcastDetection] ${e.message}`);
            }
            return original.call(this, requestedHatOpcode, optMatchFields, optTarget);
        };
        return () => {
            vm.runtime.startHats = original;
        };
    },

    detectBroadcast(vm, targetBroadcasts, onDetected) {
        const targets = Array.isArray(targetBroadcasts) ? targetBroadcasts : [targetBroadcasts];
        const lowered = targets.map(x => String(x).toLowerCase());
        return this.setupBroadcastDetection(vm, (msg) => {
            if (lowered.includes(String(msg || "").toLowerCase())) onDetected(msg);
        });
    },

    _normalizeQaInputs(input) {
        if (input === undefined || input === null) return [];

        if (Array.isArray(input)) return input.map(x => String(x));

        // Support explicit multi-input object shape: { inputs: [...] }
        if (typeof input === "object") {
            if (Array.isArray(input.inputs)) return input.inputs.map(x => String(x));
            return [String(input)];
        }

        if (typeof input === "string") {
            const trimmed = input.trim();
            if (!trimmed) return [""];

            // Support encoded list-like inputs, e.g. "[12, 18]" or "['a', 'b']" or "(12, 18)".
            const looksLikeList =
                (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
                (trimmed.startsWith("(") && trimmed.endsWith(")"));

            if (looksLikeList) {
                const jsonLike = trimmed.startsWith("(")
                    ? `[${trimmed.slice(1, -1)}]`
                    : trimmed;
                const candidates = [jsonLike, jsonLike.replace(/'/g, '"')];
                for (const candidate of candidates) {
                    try {
                        const parsed = JSON.parse(candidate);
                        if (Array.isArray(parsed)) return parsed.map(x => String(x));
                    } catch (e) {}
                }
            }
            return [input];
        }

        return [String(input)];
    },

    _qaOutputMatches(actualText, expected) {
        const actual = String(actualText);
        if (typeof expected === "number") {
            const parsed = parseInt(actual, 10);
            return !Number.isNaN(parsed) && parsed === expected;
        }
        const expectedText = String(expected);
        return actual === expectedText || actual.includes(expectedText);
    },

    async runQuestionAnswerCase(vm, testCase, questionKeywords, config = {}, caseContext = {}) {
        const timeoutMs = Math.max(1, Number(config.timeout || 10)) * 1000;
        const spriteName = String(config.spriteName || "Sprite1");
        const beforeEachCase = typeof config.beforeEachCase === "function" ? config.beforeEachCase : null;
        const afterEachCase = typeof config.afterEachCase === "function" ? config.afterEachCase : null;
        const caseIndex = Math.max(0, Number(caseContext.caseIndex || 0));
        const totalCases = Math.max(1, Number(caseContext.totalCases || 1));
        const rawInput = testCase && Object.prototype.hasOwnProperty.call(testCase, "inputs")
            ? testCase.inputs
            : (testCase && testCase.input);
        const inputs = this._normalizeQaInputs(rawInput);
        const expected = testCase ? testCase.expected : "";
        const caseName = (testCase && testCase.name) || "case";
        const loweredKeywords = (questionKeywords || []).map(k => String(k).toLowerCase());

        const sprite = this.findSprite(vm, spriteName) ||
            (vm.runtime.targets || []).find(t => t.isOriginal && t.sprite && t.sprite.name !== "Stage");

        let inputIndex = 0;
        let answering = false;
        let sayListener = null;
        let lastSayText = null;
        let hookMeta = {};
        const mergeHookMeta = (payload) => {
            if (payload && typeof payload === "object" && !Array.isArray(payload)) {
                hookMeta = { ...hookMeta, ...payload };
            }
        };
        const hookContext = {
            vm,
            testCase,
            caseIndex,
            caseNumber: caseIndex + 1,
            totalCases
        };

        const caseResult = await this.runCaseWithTimeout({
            caseName,
            timeoutMs,
            beforeCase: async () => {
                try { vm.runtime.stopAll(); } catch (e) {}
                if (beforeEachCase) {
                    const beforeMeta = await beforeEachCase(hookContext);
                    mergeHookMeta(beforeMeta);
                }
            },
            run: async () => {
                return await new Promise((resolve) => {
                    let settled = false;

                    const settle = (passed, error = null, meta = {}) => {
                        if (settled) return;
                        settled = true;
                        if (sayListener) {
                            try { vm.runtime.off("SAY", sayListener); } catch (e) {}
                        }
                        resolve({ passed: !!passed, error, meta });
                    };

                    sayListener = (target, type, text) => {
                        if (!target || !target.sprite) return;
                        if (sprite && target.sprite.name !== sprite.sprite.name) return;

                        const content = String(text || "");
                        lastSayText = content;
                        const lowered = content.toLowerCase();
                        const isQuestion = loweredKeywords.some(k => lowered.includes(k)) || content.includes("?");

                        if (isQuestion && !answering && inputIndex < inputs.length) {
                            answering = true;
                            const answer = inputs[inputIndex++];
                            setTimeout(() => {
                                try { vm.runtime.emit("ANSWER", answer); } catch (e) {}
                                answering = false;
                            }, 100);
                            return;
                        }

                        // Only accept final output after all planned answers are provided.
                        if (!isQuestion && inputIndex >= inputs.length && this._qaOutputMatches(content, expected)) {
                            settle(true, null, {
                                matched_text: content,
                                answers_used: inputIndex,
                                answers_total: inputs.length
                            });
                        }
                    };

                    try {
                        vm.runtime.on("SAY", sayListener);
                        this.startVM(vm);
                    } catch (e) {
                        settle(false, String(e && e.message ? e.message : e), {});
                    }
                });
            },
            afterCase: async () => {
                if (sayListener) {
                    try { vm.runtime.off("SAY", sayListener); } catch (e) {}
                }
                try { vm.runtime.stopAll(); } catch (e) {}
                if (afterEachCase) {
                    const afterMeta = await afterEachCase(hookContext);
                    mergeHookMeta(afterMeta);
                }
            }
        });

        const mergedMeta = {
            ...(caseResult.meta && typeof caseResult.meta === "object" ? caseResult.meta : {}),
            ...hookMeta
        };
        if (!Object.prototype.hasOwnProperty.call(mergedMeta, "answers_used")) {
            mergedMeta.answers_used = inputIndex;
        }
        if (!Object.prototype.hasOwnProperty.call(mergedMeta, "answers_total")) {
            mergedMeta.answers_total = inputs.length;
        }
        if (lastSayText !== null && !Object.prototype.hasOwnProperty.call(mergedMeta, "last_say_text")) {
            mergedMeta.last_say_text = lastSayText;
        }
        caseResult.meta = mergedMeta;
        return caseResult;
    },

    async runQuestionAnswerCases(vm, testCases, questionKeywords, config = {}, cleanup) {
        const cases = Array.isArray(testCases) ? testCases : [testCases];
        const details = [];
        for (let i = 0; i < cases.length; i++) {
            const one = cases[i] || {};
            const caseWithName = { ...one, name: one.name || `case_${i + 1}` };
            const result = await this.runQuestionAnswerCase(
                vm,
                caseWithName,
                questionKeywords,
                config,
                { caseIndex: i, totalCases: cases.length }
            );
            details.push(result);
            if (i < cases.length - 1) await this.wait(150);
        }
        if (typeof cleanup === "function") cleanup();

        const passedTests = details.filter(d => d.passed).length;
        const totalTests = details.length;
        return {
            success: passedTests === totalTests,
            passed_tests: passedTests,
            total_tests: totalTests,
            partial_success_rate: totalTests > 0 ? passedTests / totalTests : 0,
            details
        };
    },

    async runQuestionAnswerTestsDetailed(vm, testCases, questionKeywords, config = {}, cleanup) {
        return this.runQuestionAnswerCases(vm, testCases, questionKeywords, config, cleanup);
    }
};

module.exports = EvaluationUtils;
