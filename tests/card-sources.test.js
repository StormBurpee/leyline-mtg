import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import { compileCard, canonical } from '../packages/cards/compiler.js';
import { compilePack } from '../packages/cards/pack.js';
import { CARDS, CARD_IDS, resolveCardName, createRegistry } from '../packages/engine/src/index.js';
import { fixture, put, lands, act, resolve } from '../packages/engine/test/helpers.js';
const root = new URL('../packages/cards/', import.meta.url);
const mechanics = JSON.parse(await readFile(new URL('mechanics.json', root), 'utf8'));
const sourceFiles = (await readdir(new URL('cards/', root)))
  .filter((f) => f.endsWith('.json'))
  .sort();
const sources = await Promise.all(
  sourceFiles.map(async (f) => JSON.parse(await readFile(new URL(`cards/${f}`, root), 'utf8'))),
);
const hash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
function example(abilities) {
  return {
    schemaVersion: 1,
    id: 'test:compiler-fixture',
    name: 'Compiler fixture',
    characteristics: {
      types: ['creature'],
      manaCost: '{1}{R}',
      colors: ['R'],
      power: 1,
      toughness: 2,
    },
    abilities,
  };
}
test('every source card validates against the checked-in editor schema', async () => {
  const schema = JSON.parse(await readFile(new URL('schema/card.schema.json', root), 'utf8'));
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  for (const source of sources)
    assert.equal(validate(source), true, `${source.name}: ${JSON.stringify(validate.errors)}`);
});
test('the complete source pack compiles to the checked-in runtime catalog', () => {
  const result = compilePack(sources, { mechanics });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(
    canonical(Object.fromEntries(result.definitions.map((d) => [d.name, d]))),
    canonical(CARDS),
  );
  assert.deepEqual(canonical(result.index), canonical(CARD_IDS));
  for (const [id, name] of Object.entries(result.index)) assert.equal(resolveCardName(id), name);
});
test('pre-migration contracts change only their explicitly reviewed printed subtypes', async () => {
  const baseline = JSON.parse(
    await readFile(new URL('./fixtures/v05-card-contracts.json', import.meta.url), 'utf8'),
  );
  assert.equal(baseline.cards.length, 129);
  const corrections = JSON.parse(
    await readFile(
      new URL('./fixtures/printed-subtypes-reviewed-v023.json', import.meta.url),
      'utf8',
    ),
  );
  const byName = new Map(corrections.map((row) => [row.name, row]));
  assert.equal(byName.size, corrections.length);
  for (const row of corrections) {
    assert.deepEqual(CARDS[row.name].subtypes, row.subtypes, row.name);
    assert.deepEqual(row.oldSubtypes, []);
    assert.ok(row.subtypes.length > 0);
    if (row.evidence.kind === 'scryfall') {
      assert.equal(CARD_IDS[row.evidence.oracleId], row.name);
      assert.deepEqual(row.evidence.typeLine.split(' — ')[1].split(' '), row.subtypes);
      assert.ok(row.evidence.releasedAt <= '2026-10-26');
    } else assert.ok(row.evidence.rulesText.includes(row.subtypes[0]));
  }
  // Keep every original hash. Only the recorded subtype correction is normalized;
  // costs, effects, stats, keywords and all other fields still match exactly.
  for (const contract of baseline.cards) {
    const current = CARDS[contract.name],
      correction = byName.get(contract.name);
    assert.equal(
      hash(correction ? { ...current, subtypes: correction.oldSubtypes } : current),
      contract.sha256,
      contract.name,
    );
  }
});
test('mechanic arguments are substituted as data and unsupported instructions are explicit', () => {
  const card = example([{ use: 'landfall.grow', args: { power: 2, toughness: 3 } }]);
  const result = compileCard(card, { mechanics });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.definition.triggers[0].effects, [
    { op: 'modify', subject: 'source', power: 2, toughness: 3 },
  ]);
  const bad = compileCard(
    example([
      {
        kind: 'triggered',
        on: { event: 'enter', object: 'source' },
        effects: [{ op: 'executeJavaScript', source: 'process.exit()' }],
      },
    ]),
    { mechanics },
  );
  assert.equal(bad.ok, false);
  assert.ok(bad.diagnostics.some((d) => d.code === 'UNSUPPORTED_EFFECT'));
});
test('parameter bounds, unknown arguments and recursive mechanics fail closed', () => {
  for (const ability of [
    { use: 'landfall.grow', args: { power: 2000, toughness: 1 } },
    { use: 'prowess', args: { extra: 1 } },
    { use: 'missing' },
  ])
    assert.equal(compileCard(example([ability]), { mechanics }).ok, false);
  const cyclic = { loop: { parameters: {}, abilities: [{ use: 'loop' }] } };
  assert.ok(
    compileCard(example([{ use: 'loop' }]), { mechanics: cyclic }).diagnostics.some(
      (d) => d.code === 'MECHANIC_CYCLE',
    ),
  );
});
test('pack linking rejects duplicates and dangling token identities', () => {
  const card = example([]);
  assert.equal(compilePack([card, card]).ok, false);
  const tokenSpell = {
    ...example([
      { kind: 'spell', effects: [{ op: 'createToken', token: 'test:missing', amount: 1 }] },
    ]),
    characteristics: { types: ['sorcery'], manaCost: '{R}' },
  };
  const result = compilePack([tokenSpell]);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((d) => d.code === 'UNKNOWN_TOKEN'));
});
test('callbacks, accessors and cyclic source objects never become executable rules', () => {
  let invoked = 0;
  const source = example([]);
  Object.defineProperty(source, 'name', {
    enumerable: true,
    get() {
      invoked++;
      return 'bad';
    },
  });
  assert.equal(compileCard(source).ok, false);
  assert.equal(compilePack([source]).ok, false);
  assert.equal(invoked, 0);
  const cyclic = example([]);
  cyclic.abilities.push(cyclic);
  assert.equal(compileCard(cyclic).ok, false);
  assert.equal(
    compileCard(
      example([
        {
          kind: 'keyword',
          keyword: () => {
            invoked++;
          },
        },
      ]),
    ).ok,
    false,
  );
  assert.equal(invoked, 0);
});
test('a new red-spell trigger is defined entirely in data and executes without a new event enum', () => {
  const source = example([
    {
      kind: 'triggered',
      on: { event: 'cast', controller: 'you', filter: { color: 'R' } },
      effects: [{ op: 'draw', target: 'controller', amount: 1 }],
    },
  ]);
  const compiled = compileCard(source);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  let s = fixture();
  s.catalog = createRegistry({ ...CARDS, [source.name]: compiled.definition });
  put(s, source.name);
  lands(s, 'Mountain', 1);
  const bolt = put(s, 'Lightning Bolt', 0, 'hand');
  s = act(s, 'cast', { card: bolt.id, target: { kind: 'player', id: 1 } });
  assert.equal(s.stack.length, 2);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(s.players[1].life, 20);
});
test('composed targeting from a source file controls legality and resolution', () => {
  const source = {
    schemaVersion: 1,
    id: 'test:selective-removal',
    name: 'Selective removal fixture',
    characteristics: { types: ['instant'], manaCost: '{W}', colors: ['W'] },
    abilities: [
      {
        kind: 'spell',
        target: {
          scope: 'permanent',
          where: {
            all: [
              { type: 'creature' },
              { controller: 'opponent' },
              { tapped: true },
              { power: { lte: 2 } },
            ],
          },
        },
        effects: [{ op: 'destroy', target: 'target' }],
      },
    ],
  };
  const compiled = compileCard(source);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  let s = fixture();
  s.catalog = createRegistry({ ...CARDS, [source.name]: compiled.definition });
  lands(s, 'Plains', 1);
  const bear = put(s, 'Grizzly Bears', 1),
    spell = put(s, source.name, 0, 'hand');
  bear.tapped = true;
  s = resolve(
    act(s, 'cast', {
      card: spell.id,
      target: { kind: 'object', id: bear.id, incarnation: bear.incarnation },
    }),
  );
  assert.equal(s.objects[bear.id].zone, 'graveyard');
});

