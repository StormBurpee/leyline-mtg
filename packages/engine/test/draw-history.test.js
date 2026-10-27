import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createGame,
  playerView,
  definition,
  dispatch,
  chooseBotCommand,
  validateDefinition,
} from '../src/index.js';
import { draw, move, ref } from '../src/model.js';
import { nextTurn, advanceStep } from '../src/turn.js';
import { resolveEffects, stabilize } from '../src/effects.js';
import { fixture, put, act, resolve } from './helpers.js';
const copies = (s) => Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.token);
function settle(s) {
  stabilize(s);
  for (
    let i = 0;
    i < 100 && (s.choice || s.stack.length || s.resolving || s.pendingTriggers.length);
    i++
  ) {
    const p = s.choice?.player ?? s.priority;
    const result = dispatch(s, s.choice ? chooseBotCommand(s, p) : { type: 'pass', player: p });
    assert.equal(result.ok, true, result.error?.message);
    s = result.state;
  }
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 0);
  assert.equal(s.resolving, null);
  return s;
}
test('opening hands and repeated London mulligans never count as turn-one draws', () => {
  const ready = createGame({ mulligan: false });
  assert.ok(ready.players.every((p) => p.cardsDrawn === undefined));
  draw(ready, 0, 1);
  assert.deepEqual(ready.players[0].cardsDrawn, { turn: 1, count: 1 });
  let s = createGame();
  s = act(s, 'mulligan');
  s = act(s, 'mulligan');
  assert.ok(s.players.every((p) => p.cardsDrawn === undefined));
});
test('second draw uses the player history even when Horde entered after the first draw', () => {
  let s = fixture();
  draw(s, 0, 1);
  put(s, 'Homunculus Horde');
  draw(s, 0, 1);
  assert.equal(s.pendingTriggers.length, 1);
  assert.equal(s.stack.length, 0);
  draw(s, 0, 3);
  assert.equal(s.pendingTriggers.length, 1);
  s = settle(s);
  assert.equal(copies(s).length, 1);
  assert.deepEqual(definition(s, copies(s)[0]), { ...CARDS['Homunculus Horde'], token: true });
});
test('multiple successful draws trigger individually, without resolving or applying SBA mid-instruction', () => {
  let s = fixture();
  const skymage = put(s, 'Clinquant Skymage');
  draw(s, 0, 3);
  assert.equal(skymage.plusCounters, 0);
  assert.equal(s.pendingTriggers.length, 3);
  assert.equal(s.players[0].cardsDrawn.count, 3);
  s = settle(s);
  assert.equal(s.objects[skymage.id].plusCounters, 3);
});
test('draw triggers wait until a resolving multi-instruction spell finishes', () => {
  let s = fixture();
  const h = put(s, 'Homunculus Horde');
  resolveEffects(s, {
    kind: 'ability',
    controller: 0,
    name: 'Draw and kill',
    source: ref(h),
    sourceKeywords: [],
    effects: [
      { op: 'draw', count: 2 },
      { op: 'damageAll', amount: 99, where: { type: 'creature' } },
    ],
  });
  assert.equal(copies(s).length, 0);
  assert.equal(s.pendingTriggers.length, 1);
  s = settle(s);
  assert.equal(s.objects[h.id].zone, 'graveyard');
  assert.equal(copies(s).length, 1);
});
test('Horde copying uses source LKI after departure, never a returned new incarnation', () => {
  let s = fixture();
  const h = put(s, 'Homunculus Horde');
  draw(s, 0, 2);
  move(s, h, 'graveyard');
  move(s, h, 'battlefield');
  h.definitionOverride = structuredClone(CARDS['Grizzly Bears']);
  s = settle(s);
  assert.equal(definition(s, copies(s)[0]).name, 'Homunculus Horde');
});
test('both players reset each turn; opponent-turn second draws and copied Hordes work', () => {
  let s = fixture();
  put(s, 'Homunculus Horde');
  draw(s, 0, 2);
  s = settle(s);
  draw(s, 1, 1);
  nextTurn(s);
  assert.ok(s.players.every((p) => p.cardsDrawn === undefined));
  draw(s, 0, 2);
  assert.equal(s.pendingTriggers.length, 2);
  s = settle(s);
  assert.equal(copies(s).length, 3);
  assert.deepEqual(s.players[0].cardsDrawn, { turn: 4, count: 2 });
});
test('controller relation and control changes use drawing player history, not permanent history', () => {
  let s = fixture();
  const h = put(s, 'Homunculus Horde');
  draw(s, 1, 1);
  h.controller = 1;
  draw(s, 0, 2);
  assert.equal(s.pendingTriggers.length, 0);
  draw(s, 1, 1);
  assert.equal(s.pendingTriggers.length, 1);
  h.controller = 0;
  s = settle(s);
  assert.equal(copies(s)[0].controller, 1);
});
test('empty library attempts and non-draw library-to-hand moves do not count', () => {
  const s = fixture();
  put(s, 'Homunculus Horde');
  move(s, s.objects[s.players[0].library[0]], 'hand');
  assert.equal(s.players[0].cardsDrawn, undefined);
  while (s.players[0].library.length > 1) move(s, s.objects[s.players[0].library[0]], 'graveyard');
  draw(s, 0, 3);
  assert.equal(s.players[0].failedDraw, true);
  assert.equal(s.players[0].cardsDrawn.count, 1);
  assert.equal(s.pendingTriggers.length, 0);
});
test('Quantum instruction replacement produces individual real draw events and one second-card event', () => {
  let s = fixture();
  put(s, 'Quantum Riddler');
  put(s, 'Homunculus Horde');
  draw(s, 0, 2);
  assert.equal(s.players[0].cardsDrawn.count, 3);
  assert.equal(s.pendingTriggers.length, 1);
  s = settle(s);
  assert.equal(copies(s).length, 1);
});
test('once-per-turn draw triggers consume on occurrence and restart on the other player turn', () => {
  let s = fixture();
  const o = put(s, 'Erudite Wizard');
  o.definitionOverride = {
    ...CARDS['Erudite Wizard'],
    triggers: [
      {
        event: { event: 'draw', controller: 'you' },
        oncePerTurn: true,
        effects: [{ op: 'gainLife', amount: 1 }],
      },
    ],
  };
  draw(s, 0, 3);
  assert.equal(s.pendingTriggers.length, 1);
  s = settle(s);
  assert.equal(s.players[0].life, 21);
  nextTurn(s);
  draw(s, 0, 2);
  assert.equal(s.pendingTriggers.length, 1);
});
test('public views expose only draw totals, and draw event predicates cannot inspect hidden cards', () => {
  const s = fixture();
  draw(s, 1, 2);
  const view = playerView(s, 0);
  assert.deepEqual(view.players[1].cardsDrawn, { turn: 3, count: 2 });
  for (const event of [
    { event: 'draw', drawNumber: 0 },
    { event: 'draw', drawNumber: 1.5 },
    { event: 'cast', drawNumber: 2 },
    { event: 'draw', filter: { type: 'creature' } },
    { event: 'draw', object: 'source' },
    { event: 'draw', excludeSource: true },
  ])
    assert.ok(
      validateDefinition({
        ...CARDS['Erudite Wizard'],
        triggers: [{ event, effects: [{ op: 'gainLife', amount: 1 }] }],
      }).length,
      JSON.stringify(event),
    );
});

test('draw-step turn action creates draw events but does not replace beginning-of-draw-step triggers', () => {
  let s = fixture();
  const wizard = put(s, 'Erudite Wizard');
  wizard.definitionOverride = {
    ...CARDS['Erudite Wizard'],
    triggers: [
      {
        event: { event: 'step', step: 'draw', controller: 'you' },
        effects: [{ op: 'gainLife', amount: 3 }],
      },
      { event: { event: 'draw', controller: 'you' }, effects: [{ op: 'gainLife', amount: 1 }] },
    ],
  };
  s.step = 'upkeep';
  advanceStep(s);
  assert.equal(s.step, 'draw');
  assert.equal(s.players[0].cardsDrawn.count, 1);
  assert.equal(s.pendingTriggers.length, 2);
  assert.equal(s.players[0].life, 20);
  s = settle(s);
  assert.equal(s.players[0].life, 24);
});
