import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { compileCard, canonical } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { CARDS, createRegistry } from '../packages/engine/src/index.js';
import { validateNumericValue } from '../packages/engine/src/value-schema.js';
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const reviewed = read('./fixtures/delirium-oracle-reviewed.json');
const sources = reviewed.cards.map(({ name }) =>
  read(`../packages/cards/cards/${name.toLowerCase().replaceAll(' ', '-')}.json`),
);
const validate = new Ajv2020({ strict: true }).compile(
  read('../packages/cards/schema/card.schema.json'),
);
const sample = () => structuredClone(sources.find((s) => s.name === 'Wildfire Wickerfolk'));

test('nine complete Delirium sources match reviewed Oracle data, validate, compile and round-trip', () => {
  assert.equal(sources.length, 9);
  for (const source of sources) {
    const oracle = reviewed.cards.find((c) => c.name === source.name);
    assert.equal(source.id, oracle.oracle_id);
    assert.equal(source.rulesText, oracle.oracle_text);
    assert.equal(source.characteristics.manaCost, oracle.mana_cost);
    assert.deepEqual(source.characteristics.colors, oracle.colors);
    assert.deepEqual(
      source.characteristics.types,
      oracle.type_line.split(' — ')[0].toLowerCase().split(' '),
    );
    assert.equal(validate(source), true, `${source.name}: source schema`);
    const result = compileCard(source);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const round = compileCard(sourceFromDefinition(result.definition, { id: source.id }));
    assert.equal(round.ok, true, JSON.stringify(round.diagnostics));
    assert.deepEqual(canonical(round.definition), canonical(result.definition));
    assert.doesNotThrow(() => createRegistry([result.definition]));
    if (oracle.power !== null) {
      assert.equal(result.definition.power, Number(oracle.power));
      assert.equal(result.definition.toughness, Number(oracle.toughness));
    }
  }
});

test('graveyard type expressions are closed, player-bound and never permit hidden-zone characteristic queries', () => {
  for (const value of [
    { kind: 'graveyardCardTypes' },
    { kind: 'graveyardCardTypes', player: 'controller' },
    ...['hand', 'library', 'battlefield', 'exile', 'graveyard'].map((zone) => ({
      kind: 'graveyardCardTypes',
      player: 'you',
      zone,
    })),
    { kind: 'graveyardCardTypes', player: 'you', where: { type: 'creature' } },
    { kind: 'graveyardCardTypes', player: 'you', excludeSource: true },
    { kind: 'graveyardCardTypes', player: 'you', count: 4 },
  ]) {
    assert.ok(validateNumericValue(value).length);
    const source = sample();
    source.abilities[1].condition.left = value;
    assert.equal(validate(source), false);
    assert.equal(compileCard(source).ok, false);
    assert.throws(() =>
      createRegistry([{ ...CARDS['Grizzly Bears'], selfBonus: { power: value, toughness: 0 } }]),
    );
  }
  for (const player of ['you', 'opponent', 'all']) {
    const value = { kind: 'graveyardCardTypes', player };
    assert.deepEqual(validateNumericValue(value), []);
    const source = sample();
    source.abilities[1].condition.left = value;
    assert.equal(validate(source), true);
    assert.equal(compileCard(source).ok, true);
  }
  let value = { kind: 'graveyardCardTypes', player: 'you' };
  for (let i = 0; i < 10; i++) value = { kind: 'sum', values: [value] };
  assert.ok(validateNumericValue(value).length);
});

test('conditional combat restrictions reject unsupported bindings, fields, kinds and unbounded lists', () => {
  const native = compileCard(sources.find((s) => s.name === 'Patchwork Beastie')).definition;
  for (const rule of [
    { restriction: 'cannotAttack' },
    {
      restriction: 'cannotAttack',
      condition: { kind: 'targetMatches', target: 'target', where: { type: 'creature' } },
    },
    { restriction: 'cannotBeBlockedByLowerPower', condition: { kind: 'controllerTurn' } },
    { restriction: 'unblockable', condition: { kind: 'sourcePowerAtMost', count: 1001 } },
    { restriction: 'unblockable', condition: { kind: 'sourcePowerAtMost', count: 1.5 } },
    { restriction: 'cannotBlock', condition: { kind: 'arbitraryCode' } },
    { restriction: 'cannotBlock', condition: { kind: 'controllerTurn' }, player: 'opponent' },
  ]) {
    assert.throws(() => createRegistry([{ ...native, conditionalCombatRestrictions: [rule] }]));
  }
  for (const rules of [[], Array(9).fill(native.conditionalCombatRestrictions[0]), null])
    assert.throws(() => createRegistry([{ ...native, conditionalCombatRestrictions: rules }]));
  const source = structuredClone(sources.find((s) => s.name === 'Patchwork Beastie'));
  source.abilities[0].restriction = 'cannotBeBlockedByLowerPower';
  assert.equal(compileCard(source).ok, false);
});

test('conditional unblockability accepts supported turn and bounded source-power conditions', () => {
  for (const condition of [{ kind: 'controllerTurn' }, { kind: 'sourcePowerAtMost', count: 1 }]) {
    const source = structuredClone(sources.find((s) => s.name === 'Patchwork Beastie'));
    source.abilities = [{ kind: 'combatRestriction', restriction: 'unblockable', condition }];
    assert.equal(validate(source), true, JSON.stringify(validate.errors));
    const result = compileCard(source);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.definition.conditionalCombatRestrictions, [
      { restriction: 'unblockable', condition },
    ]);
    assert.doesNotThrow(() => createRegistry([result.definition]));
    const round = compileCard(sourceFromDefinition(result.definition, { id: source.id }));
    assert.equal(round.ok, true, JSON.stringify(round.diagnostics));
    assert.deepEqual(canonical(round.definition), canonical(result.definition));
  }
});
