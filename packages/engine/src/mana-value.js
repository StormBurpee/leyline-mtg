/** CR 202.3e: X is zero except on the stack, where its announced value is used. */
export function manaValue(card, x = 0) {
  return Object.entries(card?.cost ?? {}).reduce(
    (total, [symbol, amount]) => total + amount * (symbol === 'X' ? x : 1),
    0,
  );
}
/** Explicit implementation budget, not a Magic rules limit. */
export const MAX_X = 1000;
