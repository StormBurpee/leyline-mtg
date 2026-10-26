import { meetsCondition } from './conditions.js';
import { COLORS, controlled, definition, isSick, requireRule, emit, move } from './model.js';
export function manaRestriction(s, o, color) {
  const restriction = definition(s, o).manaRestrictions?.[color];
  return restriction
    ? {
        color,
        restriction,
        creatureType: o.chosenCreatureType,
        uncounterable: restriction === 'chosenCreatureType',
      }
    : null;
}
export function manaEligible(unit, purpose) {
  return (
    !unit ||
    (!!purpose &&
      purpose.type === 'cast' &&
      purpose.card?.type === 'creature' &&
      (unit.restriction === 'creature' ||
        (unit.restriction === 'chosenCreatureType' &&
          purpose.card.subtypes?.includes(unit.creatureType))))
  );
}
export function manaOptions(s, o) {
  const mana = definition(s, o).mana;
  return (mana ? (Array.isArray(mana) ? mana : [mana]) : []).filter((color) =>
    meetsCondition(s, o.controller, definition(s, o).manaConditions?.[color]),
  );
}
export function canTapForMana(s, o, p) {
  const d = definition(s, o);
  return (
    o.zone === 'battlefield' &&
    o.controller === p &&
    !o.tapped &&
    !!d.mana &&
    manaOptions(s, o).length > 0 &&
    (d.type !== 'creature' || !isSick(s, o))
  );
}
export function tapForMana(s, id, p, color) {
  const o = s.objects[id];
  requireRule(
    Object.hasOwn(s.objects, id) && o && canTapForMana(s, o, p),
    'MANA_SOURCE',
    'That permanent cannot produce mana now.',
  );
  const options = manaOptions(s, o);
  const chosen = color ?? (options.length === 1 ? options[0] : null);
  requireRule(options.includes(chosen), 'MANA_COLOR', 'Choose a color this source can produce.');
  o.tapped = true;
  const restriction = manaRestriction(s, o, chosen);
  if (restriction) (s.players[p].restrictedMana ??= []).push(restriction);
  else s.players[p].mana[chosen]++;
  emit(s, 'mana', { player: p, objectId: id, color: chosen });
  if (definition(s, o).manaSacrifice) {
    emit(s, 'sacrificed', { player: p, objectId: id, name: o.name });
    move(s, o, 'graveyard');
  }
}
/** Pure unit-capacity matching. Flexible sources must not strand a colored cost. */
export function planPayment(s, p, cost, { autoTap = true, excludeSources = [], purpose } = {}) {
  const pool = { ...s.players[p].mana };
  const spent = Object.fromEntries(COLORS.map((c) => [c, 0]));
  let sources = autoTap
    ? controlled(s, p).filter((o) => !excludeSources.includes(o.id) && canTapForMana(s, o, p))
    : [];
  const sacrificial = sources.filter((o) => definition(s, o).manaSacrifice).map((o) => o.id);
  if (sacrificial.length) {
    const preserve = planPayment(s, p, cost, {
      autoTap,
      purpose,
      excludeSources: [...excludeSources, ...sacrificial],
    });
    if (preserve) return preserve;
  }
  sources = [
    ...(s.players[p].restrictedMana ?? [])
      .map((unit, index) => ({ id: `restricted:${index}`, unit, index }))
      .filter((o) => manaEligible(o.unit, purpose)),
    ...sources.filter((o) =>
      manaOptions(s, o).some((color) => manaEligible(manaRestriction(s, o, color), purpose)),
    ),
  ];
  const demand = [];
  for (const color of COLORS) {
    const amount = cost[color] ?? 0,
      floating = Math.min(pool[color], amount);
    pool[color] -= floating;
    spent[color] += floating;
    const remaining = amount - floating;
    if (remaining > sources.length - demand.length) return null;
    for (let i = 0; i < remaining; i++) demand.push(color);
  }
  const choices = sources.map((o) =>
      o.unit
        ? [o.unit.color]
        : manaOptions(s, o).filter((color) => manaEligible(manaRestriction(s, o, color), purpose)),
    ),
    assigned = Array(sources.length).fill(-1);
  const match = (slot, visited) => {
    for (let i = 0; i < sources.length; i++) {
      if (visited.has(i) || !choices[i].includes(demand[slot])) continue;
      visited.add(i);
      if (assigned[i] < 0 || match(assigned[i], visited)) {
        assigned[i] = slot;
        return true;
      }
    }
    return false;
  };
  for (let slot = 0; slot < demand.length; slot++) if (!match(slot, new Set())) return null;
  const activations = [],
    restrictedSpent = [],
    restrictedSources = [];
  let uncounterable = false;
  const consume = (source, color) => {
    const unit = source.unit ?? manaRestriction(s, source, color);
    if (source.unit) restrictedSpent.push(source.index);
    else {
      activations.push({ card: source.id, color });
      if (unit) restrictedSources.push(source.id);
    }
    if (!unit) spent[color]++;
    else uncounterable ||= !!unit.uncounterable;
  };
  for (let i = 0; i < sources.length; i++)
    if (assigned[i] >= 0) {
      const color = demand[assigned[i]];
      consume(sources[i], color);
    }
  let generic = cost.generic ?? 0;
  for (const color of ['C', 'W', 'U', 'B', 'R', 'G']) {
    const n = Math.min(generic, pool[color]);
    pool[color] -= n;
    spent[color] += n;
    generic -= n;
  }
  for (let i = 0; i < sources.length && generic > 0; i++)
    if (assigned[i] < 0) {
      const color = choices[i][0];
      consume(sources[i], color);
      generic--;
    }
  if (generic > 0) return null;
  return {
    taps: activations.map((a) => a.card),
    activations,
    spent,
    remaining: pool,
    restrictedSpent,
    restrictedSources,
    uncounterable,
  };
}
export function pay(s, p, cost, autoTap = true, excludeSources = [], purpose) {
  const plan = planPayment(s, p, cost, { autoTap, excludeSources, purpose });
  requireRule(plan, 'MANA', 'You cannot pay this mana cost.');
  const consumed = new Set(plan.restrictedSpent);
  for (const activation of plan.activations) {
    if (plan.restrictedSources.includes(activation.card))
      consumed.add((s.players[p].restrictedMana ?? []).length);
    tapForMana(s, activation.card, p, activation.color);
  }
  if (s.players[p].restrictedMana)
    s.players[p].restrictedMana = s.players[p].restrictedMana.filter((_, i) => !consumed.has(i));
  for (const color of COLORS) s.players[p].mana[color] -= plan.spent[color];
  emit(s, 'paid', { player: p, spent: plan.spent });
  return plan;
}
