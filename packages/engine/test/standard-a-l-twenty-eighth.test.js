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
const names = ['Dai Li Indoctrination', 'Dragonfly Swarm', 'Glacier Godmaw', 'Constrictor Sage'];
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
const cast = (s, name, args = {}) => {
  const o = put(s, name, 0, 'hand');
  return { s: resolve(act(s, 'cast', { card: o.id, ...args })), id: o.id };
};
test('four twenty-eighth-pass cards roundtrip exactly', () => {
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

test('Dai Li discards only a nonland permanent or chooses earthbend instead', () => {
  let s = rich();
  const creature = put(s, 'Grizzly Bears', 1, 'hand'),
    instant = put(s, 'Burst Lightning', 1, 'hand'),
    land = put(s, 'Forest', 1, 'hand');
  s = cast(s, 'Dai Li Indoctrination', { mode: 0, target: { kind: 'player', id: 1 } }).s;
  assert.deepEqual(s.choice.eligibleCards, [creature.id]);
  s = act(s, 'chooseResolutionCard', { card: creature.id });
  assert.equal(s.objects[creature.id].zone, 'graveyard');
  assert.equal(s.objects[instant.id].zone, 'hand');
  assert.equal(s.objects[land.id].zone, 'hand');
  s = rich();
  const own = put(s, 'Forest');
  s = cast(s, 'Dai Li Indoctrination', { mode: 1, target: ref(own) }).s;
  assert.equal(s.objects[own.id].plusCounters, 2);
});
test('Dragonfly power counts only noncreature nonland cards and death checks the Lesson', () => {
  let s = rich();
  const swarm = put(s, 'Dragonfly Swarm');
  put(s, 'Grizzly Bears', 0, 'graveyard');
  put(s, 'Forest', 0, 'graveyard');
  put(s, 'Burst Lightning', 0, 'graveyard');
  put(s, 'Basilisk Collar', 0, 'graveyard');
  const lesson = put(s, 'Firebending Lesson', 0, 'graveyard');
  assert.equal(stats(s, swarm).power, 3);
  move(s, swarm, 'graveyard');
  stabilize(s);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 1);
});
test('Constrictor renew exiles itself and taps/stuns only opposing creatures', () => {
  let s = rich();
  const c = put(s, 'Constrictor Sage', 0, 'graveyard'),
    enemy = put(s, 'Grizzly Bears', 1);
  s = resolve(act(s, 'activate', { card: c.id, ability: 0, target: ref(enemy) }));
  assert.equal(s.objects[c.id].zone, 'exile');
  assert.equal(s.objects[enemy.id].tapped, true);
  assert.equal(s.objects[enemy.id].stunCounters, 1);
});
test('Glacier landfall grants the whole controlled team +1/+1 vigilance and haste', () => {
  let s = rich();
  const r = cast(s, 'Glacier Godmaw');
  s = resolve(r.s);
  assert.ok(Object.values(s.objects).some((o) => o.name === 'Lander Token'));
  const bear = put(s, 'Grizzly Bears'),
    land = put(s, 'Forest', 0, 'hand');
  enterBattlefield(s, land, 0);
  stabilize(s);
  s = resolve(s);
  assert.equal(stats(s, s.objects[bear.id]).power, 3);
  assert.ok(keywords(s, s.objects[bear.id]).includes('vigilance'));
  assert.ok(keywords(s, s.objects[r.id]).includes('haste'));
});
