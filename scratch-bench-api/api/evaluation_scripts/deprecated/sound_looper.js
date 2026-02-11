/**
 * @evaluation: Test for sound looper functionality
 * Checks that volume is set to ~50%, the 'Meow' sound is played three times sequentially (until done), 
 * and sounds are stopped afterward.
 * 
 * @param {Object} vm - Scratch VM instance
 * @param {Object} config - Test configuration
 * @param {Function} cleanup - Cleanup function
 * @returns {Promise<boolean>} Test result
 */
module.exports = async (vm, config, cleanup) => {
  const EU = window.EvaluationUtils;

  const timeoutSec = (config && config.timeout ? config.timeout : 20);
  const spriteName = (config && config.spriteName) || 'Sprite1';

  const restartProject = async () => {
    vm.runtime.stopAll();
    EU.startVM(vm);
  };

  // No monkey-patching approach: we rely on AudioEngine.getLoudness() to detect sound activity peaks

  try {
    console.log('[Sound Looper Test] Begin');
    await restartProject();

    const sprite = EU.findSprite(vm, spriteName);
    if (!sprite) throw new Error(`Sprite '${spriteName}' not found`);

    // Wait for initialization
    await EU.wait(500);

    // Check volume is set to approximately 50%
    const volume = sprite.volume;
    console.log(`[Sound Looper Test] Current volume: ${volume}`);
    
    if (Math.abs(volume - 50) > 5) {
      throw new Error(`Volume should be ~50%, but got ${volume}`);
    }

    // Loudness-based detection
    const ae = vm && vm.runtime && vm.runtime.audioEngine;
    if (!ae || typeof ae.getLoudness !== 'function') {
      throw new Error('AudioEngine.getLoudness not available');
    }
    let soundPlayCount = 0;
    let inPeak = false;
    let lastPeakAt = 0;
    const QUIET_THRESHOLD = 1;   // below this is considered quiet
    const LOUD_THRESHOLD = 5;    // above this considered a peak
    const MIN_GAP_MS = 200;      // minimal time between peaks to consider them distinct

    const maxWaitTime = timeoutSec * 1000;
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitTime) {
      const loud = Number(ae.getLoudness ? ae.getLoudness() : 0) || 0;
      // console.log(`[Sound Looper Test] loudness=${loud}`);
      const now = Date.now();
      if (!inPeak && loud >= LOUD_THRESHOLD && (now - lastPeakAt) >= MIN_GAP_MS) {
        inPeak = true;
        soundPlayCount += 1;
        lastPeakAt = now;
        console.log(`[Sound Looper Test] Peak detected (#${soundPlayCount}) loudness=${loud}`);
        if (soundPlayCount >= 3) break;
      } else if (inPeak && loud <= QUIET_THRESHOLD) {
        inPeak = false; // reset to allow next peak
      }
      await EU.wait(100);
    }

    // After loop, require three peaks
    if (soundPlayCount < 3) {
      throw new Error(`Expected 3 Meow sound plays (loudness peaks), but detected ${soundPlayCount}`);
    }

    // Short quiet verification: ensure loudness falls below threshold after the plays
    let quietOk = false;
    const quietWindowStart = Date.now();
    while (Date.now() - quietWindowStart < 1000) {
      const loud = Number(ae.getLoudness ? ae.getLoudness() : 0) || 0;
      if (loud <= QUIET_THRESHOLD) { quietOk = true; break; }
      await EU.wait(50);
    }
    if (!quietOk) {
      throw new Error('Sound did not become quiet after expected plays');
    }

    vm.runtime.stopAll();
    cleanup();
    console.log('[Sound Looper Test] Passed');
    return true;
  } catch (err) {
    // No monkey patches to restore on error
    vm.runtime.stopAll();
    cleanup();
    console.log(`[Sound Looper Test] Failed: ${err.message}`);
    throw err;
  }
};