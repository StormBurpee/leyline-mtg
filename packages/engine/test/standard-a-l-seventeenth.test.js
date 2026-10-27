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
  'Artistic Process',
  'Cerebral Download',
  'Circle of Power',
  'Falcon, Winged Wonder',
  'Elvish Archivist',
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
test('five seventeenth-pass cards roundtrip exactly', () => {
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

test('Artistic Process uses the exact 3/3 UR flying Elemental and temporary haste', () => {
  let s = rich();
  s = cast(s, 'Artistic Process', { mode: 2 }).s;
  const e = Object.values(s.objects).find((o) => o.name === 'Blue Red Flying Elemental Token');
  assert.ok(e);
  assert.deepEqual(CARDS[e.name].color, ['U', 'R']);
  assert.equal(stats(s, e).power, 3);
  assert.ok(keywords(s, e).includes('haste'));
});
test('Cerebral Download surveils the current artifact count before drawing three', () => {
  let s = rich();
  put(s, 'Basilisk Collar');
  put(s, 'Treasure Token');
  s = cast(s, 'Cerebral Download').s;
  assert.equal(s.choice.cards.length, 2);
  assert.equal(s.players[0].hand.length, 0);
  s = act(s, 'orderLibrary', { top: s.choice.cards, rest: [] });
  assert.equal(s.players[0].hand.length, 3);
});
test('Circle of Power creates the exact Wizard and includes it in the lifelink pump', () => {
  let s = rich();
  s = cast(s, 'Circle of Power').s;
  assert.equal(s.players[0].life, 18);
  assert.equal(s.players[0].hand.length, 2);
  const w = Object.values(s.objects).find((o) => o.name === 'Black Wizard Spellslinger Token');
  assert.ok(w);
  assert.equal(stats(s, w).power, 1);
  assert.ok(keywords(s, w).includes('lifelink'));
});
test('Falcon creates legendary blue Redwing whose attack surveils', () => {
  let s = rich();
  s = resolve(cast(s, 'Falcon, Winged Wonder').s);
  const bird = Object.values(s.objects).find((o) => o.name === 'Redwing');
  assert.ok(bird);
  assert.equal(CARDS.Redwing.legendary, true);
  assert.deepEqual(CARDS.Redwing.subtypes, ['Bird', 'Scout']);
  notifyTriggers(s, 'attack', { object: bird });
  stabilize(s);
  s = resolve(s);
  assert.equal(s.choice.kind, 'libraryOrder');
  assert.equal(s.choice.cards.length, 1);
});
test('Elvish Archivist permits each distinct once-per-turn trigger only once', () => {
  let s = rich();
  const a = put(s, 'Elvish Archivist');
  for (let i = 0; i < 2; i++) {
    const art = put(s, 'Basilisk Collar', 0, 'hand');
    enterBattlefield(s, art, 0);
  }
  stabilize(s);
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(s.objects[a.id].plusCounters, 2);
  for (let i = 0; i < 2; i++) {
    const enchant = put(s, 'Felidar Retreat', 0, 'hand');
    enterBattlefield(s, enchant, 0);
  }
  stabilize(s);
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 1);
});
