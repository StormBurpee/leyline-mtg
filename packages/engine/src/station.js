import { definition, controlled, stats } from './model.js';
import { hasType } from './types.js';

// CR 702.184 (2026-09-25): exactly one *other* creature, not a crew cost.
// In particular, Pilot's crew/saddle power adjustment does not apply.
export function stationCandidates(s, p, id) {
  return controlled(s, p).filter(
    (o) => o.id !== id && !o.tapped && hasType(definition(s, o), 'creature'),
  );
}
export function stationProblem(s, p, id, cards) {
  const source = s.objects[id];
  if (
    !source ||
    source.zone !== 'battlefield' ||
    source.controller !== p ||
    !definition(s, source).station
  )
    return 'You do not control a permanent with station.';
  if (s.status !== 'playing' || s.choice || s.priority !== p) return 'You do not have priority.';
  if (s.active !== p || !['main1', 'main2'].includes(s.step) || s.stack.length)
    return 'Station only as a sorcery.';
  if (!Array.isArray(cards) || cards.length !== 1)
    return 'Choose exactly one other untapped creature you control.';
  if (!stationCandidates(s, p, id).some((o) => o.id === cards[0]))
    return 'Choose exactly one other untapped creature you control.';
  return null;
}
// One deterministic witness; zero/negative power is legal, but rarely useful.
export function stationPlan(s, p, id) {
  const payer = stationCandidates(s, p, id).sort(
    (a, b) => stats(s, b).power - stats(s, a).power || a.id.localeCompare(b.id),
  )[0];
  const cards = payer ? [payer.id] : [];
  return stationProblem(s, p, id, cards) ? null : cards;
}
