import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseBotCommand } from '../packages/engine/src/index.js';
import { chooseSequence } from '../packages/engine/src/sequence-policy.js';
import { fixture, put, lands, act, resolve } from '../packages/engine/test/helpers.js';

test('plan two useful spells rather than a single expensive spell that strands mana', () => {
  let s = fixture();
  lands(s, 'Forest', 4);
  s.players[0].landsPlayed = 1;
  const spider = put(s, 'Giant Spider', 0, 'hand');
  const bear = put(s, 'Grizzly Bears', 0, 'hand');
  const visionary = put(s, 'Elvish Visionary', 0, 'hand');
  const before = structuredClone(s);
  const first = chooseBotCommand(s, 0);
  assert.notEqual(first.card, spider.id);
  assert.ok([bear.id, visionary.id].includes(first.card));
  assert.deepEqual(s, before);
  s = resolve(act(s, 'cast', first));
  while (s.stack.length) s = resolve(s);
  const second = chooseBotCommand(s, 0);
  assert.ok([bear.id, visionary.id].includes(second.card));
  assert.notEqual(first.card, second.card);
  assert.equal(act(s, 'cast', second).stack.at(-1).source.id, second.card);
});

test('search recognizes a known two-spell lethal line before nonlethal development', () => {
  const s = fixture();
  lands(s, 'Mountain', 3);
  put(s, 'Brazen Scourge', 0, 'hand');
  const bolt = put(s, 'Lightning Bolt', 0, 'hand');
  const shock = put(s, 'Shock', 0, 'hand');
  s.players[1].life = 5;
  const action = chooseBotCommand(s, 0);
  assert.ok([bolt.id, shock.id].includes(action.card));
  assert.deepEqual(action.target, { kind: 'player', id: 1 });
});

test('creature development values board impact rather than printed mana expenditure', () => {
  const s = fixture();
  lands(s, 'Forest', 4);
  const bear = put(s, 'Grizzly Bears', 0, 'hand');
  const spider = put(s, 'Giant Spider', 0, 'hand');
  // Equally affordable fixture bodies: the higher-cost 1/1 must not beat a 4/4.
  s.catalog = {
    ...s.catalog,
    'Grizzly Bears': { ...s.catalog['Grizzly Bears'], power: 4, toughness: 4 },
    'Giant Spider': { ...s.catalog['Giant Spider'], power: 1, toughness: 1, keywords: [] },
  };
  assert.equal(chooseBotCommand(s, 0).card, bear.id);
  assert.notEqual(chooseBotCommand(s, 0).card, spider.id);
});

test('resource search follows actual automatic payments rather than summed mana costs', () => {
  const s = fixture();
  lands(s, 'Island', 1);
  lands(s, 'Mountain', 1);
  const generic = put(s, 'Grizzly Bears', 0, 'hand');
  const blue = put(s, 'Opt', 0, 'hand');
  // Fixture candidates use an explicit generic cost to expose the source-order issue.
  s.catalog = {
    ...s.catalog,
    'Grizzly Bears': { ...s.catalog['Grizzly Bears'], cost: { generic: 1 } },
  };
  const plan = chooseSequence(s, 0, [
    { a: { type: 'cast', card: generic.id }, score: 8 },
    { a: { type: 'cast', card: blue.id }, score: 5 },
  ]);
  assert.equal(plan.action.card, blue.id);
  assert.equal(plan.actions.length, 2);
  assert.ok(plan.examined <= 256);
});

test('search cannot score repeated modes or targets as extra copies of the same card', () => {
  const s = fixture();
  lands(s, 'Mountain', 3);
  const shock = put(s, 'Shock', 0, 'hand');
  const bolt = put(s, 'Lightning Bolt', 0, 'hand');
  const bear = put(s, 'Grizzly Bears', 1);
  const target = { kind: 'object', id: bear.id, incarnation: bear.incarnation };
  const plan = chooseSequence(s, 0, [
    { a: { type: 'cast', card: shock.id, target }, score: 20 },
    { a: { type: 'cast', card: bolt.id, target }, score: 20 },
  ]);
  assert.equal(plan.actions.length, 1);
});

test('sequence search respects a strict deterministic node budget', () => {
  const s = fixture();
  lands(s, 'Mountain', 8);
  const cards = Array.from({ length: 8 }, () => put(s, 'Raging Goblin', 0, 'hand'));
  const plan = chooseSequence(
    s,
    0,
    cards.map((o) => ({ a: { type: 'cast', card: o.id }, score: 6 })),
    { budget: 7 },
  );
  assert.equal(plan.examined, 7);
  assert.equal(new Set(plan.actions.map((a) => a.card)).size, plan.actions.length);
});

test('target-rich removal candidates do not crowd out a burn lethal sequence', () => {
  const s = fixture();
  lands(s, 'Mountain', 2);
  s.players[1].life = 5;
  const bolt = put(s, 'Lightning Bolt', 0, 'hand');
  const shock = put(s, 'Shock', 0, 'hand');
  const creatures = Array.from({ length: 30 }, () => put(s, 'Grizzly Bears', 1));
  const ranked = creatures.map((o) => ({
    a: { type: 'cast', card: bolt.id, target: { kind: 'object', id: o.id } },
    score: 20,
  }));
  ranked.push(
    ...[bolt, shock].map((o) => ({
      a: { type: 'cast', card: o.id, target: { kind: 'player', id: 1 } },
      score: 2,
    })),
  );
  const plan = chooseSequence(s, 0, ranked);
  assert.equal(plan.actions.length, 2);
  assert.ok(plan.actions.every((a) => a.target.kind === 'player'));
});

test('sequences reserve ward mana rather than promising it to another spell', () => {
  const s = fixture();
  lands(s, 'Mountain', 2);
  const shock = put(s, 'Shock', 0, 'hand');
  const goblin = put(s, 'Raging Goblin', 0, 'hand');
  const bear = put(s, 'Grizzly Bears', 1);
  s.catalog = {
    ...s.catalog,
    'Grizzly Bears': { ...s.catalog['Grizzly Bears'], ward: { mana: { generic: 1 } } },
  };
  const plan = chooseSequence(s, 0, [
    { a: { type: 'cast', card: shock.id, target: { kind: 'object', id: bear.id } }, score: 20 },
    { a: { type: 'cast', card: goblin.id }, score: 6 },
  ]);
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.action.card, shock.id);
});

test('policy decisions do not access hidden zones, seed, RNG or privileged evaluation data', () => {
  const s = fixture();
  lands(s, 'Forest', 4);
  put(s, 'Giant Spider', 0, 'hand');
  put(s, 'Grizzly Bears', 0, 'hand');
  put(s, 'Elvish Visionary', 0, 'hand');
  const expected = chooseBotCommand(s, 0);
  for (const p of s.players) {
    p.libraryCount = p.library.length;
    p.handCount = p.hand.length;
    Object.defineProperty(p, 'library', {
      enumerable: false,
      get() {
        throw new Error('concealed library read');
      },
    });
  }
  Object.defineProperty(s.players[1], 'hand', {
    enumerable: false,
    get() {
      throw new Error('opposing hand read');
    },
  });
  for (const key of ['seed', 'rng', 'config', 'history', 'events'])
    Object.defineProperty(s, key, {
      enumerable: false,
      get() {
        throw new Error(`privileged ${key} read`);
      },
    });
  assert.deepEqual(chooseBotCommand(s, 0), expected);
});
