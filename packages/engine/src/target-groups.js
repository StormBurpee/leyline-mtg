import { legalTarget, targetsFor } from './effects.js';
const same = (a, b) =>
  a?.kind === b?.kind &&
  a?.id === b?.id &&
  (a?.kind !== 'object' || a.incarnation === b.incarnation);
export const flattenTargets = (plan) => Object.values(plan ?? {}).flat();
export function targetGroupCandidates(state, groups, id, player, plan = {}) {
  const group = groups.find((g) => g.id === id);
  if (!group) return [];
  const excluded = (group.excludeFrom ?? []).flatMap((key) => plan[key] ?? []);
  return targetsFor(state, group.selector, player).filter((t) => !excluded.some((e) => same(t, e)));
}
export function targetPlanProblem(state, groups, plan, player) {
  if (
    !plan ||
    typeof plan !== 'object' ||
    Array.isArray(plan) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(plan))
  )
    return 'Choose targets for each target group.';
  if (Object.keys(plan).some((id) => !groups.some((g) => g.id === id)))
    return 'Unknown target group.';
  for (const group of groups) {
    const chosen = plan[group.id];
    if (!Array.isArray(chosen) || chosen.length < group.min || chosen.length > group.max)
      return `Choose ${group.min}–${group.max} targets for ${group.label ?? group.id}.`;
    const candidates = targetGroupCandidates(state, groups, group.id, player, plan);
    if (
      chosen.some(
        (t, i) => !candidates.some((c) => same(t, c)) || chosen.slice(0, i).some((c) => same(t, c)),
      )
    )
      return `Choose distinct legal targets for ${group.label ?? group.id}.`;
  }
  return null;
}
/** Deterministic bounded proposals for bots; callers may submit any validated plan. */
export function targetPlans(state, groups, player, limit = 256) {
  const results = [];
  let visited = 0;
  const budget = 8192;
  if (groups.some((g) => targetsFor(state, g.selector, player).length < g.min)) return results;
  function visit(index, plan) {
    if (results.length >= limit || ++visited > budget) return;
    if (index === groups.length) {
      results.push(structuredClone(plan));
      return;
    }
    const group = groups[index],
      candidates = targetGroupCandidates(state, groups, group.id, player, plan);
    function choose(start, picked) {
      if (results.length >= limit || ++visited > budget) return;
      if (picked.length >= group.min) visit(index + 1, { ...plan, [group.id]: picked });
      if (picked.length === group.max || candidates.length - start < group.min - picked.length)
        return;
      for (let i = start; i < candidates.length; i++) {
        choose(i + 1, [...picked, candidates[i]]);
        if (results.length >= limit || ++visited > budget) return;
      }
    }
    choose(0, []);
  }
  visit(0, {});
  return results;
}
/** Resolution checks each declaration independently, not its original minimum. */
export function survivingTargets(state, groups, plan, player) {
  return Object.fromEntries(
    groups.map((g) => [
      g.id,
      (plan[g.id] ?? []).filter((t) => legalTarget(state, g.selector, t, player)),
    ]),
  );
}
