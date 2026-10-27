import { proposedCastingState } from './casting-costs.js';
import { controlled, definition, ref } from './model.js';
import { matchesFilter } from './selectors.js';
import { convokePayment } from './convoke.js';

/** A casting cost, never a resolving sacrifice instruction or a target. */
export function castingSacrificeCandidates(s, p, profile) {
  if (!profile.sacrificeCost) return [];
  return controlled(s, p).filter((o) =>
    matchesFilter({ definition: definition(s, o) }, profile.sacrificeCost.where, p),
  );
}
export function castingPayment(s, p, profile, { sacrifice, convoke, autoTap = true, card } = {}) {
  if (card) {
    const object = s.objects[card];
    if (!object) return null;
    if (object.zone !== 'stack' && s.rulesRevision !== 1)
      s = proposedCastingState(s, p, object, profile.chosenX);
  }
  if (!profile.sacrificeCost) {
    if (sacrifice !== undefined) return null;
    return convokePayment(s, p, profile, convoke, autoTap);
  }
  const candidates = castingSacrificeCandidates(s, p, profile);
  if (sacrifice === undefined) {
    for (const object of candidates) {
      const plan = castingPayment(s, p, profile, { sacrifice: ref(object), convoke, autoTap });
      if (plan) return plan;
    }
    return null;
  }
  if (
    !sacrifice ||
    sacrifice.kind !== 'object' ||
    Object.keys(sacrifice).some((k) => !['kind', 'id', 'incarnation'].includes(k))
  )
    return null;
  const object = candidates.find(
    (o) => o.id === sacrifice.id && o.incarnation === sacrifice.incarnation,
  );
  if (!object) return null;
  // CR 601.2g–h: a mana ability may tap this object, but cannot sacrifice it
  // and then use the departed object to pay the additional sacrifice cost.
  const excludeManaSources = definition(s, object).manaSacrifice ? [object.id] : [];
  const plan = convokePayment(s, p, profile, convoke, autoTap, excludeManaSources);
  return plan
    ? {
        ...plan,
        sacrifice: ref(object),
        excludeSources: [...plan.excludeSources, ...excludeManaSources],
      }
    : null;
}
