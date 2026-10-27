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
const names = ['Brimstone Roundup', 'Crumb and Get It', 'Deluge Virtuoso', 'Hexhaven Battalion'];
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
const cast = (s, name, args = {}) => {
  const o = put(s, name, 0, 'hand');
  return { s: resolve(act(s, 'cast', { card: o.id, ...args })), id: o.id };
};
test('four twenty-ninth-pass cards roundtrip exactly', () => {
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

test('Crumb offers an opposing Food only for the indestructible gift mode', () => {
  for (const mode of [0, 1]) {
    let s = rich();
    const bear = put(s, 'Grizzly Bears');
    s = cast(s, 'Crumb and Get It', { mode, target: ref(bear) }).s;
    assert.equal(stats(s, s.objects[bear.id]).power, 4);
    assert.equal(keywords(s, s.objects[bear.id]).includes('indestructible'), !!mode);
    const foods = Object.values(s.objects).filter((o) => o.name === 'Food Token');
    assert.equal(foods.length, mode);
    if (mode) assert.equal(foods[0].controller, 1);
  }
});
test('Deluge uses mana actually spent and replaces +1/+1 with +2/+2', () => {
  for (const expensive of [false, true]) {
    let s = rich();
    const v = put(s, 'Deluge Virtuoso');
    const base = stats(s, v).power;
    const spell = put(s, expensive ? 'Hexhaven Battalion' : 'Burst Lightning', 0, 'hand');
    s = act(s, 'cast', {
      card: spell.id,
      ...(!expensive ? { target: { kind: 'player', id: 1 } } : {}),
    });
    s = resolve(s);
    assert.equal(stats(s, s.objects[v.id]).power, base + (expensive ? 2 : 1));
  }
});
test('Hexhaven makes three exact Cadets and empowers Jace', () => {
  let s = rich();
  s = cast(s, 'Hexhaven Battalion').s;
  assert.equal(Object.values(s.objects).filter((o) => o.name === 'Cadet').length, 3);
  const j = Object.values(s.objects).find((o) => o.name === 'Jace Token');
  assert.equal(j.loyalty, 2);
});
test('Brimstone Roundup creates only on the second spell', () => {
  let s = rich();
  put(s, 'Brimstone Roundup');
  s = cast(s, 'Grizzly Bears').s;
  assert.ok(!Object.values(s.objects).some((o) => o.name === 'Mercenary Token'));
  const c = put(s, 'Grizzly Bears', 0, 'hand');
  s = act(s, 'cast', { card: c.id });
  s = resolve(s);
  assert.equal(Object.values(s.objects).filter((o) => o.name === 'Mercenary Token').length, 1);
});
