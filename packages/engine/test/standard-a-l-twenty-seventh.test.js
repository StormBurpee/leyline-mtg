import test from 'node:test';
import { readFileSync } from 'node:fs';
const mechanics = JSON.parse(
  readFileSync(new URL('../../cards/mechanics.json', import.meta.url), 'utf8'),
);
import assert from 'node:assert/strict';
import { CARDS, CARD_IDS, ref, stats, keywords } from '../src/index.js';
import { enterBattlefield, stabilize } from '../src/effects.js';
import { advanceStep } from '../src/turn.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';
import { notifyTriggers, move } from '../src/model.js';
const names = [
  'Hopeful Vigil',
  "Garruk's Uprising",
  'Corroding Dragonstorm',
  'Call the Mountain Chocobo',
  'Gysahl Greens',
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
test('five twenty-seventh-pass cards roundtrip exactly', () => {
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

test('Hopeful Vigil produces a 2/2 vigilant Knight and sacrifices on resolution before scry', () => {
  let s = rich();
  const r = cast(s, 'Hopeful Vigil');
  s = resolve(r.s);
  const knight = Object.values(s.objects).find((o) => o.name === 'Adventure Vigilant Knight Token');
  assert.equal(stats(s, knight).power, 2);
  assert.ok(keywords(s, knight).includes('vigilance'));
  s = act(s, 'activate', { card: r.id, ability: 0 });
  assert.equal(s.objects[r.id].zone, 'battlefield');
  s = resolve(s);
  assert.equal(s.objects[r.id].zone, 'graveyard');
  s = resolve(s);
  assert.equal(s.choice.cards.length, 2);
});
test('Garruk Uprising filters entering creatures by power and grants team trample', () => {
  let s = rich();
  put(s, 'Colossal Dreadmaw');
  s = resolve(cast(s, "Garruk's Uprising").s);
  assert.equal(s.players[0].hand.length, 1);
  const small = put(s, 'Grizzly Bears', 0, 'hand');
  enterBattlefield(s, small, 0);
  stabilize(s);
  assert.equal(s.stack.length, 0);
  assert.ok(keywords(s, small).includes('trample'));
  const big = put(s, 'Colossal Dreadmaw', 0, 'hand');
  enterBattlefield(s, big, 0);
  stabilize(s);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 2);
});
test('Corroding Dragonstorm drains and surveils, then returns for a friendly Dragon', () => {
  let s = rich();
  const r = cast(s, 'Corroding Dragonstorm');
  s = resolve(r.s);
  assert.equal(s.players[0].life, 22);
  assert.equal(s.players[1].life, 18);
  s = act(s, 'orderLibrary', { top: s.choice.cards, rest: [] });
  const dragon = put(s, 'Five Five Dragon Token', 0, 'hand');
  enterBattlefield(s, dragon, 0);
  stabilize(s);
  s = resolve(s);
  assert.equal(s.objects[r.id].zone, 'hand');
});
test('Chocobo search and Gysahl flashback use the exact green landfall Bird', () => {
  let s = rich();
  const mountain = put(s, 'Mountain', 0, 'library');
  s = cast(s, 'Call the Mountain Chocobo').s;
  s = act(s, 'searchLibrary', { cards: [mountain.id] });
  assert.equal(s.objects[mountain.id].zone, 'hand');
  const bird = Object.values(s.objects).find((o) => o.name === 'Landfall Bird Token');
  assert.equal(stats(s, bird).power, 2);
  enterBattlefield(s, s.objects[mountain.id], 0);
  stabilize(s);
  s = resolve(s);
  assert.equal(stats(s, s.objects[bird.id]).power, 3);
  const spell = put(s, 'Gysahl Greens', 0, 'graveyard');
  s = resolve(act(s, 'cast', { card: spell.id }));
  assert.equal(s.objects[spell.id].zone, 'exile');
  assert.equal(Object.values(s.objects).filter((o) => o.name === 'Landfall Bird Token').length, 2);
});
