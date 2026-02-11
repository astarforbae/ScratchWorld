/**
 * Connect two blocks with specified placement
 */
(payload) => {
  return connectBlocks(payload.sourceId, payload.targetId, payload.placement);
}
