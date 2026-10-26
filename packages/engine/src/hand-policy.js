import { controlled, definition } from './model.js';
import { manaOptions } from './mana.js';

const manaValue = (d) => Object.values(d.cost).reduce((sum, n) => sum + n, 0);

/** Marginal value of a known card. No inference from catalog membership, library
 * order or opposing cards; only our hand and public mana sources are consulted. */
export function keepValue(s, p, id, hand = s.players[p].hand) {
  const card = definition(s, s.objects[id]);
  const board = controlled(s, p).filter((o) => definition(s, o).mana);
  const others = hand
    .filter((other) => other !== id)
    .map((other) => definition(s, s.objects[other]));
  const lands = others.filter((d) => d.type === 'land');
  const spells = others.filter((d) => d.type !== 'land');
  const target = Math.max(3, Math.min(6, Math.max(0, ...spells.map(manaValue))));
  const colors = board.map((o) => manaOptions(s, o));
  for (const d of lands) colors.push(Array.isArray(d.mana) ? d.mana : [d.mana]);
  if (card.type === 'land') {
    const options = Array.isArray(card.mana) ? card.mana : [card.mana];
    const fixes = spells.some((d) =>
      options.some((c) => (d.cost[c] ?? 0) > colors.filter((cs) => cs.includes(c)).length),
    );
    const total = board.length + lands.length;
    return (
      (total < 2 ? 24 : total < target ? 12 - total : total < target + 1 ? 1 : -8) +
      (fixes ? 14 : 0)
    );
  }
  const available = board.length + lands.length;
  const shortfall = Math.max(0, manaValue(card) - available);
  const missingColor = Object.entries(card.cost).some(
    ([c, n]) => c !== 'generic' && colors.filter((cs) => cs.includes(c)).length < n,
  );
  return (
    8 +
    Math.min(5, manaValue(card)) * 0.4 -
    shortfall * 2.5 -
    (missingColor ? 3 : 0) +
    (card.type === 'creature' ? 2 : 0) +
    (card.effects?.some((e) => e.op === 'draw') ? 1 : 0)
  );
}

/** Recompute marginal land value after every removal; do not discard all copies
 * of a needed color just because each looked redundant in the original hand. */
export function chooseDiscards(s, p, count) {
  const retained = [...s.players[p].hand],
    discarded = [];
  for (let i = 0; i < count && retained.length; i++) {
    retained.sort(
      (a, b) => keepValue(s, p, a, retained) - keepValue(s, p, b, retained) || a.localeCompare(b),
    );
    discarded.push(retained.shift());
  }
  return discarded;
}

export function chooseLibraryOrder(s, p, forcedRest = []) {
  const cards = s.choice.cards;
  const top = cards.filter((id) => !forcedRest.includes(id) && keepValue(s, p, id) > 0);
  top.sort((a, b) => keepValue(s, p, b) - keepValue(s, p, a) || a.localeCompare(b));
  return { top, rest: cards.filter((id) => !top.includes(id)) };
}
