import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry, dispatch } from '../src/index.js';
import { draw } from '../src/model.js';
import { stabilize } from '../src/effects.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
test('Tome Scour mills chosen player cards without drawing or changing the other library', () => {
  let s = fixture();
  lands(s, 'Island', 1);
  const spell = put(s, 'Tome Scour', 0, 'hand');
  const top = s.players[1].library.slice(0, 5),
    own = s.players[0].library.length;
  s = resolve(act(s, 'cast', { card: spell.id, target: { kind: 'player', id: 1 } }));
  assert.deepEqual(s.players[1].graveyard.slice(-5), top);
  assert.equal(s.players[0].library.length, own);
  assert.equal(s.players[1].failedDraw, false);
});
test('Mind Sculpt cannot target its caster', () => {
  const s = fixture();
  lands(s, 'Island', 2);
  const spell = put(s, 'Mind Sculpt', 0, 'hand');
  assert.equal(
    dispatch(s, { type: 'cast', player: 0, card: spell.id, target: { kind: 'player', id: 0 } }).ok,
    false,
  );
});
test('milling beyond an empty library does not lose until a draw is attempted', () => {
  let s = fixture();
  const name = 'Mill fixture';
  s.catalog = createRegistry({
    ...CARDS,
    [name]: {
      name,
      type: 'sorcery',
      cost: {},
      target: 'opponent',
      effects: [{ op: 'mill', count: 1000, player: 'target' }],
    },
  });
  const spell = put(s, name, 0, 'hand');
  s = resolve(act(s, 'cast', { card: spell.id, target: { kind: 'player', id: 1 } }));
  assert.equal(s.players[1].library.length, 0);
  assert.equal(s.status, 'playing');
  draw(s, 1, 1);
  stabilize(s);
  assert.equal(s.status, 'finished');
  assert.equal(s.winner, 0);
});
test('Millstone pays its activation cost then mills only on resolution', () => {
  let s = fixture();
  const stone = put(s, 'Millstone');
  lands(s, 'Island', 2);
  const before = s.players[1].library.length;
  s = act(s, 'activate', { card: stone.id, ability: 0, target: { kind: 'player', id: 1 } });
  assert.equal(s.objects[stone.id].tapped, true);
  assert.equal(s.players[1].library.length, before);
  s = resolve(s);
  assert.equal(s.players[1].library.length, before - 2);
});
