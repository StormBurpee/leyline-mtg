import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createGame,
  createRegistry,
  dispatch,
  legalActions,
  chooseBotCommand,
  validateDefinition,
  exportReplay,
  replay,
} from '../src/index.js';
import { move, addObject } from '../src/model.js';
import { act, resolve, put } from './helpers.js';
const spell = {
  name: 'Modal fixture',
  type: 'instant',
  cost: {},
  keywords: [],
  color: [],
  modes: [
    {
      label: 'Deal 3 damage to target creature',
      target: 'creature',
      effects: [{ op: 'damage', amount: 3 }],
    },
    { label: 'Destroy target artifact', target: 'artifact', effects: [{ op: 'destroy' }] },
    { label: 'Gain 4 life', effects: [{ op: 'gainLife', amount: 4 }] },
  ],
};
function setup() {
  const s = createGame({
    mulligan: false,
    catalog: createRegistry([...Object.values(CARDS), spell]),
  });
  s.turn = 3;
  s.step = 'main1';
  const card = addObject(s, spell.name, 0, 'hand');
  return { s, card };
}
test('modes and their targets are selected while casting and appear on the stack', () => {
  let { s, card } = setup();
  const bear = put(s, 'Grizzly Bears', 1),
    map = put(s, 'Expedition Map', 1);
  const actions = legalActions(s, 0).filter((a) => a.card === card.id);
  assert.deepEqual(
    actions.map((a) => a.mode),
    [0, 1, 2],
  );
  s = act(s, 'cast', { card: card.id, mode: 1, target: actions.find((a) => a.mode === 1).target });
  assert.equal(s.stack.at(-1).mode, 1);
  assert.equal(s.stack.at(-1).modeLabel, spell.modes[1].label);
  assert.equal(s.choice, null);
  s = resolve(s);
  assert.equal(s.objects[map.id].zone, 'graveyard');
  assert.equal(s.objects[bear.id].zone, 'battlefield');
  assert.equal(s.players[0].life, 20);
});
test('a mode with no legal target is absent but a nontargeted mode remains castable', () => {
  let { s, card } = setup();
  const actions = legalActions(s, 0).filter((a) => a.card === card.id);
  assert.deepEqual(actions, [{ type: 'cast', card: card.id, mode: 2 }]);
  s = act(s, 'cast', { card: card.id, mode: 2 });
  s = resolve(s);
  assert.equal(s.players[0].life, 24);
});
test('missing, out-of-range, noninteger modes and wrong-mode targets reject atomically', () => {
  const { s, card } = setup();
  const bear = put(s, 'Grizzly Bears', 1);
  const target = { kind: 'object', id: bear.id, incarnation: bear.incarnation };
  for (const options of [
    {},
    { mode: -1 },
    { mode: 3 },
    { mode: 1.5 },
    { mode: '1' },
    { mode: null },
    { mode: 1, target },
    { mode: 2, target },
    { mode: 0 },
  ]) {
    const before = JSON.stringify(s),
      r = dispatch(s, { type: 'cast', player: 0, card: card.id, ...options });
    assert.equal(r.ok, false, JSON.stringify(options));
    assert.equal(r.state, s);
    assert.equal(JSON.stringify(s), before);
  }
  const ordinary = put(s, 'Ornithopter', 0, 'hand');
  assert.equal(dispatch(s, { type: 'cast', player: 0, card: ordinary.id, mode: 0 }).ok, false);
});
test('the chosen mode does not change when its target becomes illegal', () => {
  let { s, card } = setup();
  const bear = put(s, 'Grizzly Bears', 1);
  s = act(s, 'cast', {
    card: card.id,
    mode: 0,
    target: { kind: 'object', id: bear.id, incarnation: bear.incarnation },
  });
  move(s, s.objects[bear.id], 'hand');
  s = resolve(s);
  assert.equal(s.players[0].life, 20);
  assert.ok(s.events.some((e) => e.type === 'fizzled'));
  assert.equal(s.objects[card.id].zone, 'graveyard');
});
test('invalid modal definitions fail closed, including multi-mode fields and permanence', () => {
  for (const patch of [
    { type: 'creature', power: 2, toughness: 2 },
    { effects: [] },
    { target: 'creature' },
    { modes: [] },
    { modes: [spell.modes[0]] },
    { modes: [{ ...spell.modes[0], choose: 2 }, spell.modes[1]] },
    { modes: [spell.modes[0], spell.modes[0]] },
  ])
    assert.ok(validateDefinition({ ...spell, ...patch }).length, JSON.stringify(patch));
});
test('the bot reads the selected mode when evaluating lethal', () => {
  const d = {
    ...spell,
    modes: [
      { label: 'Deal 3 to opponent', effects: [{ op: 'damageOpponent', amount: 3 }] },
      spell.modes[2],
    ],
  };
  const s = createGame({ mulligan: false, catalog: createRegistry([...Object.values(CARDS), d]) });
  s.step = 'main1';
  s.players[1].life = 3;
  const card = addObject(s, d.name, 0, 'hand');
  assert.deepEqual(chooseBotCommand(s, 0), { type: 'cast', card: card.id, mode: 0, player: 0 });
});
test('modal casts retain their mode through deterministic replay', () => {
  const deck = [...Array(4).fill(spell.name), ...Array(3).fill('Forest')];
  let s = createGame({
    mulligan: false,
    minimumDeckSize: 7,
    decks: [deck, deck],
    catalog: createRegistry([spell, CARDS.Forest]),
  });
  const card = s.players[0].hand.find((id) => s.objects[id].name === spell.name);
  s = resolve(act(s, 'cast', { card, mode: 2 }));
  assert.deepEqual(replay(exportReplay(s)), s);
});
test('a modal cast is valid through opaque session handles', async () => {
  const { createSession } = await import('../../simulation/session.js');
  const deck = [...Array(4).fill(spell.name), ...Array(3).fill('Forest')];
  const session = createSession({
    mulligan: false,
    minimumDeckSize: 7,
    decks: [deck, deck],
    catalog: createRegistry([spell, CARDS.Forest]),
  });
  const c = session.context(),
    action = c.actions.find((a) => a.type === 'cast' && a.mode === 2);
  assert.ok(action.card.startsWith('object:'));
  assert.equal(session.step(action).ok, true);
  assert.equal(session.context().observation.stack.at(-1).mode, 2);
});
test('keyword target predicates use granted abilities, not only printed text', () => {
  const { s } = setup();
  const bear = put(s, 'Grizzly Bears', 1);
  s.modifiers.push({
    objectId: bear.id,
    incarnation: bear.incarnation,
    keywords: ['flying'],
    power: 0,
    toughness: 0,
    expires: s.turn,
  });
  const card = put(s, 'Reckless Air Strike', 0, 'hand');
  s.players[0].mana.R = 1;
  assert.ok(
    legalActions(s, 0).some((a) => a.card === card.id && a.mode === 0 && a.target.id === bear.id),
  );
});
test('targeted counters and keyword-only modifiers affect the chosen permanent', () => {
  let { s } = setup();
  s.players[0].mana.W = 3;
  const bear = put(s, 'Grizzly Bears'),
    map = put(s, 'Expedition Map');
  const hope = put(s, 'Light of Hope', 0, 'hand');
  s = resolve(
    act(s, 'cast', {
      card: hope.id,
      mode: 2,
      target: { kind: 'object', id: bear.id, incarnation: bear.incarnation },
    }),
  );
  assert.equal(s.objects[bear.id].plusCounters, 1);
  const reroute = put(s, 'Reroute Systems', 0, 'hand');
  s = resolve(
    act(s, 'cast', {
      card: reroute.id,
      mode: 0,
      target: { kind: 'object', id: map.id, incarnation: map.incarnation },
    }),
  );
  assert.ok(
    s.modifiers.some((m) => m.objectId === map.id && m.keywords.includes('indestructible')),
  );
});
