import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  validateDefinition,
  createGame,
  dispatch,
  exportReplay,
  replay,
  definition,
  stats,
  ref,
  legalActions,
  RegistryError,
} from '../src/index.js';
import { compileForgeCard } from '../../forge-import/compile.js';
import { addObject, move } from '../src/model.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
const adept = {
  name: 'Registry Test Adept',
  type: 'creature',
  cost: { U: 1 },
  power: 1,
  toughness: 2,
  keywords: ['flash'],
  text: 'Test fixture, not an official Magic card.',
};
test('custom registry is deeply immutable and never changes global defaults', () => {
  const registry = createRegistry([...Object.values(CARDS), adept]);
  assert.ok(registry[adept.name]);
  assert.equal(CARDS[adept.name], undefined);
  assert.throws(() => {
    registry[adept.name].cost.U = 9;
  }, TypeError);
});
test('invalid definitions fail before game construction', () => {
  for (const bad of [
    { ...adept, keywords: ['ward 2'] },
    { ...adept, unknownMechanic: true },
    { ...adept, cost: { X: 1 } },
    { ...adept, activated: [{ cost: { sacrifice: true }, effects: [] }] },
  ])
    assert.throws(() => createGame({ catalog: [...Object.values(CARDS), bad] }), RegistryError);
});
test('missing token references and unknown opcodes are rejected', () => {
  for (const effects of [
    [{ op: 'token', definition: 'Missing Token', count: 1 }],
    [{ op: 'runJavaScript', source: 'arbitrary()' }],
  ])
    assert.throws(
      () => createRegistry([...Object.values(CARDS), { ...adept, etb: effects }]),
      RegistryError,
    );
});
test('bad effect targeting and numeric values fail closed', () => {
  for (const card of [
    { ...adept, etb: [{ op: 'damage', amount: 1 }] },
    { ...adept, etb: [{ op: 'draw', count: Infinity }] },
    { ...adept, power: NaN },
    { ...adept, cost: { U: -1 } },
  ])
    assert.ok(validateDefinition(card).length);
});
test('custom cards cast through ordinary commands, including flash', () => {
  let s = createGame({
    catalog: createRegistry([...Object.values(CARDS), adept]),
    mulligan: false,
  });
  s.step = 'main1';
  s.turn = 3;
  const card = addObject(s, adept.name, 1, 'hand');
  const land = addObject(s, 'Island', 1, 'battlefield');
  s = act(s, 'pass');
  s = act(s, 'cast', { card: card.id });
  s = resolve(s);
  assert.equal(s.objects[card.id].zone, 'battlefield');
  assert.equal(definition(s, s.objects[card.id]).name, adept.name);
});
test('replays embed their complete registry and preserve custom card behavior', () => {
  const catalog = createRegistry([...Object.values(CARDS), adept]);
  const decks = [
    Array(60).fill('Island'),
    [...Array(56).fill('Island'), ...Array(4).fill(adept.name)],
  ];
  let s = createGame({ catalog, decks, seed: 9 });
  s = act(s, 'keep');
  s = act(s, 'keep');
  const record = JSON.parse(JSON.stringify(exportReplay(s)));
  assert.equal(record.config.catalog[adept.name].power, 1);
  assert.deepEqual(replay(record), s);
  record.config.catalog[adept.name].etb = [{ op: 'unknown' }];
  assert.throws(() => replay(record), RegistryError);
});
test('a translated Forge candidate can execute without editing the built-in registry', () => {
  const result = compileForgeCard(
    'Name:Migration Test Bear\nManaCost:1 G\nTypes:Creature Bear\nPT:2/2\nOracle:',
  );
  assert.equal(result.status, 'candidate');
  const catalog = createRegistry([...Object.values(CARDS), result.definition]);
  let s = createGame({ catalog, mulligan: false });
  s.step = 'main1';
  s.turn = 3;
  const bear = addObject(s, result.name, 0, 'hand');
  lands(s, 'Forest', 2);
  s = act(s, 'cast', { card: bear.id });
  s = resolve(s);
  assert.deepEqual(stats(s, s.objects[bear.id]), { power: 2, toughness: 2 });
});
test('registry entries with duplicate names or reserved object keys are rejected', () => {
  assert.throws(() => createRegistry([adept, adept]), /Duplicate/);
  assert.throws(() => createRegistry([{ ...adept, name: '__proto__' }]), RegistryError);
});
test('hexproof permits your own target but rejects the opponent', () => {
  const card = { ...adept, name: 'Hexproof Test', keywords: ['hexproof'] };
  let s = createGame({ catalog: createRegistry([...Object.values(CARDS), card]), mulligan: false });
  s.step = 'main1';
  s.turn = 3;
  const target = addObject(s, card.name, 0, 'battlefield');
  const growth = addObject(s, 'Giant Growth', 0, 'hand');
  lands(s, 'Forest', 1);
  s = act(s, 'cast', { card: growth.id, target: ref(target) });
  s = resolve(s);
  const bolt = addObject(s, 'Lightning Bolt', 1, 'hand');
  lands(s, 'Mountain', 1, 1);
  s = act(s, 'pass');
  assert.equal(
    dispatch(s, { type: 'cast', player: 1, card: bolt.id, target: ref(s.objects[target.id]) }).ok,
    false,
  );
});
test('indestructible survives damage but not zero toughness', () => {
  const card = { ...adept, name: 'Indestructible Test', keywords: ['indestructible'] };
  let s = createGame({ catalog: createRegistry([...Object.values(CARDS), card]), mulligan: false });
  s.step = 'main1';
  s.turn = 3;
  const target = addObject(s, card.name, 1, 'battlefield'),
    bolt = addObject(s, 'Lightning Bolt', 0, 'hand');
  lands(s, 'Mountain', 1);
  s = act(s, 'cast', { card: bolt.id, target: ref(target) });
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'battlefield');
  s.modifiers.push({
    objectId: target.id,
    incarnation: s.objects[target.id].incarnation,
    power: 0,
    toughness: -2,
    expires: s.turn,
  });
  s = act(s, 'pass');
  assert.equal(s.objects[target.id].zone, 'graveyard');
});

