import { legalActions } from '../../../packages/engine/src/engine.js';
import { actionSafe, directLethal } from './decision-safety.js';
import { controlled, definition } from '../../../packages/engine/src/model.js';
import { manaOptions } from '../../../packages/engine/src/mana.js';

const key = (action) => action.type + ':' + action.card + ':' + (action.ability ?? '');
function available(s, p) {
  return legalActions(s, p).filter(
    (action) => ['cast', 'activate'].includes(action.type) && actionSafe(s, p, action),
  );
}
/** Compare legal land drops by the plays their mana unlocks, then the colors in
 * our own hand. This is a mana-development heuristic, not an ETB/landfall rollout.
 * No opposing hand, library identity, seed or future draw is consulted.
 */
export function chooseLandAction(s, p, actions) {
  const lands = actions.filter((action) => action.type === 'playLand');
  if (lands.length < 2) return lands[0];
  const before = new Set(available(s, p).map(key));
  const sources = controlled(s, p).map((object) => manaOptions(s, object));
  let best = null;
  for (const action of lands) {
    const object = s.objects[action.card];
    const card = definition(s, object);
    const projected = {
      ...s,
      objects: {
        ...s.objects,
        [object.id]: {
          ...object,
          zone: 'battlefield',
          controller: p,
          tapped: !!card.entersTapped,
          incarnation: object.incarnation + 1,
          controlledSince: s.turn,
        },
      },
      players: s.players.map((player, index) =>
        index === p ? { ...player, hand: player.hand.filter((id) => id !== object.id) } : player,
      ),
    };
    const after = available(projected, p);
    const enabled = new Map();
    for (const candidate of after)
      if (!before.has(key(candidate))) enabled.set(key(candidate), candidate);
    const immediate = Math.max(
      0,
      ...[...enabled.values()].map((candidate) => {
        const next = definition(projected, projected.objects[candidate.card]);
        return candidate.type === 'cast'
          ? 5 + Object.values(next.cost).reduce((total, amount) => total + amount, 0)
          : 3;
      }),
    );
    const options = manaOptions(projected, projected.objects[object.id]);
    let colors = 0;
    for (const id of projected.players[p].hand) {
      const next = definition(projected, projected.objects[id]);
      if (next.type === 'land') continue;
      for (const color of options)
        colors +=
          (next.cost[color] ?? 0) / (1 + sources.filter((set) => set.includes(color)).length);
    }
    const score =
      (after.some((candidate) => directLethal(projected, p, candidate)) ? 1_000_000 : 0) +
      immediate * 100 +
      enabled.size * 2 +
      colors +
      (!immediate && card.entersTapped ? 0.25 : 0);
    if (!best || score > best.score) best = { action, score };
  }
  return best.action;
}
