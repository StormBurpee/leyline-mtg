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
const names = ['Disruptor of Currents', 'Gloom Ripper', 'Hapatra, the Desert Frost', 'Doctor Doom'];
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
const cast = (s, name, args = {}) => {
  const o = put(s, name, 0, 'hand');
  return { s: resolve(act(s, 'cast', { card: o.id, ...args })), id: o.id };
};
test('four nineteenth-pass cards roundtrip exactly', () => {
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

test('Disruptor optionally bounces another nonland permanent, never itself', () => {
  let s = rich();
  const a = put(s, 'Basilisk Collar', 1);
  const r = cast(s, 'Disruptor of Currents');
  s = r.s;
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [ref(a)] } });
  s = resolve(s);
  assert.equal(s.objects[a.id].zone, 'hand');
  assert.equal(s.objects[r.id].zone, 'battlefield');
});
test('Gloom Ripper counts Elves on the battlefield and in graveyard at resolution', () => {
  let s = rich();
  const own = put(s, 'Grizzly Bears'),
    enemy = put(s, 'Colossal Dreadmaw', 1);
  put(s, 'Llanowar Elves');
  put(s, 'Llanowar Elves', 0, 'graveyard');
  s = cast(s, 'Gloom Ripper').s;
  s = act(s, 'chooseTriggerTargets', { targets: { friendly: [ref(own)], enemy: [ref(enemy)] } });
  s = resolve(s);
  assert.equal(stats(s, s.objects[own.id]).power, 5);
  assert.equal(stats(s, s.objects[enemy.id]).toughness, 3);
});
test('Hapatra optionally taps and stuns an opposing creature and can untap any creature', () => {
  let s = rich();
  const a = put(s, 'Grizzly Bears', 1);
  const r = cast(s, 'Hapatra, the Desert Frost');
  s = r.s;
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [ref(a)] } });
  s = resolve(s);
  assert.equal(s.objects[a.id].tapped, true);
  assert.equal(s.objects[a.id].stunCounters, 1);
  s = resolve(act(s, 'activate', { card: r.id, ability: 0, target: ref(a) }));
  assert.equal(s.objects[a.id].stunCounters, 0);
  assert.equal(s.objects[a.id].tapped, true);
});
test('Doctor Doom creates exact named Doombots and loses indestructible without an artifact creature or Plan', () => {
  let s = rich();
  const r = cast(s, 'Doctor Doom');
  s = resolve(r.s);
  const bots = Object.values(s.objects).filter((o) => o.name === 'Doombot');
  assert.equal(bots.length, 2);
  assert.deepEqual(CARDS.Doombot.subtypes, ['Robot', 'Villain']);
  assert.equal(stats(s, bots[0]).power, 3);
  assert.ok(keywords(s, s.objects[r.id]).includes('indestructible'));
  for (const b of bots) move(s, b, 'exile');
  stabilize(s);
  assert.ok(!keywords(s, s.objects[r.id]).includes('indestructible'));
});
