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
  'Expressive Firedancer',
  'Lionheart Glimmer',
  'Lord Skitter, Sewer King',
  'Callous Inspector',
  'Billowing Shriekmass',
  'Crimson Operative',
  'Crypt Feaster',
  'Bagel and Schmear',
  'Azula Always Lies',
  'Decoy Ploy',
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
test('ten twelfth-pass definitions roundtrip exactly', () => {
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
test('Azula Always Lies permits both modes on the same creature without extra costs', () => {
  let s = rich();
  const target = put(s, 'Llanowar Elves');
  s = cast(s, 'Azula Always Lies', {
    mode: 2,
    targets: { mode0: [ref(target)], mode1: [ref(target)] },
  }).s;
  assert.equal(s.objects[target.id].zone, 'battlefield');
  assert.equal(s.objects[target.id].plusCounters, 1);
  assert.deepEqual(stats(s, s.objects[target.id]), { power: 1, toughness: 1 });
});
test('Decoy Ploy can return both a Villain and a Hero', () => {
  let s = rich();
  const a = put(s, 'Crossbones, Malicious Mercenary', 0, 'graveyard'),
    b = put(s, "Captain Marvel, Earth's Protector", 0, 'graveyard');
  s = cast(s, 'Decoy Ploy', { mode: 2, targets: { mode0: [ref(a)], mode1: [ref(b)] } }).s;
  assert.equal(s.objects[a.id].zone, 'hand');
  assert.equal(s.objects[b.id].zone, 'hand');
});
test('Bagel and Schmear Share can choose no creature and still draws', () => {
  let s = rich();
  const source = put(s, 'Bagel and Schmear');
  s = resolve(act(s, 'activate', { card: source.id, ability: 0, targets: { chosen: [] } }));
  assert.equal(s.objects[source.id].zone, 'graveyard');
  assert.equal(s.players[0].hand.length, 1);
});
test('Lord Skitter creates a nonblocking Rat which can trigger targeted graveyard exile', () => {
  let s = rich();
  put(s, 'Lord Skitter, Sewer King');
  const grave = put(s, 'Forest', 1, 'graveyard');
  advanceStep(s);
  stabilize(s);
  s = resolve(s);
  assert.equal(s.choice.kind, 'triggerTargets');
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [ref(grave)] } });
  s = resolve(s);
  assert.equal(s.objects[grave.id].zone, 'exile');
  assert.equal(
    Object.values(s.objects).filter(
      (o) => o.zone === 'battlefield' && o.name === 'Nonblocking Rat Token',
    ).length,
    1,
  );
});
