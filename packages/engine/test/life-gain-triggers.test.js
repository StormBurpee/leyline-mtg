import test from 'node:test';
import assert from 'node:assert/strict';
import { ref, CARDS, createRegistry } from '../src/index.js';
import { dealDamageBatch, dealDamage, resolveEffects } from '../src/effects.js';
import { orderLifePayoffs } from '../src/combat-payoffs.js';
import { fixture, put } from './helpers.js';
const life = (s, amount, controller = 0) =>
  resolveEffects(s, { controller, effects: [{ op: 'gainLife', amount }] });
test('life gain triggers once per positive event, not per point or for zero', () => {
  const s = fixture();
  const cat = put(s, "Ajani's Pridemate");
  life(s, 3);
  assert.equal(s.pendingTriggers.length, 1);
  resolveEffects(s, s.pendingTriggers.pop());
  assert.equal(s.objects[cat.id].plusCounters, 1);
  life(s, 0);
  life(s, 3, 1);
  assert.equal(s.pendingTriggers.length, 0);
  life(s, 1);
  life(s, 1);
  assert.equal(s.pendingTriggers.length, 2);
});
test('lifelink splits across recipients as one gain, but distinct simultaneous sources trigger separately', () => {
  const s = fixture();
  put(s, "Ajani's Pridemate");
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears'),
    target = put(s, 'Colossal Dreadmaw', 1);
  const source = (o) => ({ ...ref(o), controller: 0, keywords: ['lifelink'] });
  dealDamageBatch(
    s,
    [
      { source: source(a), target: ref(target), amount: 2 },
      { source: source(a), target: { kind: 'player', id: 1 }, amount: 1 },
      { source: source(b), target: { kind: 'player', id: 1 }, amount: 2 },
    ],
    true,
  );
  assert.equal(s.players[0].life, 25);
  assert.equal(s.pendingTriggers.length, 2);
});
test('a lethal simultaneous hit does not erase an existing life-gain watcher before it triggers', () => {
  const s = fixture();
  const cat = put(s, "Ajani's Pridemate"),
    enemy = put(s, 'Grizzly Bears', 1),
    friend = put(s, 'Grizzly Bears');
  dealDamageBatch(
    s,
    [
      { source: { ...ref(enemy), controller: 1, keywords: [] }, target: ref(cat), amount: 4 },
      {
        source: { ...ref(friend), controller: 0, keywords: ['lifelink'] },
        target: { kind: 'player', id: 1 },
        amount: 2,
      },
    ],
    true,
  );
  assert.equal(s.pendingTriggers.length, 1);
  assert.equal(s.objects[cat.id].damage, 4);
});
test('invalid damage and zero damage cause no phantom life gain', () => {
  const s = fixture();
  put(s, "Ajani's Pridemate");
  const a = put(s, 'Grizzly Bears');
  const source = { ...ref(a), controller: 0, keywords: ['lifelink'] };
  dealDamage(s, source, { kind: 'object', id: 'missing', incarnation: 1 }, 4);
  dealDamage(s, source, { kind: 'player', id: 1 }, 0);
  assert.equal(s.players[0].life, 20);
  assert.equal(s.pendingTriggers.length, 0);
});
test('life-payoff ordering does not mutate the real pending trigger queue', () => {
  const s = fixture();
  put(s, "Ajani's Pridemate");
  const before = structuredClone(s);
  orderLifePayoffs(s, [{ id: 'fixture', controller: 0, effects: [{ op: 'gainLife', amount: 3 }] }]);
  assert.deepEqual(s, before);
});
test('life-gain events reject irrelevant object predicates', () => {
  assert.throws(() =>
    createRegistry({
      ...CARDS,
      Invalid: {
        name: 'Invalid',
        type: 'creature',
        cost: {},
        power: 1,
        toughness: 1,
        triggers: [
          {
            event: { event: 'lifeGain', filter: { type: 'creature' } },
            effects: [{ op: 'gainLife', amount: 1 }],
          },
        ],
      },
    }),
  );
});
