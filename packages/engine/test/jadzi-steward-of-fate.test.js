import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CARDS, CARD_IDS, stats } from '../src/index.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';
const name = "Jadzi, Steward of Fate // Oracle's Gift";
test('Jadzi preserves exact blue face colors and nested X spell source roundtrip', () => {
  assert.deepEqual(CARDS[name].color, ['U']);
  assert.deepEqual(CARDS[name].prepareSpell.color, ['U']);
  assert.deepEqual(CARDS['Fractal Token'].color, ['U', 'G']);
  const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
  const mechanics = JSON.parse(
    readFileSync(new URL('../../cards/mechanics.json', import.meta.url), 'utf8'),
  );
  const compiled = compileCard(
    sourceFromDefinition(CARDS[name], { id: idsByName[name], idsByName }),
    { identities: CARD_IDS, mechanics },
  );
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  assert.deepEqual(canonical(compiled.definition), canonical(CARDS[name]));
});
test('Jadzi draws then discards two; Oracle Gift creates X Fractals and buffs each old and new Fractal', () => {
  for (const x of [0, 2]) {
    let s = fixture();
    s.players[0].mana = { W: 20, U: 20, B: 20, R: 20, G: 20, C: 20 };
    const old = put(s, 'Fractal Token');
    old.plusCounters = 1;
    const card = put(s, name, 0, 'hand');
    s = resolve(act(s, 'cast', { card: card.id }));
    assert.equal(s.objects[card.id].zone, 'battlefield');
    assert.ok(s.objects[card.id].preparedCopy);
    s = resolve(s);
    assert.equal(s.players[0].hand.length, 2);
    assert.equal(s.choice.kind, 'discardEffect');
    s = act(s, 'discardEffect', { cards: [...s.players[0].hand] });
    const copy = s.objects[card.id].preparedCopy.id;
    s = resolve(act(s, 'cast', { card: copy, x }));
    assert.equal(s.objects[card.id].preparedCopy, undefined);
    assert.equal(s.objects[copy], undefined);
    const fractals = Object.values(s.objects).filter(
      (o) => o.zone === 'battlefield' && o.name === 'Fractal Token',
    );
    assert.equal(fractals.length, x + 1);
    assert.deepEqual(stats(s, s.objects[old.id]), { power: 1 + x, toughness: 1 + x });
    for (const o of fractals.filter((o) => o.id !== old.id))
      assert.deepEqual(stats(s, o), { power: x, toughness: x });
  }
});
