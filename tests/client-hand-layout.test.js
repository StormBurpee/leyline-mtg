import test from 'node:test';
import assert from 'node:assert/strict';
import { handGeometry, readableHandCard } from '../apps/web/hand-layout.js';
import { fixture, put } from '../packages/engine/test/helpers.js';

test('seven normal-size cards become a reachable rail on a phone', () => {
  assert.equal(handGeometry(7, 327, 106).mode, 'rail');
});
test('a wider table keeps a fan without cutting off the end cards', () => {
  const result = handGeometry(7, 450, 106);
  assert.equal(result.mode, 'fan');
  assert.ok(Math.abs(result.span - 450) < 0.001);
  assert.ok(106 - result.overlap >= 48);
});
test('geometry preserves a usable strip or deliberately chooses scrolling', () => {
  for (const count of [0, 1, 2, 5, 7, 10, 11, 20])
    for (const width of [280, 320, 375, 768, 1024, 1600])
      for (const cardWidth of [76, 106, 143]) {
        const result = handGeometry(count, width, cardWidth);
        if (result.mode === 'fan') {
          assert.ok(result.span <= width + 0.001);
          assert.ok(cardWidth - result.overlap >= 48);
          assert.ok(result.overlap >= 0);
        } else {
          assert.equal(result.span, count * cardWidth + (count - 1) * 8);
          assert.equal(result.overlap, 0);
        }
      }
});
test('oversized single cards and very large hands remain scrollable', () => {
  assert.equal(handGeometry(1, 90, 106).mode, 'rail');
  assert.equal(handGeometry(12, 2000, 106).mode, 'rail');
  assert.deepEqual(handGeometry(0, 300, 106), { mode: 'fan', overlap: 0, span: 0 });
});
test('invalid geometry is rejected rather than generating NaN styles', () => {
  assert.throws(() => handGeometry(-1, 300, 100), RangeError);
  assert.throws(() => handGeometry(2, NaN, 100), RangeError);
  assert.throws(() => handGeometry(2, 300, 0), RangeError);
});
test('explicit reading follows only a current card in the viewing player hand', () => {
  const s = fixture();
  const own = put(s, 'Shock', 0, 'hand');
  const enemy = put(s, 'Counterspell', 1, 'hand');
  assert.equal(readableHandCard(s, { selected: own.id }, 0), own.id);
  assert.equal(readableHandCard(s, { inspectObject: own.id }, 0), own.id);
  assert.equal(readableHandCard(s, { selected: enemy.id, inspectObject: own.id }, 0), own.id);
  assert.equal(readableHandCard(s, { selected: enemy.id }, 0), null);
  assert.equal(readableHandCard(s, { selected: own.id }, 1), null);
  own.zone = 'graveyard';
  assert.equal(readableHandCard(s, { inspectObject: own.id }, 0), null);
});
