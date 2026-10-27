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
const names = [
  'Bejeweled Warg',
  'Black Panther, Vanguard',
  'Cosmogrand Zenith',
  'Daily Bugle Reporters',
  'Elven Raft-Steerer',
  "Fangkeeper's Familiar",
  'Fateshaper Aspirant',
  'Gaius van Baelsar',
  'Felidar Retreat',
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
test('nine additional modal cards roundtrip exactly', () => {
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

test('Daily Bugle offers zero or two counter targets and recovers a small creature', () => {
  for (const targetsCount of [0, 2]) {
    let s = rich();
    const a = put(s, 'Grizzly Bears'),
      b = put(s, 'Grizzly Bears');
    s = cast(s, 'Daily Bugle Reporters').s;
    s = act(s, 'chooseTriggerMode', { mode: 0 });
    s = act(s, 'chooseTriggerTargets', {
      targets: { chosen: targetsCount ? [ref(a), ref(b)] : [] },
    });
    s = resolve(s);
    assert.equal(s.objects[a.id].plusCounters ?? 0, targetsCount ? 1 : 0);
  }
  let s = rich();
  const a = put(s, 'Grizzly Bears', 0, 'graveyard');
  s = cast(s, 'Daily Bugle Reporters').s;
  s = act(s, 'chooseTriggerMode', { mode: 1 });
  s = act(s, 'chooseTriggerTarget', { target: ref(a) });
  s = resolve(s);
  assert.equal(s.objects[a.id].zone, 'hand');
});
test('Fateshaper returns legendary noncreature cards or grants counters and temporary protection', () => {
  let s = rich();
  const a = put(s, 'Ajani, Caller of the Pride', 0, 'graveyard');
  s = cast(s, 'Fateshaper Aspirant').s;
  s = act(s, 'chooseTriggerMode', { mode: 0 });
  s = act(s, 'chooseTriggerTarget', { target: ref(a) });
  s = resolve(s);
  assert.equal(s.objects[a.id].zone, 'hand');
  s = rich();
  const b = put(s, 'Grizzly Bears');
  s = cast(s, 'Fateshaper Aspirant').s;
  s = act(s, 'chooseTriggerMode', { mode: 1 });
  s = act(s, 'chooseTriggerTarget', { target: ref(b) });
  s = resolve(s);
  assert.equal(s.objects[b.id].plusCounters, 1);
  assert.ok(keywords(s, s.objects[b.id]).includes('indestructible'));
});
test('Felidar landfall creates exact Cat Beast or counters and vigilance for the controlled team', () => {
  for (const mode of [0, 1]) {
    let s = rich();
    put(s, 'Felidar Retreat');
    const a = put(s, 'Grizzly Bears');
    const land = put(s, 'Plains', 0, 'hand');
    enterBattlefield(s, land, 0);
    stabilize(s);
    s = act(s, 'chooseTriggerMode', { mode });
    s = resolve(s);
    if (!mode) {
      const cat = Object.values(s.objects).find((o) => o.name === 'Cat Beast Token');
      assert.ok(cat);
      assert.deepEqual(CARDS[cat.name].subtypes, ['Cat', 'Beast']);
    } else {
      assert.equal(s.objects[a.id].plusCounters, 1);
      assert.ok(keywords(s, s.objects[a.id]).includes('vigilance'));
    }
  }
});
test('Gaius sacrifices enchantments for each player without targeting', () => {
  let s = rich();
  const a = put(s, 'Felidar Retreat'),
    b = put(s, 'Felidar Retreat', 1);
  put(s, 'Grizzly Bears');
  s = cast(s, 'Gaius van Baelsar').s;
  s = act(s, 'chooseTriggerMode', { mode: 2 });
  s = resolve(s);
  s = act(s, 'sacrifice', { cards: [a.id] });
  s = act(s, 'sacrifice', { cards: [b.id] });
  assert.equal(s.objects[a.id].zone, 'graveyard');
  assert.equal(s.objects[b.id].zone, 'graveyard');
});
test('Fangkeeper offers life plus surveil independently of targeted modes', () => {
  let s = rich();
  s = cast(s, "Fangkeeper's Familiar").s;
  s = act(s, 'chooseTriggerMode', { mode: 0 });
  s = resolve(s);
  assert.equal(s.players[0].life, 23);
  assert.equal(s.choice.kind, 'libraryOrder');
  assert.equal(s.choice.cards.length, 3);
});
test('Black Panther ignores non-Hero entrants and creates the exact Soldier for another Hero', () => {
  let s = rich();
  put(s, 'Black Panther, Vanguard');
  const ordinary = put(s, 'Grizzly Bears', 0, 'hand');
  enterBattlefield(s, ordinary, 0);
  stabilize(s);
  assert.equal(s.choice, null);
  const hero = put(s, 'Agent of Atlas', 0, 'hand');
  enterBattlefield(s, hero, 0);
  stabilize(s);
  s = act(s, 'chooseTriggerMode', { mode: 0 });
  s = resolve(s);
  assert.ok(
    Object.values(s.objects).some((o) => o.zone === 'battlefield' && o.name === 'Soldier Token'),
  );
});
test('Cosmogrand counts the second spell only and creates exact Human Soldiers', () => {
  let s = rich();
  put(s, 'Cosmogrand Zenith');
  s = cast(s, 'Grizzly Bears').s;
  assert.equal(s.choice, null);
  const next = put(s, 'Grizzly Bears', 0, 'hand');
  s = act(s, 'cast', { card: next.id });
  s = act(s, 'chooseTriggerMode', { mode: 0 });
  s = resolve(s);
  assert.equal(
    Object.values(s.objects).filter(
      (o) => o.zone === 'battlefield' && o.name === 'Human Soldier Token',
    ).length,
    2,
  );
});