test('malformed JSON identities and ability references produce diagnostics, not coercion errors', () => {
  for (const changed of [
    { id: { toString: 'not a function' } },
    { name: { toString: 'not a function' } },
    { abilities: [{ use: { toString: 'bad' } }] },
    { abilities: [{ kind: { toString: 'bad' } }] },
  ]) {
    const source = { ...example([]), ...changed };
    assert.doesNotThrow(() => compileCard(source));
    assert.equal(compileCard(source).ok, false);
    assert.equal(compilePack([source]).ok, false);
  }
});
test('unsupported supertypes remain represented in source but cannot become vanilla runtime cards', () => {
  const source = example([]);
  source.characteristics.supertypes = ['snow'];
  const result = compileCard(source);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((d) => d.code === 'UNSUPPORTED_SUPERTYPE'));
});

test('source compilation can bootstrap without a generated runtime catalog', async () => {
  const { mkdtemp, mkdir, writeFile, cp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join, dirname } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'leyline-source-bootstrap-'));
  try {
    await writeFile(join(dir, 'package.json'), '{"type":"module"}');
    for (const path of [
      'packages/cards/compiler.js',
      'packages/cards/json-data.js',
      'packages/engine/src/definition-validation.js',
      'packages/engine/src/condition-schema.js',
      'packages/engine/src/target-group-schema.js',
      'packages/engine/src/value-schema.js',
      'packages/engine/src/types.js',
      'packages/engine/src/creature-types.js',
      'packages/engine/src/selectors.js',
      'packages/engine/src/events.js',
    ]) {
      const dest = join(dir, path);
      await mkdir(dirname(dest), { recursive: true });
      await cp(new URL(`../${path}`, import.meta.url), dest);
    }
    await writeFile(
      join(dir, 'run.mjs'),
      `import {compileCard} from './packages/cards/compiler.js';const result=compileCard(${JSON.stringify(example([]))});if(!result.ok)throw new Error(JSON.stringify(result.diagnostics));`,
    );
    const result = spawnSync(process.execPath, [join(dir, 'run.mjs')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('targeted ETB sources compile without losing the selector into legacy etb shorthand', () => {
  const result = compileCard(
    example([
      {
        kind: 'triggered',
        on: { event: 'enter', object: 'source' },
        target: { scope: 'damageable' },
        effects: [{ op: 'damage', target: 'target', amount: 2 }],
      },
    ]),
  );
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.definition.etb, undefined);
  assert.ok(result.definition.triggers[0].target);
  const state = fixture();
  state.catalog = createRegistry({ ...CARDS, [result.definition.name]: result.definition });
  lands(state, 'Mountain', 2);
  const object = put(state, result.definition.name, 0, 'hand');
  const next = resolve(act(state, 'cast', { card: object.id }));
  assert.equal(next.choice.kind, 'triggerTarget');
});

test('legendary permanent sources preserve the supertype rather than becoming vanilla', () => {
  const source = example([]);
  source.characteristics.supertypes = ['legendary'];
  const result = compileCard(source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.definition.legendary, true);
});
