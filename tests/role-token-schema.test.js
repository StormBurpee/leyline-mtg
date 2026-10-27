import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { compilePack } from '../packages/cards/pack.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { createRegistry, CARDS } from '../packages/engine/src/index.js';
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const tokens = ['cursed', 'monster', 'royal', 'sorcerer', 'wicked', 'young-hero'].map((name) =>
  read(`../packages/cards/cards/${name}-role.json`),
);
const identities = Object.fromEntries(tokens.map((t) => [t.id, t.name])),
  idsByName = Object.fromEntries(tokens.map((t) => [t.name, t.id]));
const schema = new Ajv2020({ allErrors: true, strict: true }).compile(
  read('../packages/cards/schema/card.schema.json'),
);
const creator = (target) => ({
  schemaVersion: 1,
  id: 'test:role-maker',
  name: 'Role Maker',
  characteristics: {
    types: ['creature'],
    subtypes: [],
    colors: [],
    manaCost: '{1}',
    power: 1,
    toughness: 1,
  },
  rulesText: 'Test fixture.',
  abilities: [
    {
      kind: 'triggered',
      on: { event: 'enter', object: 'source' },
      ...(target === 'target'
        ? { target: { scope: 'permanent', where: { type: 'creature' } } }
        : {}),
      effects: [{ op: 'createAttachedToken', token: 'leyline:token/royal-role', target }],
    },
  ],
});
test('All six exact Role sources validate and round-trip including granted triggers and additive ward', () => {
  for (const source of tokens) {
    assert(schema(source), `${source.name}: ${JSON.stringify(schema.errors)}`);
    const result = compileCard(source, { identities });
    assert(result.ok, JSON.stringify(result.diagnostics));
    const round = compileCard(
      sourceFromDefinition(result.definition, { id: source.id, idsByName }),
      { identities },
    );
    assert(round.ok, JSON.stringify(round.diagnostics));
    assert.deepEqual(round.definition, result.definition);
  }
  const pack = compilePack(tokens);
  assert(pack.ok, JSON.stringify(pack.diagnostics));
  assert.doesNotThrow(() =>
    createRegistry({ ...CARDS, ...Object.fromEntries(pack.definitions.map((d) => [d.name, d])) }),
  );
});
test('Attached tokens accept exact source, event and target bindings and grouped target selections', () => {
  for (const target of ['source', 'eventSource', 'target']) {
    const source = creator(target);
    assert(schema(source), JSON.stringify(schema.errors));
    const compiled = compileCard(source, { identities });
    assert(compiled.ok, JSON.stringify(compiled.diagnostics));
    assert.deepEqual(
      compileCard(sourceFromDefinition(compiled.definition, { id: source.id, idsByName }), {
        identities,
      }).definition,
      compiled.definition,
    );
  }
  const source = creator('target'),
    ability = source.abilities[0];
  ability.targetGroups = [{ id: 'creature', selector: ability.target, min: 0, max: 1 }];
  delete ability.target;
  ability.effects[0].targetGroup = 'creature';
  const compiled = compileCard(source, { identities });
  assert(compiled.ok, JSON.stringify(compiled.diagnostics));
  assert.equal(compiled.definition.triggers[0].effects[0].targetGroup, 'creature');
});
test('Compiler and registry reject missing/non-Aura tokens, unknown attachment bindings and unsupported grant fields', () => {
  for (const mutate of [
    (s) => (s.abilities[0].effects[0].target = 'returned'),
    (s) => (s.abilities[0].effects[0].amount = 2),
    (s) => (s.abilities[0].effects[0].token = 'test:missing'),
  ]) {
    const source = creator('target');
    mutate(source);
    assert.equal(compileCard(source, { identities }).ok, false);
  }
  const badToken = structuredClone(tokens[0]);
  badToken.abilities = [];
  const maker = creator('target');
  maker.abilities[0].effects[0].token = badToken.id;
  assert.equal(compilePack([badToken, maker]).ok, false);
  const nested = creator('target');
  nested.abilities[0].effects = [
    {
      op: 'conditional',
      condition: { kind: 'controllerTurn' },
      then: [{ op: 'createAttachedToken', token: badToken.id, target: 'target' }],
    },
  ];
  assert.equal(compilePack([badToken, nested]).ok, false);
  const badGrant = structuredClone(tokens.find((t) => t.name === 'Sorcerer'));
  badGrant.abilities.at(-1).oncePerTurn = true;
  assert.equal(compileCard(badGrant, { identities }).ok, false);
});

