import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  CARDS,
  CARD_IDS,
  createRegistry,
  castingProfile,
  dispatch,
  playerView,
  stats,
  keywords,
  abilityProblem,
  createGame,
  replay,
  exportReplay,
  validateEventSpec,
} from '../src/index.js';
import { nextTurn } from '../src/turn.js';
import { numericValue } from '../src/numeric-values.js';
import { validateNumericValue } from '../src/value-schema.js';
import { recordSpellCast } from '../src/spell-history.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
const names = [
  'Brightspear Zealot',
  'Stoic Sphinx',
  "Potioner's Trove",
  'Focus the Mind',
  'Gigastorm Titan',
  'Highspire Bell-Ringer',
  'Uthros Psionicist',
  'Traxos, Academy Guardian',
  'Illvoi Operative',
  'Devoted Duelist',
  'Cori Mountain Stalwart',
  'Hearthborn Battler',
  'Iron-Fist Pulverizer',
  'Kraum, Violent Cacophony',
  'Poised Practitioner',
  'Sunstar Lightsmith',
  'Rodeo Pyromancers',
  'Malcolm, the Eyes',
];
const count = (s, player = 0, where, relation = 'you') =>
  numericValue(
    s,
    { kind: 'spellsCast', player: relation, ...(where ? { where } : {}) },
    { controller: player },
  );
