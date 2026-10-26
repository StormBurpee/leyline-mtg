/** Inspection must never turn a stale UI handle into a hidden-card disclosure. */
export function inspectableCard(state, id, player) {
  const object = state?.objects?.[id];
  if (!object) return null;
  return ['battlefield', 'graveyard', 'exile'].includes(object.zone) ||
    (object.zone === 'hand' && object.owner === player)
    ? object
    : null;
}
export function readableCard(state, ui, player) {
  return [ui.selected, ui.inspectObject].find((id) => inspectableCard(state, id, player)) ?? null;
}
