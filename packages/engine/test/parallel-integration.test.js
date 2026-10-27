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
