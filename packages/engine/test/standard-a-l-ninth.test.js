import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, CARD_IDS, ref, stats, keywords } from '../src/index.js';
import { stabilize } from '../src/effects.js';
import { advanceStep } from '../src/turn.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';
const names = [
  'Cloud of Darkness',
  'Iron-Shield Elf',
  'Ghitu Lavarunner',
  'Cori Mountain Monastery',
  'Dragonback Assault',
  'Angry Rabble',
  'Earthbending Lesson',
  'Crustacean Commando',
  'Liliana the Faultless',
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
test('nine ninth-pass definitions roundtrip exactly', () => {
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
test('Crustacean Commando creates functional Mutagen with sorcery-speed sacrifice activation', () => {
  let s = rich();
  s = cast(s, 'Crustacean Commando').s;
  s = resolve(s);
  const token = Object.values(s.objects).find((o) => o.zone === 'battlefield' && o.token);
  assert.equal(token.name, 'Mutagen Token');
  const target = put(s, 'Grizzly Bears');
  s = act(s, 'activate', { card: token.id, ability: 0, target: ref(target) });
  assert.equal(s.objects[token.id], undefined);
  s = resolve(s);
  assert.equal(s.objects[target.id].plusCounters, 1);
});
test('Earthbending Lesson animates exact land with four counters and keeps its land type', () => {
  let s = rich();
  const land = put(s, 'Forest');
  s = cast(s, 'Earthbending Lesson', { target: ref(land) }).s;
  assert.deepEqual(stats(s, s.objects[land.id]), { power: 4, toughness: 4 });
  assert.ok(keywords(s, s.objects[land.id]).includes('haste'));
  assert.equal(s.objects[land.id].plusCounters, 4);
});
test('Ghitu Lavarunner only gains its conditional bonus at two spell cards', () => {
  const s = fixture(),
    o = put(s, 'Ghitu Lavarunner');
  put(s, 'Opt', 0, 'graveyard');
  assert.equal(stats(s, o).power, 1);
  put(s, 'Boulder Dash', 0, 'graveyard');
  assert.equal(stats(s, o).power, 2);
  assert.ok(keywords(s, o).includes('haste'));
});
test('Dragonback Assault hits creatures and planeswalkers then landfall creates a 4/4 Dragon', () => {
  let s = rich();
  const bear = put(s, 'Grizzly Bears', 1),
    pw = put(s, 'Chandra, Torch of Defiance', 1);
  s = cast(s, 'Dragonback Assault').s;
  s = resolve(s);
  assert.equal(s.objects[bear.id].zone, 'graveyard');
  assert.equal(s.objects[pw.id].loyalty, 1);
  const land = put(s, 'Forest', 0, 'hand');
  s = act(s, 'playLand', { card: land.id });
  s = resolve(s);
  const token = Object.values(s.objects).find((o) => o.zone === 'battlefield' && o.token);
  assert.equal(token.name, 'Dragon Token');
  assert.deepEqual(stats(s, token), { power: 4, toughness: 4 });
});
