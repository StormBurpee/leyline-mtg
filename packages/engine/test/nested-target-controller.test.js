import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry, ref } from '../src/index.js';
import { move } from '../src/model.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
const blast = {
  name: 'Nested controller blast',
  type: 'instant',
  cost: { R: 1 },
  target: 'creature',
  additionalCost: { kind: 'teamwork', power: 2 },
  effects: [
    { op: 'damage', amount: 5 },
    {
      op: 'conditional',
      condition: { kind: 'additionalCostPaid' },
      then: [
        {
          op: 'conditional',
          condition: { kind: 'controllerTurn' },
          then: [{ op: 'damageTargetController', amount: 2 }],
          else: [],
        },
      ],
      else: [],
    },
  ],
};
const search = {
  name: 'Nested controller search',
  type: 'sorcery',
  cost: { G: 1 },
  target: { scope: 'permanent', where: { type: 'land' } },
  effects: [
    { op: 'destroy' },
    {
      op: 'conditional',
      condition: { kind: 'opponentLostLifeThisTurn' },
      then: [{ op: 'damageTargetController', amount: 99 }],
      else: [
        {
          op: 'conditional',
          condition: { kind: 'controllerTurn' },
          then: [
            {
              op: 'searchLibrary',
              count: 1,
              destination: 'battlefield',
              where: { all: [{ type: 'land' }, { basic: true }] },
              player: 'targetController',
              optional: true,
            },
          ],
        },
      ],
    },
  ],
};
function setup() {
  const s = fixture();
  s.catalog = createRegistry({ ...CARDS, [blast.name]: blast, [search.name]: search });
  return s;
}
test('nested conditional target-controller damage binds for paid teamwork, not unpaid', () => {
  for (const paid of [false, true]) {
    let s = setup();
    lands(s, 'Mountain', 1);
    const team = put(s, 'Grizzly Bears');
    const target = put(s, 'Serra Angel', 1);
    const spell = put(s, blast.name, 0, 'hand');
    s = act(s, 'cast', {
      card: spell.id,
      target: ref(target),
      additionalCost: paid ? { teamwork: [ref(team)] } : null,
    });
    s = resolve(s);
    assert.equal(s.objects[target.id].zone, 'graveyard');
    assert.equal(s.players[1].life, paid ? 18 : 20);
  }
});
test('controller is read at resolution after control changes, not frozen at cast or inferred from owner', () => {
  let s = setup();
  lands(s, 'Mountain', 1);
  const team = put(s, 'Grizzly Bears');
  const target = put(s, 'Serra Angel', 1);
  const spell = put(s, blast.name, 0, 'hand');
  s = act(s, 'cast', {
    card: spell.id,
    target: ref(target),
    additionalCost: { teamwork: [ref(team)] },
  });
  s.objects[target.id].controller = 0;
  s = resolve(s);
  assert.equal(s.objects[target.id].owner, 1);
  assert.equal(s.players[0].life, 18);
  assert.equal(s.players[1].life, 20);
});
test('nested else search retains pre-destruction controller and never executes the unchosen branch', () => {
  let s = setup();
  lands(s, 'Forest', 1);
  const target = put(s, 'Soured Springs', 0);
  target.controller = 1;
  const basic = put(s, 'Forest', 1, 'library');
  const spell = put(s, search.name, 0, 'hand');
  s = act(s, 'cast', { card: spell.id, target: ref(target) });
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'graveyard');
  assert.equal(s.objects[target.id].controller, 0);
  assert.equal(s.choice.kind, 'librarySearch');
  assert.equal(s.choice.player, 1);
  assert.equal(s.players[0].life, 20);
  assert.equal(s.players[1].life, 20);
  s = act(s, 'searchLibrary', { cards: [basic.id] }, 1);
  assert.equal(s.objects[basic.id].controller, 1);
  assert.equal(s.objects[basic.id].zone, 'battlefield');
});
test('an illegal primary target still fizzles before any nested controller effect', () => {
  let s = setup();
  lands(s, 'Mountain', 1);
  const team = put(s, 'Grizzly Bears');
  const target = put(s, 'Serra Angel', 1);
  const spell = put(s, blast.name, 0, 'hand');
  s = act(s, 'cast', {
    card: spell.id,
    target: ref(target),
    additionalCost: { teamwork: [ref(team)] },
  });
  move(s, s.objects[target.id], 'exile');
  s = resolve(s);
  assert.equal(s.players[1].life, 20);
  assert.equal(s.objects[spell.id].zone, 'graveyard');
});
