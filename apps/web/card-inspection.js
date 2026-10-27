import { topLibraryVisible } from '../../packages/engine/src/model.js';
/** Inspection must never turn a stale UI handle into a hidden-card disclosure. */
export function inspectableCard(state, id, player) {
  const object = state?.objects?.[id];
  if (!object) return null;
  return ['battlefield', 'graveyard', 'exile'].includes(object.zone) ||
    (object.zone === 'hand' && object.owner === player) ||
    (object.zone === 'library' &&
      object.owner === player &&
      topLibraryVisible(state, player) &&
      state.players[player].library[0] === id)
    ? object
    : null;
}
export function readableCard(state, ui, player) {
  return [ui.selected, ui.inspectObject].find((id) => inspectableCard(state, id, player)) ?? null;
}
