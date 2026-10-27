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
const names = ["Ashiok's Reaper", 'Knight of Doves', 'Judge Magister Gabranth', 'Demonic Ruckus'];
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
const cast = (s, name, args = {}) => {
  const o = put(s, name, 0, 'hand');
  return { s: resolve(act(s, 'cast', { card: o.id, ...args })), id: o.id };
};
test('four generic-graveyard departure cards roundtrip exactly', () => {
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

test('Ashiok and Knight observe noncreature enchantment departures but not bounce', () => {
  for (const name of ["Ashiok's Reaper", 'Knight of Doves']) {
    let s = rich();
    put(s, name);
    const e = put(s, 'Felidar Retreat');
    move(s, e, 'hand');
    stabilize(s);
    assert.equal(s.stack.length, 0);
    enterBattlefield(s, e, 0);
    move(s, e, 'graveyard');
    stabilize(s);
    s = resolve(s);
    if (name === "Ashiok's Reaper") assert.equal(s.players[0].hand.length, 1);
    else
      assert.equal(
        Object.values(s.objects).filter((o) => o.name === 'White Flying Bird Token').length,
        1,
      );
  }
});
test('Judge counts artifact creatures once and ordinary artifact deaths too', () => {
  let s = rich();
  const judge = put(s, 'Judge Magister Gabranth'),
    artifactCreature = put(s, 'Keeper of the Quiet Hour');
  move(s, artifactCreature, 'graveyard');
  stabilize(s);
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(s.objects[judge.id].plusCounters, 1);
  const a = put(s, 'Basilisk Collar');
  move(s, a, 'graveyard');
  stabilize(s);
  s = resolve(s);
  assert.equal(s.objects[judge.id].plusCounters, 2);
});
test('Demonic Ruckus enchants a creature and draws only when sent to graveyard', () => {
  let s = rich();
  const bear = put(s, 'Grizzly Bears');
  const r = cast(s, 'Demonic Ruckus', { target: ref(bear) });
  s = r.s;
  assert.equal(stats(s, s.objects[bear.id]).power, 3);
  assert.ok(keywords(s, s.objects[bear.id]).includes('menace'));
  move(s, s.objects[r.id], 'graveyard');
  stabilize(s);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 1);
});
test('graveyard replacement suppresses enchantment-death triggers', () => {
  let s = rich();
  put(s, "Ashiok's Reaper");
  put(s, 'Rest in Peace');
  const enchant = put(s, 'Felidar Retreat');
  move(s, enchant, 'graveyard');
  stabilize(s);
  assert.equal(enchant.zone, 'exile');
  assert.equal(s.stack.length, 0);
});
