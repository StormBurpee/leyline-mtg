import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { CARDS, CARD_IDS, ref, stats, keywords, createRegistry } from '../src/index.js';
import { enterBattlefield } from '../src/effects.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';
const mechanics = JSON.parse(
  readFileSync(new URL('../../cards/mechanics.json', import.meta.url), 'utf8'),
);
const names = [
  'Acolyte of Aclazotz',
  'Ahriman',
  'Bartolom\u00e9 del Presidio',
  'Hardened Tactician',
  'Hungry Ghoul',
  'Cauldron of Essence',
  'Greta, Sweettooth Scourge',
  'Immersturm Predator',
  'Intruding Soulrager',
  'Ice Cream Kitty',
  "Kingpin's Enforcers",
  'Legion Extruder',
];
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
test('twelve selected-sacrifice cards roundtrip exactly', () => {
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

for (const [name, victimName, ability] of [
  ['Acolyte of Aclazotz', 'Grizzly Bears', 0],
  ['Ahriman', 'Grizzly Bears', 0],
  ['Bartolomé del Presidio', 'Grizzly Bears', 0],
  ['Hardened Tactician', 'Food Token', 0],
  ['Hungry Ghoul', 'Grizzly Bears', 0],
  ["Kingpin's Enforcers", 'Grizzly Bears', 0],
  ['Ice Cream Kitty', 'Food Token', 0],
  ['Greta, Sweettooth Scourge', 'Food Token', 1],
  ['Legion Extruder', 'Food Token', 0],
])
  test(`${name} pays selected sacrifice and resolves full activation`, () => {
    let s = rich();
    const source = put(s, name),
      victim = put(s, victimName);
    const hand = s.players[0].hand.length;
    s = act(s, 'activate', { card: source.id, ability, sacrifices: [ref(victim)] });
    assert.ok(!s.objects[victim.id] || s.objects[victim.id].zone === 'graveyard');
    s = resolve(s);
    if (['Bartolomé del Presidio', 'Hungry Ghoul'].includes(name))
      assert.equal(stats(s, s.objects[source.id]).power, 3);
    else if (name === 'Acolyte of Aclazotz') {
      assert.equal(s.players[1].life, 19);
      assert.equal(s.players[0].life, 21);
    } else if (name === 'Legion Extruder') {
      const token = Object.values(s.objects).find((o) => o.name === 'Colorless Golem Token');
      assert.equal(stats(s, token).power, 3);
    } else {
      assert.equal(s.players[0].hand.length, hand + 1);
      if (name === 'Greta, Sweettooth Scourge') assert.equal(s.players[0].life, 19);
    }
  });
test('Cauldron puts death trigger over reanimation and retains a preexisting graveyard target', () => {
  let s = rich();
  const source = put(s, 'Cauldron of Essence'),
    victim = put(s, 'Grizzly Bears'),
    dead = put(s, 'Serra Angel', 0, 'graveyard');
  s = act(s, 'activate', {
    card: source.id,
    ability: 0,
    target: ref(dead),
    sacrifices: [ref(victim)],
  });
  assert.equal(s.stack.length, 2);
  s = resolve(s);
  assert.equal(s.players[0].life, 21);
  assert.equal(s.players[1].life, 19);
  s = resolve(s);
  assert.equal(s.objects[dead.id].zone, 'battlefield');
});
test('Greta first activation grows the chosen creature, not the sacrificed Food', () => {
  let s = rich();
  const source = put(s, 'Greta, Sweettooth Scourge'),
    food = put(s, 'Food Token'),
    bear = put(s, 'Grizzly Bears');
  s = resolve(
    act(s, 'activate', { card: source.id, ability: 0, target: ref(bear), sacrifices: [ref(food)] }),
  );
  assert.equal(stats(s, s.objects[bear.id]).power, 3);
});
test('Immersturm Predator taps and becomes indestructible after its sacrifice resolves', () => {
  let s = rich();
  const source = put(s, 'Immersturm Predator'),
    bear = put(s, 'Grizzly Bears');
  s = resolve(act(s, 'activate', { card: source.id, ability: 0, sacrifices: [ref(bear)] }));
  assert.equal(s.objects[source.id].tapped, true);
  assert.ok(keywords(s, s.objects[source.id]).includes('indestructible'));
  assert.equal(s.choice.kind, 'triggerTargets');
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [] } });
  s = resolve(s);
  assert.equal(stats(s, s.objects[source.id]).power, 4);
});

test('Intruding Soulrager sacrifices a Room and damages the opponent then draws', () => {
  let s = rich();
  s.catalog = createRegistry({
    ...CARDS,
    'Test Room': {
      name: 'Test Room',
      type: 'enchantment',
      subtypes: ['Room'],
      cost: {},
      keywords: [],
    },
  });
  const source = put(s, 'Intruding Soulrager'),
    room = put(s, 'Test Room');
  const hand = s.players[0].hand.length;
  s = resolve(act(s, 'activate', { card: source.id, ability: 0, sacrifices: [ref(room)] }));
  assert.equal(s.objects[room.id].zone, 'graveyard');
  assert.equal(s.players[1].life, 18);
  assert.equal(s.players[0].hand.length, hand + 1);
});
