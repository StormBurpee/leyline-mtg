import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  targetsFor,
  legalTarget,
  ref,
  dispatch,
  validateTargetSpec,
  validateFilter,
  targetSpec,
} from '../src/index.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
const smallTappedEnemy = {
  scope: 'permanent',
  where: {
    all: [
      { type: 'creature' },
      { controller: 'opponent' },
      { tapped: true },
      { power: { lte: 2 } },
      { manaValue: { lte: 3 } },
    ],
  },
};
test('composed selectors combine type, controller, state and numeric constraints', () => {
  const s = fixture(),
    valid = put(s, 'Grizzly Bears', 1),
    own = put(s, 'Grizzly Bears'),
    large = put(s, 'Colossal Dreadmaw', 1),
    awake = put(s, 'Grizzly Bears', 1);
  valid.tapped = own.tapped = large.tapped = true;
  assert.deepEqual(targetsFor(s, smallTappedEnemy, 0), [ref(valid)]);
  assert.equal(legalTarget(s, smallTappedEnemy, ref(awake), 0), false);
});
test('generic selectors use current derived power rather than printed power', () => {
  const s = fixture(),
    bear = put(s, 'Grizzly Bears', 1);
  bear.tapped = true;
  assert.equal(legalTarget(s, smallTappedEnemy, ref(bear), 0), true);
  put(s, 'Glorious Anthem', 1);
  assert.equal(legalTarget(s, smallTappedEnemy, ref(bear), 0), false);
});
test('a data-defined selector is rechecked at spell resolution', () => {
  let s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Selector fixture': {
      name: 'Selector fixture',
      type: 'instant',
      cost: {},
      target: smallTappedEnemy,
      effects: [{ op: 'destroy' }],
    },
  });
  const bear = put(s, 'Grizzly Bears', 1),
    spell = put(s, 'Selector fixture', 0, 'hand');
  bear.tapped = true;
  s = act(s, 'cast', { card: spell.id, target: ref(bear) });
  s.objects[bear.id].tapped = false;
  s = resolve(s);
  assert.equal(s.objects[bear.id].zone, 'battlefield');
  assert.ok(s.events.some((e) => e.type === 'fizzled'));
});
test('predicate composition preserves hexproof and shroud targeting restrictions', () => {
  const s = fixture(),
    bear = put(s, 'Grizzly Bears', 1);
  bear.tapped = true;
  s.modifiers.push({
    objectId: bear.id,
    incarnation: bear.incarnation,
    power: 0,
    toughness: 0,
    keywords: ['hexproof'],
    expires: s.turn,
  });
  assert.equal(targetsFor(s, smallTappedEnemy, 0).length, 0);
  assert.equal(
    legalTarget(s, { scope: 'permanent', where: { type: 'creature' } }, ref(bear), 1),
    true,
  );
});
test('legacy selectors lower to equivalent data queries', () => {
  const s = fixture();
  put(s, 'Ornithopter');
  put(s, 'Spirited Companion', 1);
  put(s, 'Grizzly Bears');
  put(s, 'Forest');
  for (const name of [
    'any',
    'player',
    'opponent',
    'creature',
    'nonblackCreature',
    'spell',
    'noncreatureSpell',
    'artifact',
    'enchantment',
    'artifactOrEnchantment',
    'permanent',
  ])
    assert.deepEqual(targetsFor(s, name, 0), targetsFor(s, targetSpec(name), 0), name);
});
test('spell selectors filter mana value and full printed type sets', () => {
  let s = fixture();
  lands(s, 'Mountain', 2);
  const artifact = put(s, 'Ornithopter', 0, 'hand');
  s = act(s, 'cast', { card: artifact.id });
  const spec = {
    scope: 'spell',
    where: { all: [{ type: 'artifact' }, { manaValue: { lte: 1 } }] },
  };
  assert.deepEqual(targetsFor(s, spec, 1), [{ kind: 'stack', id: s.stack[0].id }]);
});
test('malformed, executable-looking and oversized predicates fail before registration', () => {
  for (const spec of [
    { scope: 'library' },
    { scope: 'permanent', where: { type: 'creature', color: 'G' } },
    { scope: 'permanent', where: { javascript: 'process.exit()' } },
    { scope: 'permanent', where: { manaValue: { gte: NaN } } },
  ])
    assert.ok(validateTargetSpec(spec).length);
  const cycle = { not: null };
  cycle.not = cycle;
  assert.ok(validateFilter(cycle).length);
  assert.ok(validateFilter({ all: Array(33).fill({ type: 'creature' }) }).length);
});
test('effect validation rejects selectors that cannot be targets for that operation', () => {
  for (const [op, target, rest] of [
    ['destroy', { scope: 'player' }, {}],
    ['counter', { scope: 'permanent' }, {}],
    ['modify', { scope: 'permanent', where: { type: 'artifact' } }, { power: 1, toughness: 1 }],
    ['damage', { scope: 'permanent' }, { amount: 1 }],
  ])
    assert.throws(() =>
      createRegistry([
        {
          name: 'Incompatible selector',
          type: 'instant',
          cost: {},
          target,
          effects: [{ op, ...rest }],
        },
      ]),
    );
});
