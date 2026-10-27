import { tapObjects } from './model.js';
import { proposedCastingState } from './casting-costs.js';
import { controlled, definition, ref, stats, loseLife, move, emit, requireRule } from './model.js';
import { matchesFilter } from './selectors.js';
import { hasType } from './types.js';
import { convokePayment } from './convoke.js';

export function harmonizeCandidates(s, p) {
  return controlled(s, p).filter((o) => !o.tapped && hasType(definition(s, o), 'creature'));
}
/** A casting cost, never a resolving sacrifice instruction or a target. */
export function castingSacrificeCandidates(s, p, profile) {
  if (!profile.sacrificeCost) return [];
  return controlled(s, p).filter((o) =>
    matchesFilter({ definition: definition(s, o) }, profile.sacrificeCost.where, p),
  );
}
function baseCastingPayment(
  s,
  p,
  profile,
  { sacrifice, convoke, harmonize, autoTap = true, card } = {},
) {
  if (card) {
    const object = s.objects[card];
    if (!object) return null;
    if (object.zone !== 'stack' && s.rulesRevision !== 1)
      s = proposedCastingState(s, p, object, profile.chosenX);
  }
  if (profile.harmonizePaid) {
    if (sacrifice !== undefined || (convoke?.length ?? 0)) return null;
    if (harmonize === undefined) {
      for (const selected of [null, ...harmonizeCandidates(s, p).map(ref)]) {
        const plan = castingPayment(s, p, profile, { harmonize: selected, autoTap });
        if (plan) return plan;
      }
      return null;
    }
    let object = null;
    if (harmonize !== null) {
      if (
        !harmonize ||
        harmonize.kind !== 'object' ||
        Object.keys(harmonize).some((k) => !['kind', 'id', 'incarnation'].includes(k))
      )
        return null;
      object = harmonizeCandidates(s, p).find(
        (o) => o.id === harmonize.id && o.incarnation === harmonize.incarnation,
      );
      if (!object) return null;
    }
    const cost = {
      ...profile.cost,
      generic: Math.max(
        0,
        (profile.cost.generic ?? 0) - Math.max(0, object ? stats(s, object).power : 0),
      ),
    };
    const excluded = object ? [object.id] : [];
    const plan = convokePayment(s, p, { ...profile, cost }, [], autoTap, excluded);
    return plan
      ? {
          ...plan,
          harmonize: object ? ref(object) : null,
          excludeSources: [...plan.excludeSources, ...excluded],
        }
      : null;
  }
  if (harmonize !== undefined) return null;
  if (!profile.sacrificeCost) {
    if (sacrifice !== undefined) return null;
    return convokePayment(s, p, profile, convoke, autoTap);
  }
  const candidates = castingSacrificeCandidates(s, p, profile);
  if (sacrifice === undefined) {
    for (const object of candidates) {
      const plan = baseCastingPayment(s, p, profile, { sacrifice: ref(object), convoke, autoTap });
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

/** Exact object references bind additional costs to the announced incarnation. */
export function additionalCostCandidates(s, p, profile, card) {
  const kind = profile.additionalCost?.kind;
  if (kind === 'discardOrLife')
    return s.players[p].hand.filter((id) => id !== card).map((id) => s.objects[id]);
  return controlled(s, p).filter(
    (o) => hasType(definition(s, o), 'creature') && (kind !== 'teamwork' || !o.tapped),
  );
}
export function additionalCostOptions(s, p, profile, card) {
  const cost = profile.additionalCost;
  if (!cost) return [undefined];
  const objects = additionalCostCandidates(s, p, profile, card);
  if (cost.kind === 'discardOrLife')
    return [
      ...(s.players[p].life >= cost.life ? [{ life: true }] : []),
      ...objects.map((o) => ({ discard: ref(o) })),
    ];
  if (cost.kind === 'blight') return [null, ...objects.map((o) => ({ blight: ref(o) }))];
  const options = [null];
  for (const object of objects)
    if (stats(s, object).power >= cost.power) options.push({ teamwork: [ref(object)] });
  // Two deterministic witnesses supplement all single-creature payments. Humans
  // may submit any legal subset; action enumeration never inspects concealed cards.
  for (const preferNonmana of [false, true]) {
    const chosen = [];
    let power = 0;
    for (const object of [...objects].sort(
      (a, b) =>
        (preferNonmana ? Number(!!definition(s, a).mana) - Number(!!definition(s, b).mana) : 0) ||
        stats(s, b).power - stats(s, a).power ||
        a.id.localeCompare(b.id),
    )) {
      if (stats(s, object).power <= 0) continue;
      chosen.push(ref(object));
      power += stats(s, object).power;
      if (power >= cost.power) {
        if (chosen.length > 1) options.push({ teamwork: chosen });
        break;
      }
    }
  }
  return options;
}
function validRef(value, candidates) {
  return (
    value &&
    value.kind === 'object' &&
    Object.keys(value).every((k) => ['kind', 'id', 'incarnation'].includes(k)) &&
    candidates.some((o) => o.id === value.id && o.incarnation === value.incarnation)
  );
}
export function castingPayment(s, p, profile, { additionalCost, ...options } = {}) {
  const cost = profile.additionalCost;
  if (!cost)
    return additionalCost === undefined ? baseCastingPayment(s, p, profile, options) : null;
  if (additionalCost === undefined) {
    for (const candidate of additionalCostOptions(s, p, profile, options.card)) {
      const plan = castingPayment(s, p, profile, { ...options, additionalCost: candidate });
      if (plan) return plan;
    }
    return null;
  }
  const candidates = additionalCostCandidates(s, p, profile, options.card);
  let life = 0,
    excluded = [];
  if (additionalCost === null) {
    if (cost.kind === 'discardOrLife') return null;
  } else {
    if (
      typeof additionalCost !== 'object' ||
      Array.isArray(additionalCost) ||
      Object.keys(additionalCost).length !== 1
    )
      return null;
    if (cost.kind === 'discardOrLife') {
      if (additionalCost.life === true) life = cost.life;
      else if (!validRef(additionalCost.discard, candidates)) return null;
    } else if (cost.kind === 'blight') {
      if (!validRef(additionalCost.blight, candidates)) return null;
      if (definition(s, s.objects[additionalCost.blight.id]).manaSacrifice)
        excluded.push(additionalCost.blight.id);
    } else {
      const chosen = additionalCost.teamwork;
      if (
        !Array.isArray(chosen) ||
        new Set(chosen.map((r) => r?.id)).size !== chosen.length ||
        chosen.some((r) => !validRef(r, candidates)) ||
        chosen.reduce((n, r) => n + stats(s, s.objects[r.id]).power, 0) < cost.power
      )
        return null;
      excluded = chosen.map((r) => r.id);
    }
  }
  if (s.players[p].life < life) return null;
  const proposed = {
    ...s,
    objects: { ...s.objects },
  };
  for (const id of excluded) proposed.objects[id] = { ...s.objects[id], tapped: true };
  const plan = baseCastingPayment(proposed, p, profile, options);
  // Mana abilities happen before additional life is paid. Keep their conditions
  // on actual life, then reserve the combined minimum-life payment budget.
  return plan && (plan.mana?.life ?? 0) + life <= s.players[p].life
    ? {
        ...plan,
        excludeSources: [...plan.excludeSources, ...excluded],
        additionalCost: structuredClone(additionalCost),
      }
    : null;
}
export function payAdditionalCost(s, p, profile, choice) {
  if (!choice) return;
  const candidates = additionalCostCandidates(s, p, profile);
  if (choice.life) {
    requireRule(
      s.players[p].life >= profile.additionalCost.life,
      'ADDITIONAL_COST',
      'Cannot pay the life cost.',
    );
    loseLife(s, p, profile.additionalCost.life);
    emit(s, 'lifePaid', { player: p, amount: profile.additionalCost.life });
  } else if (choice.discard) {
    requireRule(
      validRef(choice.discard, candidates),
      'ADDITIONAL_COST',
      'The discard cost changed.',
    );
    move(s, s.objects[choice.discard.id], 'graveyard');
    emit(s, 'discard', { player: p, count: 1 });
  } else if (choice.blight) {
    requireRule(
      validRef(choice.blight, candidates),
      'ADDITIONAL_COST',
      'The blight creature changed.',
    );
    const o = s.objects[choice.blight.id];
    o.minusCounters = (o.minusCounters ?? 0) + profile.additionalCost.amount;
    emit(s, 'blighted', { player: p, objectId: o.id, amount: profile.additionalCost.amount });
  } else if (choice.teamwork) {
    requireRule(
      choice.teamwork.every((r) => validRef(r, candidates)) &&
        choice.teamwork.reduce((n, r) => n + stats(s, s.objects[r.id]).power, 0) >=
          profile.additionalCost.power,
      'ADDITIONAL_COST',
      'The teamwork payment changed.',
    );
    tapObjects(
      s,
      choice.teamwork.map((r) => s.objects[r.id]),
    );
  }
}
