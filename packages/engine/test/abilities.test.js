import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, stats, ref, hasKeyword, legalActions } from '../src/index.js';
import { move } from '../src/model.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
test('prowess triggers above the spell and does not resolve early', () => {
  let s = fixture();
  const monk = put(s, 'Monastery Swiftspear'),
    bolt = put(s, 'Lightning Bolt', 0, 'hand');
  lands(s, 'Mountain', 1);
  s = act(s, 'cast', { card: bolt.id, target: { kind: 'player', id: 1 } });
  assert.equal(s.stack.length, 2);
  assert.equal(stats(s, s.objects[monk.id]).power, 1);
  s = resolve(s);
  assert.equal(stats(s, s.objects[monk.id]).power, 2);
  assert.equal(s.players[1].life, 20);
  s = resolve(s);
  assert.equal(s.players[1].life, 17);
});
test('prowess triggers on enchantments, Pyromancer does not', () => {
  let s = fixture();
  put(s, 'Monastery Swiftspear');
  put(s, 'Young Pyromancer');
  lands(s, 'Plains', 3);
  const anthem = put(s, 'Glorious Anthem', 0, 'hand');
  s = act(s, 'cast', { card: anthem.id });
  assert.equal(s.pendingTriggers.length, 0);
  assert.equal(s.stack.length, 2);
  assert.equal(s.stack.at(-1).name, 'Monastery Swiftspear');
});
test('opponent casting does not trigger your prowess', () => {
  let s = fixture();
  put(s, 'Monastery Swiftspear');
  lands(s, 'Mountain', 1, 1);
  const bolt = put(s, 'Lightning Bolt', 1, 'hand');
  s = act(s, 'pass');
  s = act(s, 'cast', { card: bolt.id, target: { kind: 'player', id: 0 } });
  assert.equal(s.stack.length, 1);
});
test('Sprite Dragon counters survive cleanup and reset across zones', () => {
  let s = fixture();
  const dragon = put(s, 'Sprite Dragon'),
    bolt = put(s, 'Lightning Bolt', 0, 'hand');
  lands(s, 'Mountain', 1);
  s = act(s, 'cast', { card: bolt.id, target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.objects[dragon.id].plusCounters, 1);
  assert.equal(stats(s, s.objects[dragon.id]).power, 2);
  move(s, s.objects[dragon.id], 'hand');
  move(s, s.objects[dragon.id], 'battlefield');
  assert.equal(s.objects[dragon.id].plusCounters, 0);
});
test('self-buff trigger cannot affect a new incarnation', () => {
  let s = fixture();
  const monk = put(s, 'Monastery Swiftspear'),
    bolt = put(s, 'Lightning Bolt', 0, 'hand');
  lands(s, 'Mountain', 1);
  s = act(s, 'cast', { card: bolt.id, target: { kind: 'player', id: 1 } });
  move(s, s.objects[monk.id], 'hand');
  move(s, s.objects[monk.id], 'battlefield');
  s = resolve(s);
  assert.equal(stats(s, s.objects[monk.id]).power, 1);
});
test('Young Pyromancer trigger creates token even if source leaves', () => {
  let s = fixture();
  const pyro = put(s, 'Young Pyromancer'),
    bolt = put(s, 'Lightning Bolt', 0, 'hand');
  lands(s, 'Mountain', 1);
  s = act(s, 'cast', { card: bolt.id, target: { kind: 'player', id: 1 } });
  move(s, s.objects[pyro.id], 'graveyard');
  s = resolve(s);
  assert.ok(
    Object.values(s.objects).some((o) => o.name === 'Elemental Token' && o.zone === 'battlefield'),
  );
});
test('tap activated abilities respect summoning sickness', () => {
  const s = fixture(),
    pyro = put(s, 'Prodigal Pyromancer', 0, 'battlefield', { ready: false });
  assert.equal(
    dispatch(s, {
      type: 'activate',
      player: 0,
      card: pyro.id,
      ability: 0,
      target: { kind: 'player', id: 1 },
    }).ok,
    false,
  );
});
test('activated damage uses the stack and source may leave', () => {
  let s = fixture();
  const pyro = put(s, 'Prodigal Pyromancer');
  s = act(s, 'activate', { card: pyro.id, ability: 0, target: { kind: 'player', id: 1 } });
  assert.equal(s.players[1].life, 20);
  assert.equal(s.objects[pyro.id].tapped, true);
  move(s, s.objects[pyro.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.players[1].life, 19);
});
test('Thermo-Alchemist untaps in response to casting', () => {
  let s = fixture();
  const thermo = put(s, 'Thermo-Alchemist');
  s = act(s, 'activate', { card: thermo.id, ability: 0 });
  s = resolve(s);
  assert.equal(s.players[1].life, 19);
  lands(s, 'Mountain', 1);
  const bolt = put(s, 'Lightning Bolt', 0, 'hand');
  s = act(s, 'cast', { card: bolt.id, target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.objects[thermo.id].tapped, false);
  assert.equal(s.stack.length, 1);
});
test('mana-cost activated ability works without tapping and retains priority', () => {
  let s = fixture();
  const dragon = put(s, 'Shivan Dragon');
  lands(s, 'Mountain', 2);
  s = act(s, 'activate', { card: dragon.id, ability: 0 });
  s = act(s, 'activate', { card: dragon.id, ability: 0 });
  assert.equal(s.stack.length, 2);
  s = resolve(s);
  s = resolve(s);
  assert.equal(stats(s, s.objects[dragon.id]).power, 7);
  assert.equal(s.objects[dragon.id].tapped, false);
});
test('Seeker grants temporary lifelink as a separate ordered trigger', () => {
  let s = fixture();
  const seeker = put(s, 'Seeker of the Way');
  lands(s, 'Mountain', 1);
  const bolt = put(s, 'Lightning Bolt', 0, 'hand');
  s = act(s, 'cast', { card: bolt.id, target: { kind: 'player', id: 1 } });
  assert.equal(s.choice.kind, 'orderTriggers');
  s = act(s, 'orderTriggers', { ids: s.choice.entries.map((e) => e.id) });
  s = resolve(s);
  s = resolve(s);
  assert.equal(hasKeyword(s, s.objects[seeker.id], 'lifelink'), true);
  assert.equal(stats(s, s.objects[seeker.id]).power, 3);
});
test('Electrostatic Field triggers once for an instant', () => {
  let s = fixture();
  put(s, 'Electrostatic Field');
  lands(s, 'Mountain', 1);
  const bolt = put(s, 'Lightning Bolt', 0, 'hand');
  s = act(s, 'cast', { card: bolt.id, target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.players[1].life, 19);
  s = resolve(s);
  assert.equal(s.players[1].life, 16);
});
