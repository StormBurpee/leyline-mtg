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
      return {
        ...p,
        ...(Array.isArray(visible) ? { [zone]: visible.filter((id) => id !== object.id) } : {}),
        ...(Number.isInteger(p[`${zone}Count`])
          ? { [`${zone}Count`]: Math.max(0, p[`${zone}Count`] - 1) }
          : {}),
      };
    }),
  };
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
  let profile =
    object.zone === 'graveyard'
      ? base?.flashback
        ? { ...base, cost: { ...base.flashback }, flashbackPaid: true }
        : null
      : base;
  if (!profile || (profile.warpPaid && object.zone !== 'hand')) return null;
  if (object.zone === 'exile' && object.plotted?.incarnation === object.incarnation)
    profile = { ...profile, cost: {}, plottedCast: true };
  if (profile.cost.X) {
    if (!Number.isSafeInteger(x) || x < 0 || x > MAX_X) return null;
    const cost = { ...profile.cost, generic: (profile.cost.generic ?? 0) + profile.cost.X * x };
    delete cost.X;
    profile = { ...profile, cost, chosenX: x };
  } else if (x !== undefined) return null;
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
    manaValue: profile.faceDownCast ? 0 : manaValue(card, x ?? 0),
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
