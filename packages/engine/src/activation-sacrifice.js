import { controlled, definition, keywords, stats, ref, isAttacking, isBlocking } from './model.js';
import { manaValue } from './mana-value.js';
import { matchesFilter } from './selectors.js';

/** CR 602.2b / 601.2h: these are chosen payments, never targets or resolving effects. */
export function activationSacrificeCandidates(s, p, cost, sourceId) {
  if (!cost.sacrifice) return [];
  return controlled(s, p).filter((o) => {
    if ((cost.sacrifice.excludeSource || cost.sacrificeSelf) && o.id === sourceId) return false;
    const d = definition(s, o);
    return matchesFilter(
      {
        ...o,
        definition: d,
        ...stats(s, o),
        keywords: keywords(s, o),
        manaValue: manaValue(d),
        attacking: isAttacking(s, o),
        blocking: isBlocking(s, o),
      },
      cost.sacrifice.where,
      p,
    );
  });
}
export function activationSacrificeProblem(s, p, cost, sourceId, sacrifices) {
  if (!cost.sacrifice)
    return sacrifices === undefined ? null : 'This ability has no chosen sacrifice cost.';
  if (
    !Array.isArray(sacrifices) ||
    sacrifices.length !== cost.sacrifice.count ||
    new Set(sacrifices.map((r) => r?.id)).size !== sacrifices.length
  )
    return `Choose exactly ${cost.sacrifice.count} different permanents to sacrifice.`;
  const candidates = activationSacrificeCandidates(s, p, cost, sourceId);
  if (
    sacrifices.some(
      (r) =>
        !r ||
        r.kind !== 'object' ||
        Object.keys(r).some((k) => !['kind', 'id', 'incarnation'].includes(k)) ||
        !candidates.some((o) => o.id === r.id && o.incarnation === r.incarnation),
    )
  )
    return 'A chosen sacrifice is no longer an eligible permanent you control.';
  return null;
}
/** Bounded public proposals; dispatch accepts every valid exact subset. */
export function activationSacrificeOptions(s, p, cost, sourceId) {
  if (!cost.sacrifice) return [undefined];
  const candidates = activationSacrificeCandidates(s, p, cost, sourceId),
    options = [];
  const count = cost.sacrifice.count;
  function visit(start, chosen) {
    if (options.length >= 256) return;
    if (chosen.length === count) {
      options.push(chosen.map(ref));
      return;
    }
    for (let i = start; i <= candidates.length - (count - chosen.length); i++) {
      visit(i + 1, [...chosen, candidates[i]]);
      if (options.length >= 256) break;
    }
  }
  visit(0, []);
  return options;
}
export function costManaExclusions(s, cost, { sourceId, sacrifices } = {}) {
  return [
    ...new Set([
      ...(cost.tap ||
      (cost.sacrificeSelf &&
        s.objects[sourceId] &&
        definition(s, s.objects[sourceId]).manaSacrifice)
        ? [sourceId]
        : []),
      ...(sacrifices ?? [])
        .filter((r) => definition(s, s.objects[r.id]).manaSacrifice)
        .map((r) => r.id),
    ]),
  ];
}
