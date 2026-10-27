import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry, ref } from '../src/index.js';
import { fixture, put, act, resolve } from './helpers.js';
function setup(filter) {
  const s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Group Observer': {
      name: 'Group Observer',
      type: 'enchantment',
      cost: {},
      keywords: [],
      triggers: [
        {
          event: { event: 'attackGroup', controller: 'you', filter },
          effects: [{ op: 'gainLife', amount: 1 }],
        },
      ],
    },
  });
  put(s, 'Group Observer');
  return s;
}
function attack(s, cards) {
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: 0 };
  return act(s, 'attackers', { cards });
}
test('attackGroup uses current power and toughness, once for several matching attackers', () => {
  let s = setup({ all: [{ power: { gte: 4 } }, { toughness: { gte: 4 } }] });
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears');
  a.plusCounters = 2;
  b.plusCounters = 2;
  s = attack(s, [a.id, b.id]);
  assert.equal(s.stack.length, 1);
  // Later changes cannot alter the committed group's occurrence.
  s.objects[a.id].plusCounters = 0;
  s.combat.attackers = [];
  s = resolve(s);
  assert.equal(s.players[0].life, 21);
});
test('attackGroup sees granted keywords and current controller rather than printed keywords', () => {
  let s = setup({ all: [{ keyword: 'flying' }, { controller: 'you' }] });
  const a = put(s, 'Grizzly Bears');
  s.modifiers.push({
    objectId: a.id,
    incarnation: a.incarnation,
    expires: s.turn,
    power: 0,
    toughness: 0,
    keywords: ['flying'],
  });
  s = attack(s, [a.id]);
  assert.equal(s.stack.length, 1);
});
test('attackGroup rejects nonmatching numeric facts and keeps legacy subtype matching', () => {
  let s = setup({ power: { gte: 4 } });
  const a = put(s, 'Grizzly Bears');
  s = attack(s, [a.id]);
  assert.equal(s.stack.length, 0);
  s = setup({ subtype: 'Bear' });
  const b = put(s, 'Grizzly Bears');
  s = attack(s, [b.id]);
  assert.equal(s.stack.length, 1);
});

test('face-down attacker group facts expose only public 2/2 colorless characteristics', () => {
  for (const [filter, matches] of [
    [
      {
        all: [
          { power: { eq: 2 } },
          { toughness: { eq: 2 } },
          { color: 'colorless' },
          { not: { keyword: 'flying' } },
        ],
      },
      true,
    ],
    [{ name: 'Serra Angel' }, false],
    [{ keyword: 'flying' }, false],
    [{ color: 'W' }, false],
    [{ power: { eq: 4 } }, false],
  ]) {
    let s = setup(filter);
    const hidden = put(s, 'Serra Angel');
    hidden.faceDown = true;
    const start = s.events.length;
    s = attack(s, [hidden.id]);
    assert.equal(s.stack.length, matches ? 1 : 0, JSON.stringify(filter));
    assert.equal(JSON.stringify(s.events.slice(start)).includes('Serra Angel'), false);
  }
});
