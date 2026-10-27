import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { CARDS, CARD_IDS, ref, stats, keywords } from '../src/index.js';
import { enterBattlefield } from '../src/effects.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';
const mechanics = JSON.parse(
  readFileSync(new URL('../../cards/mechanics.json', import.meta.url), 'utf8'),
);
const names = ['Intrepid Trufflesnout // Go Hog Wild'];
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
test('Trufflesnout Adventure roundtrips exactly', () => {
  const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
  for (const name of names) {
    const result = compileCard(
      sourceFromDefinition(CARDS[name], { id: idsByName[name], idsByName }),
      { identities: CARD_IDS, mechanics },
    );
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(canonical(result.definition), canonical(CARDS[name]), name);
  }
});

test('attack-alone condition snapshots declared attackers, not resolution-time creatures', () => {
  for (const alone of [true, false]) {
    let s = rich();
    const boar = put(s, names[0], 0),
      other = put(s, 'Grizzly Bears', 0);
    s.step = 'attackers';
    s.choice = { kind: 'attackers', player: 0 };
    s = act(s, 'attackers', { cards: alone ? [boar.id] : [boar.id, other.id] });
    assert.equal(s.stack.length, alone ? 1 : 0);
    if (alone) {
      // A later effect putting another creature attacking must not invalidate the occurrence.
      s.combat.attackers.push(ref(s.objects[other.id]));
      s = resolve(s);
      assert.equal(Object.values(s.objects).filter((o) => o.name === 'Food Token').length, 1);
    }
  }
});
test('Go Hog Wild pumps, exiles the Adventure, and allows the Boar afterward', () => {
  let s = rich();
  const bear = put(s, 'Grizzly Bears', 0),
    card = put(s, names[0], 0, 'hand');
  s = resolve(act(s, 'cast', { card: card.id, mode: 1, target: ref(bear) }));
  assert.equal(stats(s, s.objects[bear.id]).power, 4);
  assert.equal(s.objects[card.id].zone, 'exile');
  s = resolve(act(s, 'cast', { card: card.id, mode: 0 }));
  assert.equal(s.objects[card.id].zone, 'battlefield');
  assert.equal(stats(s, s.objects[card.id]).power, 3);
});
