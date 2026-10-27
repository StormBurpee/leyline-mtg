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
  'Broodheart Engine',
  'Jet, Freedom Fighter',
  'Glimmerlight',
  'Heartfire Immolator',
  'Council of Echoes',
  'Gather the White Lotus',
  'Dark Endurance',
  'Honored Knight-Captain',
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
test('eight tenth-pass definitions roundtrip exactly', () => {
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
test('Heartfire Immolator sacrifices as cost and deals captured effective power damage', () => {
  let s = rich();
  const source = put(s, 'Heartfire Immolator'),
    target = put(s, 'Shivan Dragon', 1);
  source.plusCounters = 3;
  s = act(s, 'activate', { card: source.id, ability: 0, target: ref(target) });
  assert.equal(s.objects[source.id].zone, 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'graveyard');
});
test('Broodheart Engine sacrifices to return a Vehicle as well as a creature', () => {
  let s = rich();
  const source = put(s, 'Broodheart Engine'),
    target = put(s, "Cultivator's Caravan", 0, 'graveyard');
  s = resolve(act(s, 'activate', { card: source.id, ability: 0, target: ref(target) }));
  assert.equal(s.objects[source.id].zone, 'graveyard');
  assert.equal(s.objects[target.id].zone, 'battlefield');
});
test('Glimmerlight creates an enchantment creature and equips for plus one', () => {
  let s = rich();
  const r = cast(s, 'Glimmerlight');
  s = resolve(r.s);
  const token = Object.values(s.objects).find((o) => o.zone === 'battlefield' && o.token);
  assert.equal(token.name, 'White Glimmer Token');
  assert.deepEqual(CARDS[token.name].types, ['enchantment', 'creature']);
  s = resolve(act(s, 'activate', { card: r.id, ability: 0, target: ref(token) }));
  assert.deepEqual(stats(s, s.objects[token.id]), { power: 2, toughness: 2 });
});
test('Gather the White Lotus counts Plains and creates white Ally tokens before scry', () => {
  let s = rich();
  put(s, 'Plains');
  put(s, 'Plains');
  put(s, 'Forest');
  s = cast(s, 'Gather the White Lotus').s;
  assert.equal(
    Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.token).length,
    2,
  );
  assert.equal(s.choice.kind, 'libraryOrder');
});