test('Role keep-choice renders as a Role decision and repeated stale submission is rejected atomically', async () => {
  const { parseHTML } = await import('linkedom');
  const { game, legendChoiceBody } = await import('../apps/web/view.js');
  const { createGame, dispatch } = await import('../packages/engine/src/index.js');
  const { addObject, ref } = await import('../packages/engine/src/model.js');
  const { enterBattlefieldBatch, stabilize } = await import('../packages/engine/src/effects.js');
  const definitions = compilePack(tokens).definitions;
  let s = createGame({
    catalog: createRegistry({
      ...CARDS,
      ...Object.fromEntries(definitions.map((d) => [d.name, d])),
    }),
    mulligan: false,
  });
  s.step = 'main1';
  const creature = addObject(s, 'Llanowar Elves', 0, 'battlefield');
  const a = addObject(s, 'Royal', 0, 'void'),
    b = addObject(s, 'Monster', 0, 'void');
  enterBattlefieldBatch(s, [
    { object: a, attachment: ref(creature) },
    { object: b, attachment: ref(creature) },
  ]);
  stabilize(s);
  const ui = {
    mode: 'hotseat',
    seat: 0,
    activation: null,
    chosen: [],
    attackers: [],
    blocks: [],
    selected: null,
  };
  const { document } = parseHTML(game(s, ui, {}) + legendChoiceBody(s));
  assert.match(
    document.textContent ?? document.documentElement.textContent,
    /Choose one Role to keep/,
  );
  assert.equal(document.querySelectorAll('[data-action="keepLegend"]').length, 2);
  const accepted = dispatch(s, { type: 'chooseLegend', player: 0, card: a.id });
  assert.equal(accepted.ok, true);
  s = accepted.state;
  const snapshot = structuredClone(s);
  assert.equal(dispatch(s, { type: 'chooseLegend', player: 0, card: b.id }).ok, false);
  assert.deepEqual(s, snapshot);
});

test('Attachment-granted triggers cannot hide unresolved token cross-references from pack or registry linking', () => {
  const source = structuredClone(tokens.find((t) => t.name === 'Sorcerer'));
  source.abilities.at(-1).effects = [
    { op: 'createAttachedToken', token: 'test:missing-role', target: 'source' },
  ];
  const compiled = compileCard(source, { identities: { 'test:missing-role': 'Missing Role' } });
  assert.equal(compiled.ok, true);
  assert.throws(
    () => createRegistry({ ...CARDS, [compiled.definition.name]: compiled.definition }),
    /missing token definition/,
  );
  const notAura = structuredClone(tokens.find((t) => t.name === 'Monster'));
  notAura.abilities = [];
  source.abilities.at(-1).effects[0].token = notAura.id;
  assert.equal(compilePack([source, notAura]).ok, false);
});

test('generic Aura-token creation rejects single-token unordered continuation and multi-token entry loss', () => {
  const plainAura = structuredClone(tokens.find((t) => t.name === 'Royal'));
  plainAura.id = 'test:plain-aura-token';
  plainAura.name = 'Plain Aura Token';
  plainAura.characteristics.subtypes = ['Aura'];
  for (const token of [tokens.find((t) => t.name === 'Royal'), plainAura])
    for (const amount of [1, 2]) {
      const source = creator('source');
      source.abilities[0].effects = [
        { op: 'createToken', token: token.id, amount },
        { op: 'gainLife', target: 'controller', amount: 3 },
      ];
      assert(schema(source), JSON.stringify(schema.errors));
      const result = compilePack([...tokens, ...(token === plainAura ? [plainAura] : []), source]);
      assert.equal(result.ok, false);
      assert(result.diagnostics.some((d) => d.code === 'AURA_TOKEN_ENTRY'));
      const refs = { ...identities, [plainAura.id]: plainAura.name };
      const compiled = compileCard(source, { identities: refs });
      const auraDefinition = compileCard(token, { identities: refs }).definition;
      assert.equal(compiled.ok, true);
      assert.throws(
        () =>
          createRegistry({
            ...CARDS,
            [auraDefinition.name]: auraDefinition,
            [compiled.definition.name]: compiled.definition,
          }),
        /Aura token creation requires an explicit attached-token instruction/,
      );
    }
});
