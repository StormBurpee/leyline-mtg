import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewedCreatures } from '../src/reviewed-creatures.js';
import { CARDS, stats, hasKeyword } from '../src/index.js';
import { fixture, put, act, resolve } from './helpers.js';
for (const card of reviewedCreatures)
  test(`${card.name}: curated definition casts and resolves with its declared characteristics`, () => {
    let s = fixture();
    s.players[0].mana = { W: 10, U: 10, B: 10, R: 10, G: 10, C: 10 };
    const object = put(s, card.name, 0, 'hand');
    s = act(s, 'cast', { card: object.id });
    assert.equal(s.objects[object.id].zone, 'stack');
    s = resolve(s);
    assert.equal(s.objects[object.id].zone, 'battlefield');
    assert.deepEqual(stats(s, s.objects[object.id]), {
      power: card.power,
      toughness: card.toughness,
    });
    for (const keyword of card.keywords)
      assert.equal(hasKeyword(s, s.objects[object.id], keyword), true);
    if (card.triggers?.length) {
      const spell = put(s, 'Opt', 0, 'hand');
      s = act(s, 'cast', { card: spell.id });
      s = resolve(s);
      assert.equal(stats(s, s.objects[object.id]).power, card.power + 1);
    }
  });
test('curated ward cards preserve their exact mana or life payment costs', () => {
  assert.deepEqual(CARDS['Waterfall Aerialist'].ward, { mana: { generic: 2 } });
  assert.deepEqual(CARDS['Rimeshield Frost Giant'].ward, { mana: { generic: 3 } });
  assert.deepEqual(CARDS['Tomakul Honor Guard'].ward, { mana: { generic: 2 } });
  assert.deepEqual(CARDS['Owlin Shieldmage'].ward, { life: 3 });
  assert.deepEqual(CARDS['Sire of Seven Deaths'].ward, { life: 7 });
  assert.deepEqual(CARDS['Dwarven Forge-Chanter'].ward, { life: 2 });
});