test('a tap-cost source cannot also be auto-tapped to pay its own mana cost', () => {
  let s = fixture();
  const manaAdept = {
    ...adept,
    mana: 'U',
    activated: [{ cost: { mana: { U: 1 }, tap: true }, effects: [{ op: 'draw', count: 1 }] }],
  };
  s.catalog = createRegistry({ ...CARDS, [adept.name]: manaAdept });
  const source = put(s, adept.name);
  const r = dispatch(s, { type: 'activate', player: 0, card: source.id, ability: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.state, s);
  assert.equal(s.objects[source.id].tapped, false);
  lands(s, 'Island', 1);
  s = act(s, 'activate', { card: source.id, ability: 0 });
  assert.equal(s.objects[source.id].tapped, true);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 1);
});
test('malformed ability indices reject atomically rather than accessing array prototypes', () => {
  const s = fixture(),
    source = put(s, 'Shivan Dragon');
  for (const ability of ['__proto__', 'constructor', -1, 0.5, null]) {
    const result = dispatch(s, { type: 'activate', player: 0, card: source.id, ability });
    assert.equal(result.ok, false);
    assert.equal(result.state, s);
  }
});

test('prototype-named effect opcodes are ordinary registry errors', () => {
  for (const op of ['__proto__', 'constructor', 'toString']) {
    const invalid = { name: 'Bad opcode', type: 'sorcery', cost: {}, effects: [{ op }] };
    assert.ok(
      validateDefinition(invalid).some((message) => message.includes('unsupported effect opcode')),
    );
    assert.throws(() => createRegistry([invalid]), RegistryError);
  }
});

test('life is paid on activation before the ability resolves', () => {
  let s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    [adept.name]: {
      ...adept,
      activated: [{ cost: { life: 2 }, effects: [{ op: 'draw', count: 1 }] }],
    },
  });
  const source = put(s, adept.name);
  s = act(s, 'activate', { card: source.id, ability: 0 });
  assert.equal(s.players[0].life, 18);
  assert.equal(s.players[0].hand.length, 0);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 1);
});

test('registry capacity accommodates an Arena-scale catalog without a 5000-card ceiling', () => {
  const cards = Array.from({ length: 16000 }, (_, i) => ({
    ...adept,
    name: `Catalog fixture ${i}`,
  }));
  const catalog = createRegistry(cards);
  assert.equal(Object.keys(catalog).length, 16000);
  assert.equal(Object.isFrozen(catalog['Catalog fixture 15999']), true);
});
