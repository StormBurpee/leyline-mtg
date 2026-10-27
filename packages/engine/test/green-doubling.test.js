import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, put, act, resolve, lands } from './helpers.js';
import { stats, ref, move } from '../src/model.js';
import { enterBattlefieldBatch, resolveEffects } from '../src/effects.js';
import { validateDefinition } from '../src/definition-validation.js';
import { CARDS } from '../src/index.js';

test('Hydra enters with its counter before SBA and landfall doubles current counters', () => {
  const s = fixture(),
    hydra = put(s, 'Mossborn Hydra', 0, 'hand');
  enterBattlefieldBatch(s, [{ object: hydra }]);
  assert.equal(hydra.plusCounters, 1);
  const forest = put(s, 'Forest', 0, 'hand');
  enterBattlefieldBatch(s, [{ object: forest }]);
  assert.equal(s.pendingTriggers.length, 1);
  hydra.plusCounters = 3;
  resolveEffects(s, s.pendingTriggers.pop());
  assert.equal(hydra.plusCounters, 6);
});
test('Bill doubles each controlled creature independently, excludes lands and enemy creatures', () => {
  const s = fixture(),
    bill = put(s, 'Bristly Bill, Spine Sower'),
    elf = put(s, 'Llanowar Elves'),
    enemy = put(s, 'Llanowar Elves', 1),
    land = put(s, 'Forest');
  bill.plusCounters = 2;
  elf.plusCounters = 0;
  enemy.plusCounters = 3;
  land.plusCounters = 4;
  resolveEffects(s, {
    controller: 0,
    source: ref(bill),
    effects: CARDS[bill.name].activated[0].effects,
  });
  assert.deepEqual(
    [bill.plusCounters, elf.plusCounters, enemy.plusCounters, land.plusCounters],
    [4, 0, 3, 4],
  );
});
test('Tifa doubles actual power at resolution, stacks additively, and respects old incarnation', () => {
  const s = fixture(),
    tifa = put(s, 'Tifa Lockhart');
  tifa.plusCounters = 2;
  const entry = {
    controller: 0,
    source: ref(tifa),
    effects: [{ op: 'doublePower', subject: 'source' }],
  };
  resolveEffects(s, entry);
  assert.equal(stats(s, tifa).power, 6);
  resolveEffects(s, entry);
  assert.equal(stats(s, tifa).power, 12);
  tifa.plusCounters++;
  assert.equal(stats(s, tifa).power, 13);
  move(s, tifa, 'hand');
  enterBattlefieldBatch(s, [{ object: tifa }]);
  resolveEffects(s, entry);
  assert.equal(stats(s, tifa).power, 1);
});
test('doubling zero and negative power follows signed power rather than clamping', () => {
  const s = fixture(),
    tifa = put(s, 'Tifa Lockhart');
  s.modifiers.push({
    objectId: tifa.id,
    incarnation: tifa.incarnation,
    power: -3,
    toughness: 0,
    keywords: [],
    expires: s.turn,
  });
  resolveEffects(s, {
    controller: 0,
    source: ref(tifa),
    effects: [{ op: 'doublePower', subject: 'source' }],
  });
  assert.equal(stats(s, tifa).power, -4);
});
test('doubling opcodes reject invalid target, subject and group definitions', () => {
  for (const effect of [
    { op: 'doublePower' },
    { op: 'doublePower', subject: 'bogus' },
    { op: 'doubleCounters', where: { wat: 1 } },
  ])
    assert.ok(validateDefinition({ ...CARDS['Forest'], effects: [effect] }).length);
});

test('generic doubling predicates see full public permanent facts', () => {
  const s = fixture(),
    a = put(s, 'Llanowar Elves'),
    b = put(s, 'Llanowar Elves');
  a.plusCounters = 1;
  b.plusCounters = 1;
  a.tapped = true;
  resolveEffects(s, {
    controller: 0,
    source: ref(a),
    effects: [
      { op: 'doubleCounters', where: { all: [{ tapped: true }, { manaValue: { eq: 1 } }] } },
    ],
  });
  assert.equal(a.plusCounters, 2);
  assert.equal(b.plusCounters, 1);
});
