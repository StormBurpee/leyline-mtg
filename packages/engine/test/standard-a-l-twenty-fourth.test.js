import test from 'node:test';
import { readFileSync } from 'node:fs';
const mechanics = JSON.parse(
  readFileSync(new URL('../../cards/mechanics.json', import.meta.url), 'utf8'),
);
import assert from 'node:assert/strict';
import { CARDS, CARD_IDS, ref, stats, keywords, definition } from '../src/index.js';
import { enterBattlefield, stabilize } from '../src/effects.js';
import { advanceStep } from '../src/turn.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';
import { notifyTriggers, move } from '../src/model.js';
const names = ['Crescent Island Temple', 'Awaken the Inferno', 'Enduring Innocence'];
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
const cast = (s, name, args = {}) => {
  const o = put(s, name, 0, 'hand');
  return { s: resolve(act(s, 'cast', { card: o.id, ...args })), id: o.id };
};
test('three twenty-fourth-pass cards roundtrip exactly', () => {
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

test('Crescent Island Temple counts itself and creates exact prowess Monks for later Shrines', () => {
  let s = rich();
  s = resolve(cast(s, 'Crescent Island Temple').s);
  const monk = Object.values(s.objects).find((o) => o.name === 'Red Prowess Monk Token');
  assert.ok(monk);
  assert.deepEqual(CARDS[monk.name].color, ['R']);
  assert.equal(stats(s, monk).power, 1);
  const instant = put(s, 'Burst Lightning', 0, 'hand');
  s = act(s, 'cast', { card: instant.id, target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(stats(s, s.objects[monk.id]).power, 2);
});
test('Awaken the Inferno hits an opposing planeswalker and counters an optional own creature', () => {
  let s = rich();
  const pw = put(s, 'Ajani, Caller of the Pride', 1),
    bear = put(s, 'Grizzly Bears');
  s = cast(s, 'Awaken the Inferno', { targets: { enemy: [ref(pw)], friendly: [ref(bear)] } }).s;
  assert.equal(s.objects[pw.id].zone, 'graveyard');
  assert.equal(s.objects[bear.id].plusCounters, 1);
});
test('Enduring Innocence triggers once for other low-power creatures and returns as a noncreature enchantment', () => {
  let s = rich();
  const source = put(s, 'Enduring Innocence');
  for (const name of ['Colossal Dreadmaw', 'Grizzly Bears', 'Grizzly Bears']) {
    const c = put(s, name, 0, 'hand');
    enterBattlefield(s, c, 0);
  }
  stabilize(s);
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 1);
  move(s, s.objects[source.id], 'graveyard');
  stabilize(s);
  s = resolve(s);
  assert.equal(s.objects[source.id].zone, 'battlefield');
  assert.deepEqual(definition(s, s.objects[source.id]).types, ['enchantment']);
});
