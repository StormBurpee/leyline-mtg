import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry } from '../src/index.js';
import { fixture, put, act, resolve } from './helpers.js';

test('typecycling searches recognize changeling creature types in the library', () => {
  let s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Wizardcycling fixture': {
      name: 'Wizardcycling fixture',
      type: 'creature',
      cost: {},
      power: 1,
      toughness: 1,
      cycling: {},
      cyclingType: 'Wizard',
    },
  });
  const cycler = put(s, 'Wizardcycling fixture', 0, 'hand');
  const changeling = put(s, 'Chitinous Graspling', 0, 'library');
  s = act(s, 'cycle', { card: cycler.id });
  s = resolve(s);
  assert.equal(s.choice.kind, 'librarySearch');
  assert.ok(s.choice.cards.includes(changeling.id));
  s = act(s, 'searchLibrary', { cards: [changeling.id] });
  assert.equal(s.objects[changeling.id].zone, 'hand');
});

test('second-spell predicates see chosen-X stack mana value without storing it as hidden history', () => {
  let s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'First cast fixture': { name: 'First cast fixture', type: 'instant', cost: {}, effects: [] },
    'Ordinal mana witness': {
      name: 'Ordinal mana witness',
      type: 'creature',
      cost: {},
      power: 1,
      toughness: 1,
      triggers: [
        {
          event: {
            event: 'cast',
            controller: 'you',
            spellNumber: 2,
            filter: { manaValue: { gte: 5 } },
          },
          effects: [{ op: 'gainLife', amount: 2 }],
        },
      ],
    },
  });
  put(s, 'Ordinal mana witness');
  const first = put(s, 'First cast fixture', 0, 'hand');
  s = act(s, 'cast', { card: first.id });
  s = resolve(s);
  for (let i = 0; i < 5; i++) put(s, 'Island');
  const spring = put(s, 'Mind Spring', 0, 'hand');
  s = act(s, 'cast', { card: spring.id, x: 3 });
  assert.equal(s.stack.length, 2);
  s = resolve(s);
  assert.equal(s.players[0].life, 22);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 3);
  assert.equal(JSON.stringify(s.players[0].spellsCast).includes('Mind Spring'), false);
});
