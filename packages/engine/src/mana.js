import { COLORS, controlled, definition, isSick, requireRule, emit, move } from './model.js';
export function manaOptions(s, o) {
  const mana = definition(s, o).mana;
  return mana ? (Array.isArray(mana) ? mana : [mana]) : [];
}
export function canTapForMana(s, o, p) {
  const d = definition(s, o);
  return (
    o.zone === 'battlefield' &&
    o.controller === p &&
    !o.tapped &&
    !!d.mana &&
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
  s.players[p].mana[chosen]++;
  emit(s, 'mana', { player: p, objectId: id, color: chosen });
  if (definition(s, o).manaSacrifice) {
    emit(s, 'sacrificed', { player: p, objectId: id, name: o.name });
    move(s, o, 'graveyard');
  }
}
/** Pure unit-capacity matching. Flexible sources must not strand a colored cost. */
export function planPayment(s, p, cost, { autoTap = true, excludeSources = [] } = {}) {
  const pool = { ...s.players[p].mana };
  const spent = Object.fromEntries(COLORS.map((c) => [c, 0]));
  const sources = autoTap
    ? controlled(s, p).filter((o) => !excludeSources.includes(o.id) && canTapForMana(s, o, p))
    : [];
  const sacrificial = sources.filter((o) => definition(s, o).manaSacrifice).map((o) => o.id);
  if (sacrificial.length) {
    const preserve = planPayment(s, p, cost, {
      autoTap,
      excludeSources: [...excludeSources, ...sacrificial],
    });
    if (preserve) return preserve;
  }
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
  const choices = sources.map((o) => manaOptions(s, o)),
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
  const activations = [];
  for (let i = 0; i < sources.length; i++)
    if (assigned[i] >= 0) {
      const color = demand[assigned[i]];
      activations.push({ card: sources[i].id, color });
      spent[color]++;
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
      activations.push({ card: sources[i].id, color });
      spent[color]++;
      generic--;
    }
  if (generic > 0) return null;
  return { taps: activations.map((a) => a.card), activations, spent, remaining: pool };
}
export function pay(s, p, cost, autoTap = true, excludeSources = []) {
  const plan = planPayment(s, p, cost, { autoTap, excludeSources });
  requireRule(plan, 'MANA', 'You cannot pay this mana cost.');
  for (const activation of plan.activations) tapForMana(s, activation.card, p, activation.color);
  for (const color of COLORS) s.players[p].mana[color] -= plan.spent[color];
  emit(s, 'paid', { player: p, spent: plan.spent });
  return plan;
}
