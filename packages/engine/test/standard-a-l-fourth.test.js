import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, CARD_IDS, ref, stats, keywords } from '../src/index.js';
import { stabilize } from '../src/effects.js';
import { advanceStep } from '../src/turn.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';
const names = [
  'Judgment Bolt',
  'Koth of the Homestead',
  'Chitin Gravestalker',
  'Fire Sages',
  'Devout Decree',
  'Bumi Bash',
  'Craterclaw Colossus',
  'Craterhoof Behemoth',
  'Gallant Fowlknight',
  'Heroic Reinforcements',
  "Iroh's Demonstration",
  'Battlesong Berserker',
  'Champion of Dusan',
  'Dictate of Kruphix',
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
test('14 fourth-batch sources roundtrip with token identities', () => {
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
test('Craterhoof counts current creatures once and buffs its controller only', () => {
  let s = rich();
  const a = put(s, 'Grizzly Bears'),
    enemy = put(s, 'Grizzly Bears', 1);
  const r = cast(s, 'Craterhoof Behemoth');
  s = resolve(r.s);
  assert.equal(stats(s, s.objects[a.id]).power, 4);
  assert.equal(stats(s, s.objects[r.id]).power, 7);
  assert.equal(stats(s, s.objects[enemy.id]).power, 2);
  assert.ok(keywords(s, s.objects[a.id]).includes('trample'));
});
test('Craterclaw counts artifacts and grants power without toughness', () => {
  let s = rich();
  const a = put(s, 'Grizzly Bears');
  put(s, 'Basilisk Collar');
  put(s, 'Basilisk Collar');
  const r = cast(s, 'Craterclaw Colossus');
  s = resolve(r.s);
  assert.deepEqual(stats(s, s.objects[a.id]), { power: 5, toughness: 2 });
});
test('Heroic Reinforcements creates two soldiers before buffing the team', () => {
  let s = rich();
  const a = put(s, 'Grizzly Bears');
  s = cast(s, 'Heroic Reinforcements').s;
  const tokens = Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.token);
  assert.equal(tokens.length, 2);
  for (const o of tokens) {
    assert.deepEqual(stats(s, o), { power: 2, toughness: 2 });
    assert.ok(keywords(s, o).includes('haste'));
  }
  assert.deepEqual(stats(s, s.objects[a.id]), { power: 3, toughness: 3 });
});
test('Judgment Bolt damages creature then its controller for friendly Equipment count', () => {
  let s = rich();
  const a = put(s, 'Grizzly Bears', 1);
  put(s, 'Basilisk Collar');
  put(s, 'Basilisk Collar');
  put(s, 'Basilisk Collar', 1);
  s = cast(s, 'Judgment Bolt', { target: ref(a) }).s;
  assert.equal(s.objects[a.id].zone, 'graveyard');
  assert.equal(s.players[1].life, 18);
  assert.equal(s.players[0].life, 20);
});
test('Champion of Dusan renew adds plus counter and trample counter', () => {
  let s = rich();
  const a = put(s, 'Champion of Dusan', 0, 'graveyard'),
    b = put(s, 'Grizzly Bears');
  s = resolve(act(s, 'activate', { card: a.id, ability: 0, target: ref(b) }));
  assert.equal(s.objects[a.id].zone, 'exile');
  assert.equal(s.objects[b.id].plusCounters, 1);
  assert.ok(keywords(s, s.objects[b.id]).includes('trample'));
});
test('Dictate of Kruphix grants each active player their own extra draw', () => {
  for (const player of [0, 1]) {
    let s = fixture();
    put(s, 'Dictate of Kruphix');
    s.active = player;
    s.priority = player;
    s.step = 'upkeep';
    const before = s.players[player].hand.length;
    advanceStep(s);
    stabilize(s);
    assert.equal(s.players[player].hand.length, before + 1);
    s = resolve(s);
    assert.equal(s.players[player].hand.length, before + 2);
    assert.equal(s.players[1 - player].hand.length, 0);
  }
});
