import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { compileCard, canonical } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { createRegistry } from '../packages/engine/src/index.js';
const schema = JSON.parse(
  readFileSync(new URL('../packages/cards/schema/card.schema.json', import.meta.url)),
);
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
const source = {
  schemaVersion: 1,
  id: 'test:bound-fight',
  name: 'Bound fight',
  characteristics: { types: ['creature'], manaCost: '{2}{G}', power: 3, toughness: 3 },
  abilities: [
    {
      kind: 'triggered',
      on: { event: 'enter', object: 'source' },
      targetGroups: [
        {
          id: 'victim',
          selector: { scope: 'permanent', where: { type: 'creature' } },
          min: 0,
          max: 1,
        },
      ],
      effects: [{ op: 'fight', source: 'source', victimGroup: 'victim' }],
    },
  ],
};
test('explicit source fight validates, compiles and round-trips without treating its source as a target', () => {
  assert.equal(validate(source), true, JSON.stringify(validate.errors));
  const c = compileCard(source);
  assert.equal(c.ok, true, JSON.stringify(c.diagnostics));
  const back = compileCard(sourceFromDefinition(c.definition, { id: source.id }));
  assert.equal(back.ok, true);
  assert.deepEqual(canonical(c.definition), canonical(back.definition));
});
test('source bindings reject missing, unknown or simultaneous source and sourceGroup fields', () => {
  for (const effect of [
    { op: 'fight', victimGroup: 'victim' },
    { op: 'fight', source: 'attached', victimGroup: 'victim' },
    { op: 'fight', source: 'source', sourceGroup: 'actor', victimGroup: 'victim' },
  ]) {
    const bad = structuredClone(source);
    bad.abilities[0].effects = [effect];
    assert.equal(validate(bad), false);
    assert.equal(compileCard(bad).ok, false);
    const native = compileCard(source).definition;
    native.triggers[0].effects = [effect];
    assert.throws(() => createRegistry([native]), /source binding/);
  }
});
test('bite accepts creature-or-planeswalker permanent groups while fight remains creature-only', () => {
  const bad = structuredClone(source);
  bad.abilities[0].targetGroups[0].selector.where = {
    any: [{ type: 'creature' }, { type: 'planeswalker' }],
  };
  assert.equal(compileCard(bad).ok, false);
  bad.abilities[0].effects[0].op = 'bite';
  assert.equal(compileCard(bad).ok, true);
  for (const selector of [{ scope: 'permanent' }, { scope: 'player' }, { scope: 'damageable' }]) {
    bad.abilities[0].targetGroups[0].selector = selector;
    assert.equal(compileCard(bad).ok, false);
  }
});
