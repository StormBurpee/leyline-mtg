import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { compileCard, canonical } from '../packages/cards/compiler.js';
import { compilePack } from '../packages/cards/pack.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { createRegistry, validateDefinition, CARDS } from '../packages/engine/src/index.js';
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const reviewed = read('./fixtures/effect-choices-oracle-reviewed.json');
const sources = reviewed.cards.map((c) =>
  read(
    `../packages/cards/cards/${c.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')}.json`,
  ),
);
const tokens = ['food-token', 'treasure-token', 'clue-token', 'heartwood'].map((name) =>
  read(`../packages/cards/cards/${name}.json`),
);
const identities = Object.fromEntries(tokens.map((t) => [t.id, t.name]));
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(
  read('../packages/cards/schema/card.schema.json'),
);
const compiled = (source) => compileCard(source, { identities });
const native = () => compiled(sources[0]).definition;

test('all four complete Oracle sources validate, compile, round-trip and retain every printed clause', () => {
  for (const source of sources) {
    const oracle = reviewed.cards.find((c) => c.name === source.name);
    assert.equal(source.id, oracle.oracle_id);
    assert.equal(source.rulesText, oracle.oracle_text);
    assert.equal(source.characteristics.manaCost, oracle.mana_cost);
    assert.deepEqual(source.characteristics.colors, oracle.colors);
    assert.equal(validate(source), true, `${source.name}: invalid schema`);
    const result = compiled(source);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const back = compiled(
      sourceFromDefinition(result.definition, {
        id: source.id,
        idsByName: Object.fromEntries(tokens.map((t) => [t.name, t.id])),
      }),
    );
    assert.equal(back.ok, true, JSON.stringify(back.diagnostics));
    assert.deepEqual(canonical(back.definition), canonical(result.definition));
    assert.equal(result.definition.power, Number(oracle.power));
    assert.equal(result.definition.toughness, Number(oracle.toughness));
  }
  assert.equal(compilePack([...sources, ...tokens]).ok, true);
});

test('resolution alternatives reject new targets, costs, malformed labels, unsupported players and invalid branches', () => {
  for (const mutate of [
    (c) => (c.options = []),
    (c) => (c.options = [c.options[0]]),
    (c) => (c.options = Array(9).fill(c.options[0])),
    (c) => (c.options = null),
    (c) => (c.options[0] = null),
    (c) => (c.options[0].label = ''),
    (c) => (c.options[0].label = ' '.repeat(3)),
    (c) => (c.options[0].label = 'x'.repeat(161)),
    (c) => (c.player = 'all'),
    (c) => (c.target = { scope: 'permanent' }),
    (c) => (c.options[0].target = { scope: 'permanent' }),
    (c) => (c.options[0].cost = { mana: '{1}' }),
    (c) => (c.options[0].effects = [{ op: 'unsupported' }]),
    (c) =>
      (c.options[0].condition = {
        kind: 'targetMatches',
        target: 'target',
        where: { type: 'creature' },
      }),
  ]) {
    const source = structuredClone(sources[0]);
    mutate(source.abilities[0].effects[0]);
    const result = compiled(source);
    assert.equal(result.ok, false, JSON.stringify(source.abilities[0].effects[0]));
  }
  const definition = native();
  definition.etb[0].options[0].target = 'creature';
  assert.ok(validateDefinition(definition).length);
});

test('choice nesting shares effect complexity budgets and token cross-references validate unselected branches', () => {
  const definition = native();
  let e = { op: 'gainLife', amount: 1 };
  for (let i = 0; i < 10; i++)
    e = {
      op: 'chooseEffect',
      options: [
        { label: 'Recurse', effects: [e] },
        { label: 'Stop', effects: [] },
      ],
    };
  definition.etb = [e];
  assert.ok(validateDefinition(definition).length);
  const bad = native();
  bad.etb[0].options[1].effects[0].definition = 'Missing token';
  assert.throws(() => createRegistry({ ...CARDS, [bad.name]: bad }), /missing token definition/);
  const source = structuredClone(sources[0]);
  source.abilities[0].effects[0].options[1].effects[0].token = sources[0].id;
  assert.equal(compilePack([source, ...tokens]).ok, false);
});
