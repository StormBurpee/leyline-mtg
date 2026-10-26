import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseBotCommand } from '../packages/engine/src/index.js';
import { fixture, put, lands } from '../packages/engine/test/helpers.js';

test('scry bottoms excess lands and prioritizes a useful spell', () => {
  const s = fixture();
  lands(s, 'Forest', 6);
  const land = put(s, 'Forest', 0, 'library');
  const bear = put(s, 'Grizzly Bears', 0, 'library');
  s.choice = { kind: 'libraryOrder', player: 0, action: 'scry', cards: [land.id, bear.id] };
  const before = structuredClone(s);
  assert.deepEqual(chooseBotCommand(s, 0), {
    type: 'orderLibrary',
    player: 0,
    top: [bear.id],
    rest: [land.id],
  });
  assert.deepEqual(s, before);
});

test('scry keeps a land drop ahead of expensive spells while mana constrained', () => {
  const s = fixture();
  lands(s, 'Forest', 1);
  const land = put(s, 'Forest', 0, 'library');
  const big = put(s, 'Colossal Dreadmaw', 0, 'library');
  s.choice = { kind: 'libraryOrder', player: 0, action: 'scry', cards: [big.id, land.id] };
  assert.deepEqual(chooseBotCommand(s, 0).top, [land.id]);
});

test('cleanup discards excess lands over castable threats on a developed board', () => {
  const s = fixture();
  lands(s, 'Forest', 6);
  const land = put(s, 'Forest', 0, 'hand');
  put(s, 'Colossal Dreadmaw', 0, 'hand');
  s.choice = { kind: 'discard', player: 0, count: 1 };
  assert.deepEqual(chooseBotCommand(s, 0).cards, [land.id]);
});

test('bottom choice recomputes marginal land needs and preserves two lands', () => {
  const s = fixture();
  const forest = Array.from({ length: 5 }, () => put(s, 'Forest', 0, 'hand'));
  put(s, 'Grizzly Bears', 0, 'hand');
  put(s, 'Elvish Visionary', 0, 'hand');
  s.choice = { kind: 'bottom', player: 0, count: 3 };
  const cards = chooseBotCommand(s, 0).cards;
  assert.equal(cards.length, 3);
  assert.ok(cards.every((id) => forest.some((o) => o.id === id)));
});

test('surveil preserves enough cards for the known pending draw', () => {
  const s = fixture();
  lands(s, 'Island', 6);
  const island = put(s, 'Island', 0, 'library');
  s.players[0].library = [island.id];
  s.choice = { kind: 'libraryOrder', player: 0, action: 'surveil', cards: [island.id] };
  s.resolving = { entry: { controller: 0, effects: [{ op: 'draw', count: 1 }] }, index: 0 };
  assert.deepEqual(chooseBotCommand(s, 0).rest, []);
});
