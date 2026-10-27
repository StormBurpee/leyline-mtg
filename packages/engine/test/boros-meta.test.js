import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, dispatch } from '../src/index.js';
import { hasKeyword, ref } from '../src/model.js';
import { fixture, put, act, resolve } from './helpers.js';
const charm = (s) => {
  put(s, 'Mountain');
  put(s, 'Plains');
  return put(s, 'Boros Charm', 0, 'hand');
};
test('Boros Charm preserves player-or-planeswalker targeting and deals four to a player', () => {
  let s = fixture();
  const c = charm(s);
  assert.equal(CARDS['Boros Charm'].modes[0].target.scope, 'playerOrPlaneswalker');
  s = resolve(act(s, 'cast', { card: c.id, mode: 0, target: { kind: 'player', id: 1 } }));
  assert.equal(s.players[1].life, 16);
});
test('Boros Charm protects every existing friendly permanent, not only creatures', () => {
  let s = fixture();
  const c = charm(s);
  const land = put(s, 'Forest'),
    artifact = put(s, 'Food Token'),
    creature = put(s, 'Hired Claw'),
    enemy = put(s, 'Hired Claw', 1);
  s = resolve(act(s, 'cast', { card: c.id, mode: 1 }));
  for (const o of [land, artifact, creature])
    assert.ok(hasKeyword(s, s.objects[o.id], 'indestructible'));
  assert.ok(!hasKeyword(s, s.objects[enemy.id], 'indestructible'));
  const later = put(s, 'Hired Claw');
  assert.ok(!hasKeyword(s, later, 'indestructible'));
});
test('Boros Charm double strike mode is targeted and rejects a land', () => {
  let s = fixture();
  const c = charm(s),
    creature = put(s, 'Hired Claw'),
    land = put(s, 'Forest');
  assert.equal(
    dispatch(s, { type: 'cast', player: 0, card: c.id, mode: 2, target: ref(land) }).ok,
    false,
  );
  s = resolve(act(s, 'cast', { card: c.id, mode: 2, target: ref(creature) }));
  assert.ok(hasKeyword(s, s.objects[creature.id], 'double strike'));
});
test('Spicy Oatmeal Pizza targets its ETB damage then pays its sacrifice activation for life', () => {
  let s = fixture();
  for (let i = 0; i < 5; i++) put(s, 'Mountain');
  const pizza = put(s, 'Spicy Oatmeal Pizza', 0, 'hand');
  s = resolve(act(s, 'cast', { card: pizza.id }));
  assert.equal(s.choice.kind, 'triggerTarget');
  s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.players[1].life, 16);
  assert.equal(s.players[0].life, 17);
  s = act(s, 'activate', { card: pizza.id, ability: 0 });
  assert.equal(s.objects[pizza.id].zone, 'graveyard');
  s = resolve(s);
  assert.equal(s.players[0].life, 20);
});
