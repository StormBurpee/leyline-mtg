import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, exportReplay, replay } from '../src/index.js';
import { put, resolve } from './helpers.js';

test('starting player skips the whole draw step, including Dictate triggers and priority', () => {
  let s = createGame({ mulligan: false });
  put(s, 'Dictate of Kruphix');
  const before = s.players[0].hand.length;
  s = resolve(s);
  assert.equal(s.step, 'main1');
  assert.equal(s.players[0].hand.length, before);
  assert.equal(s.stack.length, 0);
  assert.equal(
    s.events.some((e) => e.type === 'step' && e.step === 'draw'),
    false,
  );
  s.turn = 2;
  s.active = 1;
  s.priority = 1;
  s.step = 'upkeep';
  const opponentBefore = s.players[1].hand.length;
  s = resolve(s);
  assert.equal(s.step, 'draw');
  assert.equal(s.players[1].hand.length, opponentBefore + 1);
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(s.players[1].hand.length, opponentBefore + 2);
});

test('revision 2 and unmarked v0.48 saves retain first-draw-step command timing after re-export', () => {
  let s = createGame({ mulligan: false });
  s.rulesRevision = 2;
  s = resolve(s);
  assert.equal(s.step, 'draw');
  assert.equal(s.players[0].hand.length, 7);
  const record = exportReplay(s);
  assert.deepEqual(replay(record), s);
  const unmarked = { ...record, version: '0.48.0' };
  delete unmarked.rulesRevision;
  assert.deepEqual(replay(unmarked), s);
  const result = dispatch(s, { type: 'pass', player: s.priority });
  assert.equal(result.ok, true);
  assert.deepEqual(replay(exportReplay(result.state)), result.state);
});

test('new first-turn step sequence replays exactly', () => {
  let s = createGame({ mulligan: false });
  s = resolve(s);
  assert.equal(s.step, 'main1');
  assert.equal(exportReplay(s).rulesRevision, 3);
  assert.deepEqual(replay(exportReplay(s)), s);
});
