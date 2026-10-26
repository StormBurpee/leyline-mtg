/** A spell's modes are announced while casting, never chosen at resolution. */
export function spellProfile(card, mode) {
  if (!card.modes) return mode === undefined ? card : null;
  if (!Number.isSafeInteger(mode) || mode < 0 || mode >= card.modes.length) return null;
  const selected = card.modes[mode];
  return { ...card, effects: selected.effects, target: selected.target ?? null };
}
export const spellOptions = (card) =>
  card.modes
    ? card.modes.map((_, mode) => ({ mode, profile: spellProfile(card, mode) }))
    : [{ profile: card }];
