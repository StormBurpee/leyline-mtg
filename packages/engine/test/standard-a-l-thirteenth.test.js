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
const names = ['Ajani, Caller of the Pride', 'Explosive Getaway'];
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
const cast = (s, name, args = {}) => {
  const o = put(s, name, 0, 'hand');
  return { s: resolve(act(s, 'cast', { card: o.id, ...args })), id: o.id };
};
test('Ajani and Explosive Getaway roundtrip including exact 2/2 Cat token', () => {
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
test('Ajani can use plus ability with no target and ultimate creates life-total 2/2 Cats', () => {
  let s = rich();
  const a = put(s, 'Ajani, Caller of the Pride');
  s = resolve(act(s, 'activate', { card: a.id, ability: 0, targets: { chosen: [] } }));
  assert.equal(s.objects[a.id].loyalty, 5);
  s = rich();
  const b = put(s, 'Ajani, Caller of the Pride');
  b.loyalty = 8;
  s.players[0].life = 3;
  s = resolve(act(s, 'activate', { card: b.id, ability: 2 }));
  assert.equal(s.objects[b.id].zone, 'graveyard');
  const tokens = Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.token);
  assert.equal(tokens.length, 3);
  for (const o of tokens) assert.deepEqual(stats(s, o), { power: 2, toughness: 2 });
});
test('Explosive Getaway saves chosen creature through sweep then returns it at next end step', () => {
  let s = rich();
  const saved = put(s, 'Grizzly Bears'),
    lost = put(s, 'Grizzly Bears', 1);
  s = cast(s, 'Explosive Getaway', { targets: { blink: [ref(saved)] } }).s;
  assert.equal(s.objects[saved.id].zone, 'exile');
  assert.equal(s.objects[lost.id].zone, 'graveyard');
  s.step = 'main2';
  advanceStep(s);
  stabilize(s);
  s = resolve(s);
  assert.equal(s.objects[saved.id].zone, 'battlefield');
  assert.equal(s.objects[saved.id].damage, 0);
});
test('Explosive Getaway with zero selected permanents still sweeps all creatures', () => {
  let s = rich();
  const lost = put(s, 'Grizzly Bears');
  s = cast(s, 'Explosive Getaway', { targets: { blink: [] } }).s;
  assert.equal(s.objects[lost.id].zone, 'graveyard');
});
