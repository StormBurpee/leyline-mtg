import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { compileCard, canonical } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { CARDS, createRegistry } from '../packages/engine/src/index.js';
import { validateCondition } from '../packages/engine/src/condition-schema.js';
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const reviewed = read('./fixtures/target-conditions-oracle-reviewed.json');
const sources = reviewed.cards.map(({ name }) =>
  read(
    `../packages/cards/cards/${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')}.json`,
  ),
);
const identities = Object.fromEntries(
  ['Map Token', 'Lander Token', 'Food Token'].map((name) => [
    `leyline:token/${name.toLowerCase().replaceAll(' ', '-')}`,
    name,
  ]),
);
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(
  read('../packages/cards/schema/card.schema.json'),
);
const compiled = (source) => compileCard(source, { identities });
const sample = () => structuredClone(sources.find((s) => s.name === 'Throw from the Saddle'));
const condition = (source) => source.abilities[0].effects[0].condition;

test('all sixteen complete Oracle sources validate, compile, and round-trip without omitted clauses', () => {
  assert.equal(sources.length, 16);
  for (const source of sources) {
    const oracle = reviewed.cards.find((c) => c.name === source.name);
    assert.equal(source.id, oracle.oracle_id);
    assert.equal(source.rulesText, oracle.oracle_text);
    assert.equal(source.characteristics.manaCost, oracle.mana_cost);
    assert.deepEqual(source.characteristics.colors, oracle.colors);
    assert.equal(validate(source), true, `${source.name}: source schema`);
    const result = compiled(source);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const back = compiled(
      sourceFromDefinition(result.definition, {
        id: source.id,
        idsByName: Object.fromEntries(Object.entries(identities).map(([id, name]) => [name, id])),
      }),
    );
    assert.equal(back.ok, true, JSON.stringify(back.diagnostics));
    assert.deepEqual(canonical(result.definition), canonical(back.definition));
    if (oracle.power !== null) {
      assert.equal(result.definition.power, Number(oracle.power));
      assert.equal(result.definition.toughness, Number(oracle.toughness));
    }
  }
});
test('target conditions reject omitted, ambiguous, malformed and nonpublic binding shapes', () => {
  for (const change of [
    (c) => {
      delete c.targetGroup;
    },
    (c) => {
      c.target = 'target';
    },
    (c) => {
      c.targetGroup = 0;
    },
    (c) => {
      c.targetGroup = '__proto__';
    },
    (c) => {
      c.target = 'source';
      delete c.targetGroup;
    },
    (c) => {
      c.lki = true;
    },
    (c) => {
      c.zone = 'hand';
    },
    (c) => {
      c.where = { privateName: 'Secret' };
    },
  ]) {
    const source = sample();
    change(condition(source));
    assert.equal(validate(source), false);
    assert.equal(compiled(source).ok, false);
  }
});
test('semantic validation binds only a declared single object target, including an optional one', () => {
  for (const change of [
    (s) => {
      condition(s).targetGroup = 'absent';
    },
    (s) => {
      s.abilities[0].targetGroups[0].max = 2;
    },
    (s) => {
      s.abilities[0].targetGroups[0].selector = { scope: 'player' };
    },
    (s) => {
      s.abilities[0].targetGroups[0].selector = { scope: 'spell' };
    },
    (s) => {
      s.abilities[0].targetGroups[0].selector = { scope: 'damageable' };
    },
    (s) => {
      delete condition(s).targetGroup;
      condition(s).target = 'target';
    },
  ]) {
    const source = sample();
    change(source);
    assert.equal(compiled(source).ok, false);
    const native = structuredClone(CARDS['Throw from the Saddle']);
    native.effects[0].condition = condition(source);
    native.targetGroups = source.abilities[0].targetGroups;
    assert.throws(() => createRegistry([native]), /target|Target/);
  }
  assert.equal(compiled(sources.find((s) => s.name === 'Sunpearl Kirin')).ok, true);
  const source = sample();
  condition(source).kind = 'targetEnteredThisTurn';
  delete condition(source).where;
  source.abilities[0].targetGroups[0].selector = { scope: 'graveyard' };
  assert.equal(compiled(source).ok, false);
});
test('target conditions are resolution-effect-only, never trigger gates, costs or continuous conditions', () => {
  const c = { kind: 'targetMatches', target: 'target', where: { type: 'creature' } };
  for (const wrapped of [c, { kind: 'all', conditions: [c] }, { kind: 'any', conditions: [c] }]) {
    assert.ok(validateCondition(wrapped).length);
    assert.ok(validateCondition(wrapped, { continuous: true }).length);
    assert.deepEqual(validateCondition(wrapped, { resolving: true, target: 'creature' }), []);
    for (const key of ['condition', 'triggerCondition']) {
      const source = structuredClone(sources.find((s) => s.name === 'Little Bear'));
      source.abilities[1][key] = wrapped;
      assert.equal(validate(source), false);
      assert.equal(compiled(source).ok, false);
      const native = structuredClone(CARDS['Little Bear']);
      native.triggers[0][key] = wrapped;
      assert.throws(() => createRegistry([native]), /resolving effect/);
    }
    const native = { ...CARDS['Grizzly Bears'], entersTappedUnless: wrapped };
    assert.throws(() => createRegistry([native]), /resolving effect/);
  }
});
test('nested mixed conditions retain bounded graphs and grouped controller damage has one object binding', () => {
  const source = sample();
  source.abilities[0].effects[0].condition = {
    kind: 'all',
    conditions: [condition(source), { kind: 'controllerTurn' }],
  };
  assert.equal(validate(source), true);
  assert.equal(compiled(source).ok, true);
  let c = condition(source);
  for (let i = 0; i < 10; i++) c = { kind: 'all', conditions: [c] };
  source.abilities[0].effects[0].condition = c;
  assert.equal(compiled(source).ok, false);
  for (const selector of [{ scope: 'player' }, { scope: 'spell' }]) {
    const native = {
      ...CARDS['Wisecrack'],
      targetGroups: [{ id: 'creature', min: 1, max: 1, selector }],
      effects: [{ op: 'damageTargetController', targetGroup: 'creature', amount: 2 }],
    };
    assert.throws(() => createRegistry([native]), /target group binding/);
  }
});
