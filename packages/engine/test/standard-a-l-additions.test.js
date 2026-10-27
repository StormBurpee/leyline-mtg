import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, ref, dispatch } from '../src/index.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';
const names = [
  "Hero's Downfall",
  'Hulking Raptor',
  'Angel of Finality',
  'Arcanis the Omnipotent',
  'Discerning Peddler',
  'Karn, Argent Defender',
  'Defibrillating Current',
  'Incinerating Blast',
  'Count on Luck',
  'High-Flying Ace',
  'Abraded Bluffs',
  'Bristling Backwoods',
  'Creosote Heath',
  'Eroded Canyon',
  'Festering Gulch',
  'Forlorn Flats',
  'Jagged Barrens',
  'Lonely Arroyo',
  'Lush Oasis',
  'Earth Kingdom Soldier',
  'Black Waltz No. 3',
  'Cat-Gator',
  'Enraged Flamecaster',
  'Extended Absence',
  'Growth Curve',
  'Airship Crash',
  'Haazda Vigilante',
  'Clockwork Percussionist',
  'HYDRA Assault Robot',
  'Crash and Burn',
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
test('all 30 new A–L sources roundtrip without changing runtime contracts', () => {
  for (const name of names) {
    const id = 'test:roundtrip';
    const source = sourceFromDefinition(CARDS[name], { id });
    const result = compileCard(source);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(canonical(result.definition), canonical(CARDS[name]), name);
  }
});
test('nine pain-entry dual lands enter tapped, target opponent, deal damage and preserve both colors', () => {
  for (const name of names.filter((n) =>
    [
      'Abraded Bluffs',
      'Bristling Backwoods',
      'Creosote Heath',
      'Eroded Canyon',
      'Festering Gulch',
      'Forlorn Flats',
      'Jagged Barrens',
      'Lonely Arroyo',
      'Lush Oasis',
    ].includes(n),
  )) {
    let s = fixture();
    const o = put(s, name, 0, 'hand');
    s = act(s, 'playLand', { card: o.id });
    assert.equal(s.objects[o.id].tapped, true);
    assert.equal(s.choice.kind, 'triggerTarget');
    s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
    s = resolve(s);
    assert.equal(s.players[1].life, 19, name);
    assert.equal(CARDS[name].mana.length, 2);
  }
});
test('Angel of Finality can target either graveyard without clearing the other', () => {
  for (const player of [0, 1]) {
    let s = rich();
    const a = put(s, 'Forest', 0, 'graveyard'),
      b = put(s, 'Swamp', 1, 'graveyard');
    s = cast(s, 'Angel of Finality').s;
    s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: player } });
    s = resolve(s);
    assert.equal(s.objects[a.id].zone, player === 0 ? 'exile' : 'graveyard');
    assert.equal(s.objects[b.id].zone, player === 1 ? 'exile' : 'graveyard');
  }
});
test('Arcanis draws three and self-return follows exact source', () => {
  let s = rich();
  const o = put(s, 'Arcanis the Omnipotent');
  s = resolve(act(s, 'activate', { card: o.id, ability: 0 }));
  assert.equal(s.players[0].hand.length, 3);
  s = resolve(act(s, 'activate', { card: o.id, ability: 1 }));
  assert.equal(s.objects[o.id].zone, 'hand');
});
test('Karn suppresses artifact and creature entry triggers, not enchantment entries', () => {
  let s = rich();
  put(s, 'Karn, Argent Defender');
  s = cast(s, 'Discerning Peddler').s;
  assert.equal(s.stack.length, 0);
  assert.equal(s.choice, null);
  s = cast(s, 'Rest in Peace').s;
  assert.ok(s.stack.length > 0);
});
test('Earth Kingdom Soldier permits zero or two friendly targets, never enemy targets', () => {
  for (const n of [0, 2]) {
    let s = rich();
    const a = put(s, 'Grizzly Bears'),
      b = put(s, 'Llanowar Elves'),
      enemy = put(s, 'Grizzly Bears', 1);
    s = cast(s, 'Earth Kingdom Soldier').s;
    assert.equal(
      dispatch(s, { type: 'chooseTriggerTargets', player: 0, targets: { chosen: [ref(enemy)] } })
        .ok,
      false,
    );
    s = act(s, 'chooseTriggerTargets', { targets: { chosen: [a, b].slice(0, n).map(ref) } });
    s = resolve(s);
    assert.equal(s.objects[a.id].plusCounters ?? 0, n ? 1 : 0);
    assert.equal(s.objects[b.id].plusCounters ?? 0, n ? 1 : 0);
  }
});
test('Growth Curve adds before doubling existing plus counters', () => {
  let s = rich();
  const o = put(s, 'Grizzly Bears');
  o.plusCounters = 2;
  s = cast(s, 'Growth Curve', { target: ref(o) }).s;
  assert.equal(s.objects[o.id].plusCounters, 6);
});
test('Defibrillating Current damage and life gain resolve together', () => {
  let s = rich();
  const o = put(s, 'Grizzly Bears', 1);
  s = cast(s, 'Defibrillating Current', { target: ref(o) }).s;
  assert.equal(s.objects[o.id].zone, 'graveyard');
  assert.equal(s.players[0].life, 22);
});
test('Cat-Gator counts Swamps and lifelink includes damage to opponent', () => {
  let s = rich();
  put(s, 'Swamp');
  put(s, 'Swamp');
  put(s, 'Forest');
  s = cast(s, 'Cat-Gator').s;
  s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.players[1].life, 18);
  assert.equal(s.players[0].life, 22);
});
test('Discerning Peddler may decline discard or discard to draw exactly one', () => {
  for (const yes of [false, true]) {
    let s = rich();
    const o = put(s, 'Forest', 0, 'hand');
    s = cast(s, 'Discerning Peddler').s;
    s = resolve(s);
    assert.equal(s.choice.kind, 'discardEffect');
    s = act(s, 'discardEffect', { cards: yes ? [o.id] : [] });
    assert.equal(s.players[0].hand.length, 1);
    assert.equal(s.objects[o.id].zone, yes ? 'graveyard' : 'hand');
  }
});
