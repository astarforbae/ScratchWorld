/**
 * Common JavaScript utilities for Scratch API operations
 */

/**
 * Check if VM is available and return it
 */
function getVM() {
  const vm = (typeof window !== 'undefined' && window.vm) ? window.vm : 
             (typeof vm !== 'undefined' ? vm : 
             (typeof globalThis !== 'undefined' ? globalThis.vm : undefined));
  
  if (!vm) {
    throw new Error('VM not available');
  }
  return vm;
}

/**
 * Get the main workspace
 */
function getWorkspace() {
  const ws = window.workspace || 
             (typeof Blockly !== 'undefined' && Blockly.getMainWorkspace && Blockly.getMainWorkspace());
  
  if (!ws) {
    throw new Error('Workspace not available');
  }
  return ws;
}

/**
 * Get ScratchBlocks/Blockly reference
 */
function getScratchBlocks() {
  const SB = window.ScratchBlocks || window.Blockly || null;
  if (!SB) {
    throw new Error('ScratchBlocks not available');
  }
  return SB;
}

/**
 * Generate a unique ID
 */
function generateId() {
  return (window.crypto && crypto.randomUUID) ? 
         crypto.randomUUID() : 
         ('id_' + Math.random().toString(36).slice(2, 11));
}

/**
 * Get visible XY position for new blocks
 */
function getVisibleXY(ws, padding = 30) {
  const m = ws.getMetrics();
  return {
    x: (m.viewLeft / ws.scale) + padding,
    y: (m.viewTop / ws.scale) + padding
  };
}

/**
 * Strip IDs from XML nodes recursively
 */
function stripIds(node) {
  if (node.nodeType === 1 && node.hasAttribute('id')) {
    node.removeAttribute('id');
  }
  for (const c of Array.from(node.childNodes)) {
    stripIds(c);
  }
}

/**
 * Escape XML string
 */
function escapeXml(str, SB) {
  return (SB.utils && SB.utils.xmlEscape) ? 
         SB.utils.xmlEscape(String(str)) : 
         String(str);
}

/**
 * Standard error response format
 */
function createError(code, message) {
  return { error: { code, message } };
}

/**
 * Standard success response format
 */
function createSuccess(data) {
  return { success: true, ...data };
}

/**
 * Safe execution wrapper
 */
function safeExecute(fn) {
  try {
    return fn();
  } catch (e) {
    return createError('EXECUTION_ERROR', e.message || 'Operation failed');
  }
}
