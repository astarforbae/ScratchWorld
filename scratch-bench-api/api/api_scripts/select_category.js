/**
 * Select a category in the toolbox
 */
(cat) => {
  if (!cat) {
    return createError('INVALID_ARG', 'Category name is required');
  }

  try {
    const workspace = getWorkspace();
    if (!workspace) {
      return createError('API_UNAVAILABLE', 'Workspace not available');
    }
    
    const toolbox = workspace.toolbox_ || workspace.toolbox;
    if (!toolbox) {
      return createError('API_UNAVAILABLE', 'Toolbox not available');
    }

    // Normalize input to Scratch category IDs (see src/lib/make-toolbox-xml.js)
    const s = String(cat).toLowerCase().trim();
    const map = new Map([
      ['motion','motion'],
      ['looks','looks'],
      ['sound','sound'],
      ['events','events'],
      ['event','events'],
      ['control','control'],
      ['sensing','sensing'],
      ['operators','operators'],
      ['variables','variables'],
      ['my blocks','myBlocks'],
    ]);
    const categoryId = map.get(s) || s; // allow direct id if already correct

    // If available, refresh selection bookkeeping (as GUI does in blocks.jsx)
    if (typeof workspace.refreshToolboxSelection_ === 'function') {
      try { 
        workspace.refreshToolboxSelection_(); 
      } catch (e) { 
        // Ignore refresh errors
      }
    }

    // Select by id
    if (typeof toolbox.setSelectedCategoryById === 'function') {
      toolbox.setSelectedCategoryById(categoryId);
    } else if (typeof toolbox.scrollToCategoryById === 'function') {
      // Fallback: scroll if selection API missing
      toolbox.scrollToCategoryById(categoryId);
    } else {
      return createError('API_UNAVAILABLE', 'Toolbox does not expose selection APIs');
    }

    // Align flyout scroll to the category start (mirrors blocks.jsx behavior)
    try {
      if (typeof toolbox.getCategoryPositionById === 'function' &&
          typeof toolbox.setFlyoutScrollPos === 'function') {
        const pos = toolbox.getCategoryPositionById(categoryId);
        if (typeof pos === 'number') {
          toolbox.setFlyoutScrollPos(pos);
        }
      }
    } catch (e) { 
      // Best effort - ignore errors
    }

    // Verify selection if API available
    try {
      if (typeof toolbox.getSelectedCategoryId === 'function') {
        const currentId = toolbox.getSelectedCategoryId();
        if (currentId !== categoryId) {
          // Retry once on the next microtask/frame (toolbox may still be rebuilding)
          setTimeout(() => {
            if (typeof toolbox.setSelectedCategoryById === 'function') {
              toolbox.setSelectedCategoryById(categoryId);
            }
          }, 0);
        }
      }
    } catch (e) { 
      // Ignore verification errors
    }

    return createSuccess({category: categoryId});
  } catch (e) {
    return createError('EXECUTION_ERROR', e.message || 'Failed to select category');
  }
}
