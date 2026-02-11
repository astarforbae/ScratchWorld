/**
 * Instruction: Starting from an empty Scratch project with a single default sprite named 'Sprite1', you should complete the following: 1) When the green flag is clicked, make Sprite1 continuously change its size to create a pulsing effect. 2) Increase size smoothly up to about 150%, then decrease smoothly down to about 50%. 3) Repeat this cycle forever.
 * Unit Test Semantic Goals:
 * 1) 'Sprite1' size oscillates between about 50% and 150%.
 * 2) Size changes smoothly through intermediate values (no abrupt jumps).
 * 3) Pulsing cycle repeats at least twice in a forever loop.
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const caseTimeoutMs = timeoutSec * 1000;

  const runCase = async (caseName, runner) => EU.runCaseWithTimeout({
    caseName,
    timeoutMs: caseTimeoutMs,
    beforeCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
      await EU.wait(160);
      EU.startVM(vm);
      await EU.wait(500);
    },
    run: async () => runner(),
    afterCase: async () => {
      try { vm.runtime.stopAll(); } catch (e) {}
    },
  });

  const details = [];
  try {
    details.push(await runCase("sprite1_size_pulses_between_50_and_150_repeatedly", async () => {
      const testResult = await new Promise((resolve, reject) => {
        const minSize = 50;
        const maxSize = 150;
        const sizeThreshold = 10;

        let sprite = null;
        let sizeHistory = [];
        let lastSize = null;
        let minSizeReached = false;
        let maxSizeReached = false;
        let cycleCount = 0;
        let lastDirection = null;
        let monitorInterval = null;

        const findSprite = () => {
          sprite = EU.findSprite(vm, "Sprite1", ["Sprite1", "Cat"]);
          if (sprite) {
            lastSize = sprite.size;
            console.log(`[Size Pulse] Found sprite with initial size: ${sprite.size}%`);
          }
          return sprite;
        };

        const monitorSize = () => {
          if (!sprite) return;

          const currentSize = sprite.size;
          
          if (Math.abs(currentSize - lastSize) > 1) {
            sizeHistory.push({ size: currentSize, timestamp: Date.now() });
            
            if (currentSize <= minSize + sizeThreshold && !minSizeReached) {
              minSizeReached = true;
              console.log(`[Size Pulse] Minimum size reached: ${currentSize}%`);
            }
            
            if (currentSize >= maxSize - sizeThreshold && !maxSizeReached) {
              maxSizeReached = true;
              console.log(`[Size Pulse] Maximum size reached: ${currentSize}%`);
            }
            
            const direction = currentSize > lastSize ? 'increasing' : 'decreasing';
            if (lastDirection && lastDirection !== direction) {
              cycleCount++;
              console.log(`[Size Pulse] Cycle ${cycleCount} detected`);
            }
            lastDirection = direction;
            lastSize = currentSize;
          }

          // Check completion
          const hasMinMax = minSizeReached && maxSizeReached;
          const hasCycles = cycleCount >= 2;
          const hasSmoothing = sizeHistory.length >= 10;

          if (hasMinMax && hasCycles && hasSmoothing) {
            clearInterval(monitorInterval);
            resolve(true);
          }
        };

        // Start monitoring
        if (findSprite()) {
          vm.greenFlag();
          monitorInterval = setInterval(monitorSize, 100);
        } else {
          reject(new Error('Sprite not found'));
        }
      });

      return { passed: !!testResult, meta: {} };
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
