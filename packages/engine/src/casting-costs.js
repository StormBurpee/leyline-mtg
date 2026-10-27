import { topLibraryPlayable } from './model.js';
import {
  definition,
  battlefield,
  stats,
  keywords,
  isAttacking,
  isBlocking,
  requireRule,
} from './model.js';
import { spellProfile } from './spell-modes.js';
import { matchesFilter } from './selectors.js';
import { numericValue } from './numeric-values.js';
import { meetsCondition } from './conditions.js';
import { manaValue, MAX_X } from './mana-value.js';
function targetFacts(state, target) {
  if (target?.kind === 'player') return { controller: target.id, owner: target.id };
  if (target?.kind === 'stack') {
    const entry = state.stack.find((e) => e.id === target.id);
    if (!entry) return null;
    const object = state.objects[entry.source?.id],
      card = entry.sourceDefinition ?? (object ? definition(state, object) : null);
    return card
      ? {
          definition: card,
          controller: entry.controller,
          owner: object?.owner,
          manaValue: manaValue(card, entry.x ?? 0),
          keywords: card.keywords,
          ...(object ? stats(state, object) : {}),
        }
      : null;
  }
  const object = target?.kind === 'object' && state.objects[target.id];
  if (
    !object ||
    !['battlefield', 'graveyard'].includes(object.zone) ||
    object.incarnation !== target.incarnation
  )
    return null;
  const card = definition(state, object);
  return {
    definition: card,
    controller: object.controller,
    owner: object.owner,
    token: object.token,
    tapped: object.tapped,
    attacking: isAttacking(state, object),
    blocking: isBlocking(state, object),
    ...stats(state, object),
    keywords: keywords(state, object),
    manaValue: manaValue(card),
  };
}
/** Read-only proposal used by cost determination and mana-source availability. */
export function proposedCastingState(state, player, object, x) {
  const proposed = { ...object, zone: 'stack', controller: player, chosenX: x ?? 0 };
  return {
    ...state,
    objects: { ...state.objects, [object.id]: proposed },
    players: state.players.map((p, index) => {
      // Only the known source zone can contain this announced card. Never
      // inspect an opponent's hand or either concealed library to plan payment.
      if (
        index !== object.owner ||
        !['hand', 'graveyard', 'exile', 'library'].includes(object.zone)
      )
        return p;
      const zone = object.zone;
      const visible = Object.getOwnPropertyDescriptor(p, zone)?.value;
      const descriptors = Object.getOwnPropertyDescriptors(p);
      // Preserve opaque-zone accessors without evaluating them while removing
      // the known announced card from its one visible source zone.
      if (Array.isArray(visible))
        descriptors[zone] = {
          value: visible.filter((id) => id !== object.id),
          enumerable: true,
          writable: true,
          configurable: true,
        };
      if (Number.isInteger(p[`${zone}Count`]))
        descriptors[`${zone}Count`] = {
          value: Math.max(0, p[`${zone}Count`] - 1),
          enumerable: true,
          writable: true,
          configurable: true,
        };
      return Object.create(Object.getPrototypeOf(p), descriptors);
    }),
  };
}
/** Announced division is fixed even if one target later becomes illegal. */
export function distributionProblem(profile, targets, distribution) {
  if (!profile.distributedCounters)
    return distribution === undefined ? null : 'This spell has no distribution.';
  const selected = targets?.distributed;
  if (
    !Array.isArray(selected) ||
    !distribution ||
    typeof distribution !== 'object' ||
    Array.isArray(distribution) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(distribution))
  )
    return 'Assign counters to the chosen creatures.';
  if (
    Object.keys(distribution).length !== selected.length ||
    selected.some(
      (t) =>
        !Object.hasOwn(distribution, t.id) ||
        !Number.isSafeInteger(distribution[t.id]) ||
        distribution[t.id] < 1,
    ) ||
    Object.values(distribution).reduce((n, v) => n + v, 0) !== profile.chosenX
  )
    return 'Distribute exactly X counters, at least one per target.';
  return null;
}
/** Determine, then lock, the mana cost. Increases precede reductions (CR 601.2f). */
export function castingProfile(
  state,
  player,
  object,
  mode,
  target = null,
  card = definition(state, object),
  x,
) {
  const base = spellProfile(card, mode);
  // CR 601.3e: a zone permission tests the spell characteristics actually chosen,
  // not the main face printed on an Adventure or face-down spell.
  if (object.zone === 'library' && (!base || !topLibraryPlayable(state, object, player, base)))
    return null;
  // The permission from a resolved Adventure permits only its main face.
  const adventurePermission =
    object.zone === 'exile' &&
    object.adventured?.incarnation === object.incarnation &&
    object.adventured.player === player;
  const otherPermission =
    object.playPermission?.player === player &&
    (object.playPermission.turn === state.turn ||
      (object.playPermission.untilNextTurn !== undefined &&
        !object.playPermission.nextTurnStarted)) &&
    object.playPermission.incarnation === object.incarnation;
  if (base?.adventureCast && adventurePermission && !otherPermission) return null;
  let profile =
    object.zone === 'graveyard'
      ? base?.harmonize
        ? { ...base, cost: { ...base.harmonize }, harmonizePaid: true }
        : base?.flashback
          ? { ...base, cost: { ...base.flashback }, flashbackPaid: true }
          : null
      : base;
  if (!profile || (profile.warpPaid && object.zone !== 'hand')) return null;
  if (object.zone === 'exile' && otherPermission && object.playPermission.anyMana)
    profile = { ...profile, manaAsAnyType: true };
  if (object.zone === 'exile' && object.plotted?.incarnation === object.incarnation)
    profile = { ...profile, cost: {}, plottedCast: true };
  // Alternative/free base costs never erase mandatory Spree additional costs.
  if (base?.spree && (profile.flashbackPaid || profile.plottedCast)) {
    const cost = { ...profile.cost };
    for (const [symbol, amount] of Object.entries(base.modeAdditionalMana ?? {}))
      cost[symbol] = (cost[symbol] ?? 0) + amount;
    profile = { ...profile, cost };
  }
  if (profile.cost.X) {
    if (!Number.isSafeInteger(x) || x < 0 || x > MAX_X) return null;
    const cost = { ...profile.cost, generic: (profile.cost.generic ?? 0) + profile.cost.X * x };
    delete cost.X;
    profile = { ...profile, cost, chosenX: x };
  } else if (x !== undefined) return null;
  if (profile.distributedCounters)
    profile = {
      ...profile,
      targetGroups: [
        {
          id: 'distributed',
          label: 'Distribute +1/+1 counters',
          selector: profile.distributedCounters,
          min: x === 0 ? 0 : 1,
          max: x,
        },
      ],
      effects: [{ op: 'distributedCounters', targetGroup: 'distributed' }],
    };
  const intrinsic = (profile.costModifiers ?? []).filter((m) => m.scope === 'self');
  const sources = battlefield(state)
    .map((source) => ({
      source,
      modifiers: (definition(state, source).costModifiers ?? []).filter((m) => m.scope !== 'self'),
    }))
    .filter((x) => x.modifiers.length);
  if (!intrinsic.length && !sources.length) return profile;
  const projected = proposedCastingState(state, player, object, x);
  const proposed = projected.objects[object.id];
  const spell = {
    definition: profile,
    controller: player,
    owner: object.owner,
    manaValue: profile.faceDownCast ? 0 : manaValue(profile.adventureCast ? profile : card, x ?? 0),
    keywords: profile.keywords,
    ...(profile.faceDownCast ? { power: 2, toughness: 2 } : stats(projected, proposed)),
  };
  const targetInfo = (Array.isArray(target) ? target : [target])
    .map((t) => targetFacts(projected, t))
    .filter(Boolean);
  let increase = 0,
    reduction = 0;
  const apply = (modifier, source, controller) => {
    if (modifier.scope === 'you' && player !== controller) return;
    if (modifier.scope === 'opponent' && player === controller) return;
    if (
      !matchesFilter(spell, modifier.where, controller) ||
      !meetsCondition(projected, controller, modifier.condition, [], source)
    )
      return;
    if (
      modifier.targetWhere &&
      !targetInfo.some((info) => matchesFilter(info, modifier.targetWhere, controller))
    )
      return;
    const amount = Math.max(0, numericValue(projected, modifier.amount, { controller, source }));
    if (modifier.change === 'increase') increase += amount;
    else reduction += amount;
  };
  intrinsic.forEach((m) => apply(m, proposed, player));
  for (const { source, modifiers } of sources)
    modifiers.forEach((m) => apply(m, source, source.controller));
  requireRule(
    Number.isSafeInteger(increase) && Number.isSafeInteger(reduction),
    'COST_RANGE',
    'Cost adjustments exceed the safe integer range.',
  );
  const generic = Math.max(0, (profile.cost.generic ?? 0) + increase - reduction);
  requireRule(
    Number.isSafeInteger(generic),
    'COST_RANGE',
    'The casting cost exceeds the safe integer range.',
  );
  const cost = { ...profile.cost };
  if (generic || Object.hasOwn(cost, 'generic')) cost.generic = generic;
  return { ...profile, cost };
}
