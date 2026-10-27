import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CARDS, createRegistry, definition, dispatch, ref, stats } from '../src/index.js';
import { addModifier, move, loseLife } from '../src/model.js';
import { enterBattlefieldBatch, resolveEffects, stabilize } from '../src/effects.js';
import { compileCard } from '../../cards/compiler.js';
import { fixture, put, lands, act, resolve } from './helpers.js';

const replacements = [
  'caradora-heart-of-alacria',
  'michelangelo-weirdness-to-11',
  'yoshimaru-beloved-companion',
].map((slug) => {
  const source = JSON.parse(
    fs.readFileSync(new URL(`../../cards/cards/${slug}.json`, import.meta.url)),
  );
  const compiled = compileCard(source, {
    identities: { 'leyline:token/mutagen-token': 'Mutagen Token' },
  });
  assert.ok(compiled.ok, JSON.stringify(compiled.diagnostics));
  return compiled.definition;
});
const names = replacements.map((d) => d.name);
function setup(...extra) {
  const s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    ...Object.fromEntries([...replacements, ...extra].map((d) => [d.name, d])),
  });
  return s;
}
function effect(s, source, effects, target = source) {
  resolveEffects(s, {
    name: source.name,
    kind: 'ability',
    controller: source.controller,
    source: ref(source),
    target: ref(target),
    effects,
  });
}
function reject(s, command, code) {
  const before = structuredClone(s);
  const result = dispatch(s, { player: s.choice?.player ?? s.priority, ...command });
  assert.equal(result.ok, false);
  if (code) assert.equal(result.error.code, code);
  assert.deepEqual(s, before);
}

test('review: entry uses prospective control, including stolen entrants and fixed entry counters', () => {
  const native = { ...CARDS['Grizzly Bears'], name: 'Fixed Entry Review', entryPlusCounters: 2 };
  const s = setup(native);
  for (const name of names) put(s, name);
  const stolen = put(s, native.name, 1, 'graveyard');
  const donated = put(s, native.name, 0, 'graveyard');
  enterBattlefieldBatch(s, [
    { object: stolen, controller: 0 },
    { object: donated, controller: 1 },
  ]);
  assert.equal(stolen.owner, 1);
  assert.equal(stolen.plusCounters, 5);
  assert.equal(donated.owner, 0);
  assert.equal(donated.plusCounters, 2);
});

test('review: multiple simultaneous replacement entrants see only preexisting Gev and replacement sources', () => {
  for (const reverse of [false, true]) {
    const s = setup();
    put(s, 'Gev, Scaled Scorch');
    put(s, names[0]);
    loseLife(s, 1, 1);
    const entries = names.slice(1).map((name) => ({ object: put(s, name, 0, 'graveyard') }));
    enterBattlefieldBatch(s, reverse ? [...entries].reverse() : entries);
    assert.deepEqual(
      entries.map(({ object }) => object.plusCounters),
      [2, 2],
    );
    const bear = put(s, 'Grizzly Bears');
    effect(s, bear, [{ op: 'counterOn', amount: 1 }]);
    assert.equal(bear.plusCounters, 4);
  }
});

test('review: ability loss is not copied and a token copy does not inherit source counters', () => {
  const s = setup();
  const original = put(s, names[0]);
  original.plusCounters = 8;
  addModifier(s, {
    objectId: original.id,
    incarnation: original.incarnation,
    removeAbilities: true,
    expires: s.turn,
  });
  effect(s, original, [{ op: 'copyToken', count: 1, exceptions: { nonlegendary: true } }]);
  const copy = Object.values(s.objects).find((o) => o.token && o.name === original.name);
  assert.equal(definition(s, original).plusCounterBonus, undefined);
  assert.deepEqual(definition(s, copy).plusCounterBonus, replacements[0].plusCounterBonus);
  assert.equal(copy.plusCounters, 0);
  effect(s, original, [{ op: 'counterOn', amount: 1 }]);
  assert.equal(original.plusCounters, 10, 'only the newly created copy supplies a bonus');
});

test('review: lethal negative counters do not remove a replacement source between instructions', () => {
  const s = setup();
  const source = put(s, names[0]);
  const bear = put(s, 'Grizzly Bears');
  effect(
    s,
    source,
    [
      { op: 'counterOn', subject: 'source', counter: '-1/-1', amount: 2 },
      { op: 'counterOn', amount: 1 },
    ],
    bear,
  );
  assert.equal(stats(s, source).toughness, 0);
  assert.equal(bear.plusCounters, 2);
  stabilize(s);
  assert.equal(source.zone, 'graveyard');
  effect(s, bear, [{ op: 'counterOn', amount: 1 }]);
  assert.equal(bear.plusCounters, 3);
});

