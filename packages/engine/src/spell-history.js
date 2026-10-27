import { matchesFilter, validateFilter } from './selectors.js';

/** History deliberately retains only public cast characteristics, never names or card IDs.
 * Equal signatures share a counter; storage depends on distinct profiles, not cast count.
 * Histories expire at every turn boundary, including the opponent's turn.
 */
export function recordSpellCast(state, player, card) {
  const p = state.players[player];
  if (p.spellsCast?.turn !== state.turn) p.spellsCast = { turn: state.turn, profiles: [] };
  const definition = {
    type: card.type,
    types: [...(card.types ?? [card.type])].sort(),
    color: [...card.color].sort(),
    subtypes: [...(card.subtypes ?? [])].sort(),
    keywords: card.keywords?.includes('changeling') ? ['changeling'] : [],
  };
  const key = JSON.stringify(definition);
  const existing = p.spellsCast.profiles.find(
    (profile) => JSON.stringify(profile.definition) === key,
  );
  if (existing) existing.count++;
  else p.spellsCast.profiles.push({ definition, count: 1 });
}
export function spellsCastCount(state, players, where, controller) {
  return players.reduce((total, player) => {
    const history = state.players[player].spellsCast;
    return (
      total +
      (history?.turn === state.turn
        ? history.profiles.reduce(
            (n, profile) => n + (matchesFilter(profile, where, controller) ? profile.count : 0),
            0,
          )
        : 0)
    );
  }, 0);
}
export function validateSpellHistoryFilter(where) {
  const errors = validateFilter(where);
  if (errors.length) return errors;
  const visit = (v) =>
    Object.entries(v).every(([key, operand]) =>
      ['all', 'any'].includes(key)
        ? operand.every(visit)
        : key === 'not'
          ? visit(operand)
          : ['type', 'color', 'subtype'].includes(key),
    );
  if (!visit(where))
    errors.push('Spell history supports only public type, color and subtype predicates.');
  return errors;
}
