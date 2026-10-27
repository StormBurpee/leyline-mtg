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
const names = ['Dawnhand Eulogist', 'Cryotheory Adept', 'Korvold and the Noble Thief'];
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
const cast = (s, name, args = {}) => {
  const o = put(s, name, 0, 'hand');
  return { s: resolve(act(s, 'cast', { card: o.id, ...args })), id: o.id };
};
test('three twenty-fifth-pass cards roundtrip exactly', () => {
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

test('Dawnhand Eulogist can find an Elf among the three just milled', () => {
  let s = rich();
  const elf = put(s, 'Llanowar Elves', 0, 'library');
  s.players[0].library = s.players[0].library.filter((id) => id !== elf.id);
  s.players[0].library.unshift(elf.id);
  s = resolve(cast(s, 'Dawnhand Eulogist').s);
  assert.equal(s.objects[elf.id].zone, 'graveyard');
  assert.equal(s.players[0].life, 22);
  assert.equal(s.players[1].life, 18);
});
test('Cryotheory exiles from the graveyard then taps and stuns a creature', () => {
  let s = rich();
  const c = put(s, 'Cryotheory Adept', 0, 'graveyard'),
    bear = put(s, 'Grizzly Bears', 1);
  s = resolve(act(s, 'activate', { card: c.id, ability: 0, target: ref(bear) }));
  assert.equal(s.objects[c.id].zone, 'exile');
  assert.equal(s.objects[bear.id].tapped, true);
  assert.equal(s.objects[bear.id].stunCounters, 1);
});
test('Korvold chapters create Treasures then exile the opposing top three', () => {
  let s = rich();
  const r = cast(s, 'Korvold and the Noble Thief');
  s = resolve(r.s);
  assert.equal(Object.values(s.objects).filter((o) => o.name === 'Treasure Token').length, 1);
  notifyTriggers(s, 'chapter', { object: s.objects[r.id], chapterNumber: 2 });
  stabilize(s);
  s = resolve(s);
  assert.equal(Object.values(s.objects).filter((o) => o.name === 'Treasure Token').length, 2);
  notifyTriggers(s, 'chapter', { object: s.objects[r.id], chapterNumber: 3 });
  stabilize(s);
  s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.players[1].exile.length, 3);
});
