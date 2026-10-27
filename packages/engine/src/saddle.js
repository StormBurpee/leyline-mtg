import { definition } from './model.js';
import { crewCandidates, tapPower } from './crew.js';

export const saddleCandidates = crewCandidates;
export function saddleProblem(s, p, id, cards) {
  const source = s.objects[id];
  if (
    !source ||
    source.zone !== 'battlefield' ||
    source.controller !== p ||
    definition(s, source).saddle === undefined
  )
    return 'You do not control a permanent with saddle.';
  if (s.status !== 'playing' || s.choice || s.priority !== p) return 'You do not have priority.';
  if (s.active !== p || !['main1', 'main2'].includes(s.step) || s.stack.length)
    return 'Saddle only as a sorcery.';
  if (!Array.isArray(cards) || new Set(cards).size !== cards.length)
    return 'Choose distinct creatures to saddle.';
  const candidates = new Set(saddleCandidates(s, p, id).map((o) => o.id));
  if (cards.some((id) => !candidates.has(id)))
    return 'Choose other untapped creatures you control.';
  if (
    cards.reduce((sum, cardId) => sum + tapPower(s, s.objects[cardId], id, 'saddle'), 0) <
    definition(s, source).saddle
  )
    return 'The selected creatures have insufficient total power.';
  return null;
}
// A bounded deterministic witness; humans can choose any legal subset.
export function saddlePlan(s, p, id) {
  const cards = [];
  for (const o of saddleCandidates(s, p, id).sort(
    (a, b) =>
      tapPower(s, b, id, 'saddle') - tapPower(s, a, id, 'saddle') || a.id.localeCompare(b.id),
  )) {
    if (!saddleProblem(s, p, id, cards)) return cards;
    if (tapPower(s, o, id, 'saddle') > 0) cards.push(o.id);
  }
  return saddleProblem(s, p, id, cards) ? null : cards;
}
