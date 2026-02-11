/**
 * @evaluation: Test for sprite size setting to specified value
 * Evaluates whether sprite size is set to the specified value. The test finds the target sprite,
 * triggers green flag event, waits for initialization scripts to execute, then monitors sprite size.
 * 
 * Tests performed:
 * 1) Sprite Size Test: Sprite size matches expected value (50%)
 * 
 * @param {Object} vm - Scratch VM instance
 * @param {Object} config - Test configuration
 * @param {Function} cleanup - Cleanup function
 * @returns {Promise<Object>} Test result with detailed breakdown
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 15);
  let timeoutTimer = null;
  const spriteName = (config && config.spriteName) || 'Sprite1';
  const expectedSize = 50; // Expected size value

  // Global timeout guard
  const timeoutPromise = new Promise((_, reject) => {
    timeoutTimer = setTimeout(() => {
      reject(new Error(`Test timed out after ${timeoutSec} seconds`));
    }, timeoutSec * 1000);
  });

  // Test case execution function
  const runTest = async (testName, testFn) => {
    console.log(`[Sprite Size Test] Starting ${testName}`);
    
    try {
      // Restart VM for each test
      try { vm.runtime.stopAll(); } catch {}
      await EU.wait(250);
      EU.startVM(vm);
      await EU.wait(600);
      
      const result = await Promise.race([testFn(), timeoutPromise]);
      console.log(`[Sprite Size Test] ${testName} ✓ Passed`);
      return { success: true, error: null, result };
    } catch (error) {
      console.log(`[Sprite Size Test] ${testName} ✗ Failed: ${error.message}`);
      return { success: false, error: error.message, result: null };
    } finally {
      // Cleanup for each test
      try { vm.runtime.stopAll(); } catch {}
    }
  };

  // Test: Sprite Size Test
  const testSpriteSize = async () => {
    const targetSprite = vm.runtime.targets.find(t => t.sprite && t.sprite.name === spriteName);

    if (!targetSprite) {
      throw new Error(`Sprite "${spriteName}" not found`);
    }

    console.log(`Target sprite: "${targetSprite.sprite.name}", initial size: ${targetSprite.size}%`);
    
    // Trigger green flag and wait for initialization
    console.log('Triggering green flag event');
    vm.start();
    vm.greenFlag();
    
    // Wait for initialization scripts to execute
    console.log('Waiting for initialization scripts to execute...');
    await EU.wait(5000);

    console.log('Starting size monitoring...');
    const monitorStartTime = Date.now();
    const monitorTimeout = 8000; // 8 seconds for monitoring

    while (Date.now() - monitorStartTime < monitorTimeout) {
      const currentSize = targetSprite.size;
      console.log(`Sprite "${spriteName}" current size: ${currentSize}%`);
      
      if (currentSize === expectedSize) {
        console.log(`Size matches expected value: ${expectedSize}%`);
        return { currentSize, expectedSize, matched: true };
      }
      
      await EU.wait(200); // Check every 200ms
    }

    // Timeout - size didn't match
    const finalSize = targetSprite.size;
    throw new Error(`Size test failed. Final size: ${finalSize}%, expected: ${expectedSize}%`);
  };

  try {
    const testResults = [];

    // Test 1: Sprite Size Test
    const test1Result = await runTest("Sprite Size Test", testSpriteSize);
    testResults.push({ name: "Sprite Size Test", ...test1Result });

    // Calculate results
    const passedTests = testResults.filter(result => result.success).length;
    const totalTests = testResults.length;
    const allPassed = passedTests === totalTests;
    const successRate = totalTests > 0 ? (passedTests / totalTests) * 100 : 0;

    // Stop VM and clear timeout
    try { vm.runtime.stopAll(); } catch {}
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();

    const finalResult = {
      success: allPassed,
      passed: passedTests,
      total: totalTests,
      successRate: successRate,
      details: testResults
    };

    if (allPassed) {
      console.log(`[Sprite Size Test] ✓ All tests passed (${passedTests}/${totalTests})`);
    } else {
      console.log(`[Sprite Size Test] ✗ Some tests failed (${passedTests}/${totalTests})`);
    }

    return finalResult;

  } catch (err) {
    console.log('[Sprite Size Test] Error:', err.message);
    try { vm.runtime.stopAll(); } catch {}
    if (timeoutTimer) clearTimeout(timeoutTimer);
    cleanup();
    throw err;
  }
};