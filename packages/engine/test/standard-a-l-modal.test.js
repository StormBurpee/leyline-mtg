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
  'Glamermite',
  'Giant-Sized Flying Ant',
  'Coliseum Behemoth',
  'Archive Arbiter',
  'Divining Duelist',
  'Apothecary Stomper',
  'Damage Control Crew',
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
test('seven complete modal entry cards roundtrip exactly', () => {
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
test('Glamermite and Giant-Sized Flying Ant choose tap or untap before selecting targets', () => {
  for (const name of ['Glamermite', 'Giant-Sized Flying Ant'])
    for (const mode of [0, 1]) {
      let s = rich();
      const target = put(s, 'Grizzly Bears', 1);
      target.tapped = mode === 1;
      s = cast(s, name).s;
      assert.equal(s.choice.kind, 'triggerMode');
      s = act(s, 'chooseTriggerMode', { mode });
      assert.equal(s.choice.kind, 'triggerTarget');
      s = act(s, 'chooseTriggerTarget', { target: ref(target) });
      s = resolve(s);
      assert.equal(s.objects[target.id].tapped, mode === 0);
    }
});
test('Coliseum Behemoth and Archive Arbiter distinguish destruction from their nontargeted modes', () => {
  for (const name of ['Coliseum Behemoth', 'Archive Arbiter'])
    for (const mode of [0, 1]) {
      let s = rich();
      const target = put(s, 'Basilisk Collar', 1);
      s = cast(s, name).s;
      s = act(s, 'chooseTriggerMode', { mode });
      if (!mode) s = act(s, 'chooseTriggerTarget', { target: ref(target) });
      s = resolve(s);
      assert.equal(s.objects[target.id].zone, mode ? 'battlefield' : 'graveyard');
      assert.equal(s.players[0].hand.length, mode && name === 'Coliseum Behemoth' ? 1 : 0);
      assert.equal(s.players[0].life, mode && name === 'Archive Arbiter' ? 24 : 20);
    }
});
test('Apothecary Stomper chooses counters or life and Divining Duelist draws then discards', () => {
  let s = rich();
  const target = put(s, 'Grizzly Bears');
  s = cast(s, 'Apothecary Stomper').s;
  s = act(s, 'chooseTriggerMode', { mode: 0 });
  s = act(s, 'chooseTriggerTarget', { target: ref(target) });
  s = resolve(s);
  assert.equal(s.objects[target.id].plusCounters, 2);
  s = cast(s, 'Divining Duelist').s;
  s = act(s, 'chooseTriggerMode', { mode: 2 });
  s = resolve(s);
  assert.equal(s.choice.kind, 'discardEffect');
  assert.equal(s.players[0].hand.length, 1);
  s = act(s, 'discardEffect', { cards: [...s.players[0].hand] });
  assert.equal(s.players[0].hand.length, 0);
});
test('Damage Control Crew returns an expensive card or exiles an artifact, not both', () => {
  for (const mode of [0, 1]) {
    let s = rich();
    const grave = put(s, 'Shivan Dragon', 0, 'graveyard'),
      artifact = put(s, 'Basilisk Collar', 1);
    s = cast(s, 'Damage Control Crew').s;
    s = act(s, 'chooseTriggerMode', { mode });
    s = act(s, 'chooseTriggerTarget', { target: ref(mode ? artifact : grave) });
    s = resolve(s);
    assert.equal(s.objects[grave.id].zone, mode ? 'graveyard' : 'hand');
    assert.equal(s.objects[artifact.id].zone, mode ? 'exile' : 'battlefield');
  }
});
