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
  'Dreadwing Scavenger',
  'Courageous Goblin',
  'Eshki Dragonclaw',
  'Honored Dreyleader',
  'Faerie Dreamthief',
  'Heaped Harvest',
  'Jazal Goldmane',
  'Haunt the Network',
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
test('eight eleventh-pass definitions roundtrip exactly', () => {
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
test('Haunt the Network includes the two new Thopters in the artifact count', () => {
  let s = rich();
  put(s, 'Basilisk Collar');
  s = cast(s, 'Haunt the Network', { target: { kind: 'player', id: 1 } }).s;
  assert.equal(s.players[0].life, 23);
  assert.equal(s.players[1].life, 17);
  assert.equal(
    Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.token).length,
    2,
  );
});
test('Heaped Harvest sacrifices as a cost and its search trigger resolves before life gain', () => {
  let s = rich();
  const source = put(s, 'Heaped Harvest'),
    land = put(s, 'Forest', 0, 'library');
  s = act(s, 'activate', { card: source.id, ability: 0 });
  assert.equal(s.objects[source.id].zone, 'graveyard');
  assert.equal(s.stack.length, 2);
  s = resolve(s);
  assert.equal(s.choice.kind, 'librarySearch');
  s = act(s, 'searchLibrary', { cards: [land.id] });
  assert.equal(s.objects[land.id].zone, 'battlefield');
  assert.equal(s.objects[land.id].tapped, true);
  s = resolve(s);
  assert.equal(s.players[0].life, 23);
});
test('Faerie Dreamthief exile activation draws one then loses one life', () => {
  let s = rich();
  const source = put(s, 'Faerie Dreamthief', 0, 'graveyard');
  s = resolve(act(s, 'activate', { card: source.id, ability: 0 }));
  assert.equal(s.objects[source.id].zone, 'exile');
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(s.players[0].life, 19);
});
test('Honored Dreyleader counts other Squirrels and Foods, not itself', () => {
  let s = rich();
  put(s, 'Food Token');
  put(s, 'Food Token');
  const r = cast(s, 'Honored Dreyleader');
  s = resolve(r.s);
  assert.equal(s.objects[r.id].plusCounters, 2);
});
