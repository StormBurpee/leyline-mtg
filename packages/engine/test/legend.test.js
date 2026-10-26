import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createGame,
  createRegistry,
  dispatch,
  legalActions,
  chooseBotCommand,
  exportReplay,
  replay,
} from '../src/index.js';
import { addObject } from '../src/model.js';
import { stabilize, stateBasedActions, enterBattlefieldBatch } from '../src/effects.js';
import { act, resolve } from './helpers.js';
const legend = {
  name: 'Legend fixture',
  type: 'creature',
  legendary: true,
  cost: {},
  color: [],
  keywords: ['indestructible'],
  power: 2,
  toughness: 2,
  text: 'Legend fixture',
};
function setup() {
  const s = createGame({
    mulligan: false,
    catalog: createRegistry([...Object.values(CARDS), legend, { ...legend, name: 'Other legend' }]),
  });
  s.step = 'main1';
  s.turn = 3;
  return s;
}
function put(s, name = 'Legend fixture', player = 0) {
  return addObject(s, name, player, 'battlefield');
}
test('legend rule is per controller and exact name, not subtype or owner', () => {
  let s = setup();
  const a = put(s),
    b = put(s, 'Legend fixture', 1),
    c = put(s, 'Other legend');
  stabilize(s);
  assert.equal(s.choice, null);
  b.controller = 0;
  stabilize(s);
  assert.equal(s.choice.kind, 'legendRule');
  assert.deepEqual(s.choice.cards, [a.id, b.id]);
  s = act(s, 'chooseLegend', { card: a.id });
  assert.equal(s.objects[a.id].zone, 'battlefield');
  assert.equal(s.objects[b.id].zone, 'graveyard');
  assert.ok(s.players[1].graveyard.includes(b.id));
  assert.equal(s.objects[c.id].zone, 'battlefield');
});
test('legend choice is mandatory, validates actor/identity atomically, and ignores indestructible', () => {
  const s = setup(),
    a = put(s),
    b = put(s);
  stabilize(s);
  for (const cmd of [
    { type: 'pass' },
    { type: 'chooseLegend', card: 'bad' },
    { type: 'chooseLegend', card: a.id, player: 1 },
  ]) {
    const before = JSON.stringify(s),
      r = dispatch(s, { player: 0, ...cmd });
    assert.equal(r.ok, false);
    assert.equal(r.state, s);
    assert.equal(JSON.stringify(s), before);
  }
  assert.equal(legalActions(s, 0).filter((a) => a.type === 'chooseLegend').length, 2);
  const next = act(s, 'chooseLegend', { card: b.id });
  assert.equal(next.objects[a.id].zone, 'graveyard');
  assert.equal(next.objects[b.id].zone, 'battlefield');
  assert.equal(next.choice, null);
});
test('APNAP legend choices wait before all state-based departures happen together', () => {
  let s = setup();
  s.active = 1;
  s.priority = 1;
  const a = put(s),
    b = put(s),
    c = put(s, 'Legend fixture', 1),
    d = put(s, 'Legend fixture', 1);
  const dying = addObject(s, 'Grizzly Bears', 0, 'battlefield');
  dying.damage = 2;
  stabilize(s);
  assert.equal(s.choice.player, 1);
  assert.equal(s.objects[dying.id].zone, 'battlefield');
  s = act(s, 'chooseLegend', { card: d.id });
  assert.equal(s.choice.player, 0);
  assert.equal(s.objects[c.id].zone, 'battlefield');
  assert.equal(s.objects[dying.id].zone, 'battlefield');
  s = act(s, 'chooseLegend', { card: b.id });
  for (const id of [a.id, c.id, dying.id]) assert.equal(s.objects[id].zone, 'graveyard');
  for (const id of [b.id, d.id]) assert.equal(s.objects[id].zone, 'battlefield');
});
test('choosing a zero-toughness legend does not rescue it or the other copy', () => {
  let s = setup();
  const a = put(s),
    b = put(s);
  s.modifiers.push({ objectId: a.id, incarnation: a.incarnation, toughness: -2, expires: s.turn });
  stabilize(s);
  s = act(s, 'chooseLegend', { card: a.id });
  assert.equal(s.objects[a.id].zone, 'graveyard');
  assert.equal(s.objects[b.id].zone, 'graveyard');
});
test('legend rule does not check in the middle of resolution', () => {
  const s = setup();
  put(s);
  put(s);
  s.resolving = { entry: {}, index: 0 };
  assert.equal(stateBasedActions(s), false);
  assert.equal(s.choice, null);
});
test('nonlegendary copies of the same name are not included', () => {
  const s = setup();
  addObject(s, 'Grizzly Bears', 0, 'battlefield');
  addObject(s, 'Grizzly Bears', 0, 'battlefield');
  stabilize(s);
  assert.equal(s.choice, null);
});
test('the bot returns an executable legend choice', () => {
  const s = setup();
  put(s).tapped = true;
  const keep = put(s);
  stabilize(s);
  const cmd = chooseBotCommand(s, 0);
  assert.equal(cmd.card, keep.id);
  assert.equal(dispatch(s, cmd).ok, true);
});
test('casting a second legend offers choice after resolution and replays deterministically', () => {
  const deck = [...Array(4).fill('Legend fixture'), ...Array(3).fill('Forest')];
  let s = createGame({
    mulligan: false,
    decks: [deck, deck],
    minimumDeckSize: 7,
    catalog: createRegistry([legend, CARDS.Forest]),
  });
  while (s.step !== 'main1') s = act(s, 'pass');
  s = resolve(
    act(s, 'cast', {
      card: s.players[0].hand.find((id) => s.objects[id].name === 'Legend fixture'),
    }),
  );
  s = resolve(
    act(s, 'cast', {
      card: s.players[0].hand.find((id) => s.objects[id].name === 'Legend fixture'),
    }),
  );
  assert.equal(s.choice.kind, 'legendRule');
  s = act(s, 'chooseLegend', { card: s.choice.cards[1] });
  assert.deepEqual(replay(exportReplay(s)), s);
});
test('all legendary departures share the pre-event death-trigger snapshot', () => {
  const witness = { ...CARDS['Zulaport Cutthroat'], name: 'Legend witness', legendary: true };
  let s = createGame({
    mulligan: false,
    catalog: createRegistry([...Object.values(CARDS), witness]),
  });
  const a = addObject(s, witness.name, 0, 'battlefield'),
    b = addObject(s, witness.name, 0, 'battlefield');
  a.damage = 1;
  stabilize(s);
  assert.equal(s.choice.kind, 'legendRule');
  s = act(s, 'chooseLegend', { card: a.id });
  assert.equal(s.objects[a.id].zone, 'graveyard');
  assert.equal(s.objects[b.id].zone, 'graveyard');
  assert.equal(s.choice.kind, 'orderTriggers');
  assert.equal(s.choice.entries.length, 4);
});
test('enter triggers wait for the legend choice and still resolve from the departed source', () => {
  const d = { ...legend, etb: [{ op: 'gainLife', amount: 2 }] };
  let s = createGame({ mulligan: false, catalog: createRegistry([...Object.values(CARDS), d]) });
  const a = addObject(s, d.name, 0, 'hand'),
    b = addObject(s, d.name, 0, 'hand');
  enterBattlefieldBatch(s, [
    { object: a, controller: 0 },
    { object: b, controller: 0 },
  ]);
  stabilize(s);
  assert.equal(s.choice.kind, 'legendRule');
  assert.equal(s.stack.length, 0);
  assert.equal(s.pendingTriggers.length, 2);
  s = act(s, 'chooseLegend', { card: a.id });
  assert.equal(s.choice.kind, 'orderTriggers');
  s = act(s, 'orderTriggers', { ids: s.choice.entries.map((e) => e.id) });
  s = resolve(resolve(s));
  assert.equal(s.players[0].life, 24);
});
test('opaque simulation handles support mandatory legend choices', async () => {
  const { createSession } = await import('../../simulation/session.js');
  const deck = [...Array(4).fill(legend.name), ...Array(3).fill('Forest')];
  const session = createSession({
    mulligan: false,
    decks: [deck, deck],
    minimumDeckSize: 7,
    catalog: createRegistry([legend, CARDS.Forest]),
  });
  let c;
  for (let n = 0; n < 80; n++) {
    c = session.context();
    if (c.observation.choice?.kind === 'legendRule') break;
    const cmd = chooseBotCommand(c.observation, c.player);
    assert.equal(session.step(cmd).ok, true);
  }
  assert.equal(c.observation.choice.kind, 'legendRule');
  assert.ok(c.observation.choice.cards.every((id) => id.startsWith('object:')));
  const cmd = chooseBotCommand(c.observation, c.player);
  assert.equal(session.step(cmd).ok, true);
});
