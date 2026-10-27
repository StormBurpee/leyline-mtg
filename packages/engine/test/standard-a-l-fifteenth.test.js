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
  'Emergency Eject',
  'Aatchik, Emerald Radian',
  'Kiora, the Rising Tide',
  'Haru, Hidden Talent',
  'Arcane Amphisbaena',
  'Azula, On the Hunt',
  'Baxter Stockman',
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
test('seven fifteenth-pass cards roundtrip exactly', () => {
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

test('Emergency Eject gives the destroyed permanent controller a Lander', () => {
  let s = rich();
  const a = put(s, 'Grizzly Bears', 1);
  s = cast(s, 'Emergency Eject', { target: ref(a) }).s;
  assert.equal(s.objects[a.id].zone, 'graveyard');
  const token = Object.values(s.objects).find((o) => o.name === 'Lander Token');
  assert.equal(token.controller, 1);
});
test('Aatchik counts artifact creatures once and makes exact green vanilla Insects', () => {
  let s = rich();
  put(s, 'Basilisk Collar', 0, 'graveyard');
  put(s, 'Grizzly Bears', 0, 'graveyard');
  put(s, 'Keeper of the Quiet Hour', 0, 'graveyard');
  const r = cast(s, 'Aatchik, Emerald Radian');
  s = resolve(r.s);
  const insects = Object.values(s.objects).filter(
    (o) => o.name === 'Green Insect Token' && o.zone === 'battlefield',
  );
  assert.equal(insects.length, 3);
  assert.deepEqual(CARDS['Green Insect Token'].color, ['G']);
  assert.deepEqual(keywords(s, insects[0]), []);
  move(s, insects[0], 'graveyard');
  stabilize(s);
  s = resolve(s);
  assert.equal(s.players[1].life, 19);
  assert.equal(s.objects[r.id].plusCounters, 1);
});
test('Kiora threshold creates the named legendary Octopus and checks threshold again at resolution', () => {
  for (const keep of [true, false]) {
    let s = rich();
    const k = put(s, 'Kiora, the Rising Tide');
    const graves = Array.from({ length: 7 }, () => put(s, 'Grizzly Bears', 0, 'graveyard'));
    notifyTriggers(s, 'attack', { object: k });
    stabilize(s);
    if (!keep) move(s, graves[0], 'exile');
    s = resolve(s);
    if (keep) {
      s = act(s, 'resolveOptional', { accept: true });
      const token = Object.values(s.objects).find((o) => o.name === 'Scion of the Deep');
      assert.ok(token);
      assert.equal(stats(s, token).power, 8);
      assert.ok(CARDS[token.name].legendary);
    } else assert.ok(!Object.values(s.objects).some((o) => o.name === 'Scion of the Deep'));
  }
});
test('Haru earthbends an own land when another Ally enters', () => {
  let s = rich();
  put(s, 'Haru, Hidden Talent');
  const land = put(s, 'Forest');
  const ally = put(s, 'Ally Token', 0, 'hand');
  enterBattlefield(s, ally, 0);
  stabilize(s);
  s = act(s, 'chooseTriggerTarget', { target: ref(land) });
  s = resolve(s);
  assert.equal(s.objects[land.id].plusCounters, 1);
  assert.equal(stats(s, s.objects[land.id]).power, 1);
});
test('Baxter creates a 1/1 Robot, not the existing 2/2 Robot', () => {
  let s = rich();
  s = resolve(cast(s, 'Baxter Stockman').s);
  const token = Object.values(s.objects).find((o) => o.name === 'Small Robot Token');
  assert.ok(token);
  assert.equal(stats(s, token).power, 1);
});
