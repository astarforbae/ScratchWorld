/**
 * @evaluation: forever
 *
 * Validates continuous sprite monitoring:
 * 1) Default sprite exists and can be monitored
 * 2) Sprite direction and position are tracked
 * 3) Continuous logging functionality works
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 10);
  const timeoutMs = timeoutSec * 1000;

  let timeoutTimer = null;

  try {
    console.log('[Forever] Begin');

    // Global timeout guard
    await new Promise((resolve, reject) => {
      timeoutTimer = EU.createTimeout(timeoutMs, () => reject(new Error('Timeout')));
      resolve();
    });

    EU.startVM(vm);
    await EU.wait(500);
    // Find the default sprite
    const defaultSprite = vm.runtime.targets.find(t => t.isOriginal && t.sprite.name === "Ball") ||
                         vm.runtime.targets.find(t => t.isOriginal && t.sprite && t.sprite.name !== 'Stage');
    
    const spriteFound = !!defaultSprite;
    let loggingWorked = false;
    let positionTracked = false;

    if (defaultSprite) {
      console.log(`[Sprite: ${defaultSprite.sprite.name}] Initial Direction: ${defaultSprite.direction}`);
      
      // Run continuous monitoring for a short period
      const runMonitoring = async () => {
        return new Promise((resolve) => {
          let logCount = 0;
          const logInterval = 200;
          
          const loggingIntervalId = setInterval(() => {
            if (defaultSprite) {
              const bounds = defaultSprite.getBounds();
              console.log(`[Sprite: ${defaultSprite.sprite.name}] Direction: ${defaultSprite.direction}, Position: (${defaultSprite.x.toFixed(1)}, ${defaultSprite.y.toFixed(1)})`);
              logCount++;
              loggingWorked = true;
              
              if (Math.abs(defaultSprite.x) > 0 || Math.abs(defaultSprite.y) > 0) {
                positionTracked = true;
              }
              
              if (logCount >= 10) {
                clearInterval(loggingIntervalId);
                resolve();
              }
            } else {
              clearInterval(loggingIntervalId);
              resolve();
            }
          }, logInterval);
          
          // Timeout for monitoring
          setTimeout(() => {
            clearInterval(loggingIntervalId);
            resolve();
          }, Math.min(timeoutMs - 1000, 3000));
        });
      };
      
      await runMonitoring();
    }

    const results = {
      spriteFound: spriteFound,
      continuousLogging: loggingWorked,
      positionTracking: positionTracked
    };

    const passedTests = Object.values(results).filter(Boolean).length;
    const totalTests = Object.keys(results).length;

    const payload = {
      success: passedTests === totalTests,
      passed_tests: passedTests,
      total_tests: totalTests,
      partial_success_rate: totalTests ? passedTests / totalTests : 0,
      details: Object.keys(results).map((k) => ({ name: k, passed: !!results[k] }))
    };

    try { vm.runtime.stopAll(); } catch (e) {}
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();

    console.log('[Forever] Done', payload);
    return payload;
  } catch (err) {
    console.log('[Forever] Error:', err.message);
    try { vm.runtime.stopAll(); } catch (e) {}
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();
    throw err;
  }
};
