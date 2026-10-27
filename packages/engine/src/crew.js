import { definition, controlled, stats } from './model.js';
import { hasType } from './types.js';

export const tapPower = (s, o, sourceId, ability = 'crew') =>
  stats(s, o).power +
  (s.objects[sourceId] &&
  definition(s, s.objects[sourceId]).subtypes.includes(ability === 'saddle' ? 'Mount' : 'Vehicle')
    ? (definition(s, o).crewSaddlePowerBonus ?? 0)
    : 0);

export function crewCandidates(s, p, id) {
  return controlled(s, p).filter(
    (o) => o.id !== id && !o.tapped && hasType(definition(s, o), 'creature'),
  );
}
export function crewProblem(s, p, id, cards) {
  const source = s.objects[id];
  if (
    !source ||
    source.zone !== 'battlefield' ||
    source.controller !== p ||
    definition(s, source).crew === undefined
  )
    return 'You do not control a permanent with crew.';
  if (s.status !== 'playing' || s.choice || s.priority !== p) return 'You do not have priority.';
  if (!Array.isArray(cards) || new Set(cards).size !== cards.length)
    return 'Choose distinct creatures to crew.';
  const candidates = new Set(crewCandidates(s, p, id).map((o) => o.id));
  if (cards.some((id) => !candidates.has(id)))
    return 'Choose other untapped creatures you control.';
  if (
    cards.reduce((sum, cardId) => sum + tapPower(s, s.objects[cardId], id), 0) <
    definition(s, source).crew
  )
    return 'The selected creatures have insufficient total power.';
  return null;
}
// One deterministic witness keeps action enumeration bounded. Humans may submit
// any legal subset, including zero/negative power creatures and overpayment.
export function crewPlan(s, p, id) {
  const cards = [];
  for (const o of crewCandidates(s, p, id).sort(
    (a, b) => tapPower(s, b, id) - tapPower(s, a, id) || a.id.localeCompare(b.id),
  )) {
    if (!crewProblem(s, p, id, cards)) return cards;
    if (tapPower(s, o, id) > 0) cards.push(o.id);
  }
  return crewProblem(s, p, id, cards) ? null : cards;
}
