import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, CARD_IDS } from '../packages/engine/src/cards.js';
import { compileCard, canonical } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { validateDefinition } from '../packages/engine/src/definition-validation.js';
const names = [
  'Abyssal Gorestalker',
  'Ball Lightning',
  'Frostbite Pyromental',
  'Pick Your Poison',
  'Crude Bent Blade',
  'Cornered by Black Mages',
  'Lorehold Charm',
  'Black Mage Wizard Token',
];
test('every sacrifice batch source round-trips without dropping clauses', () => {
  const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
  for (const name of names) {
    const source = sourceFromDefinition(CARDS[name], { id: idsByName[name], idsByName });
    const result = compileCard(source, { identities: CARD_IDS });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(canonical(result.definition), canonical(CARDS[name]), name);
  }
});
test('sacrifice authoring rejects delayed, linked-outcome, noninteger, and targetless-player instructions', () => {
  const base = { name: 'Invalid edict', type: 'sorcery', cost: {} };
  for (const effect of [
    { op: 'sacrifice', player: 'all', count: -1 },
    { op: 'sacrifice', player: 'all', count: 1.5 },
    { op: 'sacrifice', player: 'target', count: 1 },
    { op: 'sacrifice', player: 'all', count: 1, delayed: 'nextEndStep' },
    { op: 'sacrificeSelf', ifYouDo: [{ op: 'draw', count: 1 }] },
  ])
    assert.ok(validateDefinition({ ...base, effects: [effect] }).length);
});
