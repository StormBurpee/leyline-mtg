import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { CARDS, CARD_IDS, ref, stats, keywords } from '../src/index.js';
import { enterBattlefield } from '../src/effects.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';
const mechanics = JSON.parse(
  readFileSync(new URL('../../cards/mechanics.json', import.meta.url), 'utf8'),
);
const names = [
  'Diversion Specialist',
  'Edgar, Ancient Bloodlord',
  'Fountainport',
  'Jolene, Plundering Pugilist',
  'Dutiful Griffin',
  'Gollum the Abandoned',
  'Iron Hills',
  'Lake-town',
];
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
test('eight follow-on sources roundtrip exactly', () => {
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

test('Dutiful Griffin and Gollum activate from graveyard with selected battlefield sacrifices', () => {
  for (const name of ['Dutiful Griffin', 'Gollum the Abandoned']) {
    let s = rich();
    const source = put(s, name, 0, 'graveyard');
    const victims =
      name === 'Dutiful Griffin'
        ? [put(s, 'Pacifism'), put(s, 'Pacifism')]
        : [put(s, 'Grizzly Bears')];
    s = resolve(act(s, 'activate', { card: source.id, ability: 0, sacrifices: victims.map(ref) }));
    assert.equal(s.objects[source.id].zone, 'hand');
    for (const o of victims) assert.equal(s.objects[o.id].zone, 'graveyard');
  }
});
test('Edgar sees sacrificed creature and grows with menace', () => {
  let s = rich();
  const edgar = put(s, 'Edgar, Ancient Bloodlord'),
    bear = put(s, 'Grizzly Bears');
  s = act(s, 'activate', { card: edgar.id, ability: 0, sacrifices: [ref(bear)] });
  s = resolve(s);
  assert.equal(s.players[0].life, 21);
  s = resolve(s);
  assert.ok(keywords(s, s.objects[edgar.id]).includes('menace'));
  assert.equal(
    stats(s, s.objects[edgar.id]).power,
    CARDS[names.find((n) => n.startsWith('Edgar'))].power + 1,
  );
});
test('Fountainport produces a Fish with life cost then sacrifices it for a draw', () => {
  let s = rich();
  const land = put(s, 'Fountainport');
  s = resolve(act(s, 'activate', { card: land.id, ability: 1 }));
  assert.equal(s.players[0].life, 19);
  const fish = Object.values(s.objects).find((o) => o.name === 'Blue Fish Token');
  assert.equal(stats(s, fish).power, 1);
  s.objects[land.id].tapped = false;
  const hand = s.players[0].hand.length;
  s = resolve(act(s, 'activate', { card: land.id, ability: 0, sacrifices: [ref(fish)] }));
  assert.equal(s.players[0].hand.length, hand + 1);
});
test('Jolene triggers once for qualifying attack group and spends a Treasure to damage', () => {
  let s = rich();
  const source = put(s, 'Jolene, Plundering Pugilist'),
    a = put(s, 'Serra Angel'),
    b = put(s, 'Serra Angel');
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: 0 };
  s = act(s, 'attackers', { cards: [a.id, b.id] });
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  const treasure = Object.values(s.objects).find((o) => o.name === 'Treasure Token');
  s = resolve(
    act(s, 'activate', {
      card: source.id,
      ability: 0,
      target: { kind: 'player', id: 1 },
      sacrifices: [ref(treasure)],
    }),
  );
  assert.equal(s.players[1].life, 19);
});
test('Diversion Specialist grants turn-limited exile permission after sacrifice', () => {
  let s = rich();
  const source = put(s, 'Diversion Specialist'),
    bear = put(s, 'Grizzly Bears');
  s = resolve(act(s, 'activate', { card: source.id, ability: 0, sacrifices: [ref(bear)] }));
  assert.equal(s.players[0].exile.length, 1);
});
for (const [name, target] of [
  ['Iron Hills', 'Axgard Cavalry'],
  ['Lake-town', 'Hardened Tactician'],
])
  test(`${name} counters only its specified creature type`, () => {
    let s = rich();
    const land = put(s, name),
      creature = put(s, target);
    const base = stats(s, creature).power;
    s = resolve(act(s, 'activate', { card: land.id, ability: 0, target: ref(creature) }));
    assert.equal(s.objects[land.id].zone, 'graveyard');
    assert.equal(stats(s, s.objects[creature.id]).power, base + 2);
  });
