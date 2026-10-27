import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createGame,
  createRegistry,
  dispatch,
  planPayment,
  legalActions,
} from '../src/index.js';
import { fixture, put, act, resolve } from './helpers.js';
function source(s, name, colors) {
  s.catalog = createRegistry({
    ...s.catalog,
    [name]: { name, type: 'land', cost: {}, mana: colors },
  });
  return put(s, name);
}
test('flexible mana matching does not strand a colored cost', () => {
  const s = fixture(),
    dual = source(s, 'WU source', ['W', 'U']),
    white = put(s, 'Plains');
  const plan = planPayment(s, 0, { W: 1, U: 1 });
  assert.ok(plan);
  assert.deepEqual(plan.activations, [
    { card: dual.id, color: 'U' },
    { card: white.id, color: 'W' },
  ]);
});
test('generic payments preserve sources required by colored symbols', () => {
  const s = fixture();
  source(s, 'WU source', ['W', 'U']);
  put(s, 'Plains');
  put(s, 'Mountain');
  const plan = planPayment(s, 0, { W: 1, U: 1, generic: 1 });
  assert.ok(plan);
  assert.equal(plan.activations.length, 3);
  assert.equal(planPayment(s, 0, { W: 1, U: 1, generic: 2 }), null);
});
test('manual flexible mana requires an explicit supported color and rejects atomically', () => {
  let s = fixture();
  const dual = source(s, 'WU source', ['W', 'U']);
  for (const color of [undefined, 'R', 'generic']) {
    const r = dispatch(s, { type: 'tapMana', player: 0, card: dual.id, color });
    assert.equal(r.ok, false);
    assert.equal(r.state, s);
  }
  const actions = legalActions(s, 0).filter((a) => a.type === 'tapMana' && a.card === dual.id);
  assert.deepEqual(
    actions.map((a) => a.color),
    ['W', 'U'],
  );
  s = act(s, 'tapMana', { card: dual.id, color: 'U' });
  assert.equal(s.players[0].mana.U, 1);
  assert.equal(s.objects[dual.id].tapped, true);
});
test('gain lands enter tapped before their life trigger and landfall are stacked', () => {
  let s = fixture();
  put(s, 'Snapping Gnarlid');
  const land = put(s, 'Tranquil Cove', 0, 'hand');
  s = act(s, 'playLand', { card: land.id });
  assert.equal(s.objects[land.id].tapped, true);
  assert.equal(s.players[0].life, 20);
  assert.equal(s.choice.kind, 'orderTriggers');
  assert.equal(s.choice.entries.length, 2);
  assert.equal(planPayment(s, 0, { U: 1 }), null);
  s = act(s, 'orderTriggers', { ids: s.choice.entries.map((e) => e.id) });
  s = resolve(resolve(s));
  assert.equal(s.players[0].life, 21);
});
test('literal cost plans agree with exhaustive small-source assignments', () => {
  let rng = 31;
  const random = (n) => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng % n;
  };
  const colors = ['W', 'U', 'B'];
  // This exhaustive oracle compares literal mana assignments, not card-pack
  // completeness. A small valid catalog avoids revalidating thousands of
  // unrelated definitions for every generated source in every trial.
  const catalog = createRegistry([CARDS.Plains]);
  const deck = Array(60).fill('Plains');
  for (let trial = 0; trial < 120; trial++) {
    const s = createGame({ catalog, decks: [deck, deck], mulligan: false }),
      options = [];
    s.step = 'main1';
    s.turn = 3;
    for (let i = 0; i < 4; i++) {
      const list = colors.filter(() => random(2));
      if (!list.length) list.push(colors[random(3)]);
      options.push(list);
      source(s, `Source ${i}`, list);
    }
    const cost = { W: random(3), U: random(3), B: random(3), generic: random(3) };
    for (const color of colors) s.players[0].mana[color] = random(2);
    const feasible = (i, pool) => {
      if (i === options.length) {
        let remaining = 0;
        for (const c of colors) {
          if (pool[c] < (cost[c] ?? 0)) return false;
          remaining += pool[c] - (cost[c] ?? 0);
        }
        return remaining >= cost.generic;
      }
      return (
        feasible(i + 1, pool) ||
        options[i].some((c) => feasible(i + 1, { ...pool, [c]: pool[c] + 1 }))
      );
    };
    const before = structuredClone(s);
    const plan = planPayment(s, 0, cost);
    assert.equal(!!plan, feasible(0, s.players[0].mana), JSON.stringify({ trial, options, cost }));
    assert.deepEqual(s, before);
    if (plan) assert.equal(new Set(plan.taps).size, plan.taps.length);
  }
});
