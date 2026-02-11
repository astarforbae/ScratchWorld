/**
 * Add a block to the workspace
 */
(payload) => {
  try {
    const vm = getVM();
    if (!vm.editingTarget) return createError('NO_TARGET', 'No editing target available');
    const ws = getWorkspace();
    const SB = getScratchBlocks();

    const type = String((payload && payload.blockType) || '').trim();
    if (!type) return createError('INVALID_TYPE', 'Invalid blockType');

    // Fast path for special reporters: build XML with bound field and insert directly
    if (type === 'data_variable' || type === 'data_listcontents') {
      const wantList = (type === 'data_listcontents');
      const creation = payload.creation || {};

      let model = null;
      if (wantList) {
        const lists = (typeof ws.getVariablesOfType === 'function')
          ? (ws.getVariablesOfType('list') || [])
          : ((typeof ws.getAllVariables === 'function') ? (ws.getAllVariables().filter(v => v && v.type === 'list')) : []);
        
        // Look for specific list name if provided
        if (creation.listName) {
          model = lists.find(v => v && v.name === creation.listName);
        }
        // Fallback to first available list
        if (!model) {
          model = lists.length > 0 ? lists[0] : null;
        }
      } else {
        const all = (typeof ws.getAllVariables === 'function') ? (ws.getAllVariables() || []) : [];
        const variables = all.filter(v => v && v.type !== 'list');
        
        // Look for specific variable name if provided
        if (creation.variableName) {
          model = variables.find(v => v && v.name === creation.variableName);
        }
        // Fallback to first available variable
        if (!model) {
          model = variables.length > 0 ? variables[0] : null;
        }
      }
      if (!model) {
        const targetName = wantList ? (creation.listName || 'any list') : (creation.variableName || 'any variable');
        return createError('NOT_FOUND', (wantList ? `No list found: ${targetName}` : `No variable found: ${targetName}`));
      }

      const pos = getVisibleXY(ws);
      let xml;
      if (wantList) {
        xml = (
          `<xml>\n`+
          `  <variables>\n`+
          `    <variable type="list" id="${escapeXml(model.getId(), SB)}">${escapeXml(model.name, SB)}</variable>\n`+
          `  </variables>\n`+
          `  <block type="data_listcontents" x="${pos.x}" y="${pos.y}">\n`+
          `    <field name="LIST" id="${escapeXml(model.getId(), SB)}" variabletype="list">${escapeXml(model.name, SB)}</field>\n`+
          `  </block>\n`+
          `</xml>`
        );
      } else {
        xml = (
          `<xml>`+
          `<block type="data_variable" x="${pos.x}" y="${pos.y}">`+
          `<field name="VARIABLE" id="${escapeXml(model.getId(), SB)}">${escapeXml(model.name, SB)}</field>`+
          `</block>`+
          `</xml>`
        );
      }

      try {
        const dom = SB.Xml.textToDom(xml);
        const before = new Set((ws.getAllBlocks && ws.getAllBlocks(false)) ? ws.getAllBlocks(false).map(b => b.id) : ws.getTopBlocks(false).map(b => b.id));
        SB.Xml.domToWorkspace(dom, ws);
        const blocksNow = (ws.getAllBlocks && ws.getAllBlocks(false)) ? ws.getAllBlocks(false) : ws.getTopBlocks(false);
        const created = blocksNow.find(b => !before.has(b.id));
        if (created && ws.centerOnBlock) ws.centerOnBlock(created.id);
        return createSuccess({blockId: created ? created.id : null, connected: false});
      } catch (e) {
        return createError('XML_ERROR', e && e.message ? e.message : 'Failed to insert XML');
      }
    }

    let created = null;
    // Option A: clone exact template from toolbox XML (keeps default shadows)
    if (window.toolboxXML) {
      try {
        const doc = SB.Xml.textToDom(window.toolboxXML);
        const candidates = Array.from(doc.getElementsByTagName('block')).filter(n => n.getAttribute('type') === type);
        if (candidates.length) {
          const tpl = candidates[0].cloneNode(true);
          stripIds(tpl);
          const pos = getVisibleXY(ws);
          created = placeXmlNode(SB, ws, tpl, pos.x, pos.y);
        } else {
          // Also try dynamic categories (VARIABLE, LIST, PROCEDURES)
          try {
            const dynBlocks = [];
            const getCb = ws.getToolboxCategoryCallback || ws.getToolboxCategoryCallback_;
            if (typeof getCb === 'function') {
              ['VARIABLE', 'LIST', 'PROCEDURES'].forEach(name => {
                try {
                  const cb = getCb.call(ws, name);
                  if (typeof cb === 'function') {
                    const xmlList = cb(ws) || [];
                    xmlList.forEach(node => {
                      if (node && node.tagName && node.tagName.toLowerCase() === 'block') {
                        dynBlocks.push(node);
                      }
                    });
                  }
                } catch (_) { /* ignore per-category errors */ }
              });
            }

            const dynMatch = dynBlocks.find(n => n.getAttribute && n.getAttribute('type') === type);
            if (dynMatch) {
              const tpl = dynMatch.cloneNode(true);
              stripIds(tpl);
              const pos = getVisibleXY(ws);
              created = placeXmlNode(SB, ws, tpl, pos.x, pos.y);
            }
          } catch (_) { /* ignore dynamic expansion failures */ }
        }
      } catch {}
    }

    // Option B: fallback to newBlock
    // if (!created) {
    //   const pos = getVisibleXY(ws);
    //   const b = ws.newBlock(type);
    //   b.initSvg(); b.render(); b.moveBy(pos.x, pos.y);

    //   // Attach default shadows for common inputs when creating from newBlock
    //   try {
    //     attachDefaultShadows(b, ws);
    //   } catch (e) {
    //     // best-effort: ignore shadow attachment errors
    //   }

    //   created = b;
    // }

    // Bind variable/list selector fields (use first available model)
    try {
      const creation = payload.creation || {};
      const wantList = [
        'data_showlist','data_hidelist','data_addtolist','data_deleteoflist',
        'data_insertatlist','data_replaceitemoflist','data_itemoflist',
        'data_itemnumoflist','data_listcontainsitem'
      ].includes(type);
      const hasVarField = (
        type === 'data_changevariableby' ||
        type === 'data_setvariableto' ||
        type === 'data_showvariable' ||
        type === 'data_hidevariable' ||
        wantList
      );
      if (hasVarField) {
        const targetBlock = created;
        const varFieldName = wantList ? 'LIST' : 'VARIABLE';
        let model = null;
        if (wantList) {
          const lists = (typeof ws.getVariablesOfType === 'function')
            ? (ws.getVariablesOfType('list') || [])
            : ((typeof ws.getAllVariables === 'function') ? (ws.getAllVariables().filter(v => v && v.type === 'list')) : []);
          
          // Look for specific list name if provided
          if (creation.listName) {
            model = lists.find(v => v && v.name === creation.listName);
          }
          // Fallback to first available list
          if (!model) {
            model = lists.length > 0 ? lists[0] : null;
          }
        } else {
          const all = (typeof ws.getAllVariables === 'function') ? (ws.getAllVariables() || []) : [];
          const variables = all.filter(v => v && v.type !== 'list');
          
          // Look for specific variable name if provided
          if (creation.variableName) {
            model = variables.find(v => v && v.name === creation.variableName);
          }
          // Fallback to first available variable
          if (!model) {
            model = variables.length > 0 ? variables[0] : null;
          }
        }
        
        if (model) {
          const fld = targetBlock.getField && targetBlock.getField(varFieldName);
          const id = (model.getId && model.getId()) || model.id || String(model);
          if (fld && typeof fld.setValue === 'function') {
            try { fld.setValue(String(id)); } catch {}
          }
        }
      }
    } catch (e) { /* ignore binding failures */ }

    return createSuccess({blockId: created ? created.id : null, connected: false});
  } catch (e) {
    return createError('EXECUTION_ERROR', e.message || 'Failed to add block');
  }
}