function setup(extra = {}) {
  const s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    Spark: { name: 'Spark', type: 'instant', cost: {}, effects: [] },
    ...extra,
  });
  return s;
}
function castSpark(s, player = s.priority) {
  const card = put(s, 'Spark', player, 'hand');
  return act(s, 'cast', { card: card.id }, player);
}
test('cast history is committed once, after payment, and retained after countering', () => {
  let s = setup();
  const expensive = put(s, 'Gigastorm Titan', 0, 'hand');
  assert.equal(dispatch(s, { type: 'cast', player: 0, card: expensive.id }).ok, false);
  assert.equal(count(s), 0);
  s = castSpark(s);
  assert.equal(count(s), 1);
  assert.equal(count(s, 0, { type: 'instant' }), 1);
  lands(s, 'Island', 2, 1);
  const counter = put(s, 'Negate', 1, 'hand');
  s = act(s, 'pass');
  s = act(s, 'cast', { card: counter.id, target: { kind: 'stack', id: s.stack[0].id } });
  s = resolve(s);
  assert.equal(s.stack.length, 0);
  assert.equal(count(s), 1);
  assert.equal(count(s, 0, undefined, 'opponent'), 1);
  assert.equal(count(s, 0, undefined, 'all'), 2);
});
test('lands and cycling are not casts; both players reset on every turn boundary', () => {
  let s = setup();
  const land = put(s, 'Island', 0, 'hand');
  s = act(s, 'playLand', { card: land.id });
  lands(s, 'Forest', 2);
  const cycling = put(s, 'Topiary Panther', 0, 'hand');
  s = act(s, 'cycle', { card: cycling.id });
  assert.equal(count(s), 0);
  s = castSpark(s);
  s = act(s, 'pass');
  s = castSpark(s, 1);
  assert.equal(count(s, 1), 1);
  nextTurn(s);
  assert.equal(count(s), 0);
  assert.equal(count(s, 1), 0);
  assert.equal(s.players[0].spellsCast, undefined);
  assert.equal(s.players[1].spellsCast, undefined);
});
test('second-spell triggers use the event ordinal, not a rechecked resolution condition', () => {
  let s = setup();
  const operative = put(s, 'Illvoi Operative');
  s = castSpark(s);
  assert.equal(s.stack.length, 1);
  s = castSpark(s);
  assert.equal(s.stack.length, 3);
  assert.equal(s.stack.at(-1).condition, undefined);
  s = castSpark(s);
  assert.equal(s.stack.length, 4);
  s = resolve(s); // third spell
  s = resolve(s); // second-spell trigger survives third cast
  assert.equal(s.objects[operative.id].plusCounters, 1);
  assert.equal(count(s), 3);
});
test('second-spell cost reduction excludes the proposal and applies only to spell two', () => {
  let s = setup();
  put(s, 'Highspire Bell-Ringer');
  const titan = put(s, 'Gigastorm Titan', 0, 'hand');
  assert.deepEqual(castingProfile(s, 0, titan).cost, { generic: 4, U: 1 });
  s = resolve(castSpark(s));
  assert.deepEqual(castingProfile(s, 0, s.objects[titan.id]).cost, { generic: 0, U: 1 });
  s = resolve(castSpark(s));
  assert.deepEqual(castingProfile(s, 0, s.objects[titan.id]).cost, { generic: 1, U: 1 });
  nextTurn(s);
  assert.deepEqual(castingProfile(s, 0, s.objects[titan.id]).cost, { generic: 4, U: 1 });
});
test('cost reduction and continuous conditions query immutable public characteristic history', () => {
  let s = setup({
    Witness: {
      name: 'Witness',
      type: 'creature',
      cost: {},
      power: 1,
      toughness: 1,
      conditionalBonuses: [
        {
          affects: 'self',
          condition: {
            kind: 'compare',
            left: { kind: 'spellsCast', player: 'you', where: { type: 'instant' } },
            operator: 'gte',
            right: 1,
          },
          power: 2,
          toughness: 2,
        },
      ],
    },
  });
  const witness = put(s, 'Witness');
  const traxos = put(s, 'Traxos, Academy Guardian', 0, 'hand');
  assert.equal(stats(s, witness).power, 1);
  assert.equal(castingProfile(s, 0, traxos).cost.generic, 3);
  s = resolve(castSpark(s));
  assert.equal(stats(s, s.objects[witness.id]).power, 3);
  assert.equal(castingProfile(s, 0, s.objects[traxos.id]).cost.generic, 1);
  nextTurn(s);
  assert.equal(stats(s, s.objects[witness.id]).power, 1);
});
test('face-down casts reveal no printed type, color, subtype, name or identity in history', () => {
  let s = setup();
  lands(s, 'Mountain', 3);
  const card = put(s, 'Pyrotechnic Performer', 0, 'hand');
  s = act(s, 'cast', { card: card.id, mode: 1 });
  assert.equal(count(s, 0, { type: 'creature' }), 1);
  assert.equal(count(s, 0, { color: 'colorless' }), 1);
  assert.equal(count(s, 0, { color: 'R' }), 0);
  assert.equal(count(s, 0, { subtype: 'Goblin' }), 0);
  const history = playerView(s, 1).players[0].spellsCast;
  assert.ok(!JSON.stringify(history).includes('Pyrotechnic Performer'));
  assert.ok(!JSON.stringify(history).includes(card.id));
  delete s.objects[card.id].faceDown;
  assert.equal(count(s, 0, { color: 'R' }), 0);
});
test('history filters include changeling types and multitypes; repeated profiles are compacted', () => {
  const s = setup();
  const profile = {
    type: 'creature',
    types: ['creature', 'artifact'],
    color: ['U'],
    subtypes: [],
    keywords: ['changeling'],
  };
  for (let i = 0; i < 100; i++) recordSpellCast(s, 0, profile);
  assert.equal(s.players[0].spellsCast.profiles.length, 1);
  assert.equal(
    count(s, 0, { all: [{ type: 'artifact' }, { subtype: 'Otter' }, { color: 'U' }] }),
    100,
  );
  assert.equal(count(s, 0, { not: { type: 'creature' } }), 0);
  profile.color.push('R');
  assert.equal(count(s, 0, { color: 'R' }), 0);
});
test('first spell each turn counts even before the watcher enters and on opponent turns', () => {
  let s = setup();
  s = resolve(castSpark(s));
  put(s, 'Rodeo Pyromancers');
  s = castSpark(s);
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  nextTurn(s);
  s = act(s, 'pass');
  s = castSpark(s, 0);
  assert.equal(s.stack.length, 2);
  s = resolve(s);
  assert.equal(s.players[0].mana.R, 2);
});
test('any-player second-spell trigger counts the casting player rather than watcher controller', () => {
  let s = setup();
  put(s, 'Hearthborn Battler');
  s = act(s, 'pass');
  s = castSpark(s, 1);
  s = castSpark(s, 1);
  assert.equal(s.choice.kind, 'triggerTarget');
  s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } }, 0);
  s = resolve(s);
  assert.equal(s.players[1].life, 18);
  assert.equal(count(s), 0);
  assert.equal(count(s, 1), 2);
});
test('public schemas reject nonhistorical properties and invalid ordinals', () => {
  for (const where of [
    { owner: 'you' },
    { keyword: 'flying' },
    { power: { gt: 1 } },
    { not: { tapped: true } },
  ])
    assert.ok(validateNumericValue({ kind: 'spellsCast', player: 'you', where }).length);
  for (const spec of [
    { event: 'enter', spellNumber: 2 },
    { event: 'cast', spellNumber: 0 },
    { event: 'cast', spellNumber: 1.5 },
  ])
    assert.ok(validateEventSpec(spec).length);
  assert.deepEqual(validateEventSpec({ event: 'cast', spellNumber: 2 }), []);
});
test('all eighteen complete card definitions roundtrip through strict native sources', () => {
  const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
  for (const name of names) {
    const d = CARDS[name];
    assert.ok(d, name);
    const compiled = compileCard(sourceFromDefinition(d, { id: idsByName[name], idsByName }), {
      identities: CARD_IDS,
      mechanics: JSON.parse(readFileSync(new URL('../../cards/mechanics.json', import.meta.url))),
    });
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    assert.deepEqual(canonical(compiled.definition), canonical(d), name);
  }
});
test('real continuous bonuses and activation gates react to casts and expire on opponent turns', () => {
  let s = setup();
  const zealot = put(s, 'Brightspear Zealot'),
    sphinx = put(s, 'Stoic Sphinx'),
    trove = put(s, "Potioner's Trove");
  const power = stats(s, zealot).power;
  assert.ok(keywords(s, sphinx).includes('hexproof'));
  assert.ok(abilityProblem(s, 0, trove.id, 0));
  s = resolve(castSpark(s));
  assert.ok(!keywords(s, s.objects[sphinx.id]).includes('hexproof'));
  assert.equal(abilityProblem(s, 0, trove.id, 0), null);
  assert.equal(stats(s, s.objects[zealot.id]).power, power);
  s = resolve(castSpark(s));
  assert.equal(stats(s, s.objects[zealot.id]).power, power + 2);
  s = resolve(act(s, 'activate', { card: trove.id, ability: 0 }));
  assert.equal(s.players[0].life, 22);
  nextTurn(s);
  assert.equal(stats(s, s.objects[zealot.id]).power, power);
  assert.ok(keywords(s, s.objects[sphinx.id]).includes('hexproof'));
});
test('the same card cast normally then with flashback counts twice', () => {
  let s = setup();
  lands(s, 'Island', 5);
  const spell = put(s, 'Think Twice', 0, 'hand');
  s = resolve(act(s, 'cast', { card: spell.id }));
  s = resolve(act(s, 'cast', { card: spell.id }));
  assert.equal(count(s), 2);
  assert.equal(s.players[0].spellsCast.profiles.length, 1);
  assert.equal(s.objects[spell.id].zone, 'exile');
});
test('cast history survives a deterministic replay roundtrip', () => {
  const catalog = setup().catalog;
  const deck = [...Array(4).fill('Spark'), ...Array(8).fill('Island')];
  let s = createGame({ catalog, decks: [deck, deck], minimumDeckSize: 0, mulligan: false });
  const spell = s.players[0].hand.find((id) => s.objects[id].name === 'Spark');
  assert.ok(spell);
  s = act(s, 'cast', { card: spell });
  assert.equal(count(s), 1);
  assert.deepEqual(replay(JSON.parse(JSON.stringify(exportReplay(s)))), s);
});
for (const name of [
  'Devoted Duelist',
  'Cori Mountain Stalwart',
  'Kraum, Violent Cacophony',
  'Sunstar Lightsmith',
  'Poised Practitioner',
  'Malcolm, the Eyes',
  'Iron-Fist Pulverizer',
]) {
  test(`${name}: complete second-spell payoff executes`, () => {
    let s = setup();
    const source = put(s, name);
    s = resolve(castSpark(s));
    const handBefore = s.players[0].hand.length;
    s = castSpark(s);
    if (s.choice?.kind === 'triggerTarget')
      s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
    assert.equal(s.stack.length, 2);
    s = resolve(s);
    if (['Kraum, Violent Cacophony', 'Sunstar Lightsmith', 'Poised Practitioner'].includes(name))
      assert.equal(s.objects[source.id].plusCounters, 1);
    if (['Kraum, Violent Cacophony', 'Sunstar Lightsmith'].includes(name))
      assert.equal(s.players[0].hand.length, handBefore + 1);
    if (['Poised Practitioner', 'Iron-Fist Pulverizer'].includes(name))
      assert.equal(s.choice?.kind, 'libraryOrder');
    if (name === 'Cori Mountain Stalwart') assert.equal(s.players[0].life, 22);
    if (['Cori Mountain Stalwart', 'Iron-Fist Pulverizer'].includes(name))
      assert.equal(s.players[1].life, 18);
    if (name === 'Devoted Duelist') assert.equal(s.players[1].life, 19);
    if (name === 'Malcolm, the Eyes')
      assert.ok(
        Object.values(s.objects).some((o) => o.zone === 'battlefield' && o.name === 'Clue Token'),
      );
  });
}
test('Focus the Mind discount pays only three mana and preserves draw-then-discard', () => {
  let s = setup();
  lands(s, 'Island', 3);
  const spell = put(s, 'Focus the Mind', 0, 'hand');
  assert.ok(dispatch(s, { type: 'cast', player: 0, card: spell.id }).error);
  s = resolve(castSpark(s));
  s = act(s, 'cast', { card: spell.id });
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 3);
  assert.equal(s.choice.kind, 'discardEffect');
  assert.equal(count(s), 2);
});
