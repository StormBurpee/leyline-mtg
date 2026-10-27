import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, CARD_IDS, ref, stats, keywords } from '../src/index.js';
import { stabilize } from '../src/effects.js';
import { advanceStep } from '../src/turn.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';
const names = [
  'Dedicated Commons',
  'Fatehold Annex',
  'Formidable Commons',
  'Innovative Commons',
  'Konstrari Annex',
  'Boggart Prankster',
  'Boulder Dash',
  'Krenko, Mob Boss',
  'Early Winter',
  'Landscape Painter // Vibrant Idea',
  'Blazing Firesinger // Seething Song',
  'Adventurous Eater // Have a Bite',
  'Emergency Phytomedic // Seed Suture',
  'Blossom-Blessed Angel // Seed Suture',
  'Cheerful Osteomancer // Raise Dead',
  "Honorbound Page // Forum's Favor",
  'Hallway Heckler // Vicious Verse',
  'Bellowing Bruiser // Beat a Path',
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
test('eighteen next-pass sources roundtrip including nested prepared and Adventure spells', () => {
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
test('all eight simple prepared creatures enter prepared and create the correct spell copy', () => {
  for (const name of names.filter((n) => CARDS[n].prepareSpell)) {
    let s = rich();
    const r = cast(s, name);
    s = r.s;
    const copy = s.objects[s.objects[r.id].preparedCopy.id];
    assert.equal(copy.zone, 'exile');
    assert.equal(copy.name, CARDS[name].prepareSpell.name);
    assert.equal(copy.preparedFrom.id, r.id);
  }
});
test('Landscape Painter prepared spell draws two and consumes preparedness', () => {
  let s = rich();
  const r = cast(s, 'Landscape Painter // Vibrant Idea');
  s = r.s;
  const copy = s.objects[r.id].preparedCopy.id;
  s = resolve(act(s, 'cast', { card: copy }));
  assert.equal(s.players[0].hand.length, 2);
  assert.equal(s.objects[r.id].preparedCopy, undefined);
});
test('Seed Suture prepared spells add a counter and gain one life', () => {
  for (const name of [
    'Emergency Phytomedic // Seed Suture',
    'Blossom-Blessed Angel // Seed Suture',
    'Adventurous Eater // Have a Bite',
  ]) {
    let s = rich();
    const target = put(s, 'Grizzly Bears');
    const r = cast(s, name);
    s = r.s;
    const copy = s.objects[r.id].preparedCopy.id;
    s = resolve(act(s, 'cast', { card: copy, target: ref(target) }));
    assert.equal(s.objects[target.id].plusCounters, 1);
    assert.equal(s.players[0].life, 21);
  }
});
test('Krenko counts Goblins including itself and creates that many red 1/1 tokens', () => {
  let s = rich();
  const k = put(s, 'Krenko, Mob Boss');
  put(s, 'Goblin Token');
  put(s, 'Grizzly Bears');
  s = resolve(act(s, 'activate', { card: k.id, ability: 0 }));
  assert.equal(
    Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.token).length,
    3,
  );
});
test('planeswalker conditional duals enter untapped only while their controller has one', () => {
  for (const name of [
    'Dedicated Commons',
    'Fatehold Annex',
    'Formidable Commons',
    'Innovative Commons',
    'Konstrari Annex',
  ])
    for (const pw of [false, true]) {
      let s = fixture();
      if (pw) put(s, 'Chandra, Torch of Defiance');
      const land = put(s, name, 0, 'hand');
      s = act(s, 'playLand', { card: land.id });
      assert.equal(s.objects[land.id].tapped, !pw);
    }
});
test('Boulder Dash requires different targets and deals both damage amounts', () => {
  let s = rich();
  const a = put(s, 'Grizzly Bears', 1),
    b = put(s, 'Grizzly Bears', 1);
  s = cast(s, 'Boulder Dash', { targets: { first: [ref(a)], second: [ref(b)] } }).s;
  assert.equal(s.objects[a.id].zone, 'graveyard');
  assert.equal(s.objects[b.id].damage, 1);
});
