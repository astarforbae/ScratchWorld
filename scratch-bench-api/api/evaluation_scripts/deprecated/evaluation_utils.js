/**
 * Evaluation Utilities for Scratch VM Testing
 * 
 * This module provides common utility functions for evaluating Scratch projects,
 * including sprite finding, position tracking, collision detection, and debugging helpers.
 */

const EvaluationUtils = {
    /**
     * Find a sprite by name with fallback options
     * @param {Object} vm - Scratch VM instance
     * @param {string} spriteName - Primary sprite name to search for
     * @param {Array<string>} fallbackNames - Alternative names to try
     * @returns {Object|null} Found sprite target or null
     */
    findSprite(vm, spriteName, fallbackNames = []) {
        const allNames = [spriteName, ...fallbackNames];
        
        for (const name of allNames) {
            const sprite = vm.runtime.targets.find(t => 
                t.isOriginal && t.sprite && 
                t.sprite.name.toLowerCase().includes(name.toLowerCase())
            );
            if (sprite) {
                console.log(`[Found] Sprite: "${sprite.sprite.name}" (searched for: ${name})`);
                return sprite;
            }
        }
        
        console.log(`[Not Found] Sprite with names: ${allNames.join(', ')}`);
        return null;
    },

    /**
     * Find a variable by name across all targets
     * @param {Object} vm - Scratch VM instance
     * @param {string} name - The name of the variable to find
     * @returns {Object|null} Found variable object, or null if not found
     */
    findVariableByName(vm, name) {
        const lower = name.toLowerCase();
        for (const t of vm.runtime.targets) {
            const vars = t.variables || {};
            for (const id in vars) {
                const v = vars[id];
                if (v && typeof v.name === 'string' && v.name.toLowerCase() === lower) {
                    return v;
                }
            }
        }
        return null;
    },

    /**
     * Get the value of a variable for a specific sprite (checks local then global)
     * @param {Object} sprite - Sprite target
     * @param {string} varName - Name of the variable
     * @returns {*} Value of the variable or null if not found
     */
    getSpriteVariableValue(sprite, varName) {
        if (!sprite) return null;
        const lower = varName.toLowerCase();
        
        // 1. Check local variables
        if (sprite.variables) {
            for (const id in sprite.variables) {
                const v = sprite.variables[id];
                if (v && v.name.toLowerCase() === lower) {
                    return v.value;
                }
            }
        }
        
        // 2. Check global variables (on Stage)
        const stage = sprite.runtime.getTargetForStage();
        if (stage && stage.variables) {
            for (const id in stage.variables) {
                const v = stage.variables[id];
                if (v && v.name.toLowerCase() === lower) {
                    return v.value;
                }
            }
        }
        
        return null;
    },

    /**
     * Get sprite position as an object
     * @param {Object} sprite - Sprite target
     * @returns {Object} Position object with x and y coordinates
     */
    getSpritePosition(sprite) {
        return { x: sprite.x, y: sprite.y };
    },

    /**
     * Print sprite location with optional label
     * @param {Object} sprite - Sprite target
     * @param {string} label - Optional label for the sprite
     */
    printSpriteLocation(sprite, label = "Sprite") {
        if (sprite) {
            console.log(`[${label}] Position: (${sprite.x.toFixed(1)}, ${sprite.y.toFixed(1)})`);
        } else {
            console.log(`[${label}] Not found or invalid`);
        }
    },

    /**
     * Calculate distance between two positions
     * @param {Object} pos1 - First position {x, y}
     * @param {Object} pos2 - Second position {x, y}
     * @returns {number} Distance between positions
     */
    calculateDistance(pos1, pos2) {
        return Math.sqrt(
            Math.pow(pos2.x - pos1.x, 2) + 
            Math.pow(pos2.y - pos1.y, 2)
        );
    },

    /**
     * Calculate velocity between two positions over time
     * @param {Object} currentPos - Current position {x, y}
     * @param {Object} lastPos - Previous position {x, y}
     * @returns {Object} Velocity object {x, y}
     */
    calculateVelocity(currentPos, lastPos) {
        return {
            x: currentPos.x - lastPos.x,
            y: currentPos.y - lastPos.y
        };
    },

    /**
     * Get stage boundaries from VM runtime
     * @param {Object} vm - Scratch VM instance
     * @returns {Object} Stage boundaries {left, right, top, bottom}
     */
    getStageEdges(vm) {
        const stage = vm.runtime.getTargetForStage();
        if (stage && stage.renderer) {
            // Get stage dimensions from renderer
            const stageWidth = stage.renderer.gl.canvas.width / 2;
            const stageHeight = stage.renderer.gl.canvas.height / 2;
            return {
                left: -stageWidth,
                right: stageWidth,
                top: stageHeight,
                bottom: -stageHeight
            };
        }
        // Fallback to standard Scratch stage dimensions
        return {
            left: -240,
            right: 240,
            top: 180,
            bottom: -180
        };
    },

    /**
     * Check if sprite is near screen edge using sprite bounds
     * @param {Object} sprite - Sprite target
     * @param {Object} vm - Scratch VM instance
     * @param {number} threshold - Distance threshold from edge
     * @returns {Object} Object indicating which edges are near
     */
    checkNearEdges(sprite, vm, threshold = 20) {
        const edges = this.getStageEdges(vm);
        const bounds = sprite.getBounds();
        
        return {
            left: bounds.left <= edges.left + threshold,
            right: bounds.right >= edges.right - threshold,
            top: bounds.top >= edges.top - threshold,
            bottom: bounds.bottom <= edges.bottom + threshold,
            any: bounds.left <= edges.left + threshold || 
                 bounds.right >= edges.right - threshold || 
                 bounds.top >= edges.top - threshold || 
                 bounds.bottom <= edges.bottom + threshold
        };
    },

    /**
     * Check collision between two sprites using bounding boxes
     * @param {Object} sprite1 - First sprite
     * @param {Object} sprite2 - Second sprite
     * @param {Object} sizes - Size estimates {sprite1: {width, height}, sprite2: {width, height}}
     * @param {number} threshold - Additional collision threshold (default: 10)
     * @returns {boolean} True if sprites are colliding
     */
    checkCollision(sprite1, sprite2, sizes = {}, threshold = 10) {
        const pos1 = this.getSpritePosition(sprite1);
        const pos2 = this.getSpritePosition(sprite2);
        
        const size1 = sizes.sprite1;
        const size2 = sizes.sprite2;

        return Math.abs(pos1.x - pos2.x) < (size1.width/2 + size2.width/2 + threshold) &&
               Math.abs(pos1.y - pos2.y) < (size1.height/2 + size2.height/2 + threshold);
    },

    /**
     * Check if ball bounced by comparing velocity changes
     * @param {Object} currentVel - Current velocity {x, y}
     * @param {Object} lastVel - Previous velocity {x, y}
     * @param {string} axis - Axis to check ('x', 'y', or 'both')
     * @param {number} threshold - Minimum velocity threshold
     * @returns {boolean} True if bounce detected
     */
    detectBounce(currentVel, lastVel, axis = 'both', threshold = 0.5) {
        const checkAxis = (current, last) => {
            return Math.abs(last) > threshold && 
                   Math.sign(current) !== Math.sign(last) &&
                   Math.sign(current) !== 0 && Math.sign(last) !== 0;
        };

        switch (axis) {
            case 'x':
                return checkAxis(currentVel.x, lastVel.x);
            case 'y':
                return checkAxis(currentVel.y, lastVel.y);
            case 'both':
                return checkAxis(currentVel.x, lastVel.x) || checkAxis(currentVel.y, lastVel.y);
            default:
                return false;
        }
    },

    /**
     * Simulate mouse movement for testing
     * @param {Object} vm - Scratch VM instance
     * @param {number} x - Target X coordinate
     * @param {number} y - Target Y coordinate (optional)
     */
    simulateMouseMove(vm, x, y = null) {
        vm.runtime.ioDevices.mouse._clientX = x;
        vm.runtime.ioDevices.mouse._scratchX = x;
        if (y !== null) {
            vm.runtime.ioDevices.mouse._clientY = y;
            vm.runtime.ioDevices.mouse._scratchY = y;
        }
    },

    /**
     * Simulate mouse movement for testing
     * @param {Object} vm - Scratch VM instance
     * @param {number} x - Target X coordinate
     * @param {number} y - Target Y coordinate
     */
    simulateMouseDown(vm, x, y) {
        vm.runtime.ioDevices.mouse._clientX = x;
        vm.runtime.ioDevices.mouse._scratchX = x;
        vm.runtime.ioDevices.mouse._clientY = y;
        vm.runtime.ioDevices.mouse._scratchY = y;
        vm.runtime.ioDevices.mouse._isDown = true;
    },

    simulateMouseUp(vm) {
        vm.runtime.ioDevices.mouse._isDown = false;
    },

    /**
     * Simulate clicking a sprite to trigger "when this sprite clicked" events
     * @param {Object} vm - Scratch VM instance
     * @param {Object} sprite - The sprite target to click
     */
    async clickSprite(vm, sprite) {
        vm.runtime.startHats('event_whenthisspriteclicked', null, sprite);
        await this.wait(200);
    },

    /**
     * Simulate key press and release
     * @param {Object} vm - Scratch VM instance
     * @param {string} key - Key to press (DOM key string, e.g., ' ' for space, 'a', 'ArrowUp')
     * @param {number} duration - Duration to hold key in milliseconds (default: 100)
     */
    async simulateKeyPress(vm, key, duration = 100) {
        console.log(`[KeySim] Simulate pressing: ${key}`)
        // Press key
        vm.runtime.ioDevices.keyboard.postData({
            key: key,
            isDown: true
        });
        
        // Hold for duration
        await this.wait(duration);
        
        // Release key
        vm.runtime.ioDevices.keyboard.postData({
            key: key,
            isDown: false
        });
    },

    /**
     * Simulate key down (press without release)
     * @param {Object} vm - Scratch VM instance
     * @param {string} key - Key to press down
     */
    simulateKeyDown(vm, key) {
        vm.runtime.ioDevices.keyboard.postData({
            key: key,
            isDown: true
        });
    },

    /**
     * Simulate key up (release)
     * @param {Object} vm - Scratch VM instance
     * @param {string} key - Key to release
     */
    simulateKeyUp(vm, key) {
        vm.runtime.ioDevices.keyboard.postData({
            key: key,
            isDown: false
        });
    },
    /**
     * Simulate holding multiple keys while sending other key presses
     * @param {Object} vm - Scratch VM instance
     * @param {Array<string>} holdKeys - Array of keys to hold down (e.g., [' ', 'a'])
     * @param {Array<Object>} keySequence - Array of key actions to perform while holding
     *   Each object should have: {key: string, duration?: number, delay?: number}
     * @param {Object} options - Configuration options
     * @param {number} options.holdDuration - Total time to hold the keys (default: 2000ms)
     * @param {number} options.releaseDelay - Delay before releasing held keys (default: 100ms)
     * @returns {Promise} Promise that resolves when all actions are complete
     * 
     * @example
     * // Hold space and press right arrow twice
     * await EvaluationUtils.simulateHoldKeysAndPress(vm, [' '], [
     *   {key: 'ArrowRight', duration: 100, delay: 0},
     *   {key: 'ArrowRight', duration: 100, delay: 200}
     * ], {holdDuration: 1000});
     */
    async simulateHoldKeysAndPress(vm, holdKeys = [], keySequence = [], options = {}) {
        const config = {
            holdDuration: options.holdDuration || 2000,
            releaseDelay: options.releaseDelay || 100,
            ...options
        };

        console.log(`[KeySim] Starting hold-and-press simulation`);
        console.log(`[KeySim] Holding keys: [${holdKeys.join(', ')}] for ${config.holdDuration}ms`);
        console.log(`[KeySim] Key sequence: ${keySequence.length} actions`);

        // Step 1: Press down all hold keys
        for (const key of holdKeys) {
            console.log(`[KeySim] Pressing down hold key: "${key}"`);
            this.simulateKeyDown(vm, key);
        }
        
        await this.wait(100);

        // Step 2: Execute key sequence while holding
        const startTime = Date.now();
        let sequencePromises = [];

        for (let i = 0; i < keySequence.length; i++) {
            const action = keySequence[i];
            const actionDelay = action.delay || 0;
            const actionDuration = action.duration || 100;

            // Create a promise for this key action
            const actionPromise = (async () => {
                // Wait for the specified delay
                if (actionDelay > 0) {
                    await this.wait(actionDelay);
                }

                // Check if we're still within the hold duration
                const elapsed = Date.now() - startTime;
                if (elapsed < config.holdDuration) {
                    console.log(`[KeySim] Executing key action ${i + 1}: "${action.key}" (duration: ${actionDuration}ms)`);
                    await this.simulateKeyPress(vm, action.key, actionDuration);
                } else {
                    console.log(`[KeySim] Skipping key action ${i + 1}: hold duration exceeded`);
                }
            })();

            sequencePromises.push(actionPromise);
        }

        // Step 3: Wait for either all sequences to complete or hold duration to expire
        const holdPromise = this.wait(config.holdDuration);
        const sequencePromise = Promise.all(sequencePromises);

        await Promise.race([holdPromise, sequencePromise]);

        // Step 4: Wait a bit before releasing (to ensure last key press is registered)
        if (config.releaseDelay > 0) {
            await this.wait(config.releaseDelay);
        }

        // Step 5: Release all held keys
        for (const key of holdKeys) {
            console.log(`[KeySim] Releasing hold key: "${key}"`);
            this.simulateKeyUp(vm, key);
        }

        console.log(`[KeySim] Hold-and-press simulation completed`);
    },

    /**
     * Simulate complex key combinations with timing control
     * @param {Object} vm - Scratch VM instance
     * @param {Array<Object>} keyActions - Array of key action objects
     *   Each object: {type: 'press'|'hold'|'release', key: string, duration?: number, delay?: number}
     * @returns {Promise} Promise that resolves when all actions are complete
     * 
     * @example
     * // Hold space, press right arrow, release space, press left arrow
     * await EvaluationUtils.simulateKeySequence(vm, [
     *   {type: 'hold', key: ' '},
     *   {type: 'press', key: 'ArrowRight', duration: 100, delay: 200},
     *   {type: 'release', key: ' ', delay: 300},
     *   {type: 'press', key: 'ArrowLeft', duration: 100, delay: 100}
     * ]);
     */
    async simulateKeySequence(vm, keyActions = []) {
        console.log(`[KeySeq] Starting key sequence with ${keyActions.length} actions`);

        for (let i = 0; i < keyActions.length; i++) {
            const action = keyActions[i];
            const delay = action.delay || 0;
            const duration = action.duration || 100;

            // Wait for delay if specified
            if (delay > 0) {
                await this.wait(delay);
            }

            console.log(`[KeySeq] Action ${i + 1}: ${action.type} "${action.key}"`);

            switch (action.type) {
                case 'press':
                    await this.simulateKeyPress(vm, action.key, duration);
                    break;
                case 'hold':
                    this.simulateKeyDown(vm, action.key);
                    break;
                case 'release':
                    this.simulateKeyUp(vm, action.key);
                    break;
                default:
                    console.warn(`[KeySeq] Unknown action type: ${action.type}`);
            }
        }

        console.log(`[KeySeq] Key sequence completed`);
    },

    /**
     * Wait for a specified amount of time
     * @param {number} ms - Milliseconds to wait
     * @returns {Promise} Promise that resolves after the specified time
     */
    wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    /**
     * Create a test timeout handler
     * @param {number} timeoutMs - Timeout in milliseconds
     * @param {Function} onTimeout - Function to call on timeout
     * @returns {number} Timeout ID
     */
    createTimeout(timeoutMs, onTimeout) {
        return setTimeout(() => {
            console.log(`[TIMEOUT] Test timed out after ${timeoutMs/1000} seconds`);
            onTimeout();
        }, timeoutMs);
    },

    /**
     * Clean up intervals and timeouts
     * @param {Array} timers - Array of timer IDs to clear
     */
    cleanupTimers(timers) {
        timers.forEach(timer => {
            if (timer) {
                clearInterval(timer);
                clearTimeout(timer);
            }
        });
    },

    /**
     * Log debug information about sprite state
     * @param {Object} sprite - Sprite to debug
     * @param {string} label - Label for the sprite
     * @param {Object} additionalInfo - Additional information to log
     */
    debugSprite(sprite, label = "Sprite", additionalInfo = {}) {
        if (!sprite) {
            console.log(`[Debug] ${label}: Not found`);
            return;
        }

        const pos = this.getSpritePosition(sprite);
        const info = {
            position: `(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)})`,
            visible: sprite.visible,
            size: sprite.size,
            direction: sprite.direction,
            ...additionalInfo
        };

        console.log(`[Debug] ${label}:`, info);
    },

    /**
     * Check if VM is still running
     * @param {Object} vm - Scratch VM instance
     * @returns {boolean} True if VM is running
     */
    isVMRunning(vm) {
        return vm.runtime.isRunning;
    },

    /**
     * Add collision event listener between two sprites
     * @param {Object} vm - Scratch VM instance
     * @param {Object} sprite1 - First sprite to monitor
     * @param {Object} sprite2 - Second sprite to monitor
     * @param {Function} callback - Function to call when collision detected
     * @returns {Function} Cleanup function to remove the listener
     */
    addCollisionListener(vm, sprite1, sprite2, callback) {
        let lastCollisionState = false;
        
        const checkCollision = () => {
            try {
                // Use Scratch's built-in collision detection
                const touching = vm.runtime.targets.some(target => {
                    if (target === sprite1) {
                        return target.isTouchingObject(sprite2.sprite.name);
                    }
                    return false;
                });

                // Trigger callback on collision state change
                if (touching && !lastCollisionState) {
                    callback(sprite1, sprite2, true); // collision started
                } else if (!touching && lastCollisionState) {
                    callback(sprite1, sprite2, false); // collision ended
                }
                
                lastCollisionState = touching;
            } catch (error) {
                console.log(`[Debug] Collision check error: ${error.message}`);
            }
        };
        
        const intervalId = setInterval(checkCollision, 16); // 60 FPS
        
        // Return cleanup function
        return () => clearInterval(intervalId);
    },

    /**
     * Start the script of a single sprite only
     * @param {Object} vm - Scratch VM instance
     * @param {string} spriteName - Name of the sprite to start
     * @returns {boolean} True if sprite was found and started, false otherwise
     */
    startSingleSpriteScript(vm, spriteName) {
        const sprite = this.findSprite(vm, spriteName);
        if (!sprite) {
            console.log(`[VM] Could not find sprite "${spriteName}" to start`);
            return false;
        }
        
        vm.start();
        
        // Start only the scripts for this specific sprite
        vm.runtime.startHats('event_whenflagclicked', null, sprite);
        
        console.log(`[VM] Started scripts for sprite "${sprite.sprite.name}" only`);
        return true;
    },

    /**
     * Start VM and green flag
     * @param {Object} vm - Scratch VM instance
     */
    startVM(vm) {
        vm.start();
        vm.greenFlag();
        console.log('[VM] Started and green flag clicked');
    },

    /**
     * Set up broadcast message detection by hooking into the VM's startHats function
     * @param {Object} vm - Scratch VM instance
     * @param {Function} callback - Callback function to handle detected broadcasts
     *   Callback receives: (broadcastMessage, requestedHatOpcode, optMatchFields, optTarget)
     * @returns {Function} Cleanup function to restore original startHats
     * 
     * @example
     * // Detect 'timeup' broadcasts
     * const cleanupBroadcast = EvaluationUtils.setupBroadcastDetection(vm, (broadcastMsg) => {
     *   if (broadcastMsg && broadcastMsg.toLowerCase() === 'timeup') {
     *     console.log('Timeup broadcast detected!');
     *     broadcastDetected = true;
     *   }
     * });
     * 
     * // Later, clean up
     * cleanupBroadcast();
     */
    setupBroadcastDetection(vm, callback) {
        if (!vm || !vm.runtime || typeof callback !== 'function') {
            console.warn('[BroadcastDetection] Invalid parameters provided');
            return () => {}; // Return no-op cleanup function
        }

        // Store the original startHats function
        const originalStartHats = vm.runtime.startHats;
        
        // Replace startHats with our intercepting version
        vm.runtime.startHats = function(requestedHatOpcode, optMatchFields, optTarget) {
            try {
                // Check if this is a broadcast event
                if (requestedHatOpcode === 'event_whenbroadcastreceived' && 
                    optMatchFields && 
                    optMatchFields.BROADCAST_OPTION) {
                    
                    const broadcastMsg = optMatchFields.BROADCAST_OPTION;
                    console.log(`[BroadcastDetection] Broadcast detected: "${broadcastMsg}"`);
                    
                    // Call the user's callback with the broadcast message
                    callback(broadcastMsg, requestedHatOpcode, optMatchFields, optTarget);
                }
            } catch (error) {
                console.warn(`[BroadcastDetection] Error in broadcast detection: ${error.message}`);
            }
            
            // Always call the original startHats function to maintain normal VM behavior
            return originalStartHats.call(this, requestedHatOpcode, optMatchFields, optTarget);
        };

        // Return cleanup function to restore original startHats
        return () => {
            try {
                vm.runtime.startHats = originalStartHats;
                console.log('[BroadcastDetection] Cleanup completed - original startHats restored');
            } catch (error) {
                console.warn(`[BroadcastDetection] Error during cleanup: ${error.message}`);
            }
        };
    },

    /**
     * Simplified broadcast detection for specific broadcast messages
     * @param {Object} vm - Scratch VM instance
     * @param {string|Array<string>} targetBroadcasts - Broadcast message(s) to detect (case-insensitive)
     * @param {Function} onDetected - Callback when target broadcast is detected
     * @returns {Function} Cleanup function
     * 
     * @example
     * // Detect 'timeup' broadcast
     * const cleanup = EvaluationUtils.detectBroadcast(vm, 'timeup', () => {
     *   console.log('Timeup broadcast detected!');
     *   broadcastDetected = true;
     * });
     */
    detectBroadcast(vm, targetBroadcasts, onDetected) {
        const targets = Array.isArray(targetBroadcasts) ? 
            targetBroadcasts.map(b => b.toLowerCase()) : 
            [targetBroadcasts.toLowerCase()];

        return this.setupBroadcastDetection(vm, (broadcastMsg) => {
            if (broadcastMsg && targets.includes(broadcastMsg.toLowerCase())) {
                console.log(`[BroadcastDetection] Target broadcast "${broadcastMsg}" detected!`);
                onDetected(broadcastMsg);
            }
        });
    },

    /**
     * Reusable evaluation function for MBPP tasks with question-answer pattern
     * @param {Object} vm - Scratch VM instance
     * @param {Array} testCases - Array of test cases with input and expected output
     * @param {Array} questionKeywords - Keywords to detect questions (all lowercase)
     * @param {Object} config - Configuration object with timeout and spriteName
     * @param {Function} cleanup - Cleanup function
     * @returns {Promise<boolean>} True if all tests pass, false otherwise
     */
    runQuestionAnswerTests(vm, testCases, questionKeywords, config = {}, cleanup) {
        return new Promise((resolve, reject) => {
            console.log('[Question-Answer Test] Starting evaluation');

            const testConfig = {
                timeout: (config.timeout || 15) * 1000,
                spriteName: config.spriteName || "Sprite1",
                testCases: testCases
            };

            let testResults = [];

            function runSingleTest(testCase, testIndex) {
                return new Promise((resolveTest, rejectTest) => {
                    // Prepare inputs - handle both single values and arrays
                    let inputs = [];
                    if (Array.isArray(testCase.input)) {
                        inputs = testCase.input;
                    } else if (typeof testCase.input === 'string' && testCase.input.startsWith('[') && testCase.input.endsWith(']')) {
                        try {
                            // Try to parse string representation of array if it exists (e.g. "[1, 2]")
                            const parsed = JSON.parse(testCase.input.replace(/'/g, '"'));
                            inputs = Array.isArray(parsed) ? parsed : [testCase.input];
                        } catch (e) {
                            inputs = [testCase.input];
                        }
                    } else {
                        inputs = [testCase.input];
                    }

                    console.log(`[Test ${testIndex + 1}] Testing inputs: ${JSON.stringify(inputs)} -> expected: ${testCase.expected}`);

                    let sprite = null;
                    let testCompleted = false;
                    let isAnswering = false;
                    let lastAnsweredQuestion = null;
                    let timeoutTimer = null;
                    let inputIndex = 0;

                    function findSprite() {
                        sprite = vm.runtime.targets.find(t =>
                            t.isOriginal && t.sprite && t.sprite.name === testConfig.spriteName
                        );
                        if (!sprite) {
                            sprite = vm.runtime.targets.find(t => t.isOriginal && t.sprite && t.sprite.name !== 'Stage');
                        }
                    }

                    function cleanupTest(success, message = "") {
                        console.log(`[DEBUG] cleanupTest called with success: ${success}, message: ${message}`);
                        clearTimeout(timeoutTimer);
                        testCompleted = true;
                        
                        // Ensure VM is stopped
                        vm.runtime.stopAll();
                        
                        if (success) {
                            console.log(`[✓] Test ${testIndex + 1}: Passed - ${JSON.stringify(testCase.input)} = ${testCase.expected}`);
                            resolveTest(true);
                        } else {
                            console.log(`[✗] Test ${testIndex + 1}: Failed - ${message}`);
                            resolveTest(false);
                        }
                    }

                    // Listen for SAY events
                    const sayListener = (target, type, text) => {
                        try {
                            // if (!target || !target.sprite || target.sprite.name !== testConfig.spriteName || testCompleted) {
                            if (!target || !target.sprite || target.sprite.name !== testConfig.spriteName || testCompleted) {
                                return;
                            }

                            console.log(`[Test ${testIndex + 1}] Sprite says: "${text}"`);

                            // Convert text to string to handle numbers
                            const textStr = String(text).toLowerCase();
                            
                            // Check if asking for input using provided keywords
                            const isQuestion = questionKeywords.some(keyword => textStr.includes(keyword));
                            
                            if (isQuestion) {
                                if (!isAnswering && textStr !== lastAnsweredQuestion) {
                                    // If we've already used all inputs, don't answer again
                                    if (inputIndex >= inputs.length) {
                                        console.log(`[Test ${testIndex + 1}] Question detected but all inputs already used (${inputs.length})`);
                                        return;
                                    }

                                    isAnswering = true;
                                    lastAnsweredQuestion = textStr;
                                    const currentInput = inputs[inputIndex];
                                    inputIndex++;

                                    setTimeout(() => {
                                        console.log(`[Test ${testIndex + 1}] Answering question ${inputIndex} ("${textStr}") with: ${currentInput}`);
                                        vm.runtime.emit('ANSWER', currentInput);
                                        isAnswering = false;
                                    }, 500);
                                }
                                return;
                            } else {
                                // If it's not a question (e.g. empty string or result), 
                                // reset lastAnsweredQuestion to allow answering the same question again if it's asked later
                                if (textStr === "" || !isQuestion) {
                                    lastAnsweredQuestion = null;
                                }
                            }

                            // Check if displaying result - compare with expected output
                            const originalText = String(text);
                            
                            console.log(`[DEBUG] Comparing originalText="${originalText}" vs expected="${testCase.expected}" (type: ${typeof testCase.expected})`);
                            
                            // Handle comparison based on expected type
                            if (typeof testCase.expected === 'number') {
                                // Expected is a number, try to parse the output as number
                                const numericResult = parseInt(originalText);
                                if (!isNaN(numericResult)) {
                                    console.log(`[DEBUG] Numeric comparison: ${numericResult} === ${testCase.expected}`);
                                    if (numericResult === testCase.expected) {
                                        cleanupTest(true);
                                        return;
                                    } else {
                                        cleanupTest(false, `Expected ${testCase.expected}, got ${numericResult}`);
                                        return;
                                    }
                                }
                            } else {
                                // Expected is a string, compare as strings
                                console.log(`[DEBUG] String comparison: "${originalText}" === "${testCase.expected}"`);
                                
                                // Direct string match
                                if (originalText === testCase.expected) {
                                    console.log(`[DEBUG] Exact string match found!`);
                                    cleanupTest(true);
                                    return;
                                }
                                
                                // Check if the text contains the expected result
                                if (originalText.includes(testCase.expected)) {
                                    console.log(`[DEBUG] Contains match found!`);
                                    cleanupTest(true);
                                    return;
                                }
                            }
                            // If we get here, the result doesn't match - but don't fail immediately
                            // as there might be more output coming
                        } catch (error) {
                            console.log(`[ERROR] Exception in sayListener: ${error.message}`);
                            vm.runtime.off('SAY', sayListener);
                            cleanupTest(false, `Error: ${error.message}`);
                        }
                    };

                    vm.runtime.on('SAY', sayListener);

                    // Start the VM for this test
                    findSprite();
                    EvaluationUtils.startVM(vm);

                    // Set timeout for this individual test
                    timeoutTimer = setTimeout(() => {
                        vm.runtime.off('SAY', sayListener);
                        cleanupTest(false, `Timeout after ${testConfig.timeout / 1000} seconds`);
                    }, testConfig.timeout);
                });
            }

            async function runAllTests() {
                try {
                    for (let i = 0; i < testConfig.testCases.length; i++) {
                        const testCase = testConfig.testCases[i];
                        const result = await runSingleTest(testCase, i);
                        testResults.push(result);

                        // Stop VM and restart for next test (except for the last test)
                        if (i < testConfig.testCases.length - 1) {
                            vm.runtime.stopAll();
                            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait between tests
                        }
                    }

                    // Evaluate final results and construct partial success metrics
                    const passedTests = testResults.filter(r => r).length;
                    const totalTests = testResults.length;
                    const allPassed = passedTests === totalTests;
                    const partialSuccessRate = totalTests > 0 ? passedTests / totalTests : 0;

                    const resultPayload = {
                        success: allPassed,
                        all_passed: allPassed,
                        passed_tests: passedTests,
                        total_tests: totalTests,
                        partial_success_rate: partialSuccessRate,
                        details: testResults.map((r, idx) => ({ index: idx + 1, passed: !!r }))
                    };

                    cleanup();

                    if (allPassed) {
                        console.log(`[✓] All question-answer tests passed (${passedTests}/${totalTests})`);
                    } else {
                        console.log(`[✗] Question-answer tests failed: ${passedTests}/${totalTests} passed`);
                    }
                    // Return boolean for simple success/failure checks
                    // Callers expecting detailed metrics should use runQuestionAnswerTestsDetailed instead
                    resolve(allPassed);
                } catch (error) {
                    cleanup();
                    console.log(`[✗] Error during testing: ${error.message}`);
                    // Return false on error for simple boolean checks
                    resolve(false);
                }
            }

            runAllTests();
        });
    },

    /**
     * Browser-compatible assertion functions
     */
    assert: {
        /**
         * Assert that two values are strictly equal
         * @param {*} actual - Actual value
         * @param {*} expected - Expected value
         * @param {string} message - Error message
         */
        strictEqual(actual, expected, message) {
            if (actual !== expected) {
                throw new Error(message || `Expected ${expected}, but got ${actual}`);
            }
        },

        /**
         * Assert that a condition is true
         * @param {*} condition - Condition to test
         * @param {string} message - Error message
         */
        ok(condition, message) {
            if (!condition) {
                throw new Error(message || 'Assertion failed');
            }
        }
    },

    /**
     * Standardize evaluation response to match the target schema
     * @param {Object} result - The evaluation result object
     * @param {string} evaluationMethod - The evaluation method used
     * @param {string} message - Optional message
     * @param {string} status - Status of the evaluation
     * @param {string} stdout - Standard output
     * @returns {Object} Standardized response object
     */
    standardizeResponse(result, evaluationMethod = 'automated', message = '', status = 'completed', stdout = '') {
        return {
            evaluation_method: evaluationMethod,
            message: message,
            result: {
                details: result.details || [],
                partial_success_rate: result.partial_success_rate || 0,
                passed_tests: result.passed_tests || 0,
                success: result.success || false,
                total_tests: result.total_tests || 0
            },
            status: status,
            stdout: stdout
        };
    }
};

module.exports = EvaluationUtils;
