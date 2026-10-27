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
const names = ['Kulrath Zealot', 'Lasyd Prowler', 'Irascible Wolverine', 'Hobbit Hole'];
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
const cast = (s, name, args = {}) => {
  const o = put(s, name, 0, 'hand');
  return { s: resolve(act(s, 'cast', { card: o.id, ...args })), id: o.id };
};
test('four twenty-first-pass cards roundtrip exactly', () => {
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

test('Lasyd may decline mill and its graveyard renewal uses current land-card count', () => {
  let s = rich();
  put(s, 'Forest');
  put(s, 'Forest');
  const r = cast(s, 'Lasyd Prowler');
  s = resolve(r.s);
  assert.equal(s.choice.kind, 'optionalEffect');
  s = act(s, 'resolveOptional', { accept: false });
  assert.equal(s.players[0].graveyard.length, 0);
  move(s, s.objects[r.id], 'graveyard');
  put(s, 'Forest', 0, 'graveyard');
  put(s, 'Island', 0, 'graveyard');
  const target = put(s, 'Grizzly Bears');
  s = resolve(act(s, 'activate', { card: r.id, ability: 0, target: ref(target) }));
  assert.equal(s.objects[r.id].zone, 'exile');
  assert.equal(s.objects[target.id].plusCounters, 2);
});
test('Hobbit Hole sacrifices for a tapped basic land or cycles specifically for a Halfling', () => {
  let s = rich();
  const hole = put(s, 'Hobbit Hole'),
    forest = put(s, 'Forest', 0, 'library');
  s = resolve(act(s, 'activate', { card: hole.id, ability: 0 }));
  s = act(s, 'searchLibrary', { cards: [forest.id] });
  assert.equal(s.objects[hole.id].zone, 'graveyard');
  assert.equal(s.objects[forest.id].tapped, true);
  s = rich();
  const h = put(s, 'Hobbit Hole', 0, 'hand'),
    bilbo = put(s, 'Bilbo Baggins, Burglar // Take a Glance', 0, 'library');
  s = resolve(act(s, 'cycle', { card: h.id }));
  assert.ok(s.choice.cards.includes(bilbo.id));
  s = act(s, 'searchLibrary', { cards: [bilbo.id] });
  assert.equal(s.objects[bilbo.id].zone, 'hand');
});
test('Kulrath basic-landcycles for a basic land and exiles its top card on entry', () => {
  let s = rich();
  const c = put(s, 'Kulrath Zealot', 0, 'hand'),
    land = put(s, 'Mountain', 0, 'library');
  s = resolve(act(s, 'cycle', { card: c.id }));
  s = act(s, 'searchLibrary', { cards: [land.id] });
  assert.equal(s.objects[land.id].zone, 'hand');
  s = rich();
  s = resolve(cast(s, 'Kulrath Zealot').s);
  assert.equal(s.players[0].exile.length, 1);
});
