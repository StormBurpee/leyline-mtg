import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry, ref, validateDefinition } from '../src/index.js';
import { move } from '../src/model.js';
import { fixture, put, act, resolve } from './helpers.js';
function setup(effects) {
  const s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Conditional fixture': {
      name: 'Conditional fixture',
      type: 'sorcery',
      cost: {},
      target: 'creature',
      effects,
    },
  });
  return { s, spell: put(s, 'Conditional fixture', 0, 'hand') };
}
const condition = { kind: 'controlAtLeast', where: { type: 'creature' }, count: 1 };
test('conditional instructions see the state after earlier effects, not the cast state', () => {
  let { s, spell } = setup([
    { op: 'destroy' },
    {
      op: 'conditional',
      condition,
      then: [{ op: 'gainLife', amount: 9 }],
      else: [{ op: 'gainLife', amount: 2 }],
    },
  ]);
  const target = put(s, 'Grizzly Bears');
  s = act(s, 'cast', { card: spell.id, target: ref(target) });
  s = resolve(s);
  assert.equal(s.players[0].life, 22);
});
test('conditional branch is retained across a paused scry choice', () => {
  let { s, spell } = setup([
    {
      op: 'conditional',
      condition,
      then: [
        { op: 'scry', count: 1 },
        { op: 'gainLife', amount: 3 },
      ],
      else: [{ op: 'gainLife', amount: 9 }],
    },
    { op: 'draw', count: 1 },
  ]);
  const target = put(s, 'Grizzly Bears');
  s = act(s, 'cast', { card: spell.id, target: ref(target) });
  s = resolve(s);
  assert.equal(s.choice.kind, 'libraryOrder');
  move(s, s.objects[target.id], 'graveyard');
  const top = [...s.choice.cards];
  s = act(s, 'orderLibrary', { top, rest: [] });
  assert.equal(s.players[0].life, 23);
  assert.equal(s.choice, null);
  assert.equal(s.objects[spell.id].zone, 'graveyard');
});
test('conditional effect trees enforce a shared complexity budget', () => {
  let effect = { op: 'gainLife', amount: 1 };
  for (let i = 0; i < 12; i++) effect = { op: 'conditional', condition, then: [effect] };
  assert.ok(
    validateDefinition({ name: 'Too deep', type: 'sorcery', cost: {}, effects: [effect] }).length,
  );
});

import { stats } from '../src/index.js';
import { lands } from './helpers.js';
test('replacement-strength buffs apply one branch, not the ordinary and enhanced values together', () => {
  let s = fixture();
  lands(s, 'Plains', 3);
  const target = put(s, 'Grizzly Bears');
  put(s, 'Grizzly Bears');
  put(s, 'Grizzly Bears');
  const spell = put(s, "You're Not Alone", 0, 'hand');
  s = act(s, 'cast', { card: spell.id, target: ref(target) });
  s = resolve(s);
  assert.deepEqual(stats(s, s.objects[target.id]), { power: 6, toughness: 6 });
});
test('intervening-if ETBs require the condition when triggered and again on resolution', () => {
  for (const initiallyTrue of [false, true]) {
    let s = fixture();
    s.catalog = createRegistry({
      ...CARDS,
      'Donatello, Turtle Techie': { ...CARDS['Donatello, Turtle Techie'], cost: {} },
    });
    const artifact = initiallyTrue ? put(s, 'Short Bow') : null;
    const card = put(s, 'Donatello, Turtle Techie', 0, 'hand');
    s = act(s, 'cast', { card: card.id });
    s = resolve(s);
    assert.equal(s.stack.length, initiallyTrue ? 1 : 0);
    if (artifact) {
      move(s, s.objects[artifact.id], 'graveyard');
      const before = s.players[0].hand.length;
      s = resolve(s);
      assert.equal(s.players[0].hand.length, before);
    } else {
      put(s, 'Short Bow');
      assert.equal(s.stack.length, 0);
    }
  }
});
test('trailing conditions are checked only on resolution, not as intervening-if gates', () => {
  let s = fixture();
  const summoner = put(s, 'Scalestorm Summoner');
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: 0 };
  s = act(s, 'attackers', { cards: [summoner.id] });
  assert.equal(s.stack.length, 1);
  s.modifiers.push({
    objectId: summoner.id,
    incarnation: summoner.incarnation,
    power: 4,
    toughness: 0,
    keywords: [],
    expires: s.turn,
  });
  s = resolve(s);
  assert.equal(
    Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.name === 'Dinosaur Token')
      .length,
    1,
  );
});
