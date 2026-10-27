import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, CARD_IDS, ref, stats, keywords } from '../src/index.js';
import { stabilize } from '../src/effects.js';
import { advanceStep } from '../src/turn.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';
const names = [
  "Brass's Bounty",
  "Alchemist's Assistant",
  'Arnyn, Deathbloom Botanist',
  'Brambleguard Captain',
  'Flying Octobot',
  'Abandoned Air Temple',
  'Flaring Cinder',
  'Long Goodbye',
  'Blazing Crescendo',
  'Deadly Plot',
  'Dragonstorm Forecaster',
  'Dark Matter Manipulator',
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
test('12 further A–L sources roundtrip exactly', () => {
  const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
  for (const name of names) {
    const result = compileCard(
      sourceFromDefinition(CARDS[name], { id: idsByName[name], idsByName }),
      { identities: CARD_IDS },
    );
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(canonical(result.definition), canonical(CARDS[name]), name);
  }
});
test('Brass Bounty counts only lands controlled by its controller', () => {
  let s = rich();
  put(s, 'Forest');
  put(s, 'Swamp');
  put(s, 'Island', 1);
  s = cast(s, "Brass's Bounty").s;
  assert.equal(
    Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.token).length,
    2,
  );
});
test('Alchemist Assistant renew adds persistent lifelink counter', () => {
  let s = rich();
  const a = put(s, "Alchemist's Assistant", 0, 'graveyard'),
    b = put(s, 'Grizzly Bears');
  s = resolve(act(s, 'activate', { card: a.id, ability: 0, target: ref(b) }));
  assert.equal(s.objects[a.id].zone, 'exile');
  assert.ok(keywords(s, s.objects[b.id]).includes('lifelink'));
});
test('Brambleguard Captain uses power at resolution, even after target selection', () => {
  let s = rich();
  const source = put(s, 'Brambleguard Captain'),
    target = put(s, 'Grizzly Bears');
  advanceStep(s);
  stabilize(s);
  s = act(s, 'chooseTriggerTarget', { target: ref(target) });
  s.objects[source.id].plusCounters = 2;
  const power = stats(s, s.objects[source.id]).power;
  s = resolve(s);
  assert.equal(stats(s, s.objects[target.id]).power, 2 + power);
});
test('Abandoned Air Temple checks basic land and activated counters affect friendly creatures only', () => {
  for (const basic of [false, true]) {
    let s = rich();
    if (basic) put(s, 'Forest');
    const a = put(s, 'Grizzly Bears'),
      b = put(s, 'Grizzly Bears', 1),
      land = put(s, 'Abandoned Air Temple', 0, 'hand');
    s = act(s, 'playLand', { card: land.id });
    assert.equal(s.objects[land.id].tapped, !basic);
    s.objects[land.id].tapped = false;
    s = resolve(act(s, 'activate', { card: land.id, ability: 0 }));
    assert.equal(s.objects[a.id].plusCounters, 1);
    assert.equal(s.objects[b.id].plusCounters ?? 0, 0);
  }
});
test('Flying Octobot triggers once per turn for another Villain', () => {
  let s = rich();
  const source = put(s, 'Flying Octobot');
  s = cast(s, 'Flying Octobot').s;
  s = resolve(s);
  assert.equal(s.objects[source.id].plusCounters, 1);
  s = cast(s, 'Flying Octobot').s;
  while (s.stack.length) s = resolve(s);
  assert.equal(s.objects[source.id].plusCounters, 1);
});
test('Dark Matter Manipulator mills three and uses full seven-card graveyard increments', () => {
  let s = rich();
  const r = cast(s, 'Dark Matter Manipulator');
  s = resolve(r.s);
  assert.equal(s.players[0].graveyard.length, 3);
  const base = stats(s, s.objects[r.id]).power;
  for (let i = 0; i < 4; i++) put(s, 'Forest', 0, 'graveyard');
  assert.equal(stats(s, s.objects[r.id]).power, base + 2);
});
