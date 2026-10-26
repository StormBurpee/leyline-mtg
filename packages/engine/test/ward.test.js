import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry, dispatch, ref, legalActions } from '../src/index.js';
import { move } from '../src/model.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
const sentinel = {
  name: 'Ward fixture',
  type: 'creature',
  cost: { U: 1 },
  power: 2,
  toughness: 2,
  ward: { mana: { generic: 2 } },
};
function setup(mana = 3) {
  const s = fixture();
  s.catalog = createRegistry({ ...CARDS, [sentinel.name]: sentinel });
  lands(s, 'Mountain', mana);
  const target = put(s, sentinel.name, 1),
    bolt = put(s, 'Lightning Bolt', 0, 'hand');
  return { s, target, bolt };
}
function castBolt(s, target, bolt) {
  return act(s, 'cast', { card: bolt.id, target: ref(target) });
}
test('ward permits targeting and triggers above the spell instead of increasing its cast cost', () => {
  let { s, target, bolt } = setup(1);
  assert.ok(legalActions(s, 0).some((a) => a.type === 'cast' && a.target?.id === target.id));
  s = castBolt(s, target, bolt);
  assert.equal(s.stack.length, 2);
  assert.equal(s.stack.at(-1).label, 'Ward fixture · ward');
  assert.equal(s.players[0].life, 20);
  s = resolve(s);
  assert.equal(s.choice.kind, 'payCost');
  assert.equal(s.choice.player, 0);
  assert.equal(s.choice.payable, false);
});
test('paying ward preserves the original spell and uses the available mana', () => {
  let { s, target, bolt } = setup();
  s = resolve(castBolt(s, target, bolt));
  assert.equal(s.choice.payable, true);
  s = act(s, 'payCost', { pay: true });
  assert.equal(s.stack.length, 1);
  assert.equal(s.resolving, null);
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'graveyard');
  assert.equal(s.objects[bolt.id].zone, 'graveyard');
});
test('declining ward counters the spell and leaves the protected permanent alive', () => {
  let { s, target, bolt } = setup();
  s = resolve(castBolt(s, target, bolt));
  s = act(s, 'payCost', { pay: false });
  assert.equal(s.stack.length, 0);
  assert.equal(s.objects[target.id].zone, 'battlefield');
  assert.equal(s.objects[bolt.id].zone, 'graveyard');
});
test('unpayable ward rejects atomically and no player can pass during payment', () => {
  let { s, target, bolt } = setup(1);
  s = resolve(castBolt(s, target, bolt));
  for (const command of [
    { type: 'payCost', player: 0, pay: true },
    { type: 'pass', player: 0 },
    { type: 'payCost', player: 1, pay: false },
    { type: 'payCost', player: 0, pay: 'yes' },
  ]) {
    const result = dispatch(s, command);
    assert.equal(result.ok, false);
    assert.equal(result.state, s);
  }
});
test('ward does not trigger for its controller targeting their own permanent', () => {
  let { s, target, bolt } = setup();
  s.objects[target.id].controller = 0;
  s = castBolt(s, target, bolt);
  assert.equal(s.stack.length, 1);
});
test('ward survives its source leaving the battlefield', () => {
  let { s, target, bolt } = setup();
  s = castBolt(s, target, bolt);
  move(s, s.objects[target.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.choice.kind, 'payCost');
  s = act(s, 'payCost', { pay: false });
  assert.equal(s.objects[bolt.id].zone, 'graveyard');
});
test('ward does not ask for payment when its associated spell has already left the stack', () => {
  let { s, target, bolt } = setup();
  s = castBolt(s, target, bolt);
  s.stack.splice(0, 1);
  move(s, s.objects[bolt.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.choice, null);
  assert.equal(s.resolving, null);
});
test('ward counters a targeted activated ability without destroying its source', () => {
  let { s, target } = setup(0);
  const pyro = put(s, 'Prodigal Pyromancer');
  s = act(s, 'activate', { card: pyro.id, ability: 0, target: ref(target) });
  s = resolve(s);
  s = act(s, 'payCost', { pay: false });
  assert.equal(s.objects[pyro.id].zone, 'battlefield');
  assert.equal(s.objects[pyro.id].tapped, true);
  assert.equal(s.objects[target.id].damage, 0);
});

test('life ward is paid as a cost, not damage, and can be declined', () => {
  let { s, target, bolt } = setup(1);
  s.catalog = createRegistry({ ...CARDS, [sentinel.name]: { ...sentinel, ward: { life: 3 } } });
  s = resolve(castBolt(s, target, bolt));
  assert.equal(s.choice.cost.life, 3);
  assert.equal(s.choice.payable, true);
  s = act(s, 'payCost', { pay: true });
  assert.equal(s.players[0].life, 17);
  assert.equal(s.stack.length, 1);
  assert.ok(s.events.some((e) => e.type === 'lifePaid' && e.amount === 3));
});
test('paying exactly the remaining life is legal and loses at the next state-based action check', () => {
  let { s, target, bolt } = setup(1);
  s.catalog = createRegistry({ ...CARDS, [sentinel.name]: { ...sentinel, ward: { life: 20 } } });
  s = resolve(castBolt(s, target, bolt));
  assert.equal(s.choice.payable, true);
  s = act(s, 'payCost', { pay: true });
  assert.equal(s.status, 'finished');
  assert.equal(s.winner, 1);
});
test('a combined mana and life ward cost cannot be partially paid', () => {
  let { s, target, bolt } = setup(3);
  s.catalog = createRegistry({
    ...CARDS,
    [sentinel.name]: { ...sentinel, ward: { mana: { generic: 2 }, life: 21 } },
  });
  s = resolve(castBolt(s, target, bolt));
  const before = structuredClone(s);
  assert.equal(s.choice.payable, false);
  const result = dispatch(s, { type: 'payCost', player: 0, pay: true });
  assert.equal(result.ok, false);
  assert.deepEqual(s, before);
});
