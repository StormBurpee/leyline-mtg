import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, CARD_IDS, ref, stats, keywords } from '../src/index.js';
import { stabilize } from '../src/effects.js';
import { advanceStep } from '../src/turn.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';
const names = [
  'Chupacabra Echo',
  'Dwynen, Gilt-Leaf Daen',
  'Exhibition Tidecaller',
  "Auntie's Sentence",
  "Earth King's Lieutenant",
  'Konstrari Charm',
  'Bold Biochemist',
  'Collision Course',
  'Harnesser of Storms',
  'Fleeting Effigy',
];
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
const cast = (s, name, args = {}) => {
  const o = put(s, name, 0, 'hand');
  return { s: resolve(act(s, 'cast', { card: o.id, ...args })), id: o.id };
};
test('ten eighth-pass definitions roundtrip exactly', () => {
  const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
  for (const name of names) {
    const result = compileCard(
      sourceFromDefinition(CARDS[name], { id: idsByName[name], idsByName }),
      { identities: CARD_IDS },
    );
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(canonical(result.definition), canonical(CARDS[name]), name);
  }
});
test('Chupacabra Echo counts only permanent cards in its controllers graveyard', () => {
  let s = rich();
  put(s, 'Forest', 0, 'graveyard');
  put(s, 'Grizzly Bears', 0, 'graveyard');
  put(s, 'Opt', 0, 'graveyard');
  put(s, 'Forest', 1, 'graveyard');
  const target = put(s, 'Shivan Dragon', 1);
  s = cast(s, 'Chupacabra Echo').s;
  s = act(s, 'chooseTriggerTarget', { target: ref(target) });
  s = resolve(s);
  assert.deepEqual(stats(s, s.objects[target.id]), { power: 3, toughness: 3 });
});
test('Earth Kings Lieutenant adds ETB counters only to other Allies then grows on another Ally entry', () => {
  let s = rich();
  const a = put(s, 'Compassionate Healer'),
    other = put(s, 'Grizzly Bears');
  const r = cast(s, "Earth King's Lieutenant");
  s = resolve(r.s);
  assert.equal(s.objects[a.id].plusCounters, 1);
  assert.equal(s.objects[other.id].plusCounters ?? 0, 0);
  assert.equal(s.objects[r.id].plusCounters ?? 0, 0);
  s = cast(s, 'Compassionate Healer').s;
  s = resolve(s);
  assert.equal(s.objects[r.id].plusCounters, 1);
});
test('Bold Biochemist power-up draws two as well as adding a counter', () => {
  let s = rich();
  const r = cast(s, 'Bold Biochemist');
  s = resolve(act(r.s, 'activate', { card: r.id, ability: 0 }));
  assert.equal(s.objects[r.id].plusCounters, 1);
  assert.equal(s.players[0].hand.length, 2);
});
test('Fleeting Effigy returns to hand at its controllers end step', () => {
  let s = rich();
  const o = put(s, 'Fleeting Effigy');
  s.step = 'main2';
  advanceStep(s);
  stabilize(s);
  s = resolve(s);
  assert.equal(s.objects[o.id].zone, 'hand');
});
