/**
 * Block manipulation utilities for Scratch API operations
 */

/**
 * Create shadow blocks for common input types
 */
function createShadowBlocks(ws) {
  return {
    number: (val) => {
      const s = ws.newBlock('math_number');
      s.setShadow(true);
      s.initSvg();
      const fld = s.getField('NUM');
      if (fld) fld.setValue(String(val));
      s.render();
      return s;
    },
    
    text: (val) => {
      const s = ws.newBlock('text');
      s.setShadow(true);
      s.initSvg();
      const fld = s.getField('TEXT');
      if (fld) fld.setValue(String(val));
      s.render();
      return s;
    }
  };
}

/**
 * Default input values for common block types
 */
const BLOCK_DEFAULTS = {
  'data_changevariableby': [{input: 'VALUE', val: 1, type: 'number'}],
  'data_setvariableto': [{input: 'VALUE', val: 0, type: 'number'}],
  'motion_movesteps': [{input: 'STEPS', val: 10, type: 'number'}],
  'looks_changesizeby': [{input: 'CHANGE', val: 10, type: 'number'}],
  'looks_setsizeto': [{input: 'SIZE', val: 100, type: 'number'}],
  'motion_turnright': [{input: 'DEGREES', val: 15, type: 'number'}],
  'motion_turnleft': [{input: 'DEGREES', val: 15, type: 'number'}],
  'control_wait': [{input: 'DURATION', val: 1, type: 'number'}],
  'control_repeat': [{input: 'TIMES', val: 10, type: 'number'}],
  'motion_gotoxy': [{input: 'X', val: 0, type: 'number'}, {input: 'Y', val: 0, type: 'number'}],
  'motion_glidesecstoxy': [{input: 'SECS', val: 1, type: 'number'}, {input: 'X', val: 0, type: 'number'}, {input: 'Y', val: 0, type: 'number'}],
  'sound_setvolumeto': [{input: 'VOLUME', val: 100, type: 'number'}],
  'sound_changevolumeby': [{input: 'VOLUME', val: 10, type: 'number'}],
  'motion_scroll_right': [{input: 'DISTANCE', val: 10, type: 'number'}],
  'data_listcontainsitem': [{input: 'ITEM', val: 'thing', type: 'text'}],
  'data_itemnumoflist': [{input: 'ITEM', val: 'thing', type: 'text'}],
  'data_itemoflist': [{input: 'INDEX', val: 1, type: 'number'}],
  'data_replaceitemoflist': [{input: 'INDEX', val: 1, type: 'number'}, {input: 'ITEM', val: 'thing', type: 'text'}],
  'data_insertatlist': [{input: 'INDEX', val: 1, type: 'number'}, {input: 'ITEM', val: 'thing', type: 'text'}],
  'data_deleteoflist': [{input: 'INDEX', val: 1, type: 'number'}],
  'data_addtolist': [{input: 'ITEM', val: 'thing', type: 'text'}]
};

/**
 * Attach default shadows to a block
 */
function attachDefaultShadows(block, ws) {
  const shadows = createShadowBlocks(ws);
  const defaults = BLOCK_DEFAULTS[block.type] || [];
  
  for (const spec of defaults) {
    const input = block.getInput(spec.input);
    if (!input || !input.connection) continue;
    
    const already = input.connection && input.connection.targetBlock();
    if (already) continue; // Something already connected
    
    const shadow = (spec.type === 'text') ? shadows.text(spec.val) : shadows.number(spec.val);
    if (shadow && shadow.outputConnection && input.connection) {
      shadow.outputConnection.connect(input.connection);
    }
  }
}

/**
 * Place XML node in workspace and return created block
 */
function placeXmlNode(SB, ws, node, x, y) {
  node.setAttribute('x', String(x));
  node.setAttribute('y', String(y));
  const root = document.createElement('xml');
  root.appendChild(node);
  const before = new Set(ws.getTopBlocks(false).map(b => b.id));
  SB.Xml.domToWorkspace(root, ws);
  const created = ws.getTopBlocks(false).find(b => !before.has(b.id));
  if (created) ws.centerOnBlock(created.id);
  return created;
}

/**
 * Infer field name for block type
 */
function inferFieldNameForType(blockType) {
  switch (blockType) {
    case 'math_number': return 'NUM';
    case 'text': return 'TEXT';
    case 'math_angle': return 'ANGLE';
    case 'colour_picker': return 'COLOUR';
    case 'control_create_clone_of_menu': return 'CLONE_OPTION';
    case 'event_broadcast_menu': return 'BROADCAST_OPTION';
    default: return null;
  }
}

/**
 * Infer shadow type for input name
 */
function inferShadowTypeForInputName(inputName) {
  const n = String(inputName || '').toUpperCase();
  if (n.includes('COLOUR') || n.includes('COLOR')) return 'colour_picker';
  if (n.includes('ANGLE') || n.includes('DEGREES')) return 'math_angle';
  
  const numericHints = ['STEPS','SECS','SECONDS','DURATION','X','Y','SIZE','VOLUME','TEMPO','VALUE','NUM','NUM1','NUM2','DELAY','SPEED'];
  if (numericHints.some(h => n.includes(h))) return 'math_number';
  
  return 'math_number';
}
