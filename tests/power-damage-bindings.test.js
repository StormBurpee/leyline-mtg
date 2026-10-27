import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { compileCard, canonical } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { createRegistry } from '../packages/engine/src/index.js';
const names = [
  'Bite Down',
  'Hard-Hitting Question',
  'Hivespine Wolverine',
  'Affectionate Indrik',
  'Flourishing Grapple',
  'Mind Meanderer',
  'Burrog Barrage',
];
const sources = names.map((name) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../packages/cards/cards/${name.toLowerCase().replaceAll(' ', '-')}.json`,
        import.meta.url,
      ),
    ),
  ),
);
const reviewed = JSON.parse(
  readFileSync(new URL('./fixtures/power-damage-oracle-reviewed.json', import.meta.url)),
);
const schema = JSON.parse(
  readFileSync(new URL('../packages/cards/schema/card.schema.json', import.meta.url)),
);
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

test('all seven complete Oracle sources validate, compile and round-trip', () => {
  for (const source of sources) {
    const oracle = reviewed.cards.find((card) => card.name === source.name);
    assert.equal(source.id, oracle.oracle_id);
    assert.equal(source.rulesText, oracle.oracle_text);
    assert.equal(source.characteristics.manaCost, oracle.mana_cost);
    assert.deepEqual(source.characteristics.colors, oracle.colors);
    if (oracle.power !== null) {
      assert.equal(source.characteristics.power, Number(oracle.power));
      assert.equal(source.characteristics.toughness, Number(oracle.toughness));
    }
    assert.equal(validate(source), true, JSON.stringify(validate.errors));
    const result = compileCard(source);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.equal(result.definition.text, source.rulesText);
    const back = compileCard(sourceFromDefinition(result.definition, { id: source.id }));
    assert.equal(back.ok, true, JSON.stringify(back.diagnostics));
    assert.deepEqual(canonical(result.definition), canonical(back.definition));
  }
});
const sourceFight = () => structuredClone(sources.find((s) => s.name === 'Affectionate Indrik'));
test('source binding is explicit and exclusive in source schema, compiler and native validation', () => {
  for (const effect of [
    { op: 'fight', victimGroup: 'victim' },
    { op: 'fight', source: 'attached', victimGroup: 'victim' },
    { op: 'fight', source: 'source', sourceGroup: 'actor', victimGroup: 'victim' },
  ]) {
    const source = sourceFight();
    source.abilities[0].effects = [effect];
    assert.equal(validate(source), false);
    assert.equal(compileCard(source).ok, false);
    const native = compileCard(sourceFight()).definition;
    native.triggers[0].effects = [effect];
    assert.throws(() => createRegistry([native]), /source binding/);
  }
});
test('bite accepts creature-or-planeswalker victims but fight never accepts planeswalkers or multi-victim groups', () => {
  const source = structuredClone(sources[0]);
  assert.equal(compileCard(source).ok, true);
  for (const change of [
    (s) => {
      s.abilities[0].effects[0].op = 'fight';
    },
    (s) => {
      s.abilities[0].targetGroups[1].selector = { scope: 'permanent' };
    },
    (s) => {
      s.abilities[0].targetGroups[1].selector = { scope: 'player' };
    },
    (s) => {
      s.abilities[0].targetGroups[0].selector = {
        scope: 'permanent',
        where: { type: 'planeswalker' },
      };
    },
    (s) => {
      s.abilities[0].targetGroups[0].min = 0;
    },
  ]) {
    const bad = structuredClone(source);
    change(bad);
    assert.equal(compileCard(bad).ok, false);
  }
  const fight = sourceFight();
  fight.abilities[0].targetGroups[0].max = 2;
  assert.equal(compileCard(fight).ok, false);
});
