import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  chooseBotCommand,
  dispatch,
  ref,
  legalActions,
  activationCost,
  stats,
} from '../src/index.js';
import { fixture, put, act, resolve } from './helpers.js';
import { move } from '../src/model.js';
function position(ability, card = {}) {
  const s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Review X': {
      name: 'Review X',
      type: 'creature',
      cost: { U: 1 },
      power: 1,
      toughness: 4,
      activated: [ability],
      ...card,
    },
  });
  return { s, o: put(s, 'Review X') };
}
test('review: pending grouped X draw reserves library for another grouped X activation', () => {
  let { s, o } = position({
    cost: { mana: { X: 1 } },
    targetGroups: [
      {
        id: 'drawers',
        selector: { scope: 'player', where: { controller: 'you' } },
        min: 1,
        max: 1,
      },
    ],
    effects: [{ op: 'draw', player: 'target', targetGroup: 'drawers', count: { kind: 'x' } }],
  });
  s.players[0].mana.U = 8;
  for (const id of s.players[0].library.slice(4)) move(s, s.objects[id], 'exile');
  s = act(s, 'activate', {
    card: o.id,
    ability: 0,
    x: 2,
    targets: { drawers: [{ kind: 'player', id: 0 }] },
  });
  const command = chooseBotCommand(s, 0);
  assert.equal(command.type, 'activate');
  assert.equal(command.targets.drawers[0].id, 0);
  assert.equal(command.x, 2);
  s = act(s, 'activate', command);
  s = resolve(resolve(s));
  assert.equal(s.status, 'playing');
  assert.equal(s.players[0].library.length, 0);
});
test('review: excess fixed colored power-up reduction uses generic without changing other colors', () => {
  const { s, o } = position(
    {
      powerUp: true,
      cost: { mana: { generic: 4, R: 1 } },
      effects: [{ op: 'gainLife', amount: 1 }],
    },
    { cost: { U: 2, C: 1 } },
  );
  assert.deepEqual(activationCost(s, o, s.catalog[o.name].activated[0]).mana, { generic: 1, R: 1 });
  s.turn++;
  assert.deepEqual(activationCost(s, o, s.catalog[o.name].activated[0]).mana, { generic: 4, R: 1 });
});
test('review: source printed X is zero for power-up reduction, independent of announced activated X', () => {
  let { s, o } = position(
    {
      powerUp: true,
      cost: { mana: { X: 2, U: 2 } },
      effects: [{ op: 'counterOn', subject: 'source', amount: { kind: 'x' } }],
    },
    { cost: { X: 1, U: 1 } },
  );
  o.chosenX = 9;
  s.players[0].mana.U = 7;
  assert.deepEqual(activationCost(s, o, s.catalog[o.name].activated[0], 3).mana, {
    U: 1,
    generic: 6,
  });
  s = act(s, 'activate', { card: o.id, ability: 0, x: 3 });
  assert.equal(s.stack.at(-1).x, 3);
  assert.equal(s.objects[o.id].chosenX, 9);
  s = resolve(s);
  assert.equal(stats(s, s.objects[o.id]).power, 4);
});
test('review: selected non-sacrificing mana source may tap for X before being sacrificed', () => {
  let { s, o } = position({
    cost: { mana: { X: 1 }, sacrifice: { count: 1, where: { type: 'artifact' } } },
    effects: [{ op: 'gainLife', amount: { kind: 'x' } }],
  });
  s.catalog = createRegistry({
    ...s.catalog,
    'Review Mana': { name: 'Review Mana', type: 'artifact', cost: {}, mana: ['U'] },
  });
  const mana = put(s, 'Review Mana');
  const before = structuredClone(s);
  assert.equal(
    dispatch(s, {
      type: 'activate',
      player: 0,
      card: o.id,
      ability: 0,
      x: 2,
      sacrifices: [ref(mana)],
    }).ok,
    false,
  );
  assert.deepEqual(s, before);
  assert.ok(legalActions(s, 0).some((a) => a.type === 'activate' && a.card === o.id && a.x === 1));
  s = act(s, 'activate', { card: o.id, ability: 0, x: 1, sacrifices: [ref(mana)] });
  assert.equal(s.objects[mana.id].zone, 'graveyard');
  assert.equal(s.players[0].mana.U, 0);
  s = resolve(s);
  assert.equal(s.players[0].life, 21);
});
test('review: sacrifice-self can tap for mana first when tap is not part of its X activation cost', () => {
  let { s, o } = position(
    {
      cost: { mana: { X: 1 }, sacrificeSelf: true },
      effects: [{ op: 'gainLife', amount: { kind: 'x' } }],
    },
    { mana: ['U'] },
  );
  s = act(s, 'activate', { card: o.id, ability: 0, x: 1 });
  assert.equal(s.objects[o.id].zone, 'graveyard');
  assert.equal(s.stack.at(-1).x, 1);
  s = resolve(s);
  assert.equal(s.players[0].life, 21);
});
