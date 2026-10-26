import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry, dispatch, ref, hasType, targetsFor } from '../src/index.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
test('an artifact creature is one object with both targeting categories', () => {
  const s = fixture(),
    object = put(s, 'Ornithopter', 1);
  assert.equal(hasType(CARDS[object.name], 'artifact'), true);
  assert.equal(hasType(CARDS[object.name], 'creature'), true);
  for (const kind of ['artifact', 'creature', 'artifactOrEnchantment', 'permanent'])
    assert.ok(targetsFor(s, kind, 0).some((t) => t.id === object.id));
  assert.equal(
    targetsFor(s, 'enchantment', 0).some((t) => t.id === object.id),
    false,
  );
});
test('artifact-creature spells trigger artifact and creature watchers, not prowess', () => {
  let s = fixture();
  const automaton = put(s, 'Patchwork Automaton');
  put(s, 'Beast Whisperer');
  put(s, 'Monastery Swiftspear');
  const thopter = put(s, 'Ornithopter', 0, 'hand');
  s = act(s, 'cast', { card: thopter.id });
  assert.equal(s.choice.kind, 'orderTriggers');
  assert.equal(s.choice.entries.length, 2);
  s = act(s, 'orderTriggers', { ids: s.choice.entries.map((e) => e.id) });
  s = resolve(resolve(s));
  assert.equal(s.objects[automaton.id].plusCounters, 1);
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(s.objects[thopter.id].zone, 'stack');
});
test('enchantment creatures trigger an enchantress before their own enter trigger', () => {
  let s = fixture();
  put(s, "Enchantress's Presence");
  lands(s, 'Plains', 2);
  const dog = put(s, 'Spirited Companion', 0, 'hand');
  s = act(s, 'cast', { card: dog.id });
  assert.equal(s.stack.length, 2);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(s.objects[dog.id].zone, 'stack');
  s = resolve(s);
  assert.equal(s.objects[dog.id].zone, 'battlefield');
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 2);
});
test('artifact removal can destroy an artifact creature but not a plain creature', () => {
  let s = fixture();
  lands(s, 'Mountain', 2);
  const artifact = put(s, 'Memnite', 1),
    bear = put(s, 'Grizzly Bears', 1),
    spell = put(s, 'Shatter', 0, 'hand');
  assert.equal(
    dispatch(s, { type: 'cast', player: 0, card: spell.id, target: ref(bear) }).ok,
    false,
  );
  s = resolve(act(s, 'cast', { card: spell.id, target: ref(artifact) }));
  assert.equal(s.objects[artifact.id].zone, 'graveyard');
});
test('indestructible artifacts survive destruction and remain legal targets', () => {
  let s = fixture();
  lands(s, 'Forest', 2);
  const ingot = put(s, 'Darksteel Ingot', 1),
    spell = put(s, 'Naturalize', 0, 'hand');
  s = resolve(act(s, 'cast', { card: spell.id, target: ref(ingot) }));
  assert.equal(s.objects[ingot.id].zone, 'battlefield');
});
test('Boomerang returns a land and invalidates its old incarnation', () => {
  let s = fixture();
  lands(s, 'Island', 2);
  const land = put(s, 'Forest', 1),
    old = land.incarnation,
    spell = put(s, 'Boomerang', 0, 'hand');
  s = resolve(act(s, 'cast', { card: spell.id, target: ref(land) }));
  assert.equal(s.objects[land.id].zone, 'hand');
  assert.equal(s.objects[land.id].incarnation, old + 1);
});
test('a mana artifact creature has summoning sickness, unlike a noncreature mana artifact', () => {
  const s = fixture();
  const thopter = put(s, 'Ornithopter of Paradise', 0, 'battlefield', { ready: false }),
    ingot = put(s, 'Darksteel Ingot', 0, 'battlefield', { ready: false });
  assert.equal(dispatch(s, { type: 'tapMana', player: 0, card: thopter.id, color: 'G' }).ok, false);
  assert.equal(dispatch(s, { type: 'tapMana', player: 0, card: ingot.id, color: 'G' }).ok, true);
});
test('inconsistent primary types and unsupported land-creature combinations fail registry validation', () => {
  for (const types of [
    ['artifact', 'creature'],
    ['land', 'creature'],
  ])
    assert.throws(() =>
      createRegistry([{ name: 'Invalid types', type: 'artifact', types, cost: {} }]),
    );
});
test('optional draw triggers pause on resolution and can be declined without drawing', () => {
  let s = fixture();
  put(s, 'Mesa Enchantress');
  lands(s, 'Plains', 2);
  const dog = put(s, 'Spirited Companion', 0, 'hand');
  s = resolve(act(s, 'cast', { card: dog.id }));
  assert.equal(s.choice.kind, 'optionalEffect');
  assert.equal(s.players[0].hand.length, 0);
  assert.equal(dispatch(s, { type: 'pass', player: 0 }).ok, false);
  s = act(s, 'resolveOptional', { accept: false });
  assert.equal(s.players[0].hand.length, 0);
  assert.equal(s.stack.length, 1);
});
test('accepting an optional trigger draws once and resumes normal priority', () => {
  let s = fixture();
  put(s, 'Mesa Enchantress');
  lands(s, 'Plains', 2);
  const dog = put(s, 'Spirited Companion', 0, 'hand');
  s = resolve(act(s, 'cast', { card: dog.id }));
  s = act(s, 'resolveOptional', { accept: true });
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(s.choice, null);
  assert.equal(s.resolving, null);
});

test('noncreature fields are not silently ignored on the wrong card type', () => {
  for (const extra of [
    { etb: [{ op: 'draw', count: 1 }] },
    { mana: 'G' },
    { activated: [] },
    { ward: { life: 1 } },
    { triggers: [] },
  ])
    assert.throws(() =>
      createRegistry([{ name: 'Invalid instant', type: 'instant', cost: {}, ...extra }]),
    );
  assert.throws(() =>
    createRegistry([
      {
        name: 'Invalid creature',
        type: 'creature',
        cost: {},
        power: 1,
        toughness: 1,
        effects: [{ op: 'draw', count: 1 }],
      },
    ]),
  );
});
test('optional decisions reject a different player and nonboolean responses atomically', () => {
  let s = fixture();
  put(s, 'Mesa Enchantress');
  lands(s, 'Plains', 2);
  const dog = put(s, 'Spirited Companion', 0, 'hand');
  s = resolve(act(s, 'cast', { card: dog.id }));
  for (const command of [
    { type: 'resolveOptional', player: 1, accept: true },
    { type: 'resolveOptional', player: 0, accept: 'yes' },
  ]) {
    const result = dispatch(s, command);
    assert.equal(result.ok, false);
    assert.equal(result.state, s);
  }
});
