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
  'Gurmag Rakshasa',
  'Equilibrium Adept',
  'Broadcast Rambler',
  'Campus Crier',
  'Dauntless Scrapbot',
  'Carrot Cake',
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
test('six sixteenth-pass cards roundtrip exactly', () => {
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

test('Gurmag binds opposite controllers to separate target groups', () => {
  let s = rich();
  const own = put(s, 'Grizzly Bears'),
    enemy = put(s, 'Colossal Dreadmaw', 1);
  s = cast(s, 'Gurmag Rakshasa').s;
  s = act(s, 'chooseTriggerTargets', { targets: { enemy: [ref(enemy)], friendly: [ref(own)] } });
  s = resolve(s);
  assert.equal(stats(s, s.objects[own.id]).power, 4);
  assert.equal(stats(s, s.objects[enemy.id]).power, 4);
});
test('Campus Crier exiles as a cost and empowers Jace', () => {
  let s = rich();
  const c = put(s, 'Campus Crier', 0, 'graveyard');
  s = resolve(act(s, 'activate', { card: c.id, ability: 0 }));
  assert.equal(s.objects[c.id].zone, 'exile');
  const j = Object.values(s.objects).find((o) => o.name === 'Jace Token');
  assert.ok(j);
  assert.equal(j.loyalty, 2);
});
test('Dauntless Scrapbot exiles only the opposing graveyard and creates a Lander', () => {
  let s = rich();
  const own = put(s, 'Grizzly Bears', 0, 'graveyard'),
    other = put(s, 'Grizzly Bears', 1, 'graveyard');
  s = resolve(cast(s, 'Dauntless Scrapbot').s);
  assert.equal(s.objects[own.id].zone, 'graveyard');
  assert.equal(s.objects[other.id].zone, 'exile');
  assert.ok(Object.values(s.objects).some((o) => o.name === 'Lander Token'));
});
test('Carrot Cake produces Rabbit and scry on entry and sacrifice before the life activation resolves', () => {
  let s = rich();
  const r = cast(s, 'Carrot Cake');
  s = resolve(r.s);
  s = act(s, 'orderLibrary', { top: s.choice.cards, rest: [] });
  s = act(s, 'activate', { card: r.id, ability: 0 });
  assert.equal(s.objects[r.id].zone, 'graveyard');
  s = resolve(s);
  assert.equal(s.players[0].life, 20);
  s = act(s, 'orderLibrary', { top: s.choice.cards, rest: [] });
  s = resolve(s);
  assert.equal(s.players[0].life, 23);
  assert.equal(Object.values(s.objects).filter((o) => o.name === 'Rabbit Token').length, 2);
});
