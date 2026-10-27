import { definition, controlled, stats } from './model.js';
import { hasType } from './types.js';

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
    cards.reduce((sum, id) => sum + stats(s, s.objects[id]).power, 0) < definition(s, source).crew
  )
    return 'The selected creatures have insufficient total power.';
  return null;
}
// One deterministic witness keeps action enumeration bounded. Humans may submit
// any legal subset, including zero/negative power creatures and overpayment.
export function crewPlan(s, p, id) {
  const cards = [];
  for (const o of crewCandidates(s, p, id).sort(
    (a, b) => stats(s, b).power - stats(s, a).power || a.id.localeCompare(b.id),
  )) {
    if (!crewProblem(s, p, id, cards)) return cards;
    if (stats(s, o).power > 0) cards.push(o.id);
  }
  return crewProblem(s, p, id, cards) ? null : cards;
}
