import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createGame,
  createRegistry,
  dispatch,
  exportReplay,
  replay,
  playerView,
  ref,
  stats,
} from '../src/index.js';
import { addObject, move } from '../src/model.js';
import { stabilize } from '../src/effects.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
function castSpell(name) {
  let s = fixture();
  lands(s, 'Island', 3);
  const card = put(s, name, 0, 'hand');
  s = act(s, 'cast', { card: card.id });
  return { s: resolve(s), card };
}
test('Opt suspends resolution for scry and draws only after the choice', () => {
  let { s, card } = castSpell('Opt');
  assert.equal(s.choice.kind, 'libraryOrder');
  assert.equal(s.choice.action, 'scry');
  assert.equal(s.players[0].hand.length, 0);
  assert.equal(s.objects[card.id].zone, 'stack');
  assert.ok(s.resolving);
  const top = s.choice.cards[0],
    next = s.players[0].library[1];
  s = act(s, 'orderLibrary', { top: [], rest: [top] });
  assert.equal(s.players[0].hand[0], next);
  assert.equal(s.players[0].library.at(-1), top);
  assert.equal(s.objects[card.id].zone, 'graveyard');
  assert.equal(s.resolving, null);
});
test('Preordain orders both top and bottom groups', () => {
  let { s } = castSpell('Preordain');
  const [a, b] = s.choice.cards;
  const next = s.players[0].library[2];
  s = act(s, 'orderLibrary', { top: [], rest: [b, a] });
  assert.equal(s.players[0].hand[0], next);
  assert.deepEqual(s.players[0].library.slice(-2), [b, a]);
});
test('scrying within a library does not change object incarnation', () => {
  let { s } = castSpell('Preordain');
  const [a, b] = s.choice.cards,
    inc = s.objects[b].incarnation;
  s = act(s, 'orderLibrary', { top: [a], rest: [b] });
  assert.equal(s.objects[b].incarnation, inc);
});
test('Consider moves the selected card to graveyard before drawing the next', () => {
  let { s } = castSpell('Consider');
  const id = s.choice.cards[0],
    next = s.players[0].library[1],
    inc = s.objects[id].incarnation;
  s = act(s, 'orderLibrary', { top: [], rest: [id] });
  assert.equal(s.objects[id].zone, 'graveyard');
  assert.equal(s.objects[id].incarnation, inc + 1);
  assert.equal(s.players[0].hand[0], next);
});
test('no player can pass or cast during a resolution choice', () => {
  let { s } = castSpell('Opt');
  const before = structuredClone(s);
  for (const player of [0, 1]) assert.equal(dispatch(s, { type: 'pass', player }).ok, false);
  assert.deepEqual(s, before);
});
test('library partitions reject duplicate, omitted and foreign cards atomically', () => {
  const { s } = castSpell('Preordain');
  const [a, b] = s.choice.cards;
  for (const data of [
    { top: [a, a], rest: [] },
    { top: [a], rest: [] },
    { top: [a], rest: [s.players[0].library[3]] },
  ]) {
    const r = dispatch(s, { type: 'orderLibrary', player: 0, ...data });
    assert.equal(r.ok, false);
    assert.equal(r.state, s);
  }
});
test('Catalog draws before choosing a discard and leaves its own card on the stack', () => {
  let { s, card } = castSpell('Catalog');
  assert.equal(s.choice.kind, 'discardEffect');
  assert.equal(s.players[0].hand.length, 2);
  assert.equal(s.objects[card.id].zone, 'stack');
  const id = s.players[0].hand[1];
  s = act(s, 'discardEffect', { cards: [id] });
  assert.equal(s.players[0].hand.length, 1);
  assert.ok(s.players[0].graveyard.includes(id));
  assert.equal(s.objects[card.id].zone, 'graveyard');
});
test('Merfolk Looter uses the same continuation mechanism as a spell', () => {
  let s = fixture();
  const looter = put(s, 'Merfolk Looter');
  s = act(s, 'activate', { card: looter.id, ability: 0 });
  s = resolve(s);
  assert.equal(s.choice.kind, 'discardEffect');
  s = act(s, 'discardEffect', { cards: [s.players[0].hand[0]] });
  assert.equal(s.objects[looter.id].zone, 'battlefield');
  assert.equal(s.objects[looter.id].tapped, true);
  assert.equal(s.resolving, null);
});
test('state-based loss is deferred until the whole spell finishes', () => {
  const card = {
    name: 'Resolution Test Recovery',
    type: 'instant',
    cost: { U: 1 },
    target: 'player',
    effects: [
      { op: 'damage', amount: 20 },
      { op: 'scry', count: 1 },
      { op: 'gainLife', amount: 20 },
    ],
  };
  let s = createGame({ catalog: createRegistry([...Object.values(CARDS), card]), mulligan: false });
  s.step = 'main1';
  s.turn = 3;
  lands(s, 'Island', 1);
  const spell = addObject(s, card.name, 0, 'hand');
  s = act(s, 'cast', { card: spell.id, target: { kind: 'player', id: 0 } });
  s = resolve(s);
  assert.equal(s.players[0].life, 0);
  assert.equal(s.status, 'playing');
  stabilize(s);
  assert.equal(s.status, 'playing');
  s = act(s, 'orderLibrary', { top: [...s.choice.cards], rest: [] });
  assert.equal(s.players[0].life, 20);
  assert.equal(s.status, 'playing');
});
test('a temporarily zero-toughness creature survives if restored before resolution ends', () => {
  const card = {
    name: 'Resolution Test Shrink',
    type: 'instant',
    cost: { U: 1 },
    target: 'creature',
    effects: [
      { op: 'modify', power: 0, toughness: -3 },
      { op: 'scry', count: 1 },
      { op: 'modify', power: 0, toughness: 3 },
    ],
  };
  let s = createGame({ catalog: createRegistry([...Object.values(CARDS), card]), mulligan: false });
  s.step = 'main1';
  s.turn = 3;
  lands(s, 'Island', 1);
  const bear = addObject(s, 'Grizzly Bears', 0, 'battlefield'),
    spell = addObject(s, card.name, 0, 'hand');
  s = act(s, 'cast', { card: spell.id, target: ref(bear) });
  s = resolve(s);
  assert.equal(stats(s, s.objects[bear.id]).toughness, -1);
  assert.equal(s.objects[bear.id].zone, 'battlefield');
  s = act(s, 'orderLibrary', { top: [...s.choice.cards], rest: [] });
  assert.equal(s.objects[bear.id].zone, 'battlefield');
  assert.equal(stats(s, s.objects[bear.id]).toughness, 2);
});
test('triggered abilities wait until a resolution continuation completes', () => {
  const card = {
    name: 'Resolution Test Tokens',
    type: 'instant',
    cost: { U: 1 },
    effects: [
      { op: 'token', definition: 'Soldier Token', count: 1 },
      { op: 'scry', count: 1 },
    ],
  };
  let s = createGame({ catalog: createRegistry([...Object.values(CARDS), card]), mulligan: false });
  s.step = 'main1';
  s.turn = 3;
  addObject(s, 'Soul Warden', 0, 'battlefield');
  lands(s, 'Island', 1);
  const spell = addObject(s, card.name, 0, 'hand');
  s = act(s, 'cast', { card: spell.id });
  s = resolve(s);
  assert.equal(s.pendingTriggers.length, 1);
  assert.equal(s.stack.length, 0);
  s = act(s, 'orderLibrary', { top: [...s.choice.cards], rest: [] });
  assert.equal(s.pendingTriggers.length, 0);
  assert.equal(s.stack[0].name, 'Soul Warden');
});
test('two successive choices retain the correct instruction cursor', () => {
  const card = {
    name: 'Resolution Test Chain',
    type: 'instant',
    cost: { U: 1 },
    effects: [
      { op: 'discard', count: 1 },
      { op: 'scry', count: 1 },
      { op: 'draw', count: 1 },
    ],
  };
  let s = createGame({ catalog: createRegistry([...Object.values(CARDS), card]), mulligan: false });
  s.step = 'main1';
  s.turn = 3;
  lands(s, 'Island', 1);
  const spell = addObject(s, card.name, 0, 'hand');
  s = act(s, 'cast', { card: spell.id });
  s = resolve(s);
  const initial = s.players[0].hand.length;
  s = act(s, 'discardEffect', { cards: [s.players[0].hand[0]] });
  assert.equal(s.choice.kind, 'libraryOrder');
  s = act(s, 'orderLibrary', { top: [...s.choice.cards], rest: [] });
  assert.equal(s.players[0].hand.length, initial);
  assert.equal(s.resolving, null);
});
test('scry looked cards are visible only to the choosing player', () => {
  const { s } = castSpell('Opt');
  const id = s.choice.cards[0];
  assert.ok(playerView(s, 0).objects[id].name);
  assert.equal(playerView(s, 1).objects[id], undefined);
  assert.equal(playerView(s, 1).objects[playerView(s, 1).players[0].library[0]].hidden, true);
  assert.equal(playerView(s, 1).choice.kind, 'opponentChoice');
});
test('a replay paused inside resolution reconstructs the same pending choice', () => {
  const deck = [...Array(56).fill('Island'), ...Array(4).fill('Opt')];
  let s = createGame({ decks: [deck, deck], mulligan: false, seed: 3 });
  while (s.step !== 'main1') s = resolve(s);
  const land = s.players[0].hand.find((id) => s.objects[id].name === 'Island'),
    opt = s.players[0].hand.find((id) => s.objects[id].name === 'Opt');
  assert.ok(opt);
  s = act(s, 'playLand', { card: land });
  s = act(s, 'cast', { card: opt });
  s = resolve(s);
  assert.equal(s.choice.kind, 'libraryOrder');
  assert.deepEqual(replay(JSON.parse(JSON.stringify(exportReplay(s)))), s);
});
test('scry with no cards does not itself lose, but the following draw does', () => {
  let s = fixture();
  for (const id of [...s.players[0].library]) move(s, s.objects[id], 'graveyard');
  lands(s, 'Island', 1);
  const opt = put(s, 'Opt', 0, 'hand');
  s = act(s, 'cast', { card: opt.id });
  s = resolve(s);
  assert.equal(s.status, 'finished');
  assert.equal(s.winner, 1);
  assert.equal(s.objects[opt.id].zone, 'graveyard');
});
