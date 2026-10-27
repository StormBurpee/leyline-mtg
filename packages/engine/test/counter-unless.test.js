import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry, dispatch, legalActions } from '../src/index.js';
import { move } from '../src/model.js';
import { replay } from '../src/index.js';
import { createSession } from '../../simulation/session.js';
import { chooseBotCommand } from '../src/bot.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
function setup(name = 'Spell Pierce', spare = 3) {
  let s = fixture();
  lands(s, 'Mountain', spare + 1);
  lands(s, 'Island', 3, 1);
  lands(s, 'Plains', 1, 1);
  const bolt = put(s, 'Lightning Bolt', 0, 'hand');
  const counter = put(s, name, 1, 'hand');
  s = act(s, 'cast', { card: bolt.id, target: { kind: 'player', id: 1 } });
  const stackId = s.stack.at(-1).id;
  s = act(s, 'pass');
  s = act(s, 'cast', { card: counter.id, target: { kind: 'stack', id: stackId } });
  return { s, bolt, counter, stackId };
}
test('unless payment belongs to target spell controller; payment preserves spell and continues', () => {
  let { s, bolt, counter } = setup();
  s = resolve(s);
  assert.equal(s.choice.reason, 'counterUnless');
  assert.equal(s.choice.player, 0);
  assert.equal(s.choice.payable, true);
  assert.deepEqual(s.choice.cost, { mana: { generic: 2 } });
  s = act(s, 'payCost', { pay: true });
  assert.equal(s.choice, null);
  assert.equal(s.resolving, null);
  assert.equal(s.objects[counter.id].zone, 'graveyard');
  assert.equal(s.objects[bolt.id].zone, 'stack');
  s = resolve(s);
  assert.equal(s.players[1].life, 17);
});
test('affordable cost may be declined, countering normally or into exile', () => {
  for (const name of ['Spell Pierce', 'No More Lies']) {
    let { s, bolt } = setup(name);
    s = resolve(s);
    assert.equal(s.choice.payable, true);
    s = act(s, 'payCost', { pay: false });
    assert.equal(s.objects[bolt.id].zone, name === 'No More Lies' ? 'exile' : 'graveyard');
    assert.equal(s.stack.length, 0);
  }
});
test('unaffordable payment and wrong-player/priority commands fail atomically', () => {
  let { s } = setup('No More Lies', 0);
  s = resolve(s);
  assert.equal(s.choice.payable, false);
  for (const command of [
    { type: 'payCost', player: 0, pay: true },
    { type: 'payCost', player: 1, pay: false },
    { type: 'pass', player: 0 },
  ]) {
    const r = dispatch(s, command);
    assert.equal(r.ok, false);
    assert.equal(r.state, s);
  }
  assert.equal(chooseBotCommand(s, 0).pay, false);
});
test('uncounterable target is offered optional payment but is never countered or exiled', () => {
  let { s, bolt, stackId } = setup('No More Lies');
  s.stack.find((e) => e.id === stackId).uncounterable = true;
  s = resolve(s);
  assert.equal(s.choice.reason, 'counterUnless');
  assert.equal(chooseBotCommand(s, 0).pay, false);
  s = act(s, 'payCost', { pay: false });
  assert.equal(s.objects[bolt.id].zone, 'stack');
  s = resolve(s);
  assert.equal(s.players[1].life, 17);
});
test('a lost target fizzles without asking for payment', () => {
  let { s, stackId, bolt } = setup();
  s.stack = s.stack.filter((e) => e.id !== stackId);
  move(s, s.objects[bolt.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 0);
});
test('literal mana costs only; unsupported dynamic/cost combinations reject at registry boundary', () => {
  for (const unlessPay of [{ X: 1 }, { generic: { op: 'x' } }, { life: 2 }, { '2/U': 1 }, -1]) {
    assert.throws(() =>
      createRegistry({
        ...CARDS,
        Bad: {
          name: 'Bad',
          type: 'instant',
          cost: { U: 1 },
          target: { scope: 'spell' },
          effects: [{ op: 'counter', unlessPay }],
        },
      }),
    );
  }
});
test('every authored addition is complete and exposes the intended target restrictions', () => {
  const names = [
    'Spell Pierce',
    'No More Lies',
    "It'll Quench Ya!",
    'Spectral Interference',
    'Diversion Unit',
    'Confusticate and Bebother',
    'Icy Reception',
    'Theorix Charm',
  ];
  for (const name of names) assert.ok(CARDS[name], name);
  let s = fixture();
  lands(s, 'Forest', 1);
  lands(s, 'Island', 2, 1);
  const creature = put(s, 'Llanowar Elves', 0, 'hand'),
    pierce = put(s, 'Spell Pierce', 1, 'hand'),
    spectral = put(s, 'Spectral Interference', 1, 'hand');
  s = act(s, 'cast', { card: creature.id });
  s = act(s, 'pass');
  const actions = legalActions(s, 1);
  assert.equal(
    actions.some((a) => a.card === pierce.id),
    false,
  );
  assert.equal(
    actions.some((a) => a.card === spectral.id),
    true,
  );
});
test('opaque session payment actions and suspended resolution round-trip through replay', () => {
  const catalog = createRegistry({
    ...CARDS,
    'Free Bolt': { ...CARDS['Lightning Bolt'], name: 'Free Bolt', cost: {} },
    'Free Counter': { ...CARDS['No More Lies'], name: 'Free Counter', cost: {} },
  });
  const session = createSession({
    mulligan: false,
    catalog,
    minimumDeckSize: 8,
    decks: [
      [...Array(4).fill('Free Bolt'), ...Array(4).fill('Mountain')],
      [...Array(4).fill('Free Counter'), ...Array(4).fill('Island')],
    ],
  });
  const step = (command) => {
    const c = session.context();
    const r = session.step({ player: c.player, ...command });
    assert.equal(r.ok, true, r.error?.message);
  };
  while (session.context().observation.step !== 'main1') step({ type: 'pass' });
  let c = session.context();
  step({
    type: 'cast',
    card: c.observation.players[0].hand.find(
      (id) => c.observation.objects[id].name === 'Free Bolt',
    ),
    target: { kind: 'player', id: 1 },
  });
  step({ type: 'pass' });
  c = session.context();
  step({
    type: 'cast',
    card: c.observation.players[1].hand.find(
      (id) => c.observation.objects[id].name === 'Free Counter',
    ),
    target: { kind: 'stack', id: c.observation.stack[0].id },
  });
  step({ type: 'pass' });
  step({ type: 'pass' });
  c = session.context();
  assert.equal(c.observation.choice.reason, 'counterUnless');
  assert.equal(c.player, 0);
  const before = replay(session.exportReplay());
  assert.equal(before.choice.kind, 'payCost');
  assert.equal(before.resolving.entry.name, 'Free Counter');
  assert.ok(c.actions.some((a) => a.type === 'payCost' && a.pay === false));
  step({ type: 'payCost', pay: false });
  const after = replay(session.exportReplay());
  assert.equal(after.resolving, null);
  assert.equal(after.stack.length, 0);
  assert.equal(after.players[0].exile.length, 1);
});
test('mana ability life costs determine affordability and bot declines lethal payment', () => {
  let { s, stackId } = setup('Spell Pierce', 0);
  s.catalog = createRegistry({
    ...CARDS,
    'Life Mana': {
      name: 'Life Mana',
      type: 'land',
      cost: {},
      mana: ['U'],
      manaLifeCosts: { U: 1 },
    },
  });
  put(s, 'Life Mana');
  put(s, 'Life Mana');
  s.players[0].life = 1;
  s = resolve(s);
  assert.equal(s.choice.payable, false);
  assert.equal(chooseBotCommand(s, 0).pay, false);
  let other = setup('Spell Pierce', 0);
  s = other.s;
  s.catalog = createRegistry({
    ...CARDS,
    'Life Mana': {
      name: 'Life Mana',
      type: 'land',
      cost: {},
      mana: ['U'],
      manaLifeCosts: { U: 1 },
    },
  });
  put(s, 'Life Mana');
  put(s, 'Life Mana');
  s.players[0].life = 2;
  s = resolve(s);
  assert.equal(s.choice.payable, true);
  assert.equal(chooseBotCommand(s, 0).pay, false);
});
test('Dazzling Denial checks Birds on resolution and presents exactly one correct payment', () => {
  for (const birdPresent of [true, false]) {
    let { s } = setup('Dazzling Denial', 4);
    const bird = put(s, 'Healer’s Hawk' in CARDS ? 'Healer’s Hawk' : "Healer's Hawk", 1);
    if (!birdPresent) move(s, bird, 'graveyard');
    s = resolve(s);
    assert.equal(s.choice.cost.mana.generic, birdPresent ? 4 : 2);
    s = act(s, 'payCost', { pay: true });
    assert.equal(s.choice, null);
    assert.equal(s.stack.length, 1);
  }
});
test('Diversion Unit pays sacrifice up front, then target controller decides on resolution', () => {
  let s = fixture();
  lands(s, 'Mountain', 1);
  lands(s, 'Island', 1, 1);
  const unit = put(s, 'Diversion Unit', 1),
    bolt = put(s, 'Lightning Bolt', 0, 'hand');
  s = act(s, 'cast', { card: bolt.id, target: { kind: 'player', id: 1 } });
  const id = s.stack[0].id;
  s = act(s, 'pass');
  const activation = legalActions(s, 1).find((a) => a.type === 'activate' && a.card === unit.id);
  assert.ok(activation);
  s = act(s, 'activate', activation);
  assert.equal(s.objects[unit.id].zone, 'graveyard');
  s = resolve(s);
  assert.equal(s.choice.player, 0);
  assert.equal(s.choice.cost.mana.generic, 3);
  s = act(s, 'payCost', { pay: false });
  assert.equal(s.objects[bolt.id].zone, 'graveyard');
});
