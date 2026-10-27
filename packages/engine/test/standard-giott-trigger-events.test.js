import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS } from '../src/index.js';
import { enterBattlefield } from '../src/effects.js';
import { fixture, put } from './helpers.js';

const name = 'Giott, King of the Dwarves';
const giottTriggers = (s) => s.pendingTriggers.filter((entry) => entry.name === name);

// CR 603.2: the two "whenever" clauses are independent trigger events, not an
// inclusive-OR predicate. The named source clause also survives subtype changes.
test('Giott triggers exactly once for its own ordinary entry', () => {
  const s = fixture();
  const giott = put(s, name, 0, 'hand');
  enterBattlefield(s, giott);
  assert.equal(giottTriggers(s).length, 1);
});

test('Giott separately watches another friendly Dwarf and friendly Equipment', () => {
  for (const card of ['Axgard Cavalry', 'Basilisk Collar']) {
    const s = fixture();
    put(s, name);
    enterBattlefield(s, put(s, card, 0, 'hand'));
    assert.equal(giottTriggers(s).length, 1, card);
  }
});

test('Giott triggers twice when another friendly Dwarf Equipment enters', () => {
  const s = fixture();
  put(s, name);
  const entrant = put(s, 'Basilisk Collar', 0, 'hand');
  entrant.definitionOverride = {
    ...structuredClone(CARDS['Basilisk Collar']),
    type: 'creature',
    types: ['artifact', 'creature'],
    subtypes: ['Equipment', 'Dwarf'],
    power: 2,
    toughness: 2,
  };
  enterBattlefield(s, entrant);
  assert.equal(giottTriggers(s).length, 2);
  for (const trigger of giottTriggers(s))
    assert.deepEqual(trigger.effects, [{ op: 'optionalDiscardDraw' }]);
});

test('Giott does not watch opposing Dwarves or Equipment', () => {
  for (const card of ['Axgard Cavalry', 'Basilisk Collar']) {
    const s = fixture();
    put(s, name);
    enterBattlefield(s, put(s, card, 1, 'hand'));
    assert.equal(giottTriggers(s).length, 0, card);
  }
});

test('Giott self-entry trigger does not require the source to remain a Dwarf', () => {
  const s = fixture();
  const giott = put(s, name, 0, 'hand');
  // Use the engine's supported entry exception to remove creature subtypes
  // without removing abilities, rather than changing the printed card source.
  enterBattlefield(s, giott, 0, null, { enchantmentOnly: true });
  assert.equal(giottTriggers(s).length, 1);
});

test('Giott entering as an Equipment triggers the source and Equipment events', () => {
  const s = fixture();
  const giott = put(s, name, 0, 'hand');
  giott.definitionOverride = {
    ...structuredClone(CARDS[name]),
    types: ['artifact', 'creature'],
    subtypes: ['Equipment', 'Dwarf', 'Noble'],
  };
  enterBattlefield(s, giott);
  assert.equal(giottTriggers(s).length, 2);
});
