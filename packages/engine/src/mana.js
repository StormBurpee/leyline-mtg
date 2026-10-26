import { COLORS, controlled, definition, isSick, requireRule, emit } from './model.js';
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
export function tapForMana(s, id, p) {
  const o = s.objects[id];
  requireRule(
    Object.hasOwn(s.objects, id) && o && canTapForMana(s, o, p),
    'MANA_SOURCE',
    'That permanent cannot produce mana now.',
  );
  o.tapped = true;
  s.players[p].mana[definition(s, o).mana]++;
  emit(s, 'mana', { player: p, objectId: id, color: definition(s, o).mana });
}
/** Pure payment planner. Colored costs are reserved before generic spending. */
export function planPayment(s, p, cost, { autoTap = true, excludeSources = [] } = {}) {
  const pool = { ...s.players[p].mana };
  const taps = [];
  const spent = Object.fromEntries(COLORS.map((c) => [c, 0]));
  const sources = autoTap
    ? controlled(s, p).filter((o) => !excludeSources.includes(o.id) && canTapForMana(s, o, p))
    : [];
  const take = (color, n) => {
    while (pool[color] < n) {
      const i = sources.findIndex((o) => definition(s, o).mana === color);
      if (i < 0) return false;
      const [o] = sources.splice(i, 1);
      taps.push(o.id);
      pool[color]++;
    }
    pool[color] -= n;
    spent[color] += n;
    return true;
  };
  for (const color of COLORS) if (!take(color, cost[color] ?? 0)) return null;
  let generic = cost.generic ?? 0;
  for (const color of ['C', 'W', 'U', 'B', 'R', 'G']) {
    const n = Math.min(generic, pool[color]);
    pool[color] -= n;
    spent[color] += n;
    generic -= n;
  }
  while (generic > 0) {
    const o = sources.shift();
    if (!o) return null;
    const color = definition(s, o).mana;
    taps.push(o.id);
    spent[color]++;
    generic--;
  }
  return { taps, spent, remaining: pool };
}
export function pay(s, p, cost, autoTap = true, excludeSources = []) {
  const plan = planPayment(s, p, cost, { autoTap, excludeSources });
  requireRule(plan, 'MANA', 'You cannot pay this mana cost.');
  for (const id of plan.taps) tapForMana(s, id, p);
  for (const c of COLORS) s.players[p].mana[c] -= plan.spent[c];
  emit(s, 'paid', { player: p, spent: plan.spent });
  return plan;
}
