import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry, stats, validateEventSpec } from '../src/index.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
test('battlefield anthems do not alter creature cards in hand or creature spells', () => {
  let s = fixture();
  put(s, 'Glorious Anthem');
  lands(s, 'Forest', 2);
  const bear = put(s, 'Grizzly Bears', 0, 'hand');
  assert.equal(stats(s, bear).power, 2);
  s = act(s, 'cast', { card: bear.id });
  assert.equal(stats(s, s.objects[bear.id]).power, 2);
  s = resolve(s);
  assert.equal(stats(s, s.objects[bear.id]).power, 3);
});
test('generic cast predicates use spell characteristics rather than battlefield anthem bonuses', () => {
  let s = fixture();
  const name = 'Power watcher';
  s.catalog = createRegistry({
    ...CARDS,
    [name]: {
      name,
      type: 'creature',
      cost: {},
      power: 1,
      toughness: 1,
      triggers: [
        {
          event: {
            event: 'cast',
            controller: 'you',
            filter: { all: [{ type: 'creature' }, { power: { gte: 3 } }] },
          },
          effects: [{ op: 'draw', count: 1 }],
        },
      ],
    },
  });
  put(s, name);
  put(s, 'Glorious Anthem');
  lands(s, 'Forest', 5);
  const bear = put(s, 'Grizzly Bears', 0, 'hand');
  s = act(s, 'cast', { card: bear.id });
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  const courser = put(s, 'Centaur Courser', 0, 'hand');
  s = act(s, 'cast', { card: courser.id });
  assert.equal(s.stack.length, 2);
});
test('unsupported event families and unknown predicates stay explicit', () => {
  for (const value of [
    { event: 'dies' },
    { event: 'cast', oncePerTurn: true },
    { event: 'enter', object: 'source', excludeSource: true },
    { event: 'cast', filter: { unknown: true } },
  ])
    assert.ok(validateEventSpec(value).length);
});
