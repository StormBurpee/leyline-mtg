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
const names = ['Genghis Frog', 'Battle Menu'];
const rich = () => {
  const s = fixture();
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 100;
  return s;
};
const cast = (s, name, args = {}) => {
  const o = put(s, name, 0, 'hand');
  return { s: resolve(act(s, 'cast', { card: o.id, ...args })), id: o.id };
};
test('two thirtieth-pass cards roundtrip exactly', () => {
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

test('Genghis makes exactly one Mutagen for itself and one for another Mutant', () => {
  let s = rich();
  s = resolve(cast(s, 'Genghis Frog').s);
  assert.equal(Object.values(s.objects).filter((o) => o.name === 'Mutagen Token').length, 1);
  const mutant = put(s, 'Crustacean Commando', 0, 'hand');
  enterBattlefield(s, mutant, 0);
  stabilize(s);
  // Commando itself creates a Mutagen as well; both independent triggers are legitimate.
  while (s.choice?.kind === 'orderTriggers')
    s = act(s, 'orderTriggers', { ids: s.choice.entries.map((t) => t.id) });
  while (s.stack.length) s = resolve(s);
  assert.equal(Object.values(s.objects).filter((o) => o.name === 'Mutagen Token').length, 3);
});
test('Battle Menu creates an exact vanilla 2/2 white Knight and its other modes are distinct', () => {
  let s = rich();
  s = cast(s, 'Battle Menu', { mode: 0 }).s;
  const knight = Object.values(s.objects).find((o) => o.name === 'Two Two Knight Token');
  assert.equal(stats(s, knight).power, 2);
  assert.deepEqual(keywords(s, knight), []);
  s = rich();
  s = cast(s, 'Battle Menu', { mode: 3 }).s;
  assert.equal(s.players[0].life, 24);
});
