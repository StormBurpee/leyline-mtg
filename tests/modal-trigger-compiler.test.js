import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { compileCard, canonical } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { compilePack } from '../packages/cards/pack.js';
import { createRegistry } from '../packages/engine/src/index.js';
const source = {
  schemaVersion: 1,
  id: 'test:modal-trigger',
  name: 'Modal trigger compiler',
  characteristics: { types: ['creature'], manaCost: '{1}{W}', power: 2, toughness: 2 },
  abilities: [
    {
      kind: 'triggered',
      on: { event: 'enter', object: 'source' },
      choose: 1,
      modes: [
        { label: 'Gain life', effects: [{ op: 'gainLife', amount: 3, target: 'controller' }] },
        {
          label: 'Destroy artifact',
          target: { scope: 'permanent', where: { type: 'artifact' } },
          effects: [{ op: 'destroy', target: 'target' }],
        },
      ],
    },
  ],
};
const schema = JSON.parse(
  await readFile(new URL('../packages/cards/schema/card.schema.json', import.meta.url), 'utf8'),
);
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
test('source modal triggers schema-validate, compile and roundtrip without becoming ETB effects', () => {
  assert.equal(validate(source), true, JSON.stringify(validate.errors));
  const result = compileCard(source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.definition.etb, undefined);
  assert.equal(result.definition.triggers[0].effects, undefined);
  const roundtrip = compileCard(sourceFromDefinition(result.definition, { id: source.id }));
  assert.equal(roundtrip.ok, true, JSON.stringify(roundtrip.diagnostics));
  assert.deepEqual(canonical(roundtrip.definition), canonical(result.definition));
});
test('unsupported choose-many and shared-mode fields fail closed in schema and compiler', () => {
  for (const change of [
    { choose: 2 },
    { choose: 'oneOrMore' },
    { choose: undefined },
    { effects: [] },
    { target: { scope: 'player' } },
    { modes: [source.abilities[0].modes[0]] },
  ]) {
    const card = structuredClone(source);
    Object.assign(card.abilities[0], change);
    assert.equal(validate(card), false);
    assert.equal(compileCard(card).ok, false);
  }
});
test('tokens referenced only inside triggered modes are checked by registry and pack', () => {
  const card = structuredClone(source);
  card.abilities[0].modes[0].effects = [{ op: 'createToken', token: 'test:missing', amount: 1 }];
  assert.equal(compilePack([card]).ok, false);
  const result = compileCard(source);
  const definition = structuredClone(result.definition);
  definition.triggers[0].modes[0].effects = [
    { op: 'token', definition: 'Missing token', count: 1 },
  ];
  assert.throws(() => createRegistry([definition]), /missing token definition/);
});
