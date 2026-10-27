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
const names = [
  'Alley Assailant',
  'Gadget Technician',
  'Greenbelt Radical',
  'Essence of Antiquity',
  'Dog Walker',
  'Forum Familiar',
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
test('six complete disguise cards roundtrip exactly', () => {
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

function concealed(s, name) {
  return cast(s, name, { mode: 1 });
}
test('Alley Assailant does not enter tapped face down, then its face-up trigger drains', () => {
  let s = rich();
  const r = concealed(s, 'Alley Assailant');
  s = r.s;
  assert.equal(s.objects[r.id].tapped, false);
  s = act(s, 'turnFaceUp', { card: r.id });
  s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.players[0].life, 23);
  assert.equal(s.players[1].life, 17);
});
test('Gadget Technician triggers once on normal entry or once on turning face up', () => {
  for (const disguise of [false, true]) {
    let s = rich();
    const r = cast(s, 'Gadget Technician', disguise ? { mode: 1 } : {});
    s = r.s;
    if (disguise) {
      assert.equal(s.stack.length, 0);
      s = act(s, 'turnFaceUp', { card: r.id });
    }
    s = resolve(s);
    assert.equal(
      Object.values(s.objects).filter((o) => o.name === 'Flying Thopter Token').length,
      1,
    );
  }
});
test('Greenbelt Radical and Essence of Antiquity affect the entire controlled team', () => {
  for (const name of ['Greenbelt Radical', 'Essence of Antiquity']) {
    let s = rich();
    const bear = put(s, 'Grizzly Bears');
    bear.tapped = true;
    const r = concealed(s, name);
    s = act(r.s, 'turnFaceUp', { card: r.id });
    s = resolve(s);
    if (name === 'Greenbelt Radical') {
      assert.equal(s.objects[bear.id].plusCounters, 1);
      assert.equal(s.objects[r.id].plusCounters, 1);
      assert.ok(keywords(s, s.objects[bear.id]).includes('trample'));
    } else {
      assert.equal(s.objects[bear.id].tapped, false);
      assert.ok(keywords(s, s.objects[bear.id]).includes('hexproof'));
    }
  }
});
test('Dog Walker creates two tapped white Dogs and Forum Familiar bounces another own permanent', () => {
  let s = rich();
  const r = concealed(s, 'Dog Walker');
  s = resolve(act(r.s, 'turnFaceUp', { card: r.id }));
  const dogs = Object.values(s.objects).filter((o) => o.name === 'Dog Token');
  assert.equal(dogs.length, 2);
  assert.ok(dogs.every((o) => o.tapped));
  s = rich();
  const land = put(s, 'Forest');
  const f = concealed(s, 'Forum Familiar');
  s = act(f.s, 'turnFaceUp', { card: f.id });
  s = act(s, 'chooseTriggerTarget', { target: ref(land) });
  s = resolve(s);
  assert.equal(s.objects[land.id].zone, 'hand');
  assert.equal(s.objects[f.id].plusCounters, 1);
});
