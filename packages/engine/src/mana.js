import { tapObjects } from './model.js';
import { hasType } from './types.js';
import { hasSubtype } from './creature-types.js';
import { meetsCondition } from './conditions.js';
import {
  COLORS,
  controlled,
  definition,
  isSick,
  requireRule,
  emit,
  loseLife,
  sacrificePermanents,
} from './model.js';
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
    unit.duration === 'combat' ||
    (!!purpose &&
      purpose.type === 'cast' &&
      purpose.card?.type === 'creature' &&
      (unit.restriction === 'creature' ||
        (unit.restriction === 'chosenCreatureType' && hasSubtype(purpose.card, unit.creatureType))))
  );
}
export function manaOptions(s, o) {
  const mana = definition(s, o).mana;
  return (mana ? (Array.isArray(mana) ? mana : [mana]) : []).filter(
    (color) =>
      meetsCondition(s, o.controller, definition(s, o).manaConditions?.[color], [], o) &&
      s.players[o.controller].life >= (definition(s, o).manaLifeCosts?.[color] ?? 0),
  );
}
export function canTapForMana(s, o, p) {
  if (o.zone !== 'battlefield' || o.controller !== p) return false;
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
  const life = definition(s, o).manaLifeCosts?.[chosen] ?? 0;
  if (life) {
    loseLife(s, p, life);
    emit(s, 'lifePaid', { player: p, amount: life, objectId: o.id });
  }
  tapObjects(s, [o]);
  const restriction = manaRestriction(s, o, chosen);
  if (restriction) (s.players[p].restrictedMana ??= []).push(restriction);
  else s.players[p].mana[chosen]++;
  emit(s, 'mana', { player: p, objectId: id, color: chosen });
  if (definition(s, o).manaSacrifice) {
    sacrificePermanents(s, [o]);
  }
}
/** Pure unit-capacity matching. Flexible sources must not strand a colored cost. */
export function planPayment(
  s,
  p,
  cost,
  { autoTap = true, excludeSources = [], purpose, convoke = false, excludeManaSources = [] } = {},
) {
  if (
    cost.X ||
    Object.entries(cost).some(([symbol, amount]) => /^2\/[WUBRG]$/.test(symbol) && amount > 0)
  )
    return null; // X must be announced and expanded before payment.
  if (
    purpose?.card?.manaAsAnyType ||
    controlled(s, p).some(
      (o) => definition(s, o).manaLifeCosts && !o.tapped && !excludeSources.includes(o.id),
    )
  )
    return planLifePayment(s, p, cost, {
      autoTap,
      excludeSources,
      purpose,
      convoke,
      excludeManaSources,
    });

  const pool = { ...s.players[p].mana };
  const spent = Object.fromEntries(COLORS.map((c) => [c, 0]));
  const canConvoke = (o) => convoke && !o.tapped && hasType(definition(s, o), 'creature');
  const realChoices = (o) =>
    autoTap && !excludeManaSources.includes(o.id) && canTapForMana(s, o, p)
      ? manaOptions(s, o).filter((color) => manaEligible(manaRestriction(s, o, color), purpose))
      : [];
  let sources = controlled(s, p).filter(
    (o) => !excludeSources.includes(o.id) && (realChoices(o).length || canConvoke(o)),
  );
  const sacrificial = sources.filter((o) => definition(s, o).manaSacrifice).map((o) => o.id);
  if (sacrificial.length) {
    const preserve = planPayment(s, p, cost, {
      autoTap,
      purpose,
      convoke,
      excludeManaSources,
      excludeSources: [...excludeSources, ...sacrificial],
    });
    if (preserve) return preserve;
  }
  sources = [
    ...(s.players[p].restrictedMana ?? [])
      .map((unit, index) => ({ id: `restricted:${index}`, unit, index }))
      .filter((o) => manaEligible(o.unit, purpose)),
    ...sources,
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
  const hybrids = Object.entries(cost).filter(([symbol]) => symbol.includes('/'));
  if (hybrids.length) {
    const hybridTotal = hybrids.reduce((n, [, amount]) => n + amount, 0);
    if (hybridTotal > 1000) return null;
    const floating = COLORS.flatMap((color) =>
      Array.from({ length: Math.min(pool[color], hybridTotal) }, () => ({ floatingColor: color })),
    );
    sources = [...floating, ...sources];
    for (const [symbol, amount] of hybrids) for (let i = 0; i < amount; i++) demand.push(symbol);
  }
  const choices = sources.map((o) =>
      o.floatingColor
        ? [o.floatingColor]
        : o.unit
          ? [o.unit.color]
          : [
              ...new Set([
                ...realChoices(o),
                ...(canConvoke(o)
                  ? [...(definition(s, o).color ?? []).filter((c) => c !== 'C'), '*']
                  : []),
              ]),
            ],
    ),
    assigned = Array(sources.length).fill(-1);
  const match = (slot, visited) => {
    for (let i = 0; i < sources.length; i++) {
      if (visited.has(i) || !choices[i].some((color) => demand[slot].split('/').includes(color)))
        continue;
      visited.add(i);
      if (assigned[i] < 0 || match(assigned[i], visited)) {
        assigned[i] = slot;
        return true;
      }
    }
    return false;
  };
  for (let slot = 0; slot < demand.length; slot++) if (!match(slot, new Set())) return null;
  const convoked = [];
  const activations = [],
    restrictedSpent = [],
    restrictedSources = [];
  let uncounterable = false;
  const consume = (source, color, symbol = 'generic') => {
    if (!source.floatingColor && !source.unit && !realChoices(source).includes(color)) {
      convoked.push({ card: source.id, symbol });
      return;
    }
    if (source.floatingColor) {
      spent[color]++;
      pool[color]--;
      return;
    }
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
      const color = choices[i].find((color) => demand[assigned[i]].split('/').includes(color));
      consume(sources[i], color, demand[assigned[i]]);
    }
  let generic = cost.generic ?? 0;
  for (const color of ['C', 'W', 'U', 'B', 'R', 'G']) {
    const n = Math.min(generic, pool[color]);
    pool[color] -= n;
    spent[color] += n;
    generic -= n;
  }
  for (let i = 0; i < sources.length && generic > 0; i++)
    if (assigned[i] < 0 && !sources[i].floatingColor) {
      const color = choices[i][0];
      consume(sources[i], color);
      generic--;
    }
  if (generic > 0) return null;
  return {
    convoked,
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

/** Minimum-life unit matching. It includes generic demand, so a colored pain
 * source is never paid merely because it appears earlier in battlefield order. */
function planLifePayment(s, p, cost, options) {
  const { autoTap, excludeSources, purpose, convoke, excludeManaSources } = options;
  const demand = [];
  for (const [symbol, n] of Object.entries(cost)) for (let i = 0; i < n; i++) demand.push(symbol);
  if (demand.length > 1000) return null;
  const units = [];
  for (const color of COLORS)
    for (let i = 0; i < Math.min(s.players[p].mana[color], demand.length); i++)
      units.push({ floatingColor: color, options: [{ color, life: 0, mode: 'floating' }] });
  for (const [index, unit] of (s.players[p].restrictedMana ?? []).entries())
    if (manaEligible(unit, purpose))
      units.push({ unit, index, options: [{ color: unit.color, life: 0, mode: 'restricted' }] });
  for (const object of controlled(s, p)) {
    if (excludeSources.includes(object.id)) continue;
    const d = definition(s, object),
      choices = [];
    if (autoTap && !excludeManaSources.includes(object.id) && canTapForMana(s, object, p))
      for (const color of manaOptions(s, object))
        if (manaEligible(manaRestriction(s, object, color), purpose))
          choices.push({ color, life: d.manaLifeCosts?.[color] ?? 0, mode: 'mana' });
    if (convoke && !object.tapped && hasType(d, 'creature'))
      for (const color of [...(d.color ?? []).filter((c) => c !== 'C'), '*'])
        choices.push({ color, life: 0, mode: 'convoke' });
    if (choices.length) units.push({ object, options: choices });
  }
  // Preserve sacrificial mana sources when a payment without them exists.
  const sacrificial = units
    .filter((u) => u.object && definition(s, u.object).manaSacrifice)
    .map((u) => u.object.id);
  if (sacrificial.length) {
    const safe = planLifePayment(s, p, cost, {
      ...options,
      excludeSources: [...excludeSources, ...sacrificial],
    });
    if (safe) return safe;
  }
  if (demand.length > units.length) return null;
  const edge = demand.map((symbol) =>
    units.map(
      (u) =>
        u.options
          .filter(
            (o) =>
              symbol === 'generic' ||
              symbol.split('/').includes(o.color) ||
              (purpose?.card?.manaAsAnyType && o.mode !== 'convoke'),
          )
          .sort(
            (a, b) =>
              a.life - b.life || Number(a.mode === 'convoke') - Number(b.mode === 'convoke'),
          )[0],
    ),
  );
  const assigned = Array(units.length).fill(-1),
    selected = Array(demand.length).fill(-1);
  for (let slot = 0; slot < demand.length; slot++) {
    // Residual graph: unmatched slot -> source costs life; source -> its
    // currently matched slot refunds that edge. Each augmentation is cheapest.
    const ds = Array(demand.length).fill(Infinity),
      du = Array(units.length).fill(Infinity),
      prev = Array(units.length).fill(-1);
    ds[slot] = 0;
    const queue = [slot],
      queued = new Set(queue);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const a = queue[cursor];
      queued.delete(a);
      for (let u = 0; u < units.length; u++) {
        if (!edge[a][u] || assigned[u] === a) continue;
        const distance = ds[a] + edge[a][u].life;
        if (distance >= du[u]) continue;
        du[u] = distance;
        prev[u] = a;
        const b = assigned[u];
        if (b >= 0 && distance - edge[b][u].life < ds[b]) {
          ds[b] = distance - edge[b][u].life;
          if (!queued.has(b)) {
            queue.push(b);
            queued.add(b);
          }
        }
      }
    }
    let free = -1;
    for (let u = 0; u < units.length; u++)
      if (assigned[u] < 0 && du[u] < Infinity && (free < 0 || du[u] < du[free])) free = u;
    if (free < 0) return null;
    while (free >= 0) {
      const a = prev[free],
        old = selected[a];
      assigned[free] = a;
      selected[a] = free;
      free = old;
    }
  }
  const plan = {
    convoked: [],
    taps: [],
    activations: [],
    spent: Object.fromEntries(COLORS.map((c) => [c, 0])),
    remaining: { ...s.players[p].mana },
    restrictedSpent: [],
    restrictedSources: [],
    uncounterable: false,
    life: 0,
  };
  for (let a = 0; a < demand.length; a++) {
    const u = units[selected[a]],
      chosen = edge[a][selected[a]],
      color = chosen.color;
    plan.life += chosen.life;
    if (chosen.mode === 'convoke') {
      plan.convoked.push({ card: u.object.id, symbol: demand[a] });
      continue;
    }
    if (u.floatingColor) {
      plan.spent[color]++;
      plan.remaining[color]--;
      continue;
    }
    const restriction = u.unit ?? manaRestriction(s, u.object, color);
    if (u.unit) plan.restrictedSpent.push(u.index);
    else {
      plan.taps.push(u.object.id);
      plan.activations.push({ card: u.object.id, color });
      if (restriction) plan.restrictedSources.push(u.object.id);
    }
    if (!restriction) plan.spent[color]++;
    else plan.uncounterable ||= !!restriction.uncounterable;
  }
  // Use free activations first; life payment must not unnecessarily disable
  // an otherwise available conditional source before it has produced mana.
  plan.activations.sort(
    (a, b) =>
      (definition(s, s.objects[a.card]).manaLifeCosts?.[a.color] ?? 0) -
      (definition(s, s.objects[b.card]).manaLifeCosts?.[b.color] ?? 0),
  );
  return plan.life <= s.players[p].life ? plan : null;
}