test('review: real distributed X spell keeps locked allocations when one target leaves', () => {
  let s = setup();
  put(s, names[0]);
  const first = put(s, 'Grizzly Bears');
  const second = put(s, 'Grizzly Bears');
  const spell = put(s, "Elusive Otter // Grove's Bounty", 0, 'hand');
  lands(s, 'Forest', 4);
  const targets = { distributed: [ref(first), ref(second)] };
  const distribution = { [first.id]: 2, [second.id]: 1 };
  reject(s, {
    type: 'cast',
    card: spell.id,
    mode: 1,
    x: 3,
    targets,
    distribution: { [first.id]: 3, [second.id]: 0 },
  });
  s = act(s, 'cast', { card: spell.id, mode: 1, x: 3, targets, distribution });
  move(s, s.objects[second.id], 'exile');
  s = resolve(s);
  assert.equal(s.objects[first.id].plusCounters, 3);
  assert.equal(s.objects[second.id].plusCounters, 0);
  assert.equal(s.objects[spell.id].zone, 'exile');
});

test('review: two grouped instructions on one recipient are two replacement events', () => {
  const spellDef = {
    name: 'Grouped Counter Review',
    type: 'sorcery',
    cost: {},
    targetGroups: [
      { id: 'first', selector: 'creature', min: 1, max: 1 },
      { id: 'second', selector: 'creature', min: 1, max: 2 },
    ],
    effects: [
      { op: 'counterOn', amount: 1, targetGroup: 'first' },
      { op: 'counterOn', amount: 2, targetGroup: 'second' },
    ],
  };
  let s = setup(spellDef);
  put(s, names[0]);
  const bear = put(s, 'Grizzly Bears');
  const enemy = put(s, 'Grizzly Bears', 1);
  const spell = put(s, spellDef.name, 0, 'hand');
  s = resolve(
    act(s, 'cast', {
      card: spell.id,
      targets: { first: [ref(bear)], second: [ref(bear), ref(enemy)] },
    }),
  );
  assert.equal(s.objects[bear.id].plusCounters, 5);
  assert.equal(s.objects[enemy.id].plusCounters, 2);
});

test('review: grouped overflow rolls back earlier recipients and the pending stack resolution', () => {
  const spellDef = {
    name: 'Counter Overflow Review',
    type: 'sorcery',
    cost: {},
    effects: [{ op: 'counterAll', where: { type: 'creature' }, amount: 1 }],
  };
  let s = setup(spellDef);
  put(s, names[0]);
  const first = put(s, 'Grizzly Bears');
  const overflowing = put(s, 'Grizzly Bears');
  overflowing.plusCounters = Number.MAX_SAFE_INTEGER - 1;
  const spell = put(s, spellDef.name, 0, 'hand');
  s = act(s, 'cast', { card: spell.id });
  s = act(s, 'pass');
  reject(s, { type: 'pass' }, 'COUNTER_RANGE');
  assert.equal(s.objects[first.id].plusCounters, 0);
});

test('review: connive overflow rolls back the chosen discard and preserves the outstanding choice', () => {
  let s = setup();
  put(s, names[0]);
  const bear = put(s, 'Grizzly Bears');
  bear.plusCounters = Number.MAX_SAFE_INTEGER - 1;
  const discard = put(s, 'Grizzly Bears', 0, 'hand');
  effect(s, bear, [{ op: 'connive' }]);
  assert.equal(s.choice.kind, 'discardEffect');
  reject(s, { type: 'discardEffect', cards: [discard.id] }, 'COUNTER_RANGE');
  assert.equal(s.objects[discard.id].zone, 'hand');
  assert.equal(s.choice.kind, 'discardEffect');
});

test('review: earthbend overflow rolls back animation and delayed return registration', () => {
  let s = setup();
  put(s, names[1]);
  const land = put(s, 'Ba Sing Se');
  land.plusCounters = Number.MAX_SAFE_INTEGER - 2;
  lands(s, 'Forest', 3);
  s = act(s, 'activate', { card: land.id, ability: 0, target: ref(land) });
  s = act(s, 'pass');
  reject(s, { type: 'pass' }, 'COUNTER_RANGE');
  assert.equal(definition(s, s.objects[land.id]).type, 'land');
  assert.equal(s.earthbendReturns?.length ?? 0, 0);
});

test('review: enchantment-only former Vehicles receive no Vehicle bonus at entry or later placement', () => {
  const native = {
    ...CARDS['Careening Mine Cart'],
    name: 'Vehicle Counter Entry Review',
    entryPlusCounters: 2,
  };
  const s = setup(native);
  put(s, names[0]);
  const vehicle = put(s, native.name, 0, 'graveyard');
  enterBattlefieldBatch(s, [{ object: vehicle, enchantmentOnly: true }]);
  assert.deepEqual(definition(s, vehicle).types, ['enchantment']);
  assert.equal(vehicle.plusCounters, 2, 'CR 205.1a removes artifact-subtype eligibility');
  effect(s, vehicle, [{ op: 'counterOn', amount: 1 }]);
  assert.equal(vehicle.plusCounters, 3);
  addModifier(s, {
    objectId: vehicle.id,
    incarnation: vehicle.incarnation,
    addTypes: ['creature'],
    expires: s.turn,
  });
  effect(s, vehicle, [{ op: 'counterOn', amount: 1 }]);
  assert.equal(vehicle.plusCounters, 5, 'a later animation qualifies as a creature, not a Vehicle');
});
