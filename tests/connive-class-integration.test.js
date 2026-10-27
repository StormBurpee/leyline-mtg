import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry } from '../packages/engine/src/index.js';
import { compilePack } from '../packages/cards/pack.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';

test('discard continuations in Class grants validate tokens across native and compiled registries', () => {
  const definition = structuredClone(CARDS["Caretaker's Talent"]);
  definition.classLevels[0].abilities.triggers[0].effects = [
    {
      op: 'discardThen',
      count: 1,
      then: [{ op: 'token', definition: 'Missing continuation token', count: 1 }],
    },
  ];
  assert.throws(() => createRegistry([definition]), /missing token definition/);
  const source = sourceFromDefinition(definition, {
    id: 'test:discard-class',
    idsByName: { 'Missing continuation token': 'test:missing-token' },
  });
  assert.equal(compilePack([source]).ok, false);
});
