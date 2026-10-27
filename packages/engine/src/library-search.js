import { manaValue } from './mana-value.js';
import { matchesFilter } from './selectors.js';
import { definition, stats } from './model.js';

/** Searching looks at printed library characteristics, not battlefield modifiers. */
export function searchableCards(state, player, where) {
  return state.players[player].library.filter((id) => {
    const object = state.objects[id];
    const card = definition(state, object);
    return matchesFilter(
      {
        definition: card,
        owner: object.owner,
        controller: object.owner,
        token: false,
        tapped: false,
        ...stats(state, object),
        manaValue: manaValue(card),
      },
      where,
      player,
    );
  });
}

/** A bounded deterministic choice using only the searcher's allowed information. */
export function chooseSearchCards(state, player) {
  const choice = state.choice;
  if (choice?.kind !== 'librarySearch' || choice.player !== player) return [];
  const hand = state.players[player].hand.map((id) => definition(state, state.objects[id]));
  const sources = Object.values(state.objects)
    .filter((o) => o.zone === 'battlefield' && o.controller === player)
    .map((o) => definition(state, o))
    .filter((d) => d.mana);
  const counts = {};
  const addSource = (d) => {
    for (const color of Array.isArray(d.mana) ? d.mana : [d.mana])
      if (color) counts[color] = (counts[color] ?? 0) + 1;
  };
  sources.forEach(addSource);
  if (choice.destination === 'hand') hand.filter((d) => d.type === 'land').forEach(addSource);
  const needs = {};
  for (const d of hand)
    for (const [color, n] of Object.entries(d.cost))
      if (color !== 'generic') needs[color] = Math.max(needs[color] ?? 0, n);
  const score = (id) => {
    const d = definition(state, state.objects[id]);
    if (choice.destination === 'graveyard')
      return d.type === 'creature'
        ? 20 + (d.power ?? 0) + (d.toughness ?? 0) + manaValue(d)
        : d.type === 'land'
          ? -50
          : 1;
    if (d.type === 'land') {
      const colors = Array.isArray(d.mana) ? d.mana : [d.mana];
      return (
        (sources.length < 4 ? 18 : 2) +
        Math.max(
          0,
          ...colors.map(
            (c) =>
              Math.max(0, (needs[c] ?? 0) - (counts[c] ?? 0)) * 12 +
              ((counts[c] ?? 0) === 0 ? 3 : 0),
          ),
        )
      );
    }
    const cost = manaValue(d);
    return (
      10 + (d.power ?? 0) + (d.toughness ?? 0) + cost - Math.max(0, cost - sources.length - 1) * 3
    );
  };
  const available = [...choice.cards],
    chosen = [];
  for (let i = 0; i < choice.max && available.length; i++) {
    available.sort((a, b) => score(b) - score(a) || a.localeCompare(b));
    const id = available.shift();
    chosen.push(id);
    const d = definition(state, state.objects[id]);
    if (d.mana) addSource(d);
  }
  return chosen;
}
