import test from 'node:test';
import { readFileSync } from 'node:fs';
const mechanics = JSON.parse(
  readFileSync(new URL('../../cards/mechanics.json', import.meta.url), 'utf8'),
);
import assert from 'node:assert/strict';
import { CARDS, CARD_IDS, ref, stats, keywords } from '../src/index.js';
import { stabilize } from '../src/effects.js';
import { advanceStep } from '../src/turn.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';
const names = [
  'Ferocification',
  'Armored Armadillo',
  'Keeper of the Quiet Hour',
  'Hakoda, Selfless Commander',
  'Earth Village Ruffians',
  'Encroaching Dragonstorm',
  'Goblin Glasswright // Craft with Pride',
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
test('seven fourteenth-pass sources roundtrip with exact printed colors', () => {
  const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
  for (const name of names) {
    const result = compileCard(
      sourceFromDefinition(CARDS[name], { id: idsByName[name], idsByName }),
      { identities: CARD_IDS, mechanics },
    );
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(canonical(result.definition), canonical(CARDS[name]), name);
  }
  const glass = CARDS['Goblin Glasswright // Craft with Pride'];
  assert.deepEqual(glass.color, ['R']);
  assert.deepEqual(glass.prepareSpell.color, ['R']);
});
test('Goblin Glasswright prepared spell creates a Treasure and consumes preparedness', () => {
  let s = rich();
  const r = cast(s, 'Goblin Glasswright // Craft with Pride');
  s = r.s;
  const copy = s.objects[r.id].preparedCopy.id;
  s = resolve(act(s, 'cast', { card: copy }));
  assert.equal(s.objects[r.id].preparedCopy, undefined);
  assert.equal(
    Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.name === 'Treasure Token')
      .length,
    1,
  );
});
test('Armored Armadillo uses current toughness at resolution', () => {
  let s = rich();
  const o = put(s, 'Armored Armadillo');
  s = act(s, 'activate', { card: o.id, ability: 0 });
  s.objects[o.id].plusCounters = 2;
  const before = stats(s, s.objects[o.id]);
  s = resolve(s);
  assert.equal(stats(s, s.objects[o.id]).power, before.power + before.toughness);
  assert.equal(stats(s, s.objects[o.id]).toughness, before.toughness);
});
test('Keeper empowers Jace and Encroaching Dragonstorm returns after a Dragon entry', () => {
  let s = rich();
  s = cast(s, 'Keeper of the Quiet Hour').s;
  s = resolve(s);
  const jace = Object.values(s.objects).find((o) => o.zone === 'battlefield' && o.token);
  assert.equal(jace.loyalty, 2);
  const r = cast(s, 'Encroaching Dragonstorm');
  s = resolve(r.s);
  s = act(s, 'searchLibrary', { cards: [] });
  s = cast(s, 'Shivan Dragon').s;
  s = resolve(s);
  assert.equal(s.objects[r.id].zone, 'hand');
});
test('Hakoda sacrifices itself to protect and increase toughness of remaining creatures', () => {
  let s = rich();
  const source = put(s, 'Hakoda, Selfless Commander'),
    target = put(s, 'Grizzly Bears');
  s = resolve(act(s, 'activate', { card: source.id, ability: 0 }));
  assert.equal(s.objects[source.id].zone, 'graveyard');
  assert.deepEqual(stats(s, s.objects[target.id]), { power: 2, toughness: 7 });
  assert.ok(keywords(s, s.objects[target.id]).includes('indestructible'));
});
