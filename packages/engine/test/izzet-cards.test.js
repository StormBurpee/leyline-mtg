import { finishCleanup } from '../src/turn.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { castingProfile } from '../src/index.js';
import { ref, move } from '../src/model.js';
import { enterBattlefield, resolveTop, stabilize, damageCanBePrevented } from '../src/effects.js';
import { fixture, put, act, resolve, lands } from './helpers.js';

test('Eddymurk Crab discounts only graveyard instants and sorceries and enters tapped only off-turn', () => {
  for (const active of [0, 1]) {
    const s = fixture();
    s.active = active;
    s.priority = 0;
    const crab = put(s, 'Eddymurk Crab', 0, 'hand');
    put(s, 'Opt', 0, 'graveyard');
    put(s, 'Burst Lightning', 0, 'graveyard');
    put(s, 'Grizzly Bears', 0, 'graveyard');
    assert.deepEqual(castingProfile(s, 0, crab).cost, { generic: 3, U: 2 });
    enterBattlefield(s, crab);
    assert.equal(crab.tapped, active === 1);
    assert.equal(s.pendingTriggers[0].targetGroups[0].max, 2);
  }
});
test('Get Out returns owned rather than controlled creatures and enchantments', () => {
  let s = fixture();
  lands(s, 'Island', 2);
  const own = put(s, 'Grizzly Bears');
  own.controller = 1;
  const enemy = put(s, 'Grizzly Bears', 1);
  enemy.controller = 0;
  const spell = put(s, 'Get Out', 0, 'hand');
  assert.throws(() =>
    act(s, 'cast', { card: spell.id, mode: 1, targets: { chosen: [ref(enemy)] } }),
  );
  s = act(s, 'cast', { card: spell.id, mode: 1, targets: { chosen: [ref(own)] } });
  s = resolve(s);
  assert.equal(s.objects[own.id].zone, 'hand');
  assert.equal(s.objects[enemy.id].zone, 'battlefield');
});
test('Prismari Charm damages each distinct selected target', () => {
  let s = fixture();
  lands(s, 'Island', 1);
  lands(s, 'Mountain', 1);
  const target = put(s, 'Grizzly Bears', 1);
  const spell = put(s, 'Prismari Charm', 0, 'hand');
  s = act(s, 'cast', {
    card: spell.id,
    mode: 1,
    targets: { chosen: [ref(target), { kind: 'player', id: 1 }] },
  });
  s = resolve(s);
  assert.equal(s.objects[target.id].damage, 1);
  assert.equal(s.players[1].life, 19);
});

test('Sleight of Hand requires one selection, puts it into hand without drawing, and bottoms the other', () => {
  let s = fixture();
  lands(s, 'Island', 1);
  const spell = put(s, 'Sleight of Hand', 0, 'hand');
  const library = [...s.players[0].library];
  s = resolve(act(s, 'cast', { card: spell.id }));
  assert.equal(s.choice.action, 'lookChooseHand');
  assert.throws(() => act(s, 'orderLibrary', { top: [], rest: library.slice(0, 2) }));
  assert.throws(() => act(s, 'orderLibrary', { top: library.slice(0, 2), rest: [] }));
  s = act(s, 'orderLibrary', { top: [library[1]], rest: [library[0]] });
  assert.equal(s.objects[library[1]].zone, 'hand');
  assert.deepEqual(s.players[0].library, [...library.slice(2), library[0]]);
});
test('Sleight of Hand handles one-card and empty libraries without draw loss', () => {
  for (const size of [0, 1]) {
    let s = fixture();
    lands(s, 'Island', 1);
    const spell = put(s, 'Sleight of Hand', 0, 'hand');
    for (const id of s.players[0].library.slice(size)) {
      s.objects[id].zone = 'exile';
      s.players[0].exile.push(id);
    }
    s.players[0].library = s.players[0].library.slice(0, size);
    const ids = [...s.players[0].library];
    s = resolve(act(s, 'cast', { card: spell.id }));
    if (size) s = act(s, 'orderLibrary', { top: ids, rest: [] });
    assert.equal(s.winner, null);
    assert.equal(s.choice, null);
  }
});

test('Sunderflock discounts the greatest controlled Elemental mana value, not the sum', () => {
  const s = fixture();
  const spell = put(s, 'Sunderflock', 0, 'hand');
  assert.deepEqual(castingProfile(s, 0, spell).cost, { generic: 7, U: 2 });
  put(s, 'Hearth Elemental // Stoke Genius');
  put(s, 'Hearth Elemental // Stoke Genius');
  assert.deepEqual(castingProfile(s, 0, spell).cost, { generic: 1, U: 2 });
});
test('Sunderflock cast entry bounces non-Elemental creatures; uncast entry does not', () => {
  let s = fixture();
  lands(s, 'Island', 2);
  const crab = put(s, 'Eddymurk Crab');
  const own = put(s, 'Grizzly Bears');
  const enemy = put(s, 'Grizzly Bears', 1);
  const flock = put(s, 'Sunderflock', 0, 'hand');
  s = resolve(act(s, 'cast', { card: flock.id }));
  assert.equal(s.stack.length, 1);
  move(s, s.objects[flock.id], 'graveyard'); // Historical casting fact survives its source leaving.
  s = resolve(s);
  assert.equal(s.objects[own.id].zone, 'hand');
  assert.equal(s.objects[enemy.id].zone, 'hand');
  assert.equal(s.objects[crab.id].zone, 'battlefield');
  s = fixture();
  const uncast = put(s, 'Sunderflock', 0, 'graveyard');
  enterBattlefield(s, uncast);
  assert.equal(s.pendingTriggers.length, 0);
});

test('Impractical Joke permits no target, disables prevention for this turn and expires in cleanup', () => {
  let s = fixture();
  lands(s, 'Mountain', 1);
  const spell = put(s, 'Impractical Joke', 0, 'hand');
  s = resolve(act(s, 'cast', { card: spell.id, targets: { chosen: [] } }));
  assert.equal(damageCanBePrevented(s), false);
  finishCleanup(s);
  assert.equal(damageCanBePrevented(s), true);
});
test('Impractical Joke damages creatures or planeswalkers but not players', () => {
  for (const name of ['Grizzly Bears', 'Jace Token']) {
    let s = fixture();
    lands(s, 'Mountain', 1);
    const target = put(s, name, 1);
    if (name === 'Jace Token') target.loyalty = 5;
    const spell = put(s, 'Impractical Joke', 0, 'hand');
    assert.throws(() =>
      act(s, 'cast', { card: spell.id, targets: { chosen: [{ kind: 'player', id: 1 }] } }),
    );
    s = resolve(act(s, 'cast', { card: spell.id, targets: { chosen: [ref(target)] } }));
    assert.equal(damageCanBePrevented(s), false);
    if (name === 'Jace Token') assert.equal(s.objects[target.id].loyalty, 2);
    else assert.equal(s.objects[target.id].zone, 'graveyard');
  }
});
test('Impractical Joke with an illegal sole target does not disable prevention', () => {
  let s = fixture();
  lands(s, 'Mountain', 1);
  const target = put(s, 'Grizzly Bears', 1);
  const spell = put(s, 'Impractical Joke', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, targets: { chosen: [ref(target)] } });
  move(s, s.objects[target.id], 'hand');
  s = resolve(s);
  assert.equal(damageCanBePrevented(s), true);
});
