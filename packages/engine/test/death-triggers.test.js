import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry, ref, dispatch } from '../src/index.js';
import { move } from '../src/model.js';
import { stateBasedActions, stabilize } from '../src/effects.js';
import { fixture, put, act, resolve } from './helpers.js';
const watcher = (name, event, effects = [{ op: 'gainLife', amount: 1 }]) => ({
  name,
  type: 'creature',
  cost: {},
  power: 1,
  toughness: 1,
  triggers: [{ event, effects }],
});
const game = (...cards) => {
  const s = fixture();
  s.catalog = createRegistry({ ...CARDS, ...Object.fromEntries(cards.map((d) => [d.name, d])) });
  return s;
};
test('a dying source queues its own trigger with old incarnation and controller', () => {
  let s = game(watcher('Death watcher', 'selfDies'));
  const o = put(s, 'Death watcher', 0);
  o.controller = 1;
  const old = ref(o);
  move(s, o, 'graveyard');
  assert.equal(s.pendingTriggers.length, 1);
  assert.equal(s.pendingTriggers[0].controller, 1);
  assert.deepEqual(s.pendingTriggers[0].source, old);
  assert.equal(o.controller, 0);
  stabilize(s);
  s = resolve(s);
  assert.equal(s.players[1].life, 21);
  assert.equal(s.players[0].life, 20);
});
test('simultaneous deaths use the complete pre-event battlefield independent of object order', () => {
  for (const order of [false, true]) {
    const s = game(watcher('Death watcher', 'controllerCreatureDies'));
    const pair = order
      ? [put(s, 'Grizzly Bears'), put(s, 'Death watcher')]
      : [put(s, 'Death watcher'), put(s, 'Grizzly Bears')];
    for (const o of pair) o.damage = 10;
    stateBasedActions(s);
    assert.equal(s.pendingTriggers.length, 2);
    assert.ok(pair.every((o) => o.zone === 'graveyard'));
  }
});
test('exile, bounce, discard and mill are not creature deaths', () => {
  const s = game(watcher('Death watcher', 'otherCreatureDies'));
  put(s, 'Death watcher');
  move(s, put(s, 'Grizzly Bears'), 'exile');
  move(s, put(s, 'Grizzly Bears'), 'hand');
  move(s, put(s, 'Grizzly Bears', 0, 'hand'), 'graveyard');
  move(s, put(s, 'Grizzly Bears', 0, 'library'), 'graveyard');
  assert.equal(s.pendingTriggers.length, 0);
});
test('token deaths trigger before tokens cease to exist; nontoken filters exclude them', () => {
  const s = game(
    watcher('Death watcher', 'otherCreatureDies'),
    watcher('Nontoken watcher', { event: 'dies', filter: { token: false }, excludeSource: true }),
  );
  put(s, 'Death watcher');
  put(s, 'Nontoken watcher');
  const token = put(s, 'Soldier Token');
  token.damage = 1;
  stateBasedActions(s);
  assert.equal(s.objects[token.id], undefined);
  assert.equal(s.pendingTriggers.length, 1);
  assert.equal(s.pendingTriggers[0].name, 'Death watcher');
});
test('death facts preserve pre-event power and controller through simultaneous anthem loss', () => {
  const d = watcher('Power watcher', {
    event: 'dies',
    controller: 'you',
    filter: { all: [{ type: 'creature' }, { power: { gte: 3 } }] },
  });
  d.static = { kind: 'anthem', power: 1, toughness: 1 };
  const s = game(d);
  const w = put(s, 'Power watcher'),
    bear = put(s, 'Grizzly Bears');
  w.damage = 5;
  bear.damage = 5;
  stateBasedActions(s);
  assert.equal(s.pendingTriggers.length, 1);
});
test('a self-reference in a death trigger cannot modify a returned incarnation', () => {
  let s = game(
    watcher('Death watcher', 'selfDies', [
      { op: 'modify', subject: 'source', power: 5, toughness: 5 },
    ]),
  );
  const o = put(s, 'Death watcher');
  move(s, o, 'graveyard');
  move(s, o, 'battlefield');
  stabilize(s);
  s = resolve(s);
  assert.equal(
    s.modifiers.some((m) => m.objectId === o.id),
    false,
  );
});

test('self-sacrifice is paid immediately, does not destroy, and its death trigger resolves above the activated ability', () => {
  let s = game({
    ...watcher('Offering', 'selfDies', [{ op: 'gainLife', amount: 2 }]),
    keywords: ['indestructible'],
    activated: [
      {
        cost: { sacrificeSelf: true },
        effects: [{ op: 'draw', count: 1 }],
        text: 'Sacrifice this creature: Draw a card.',
      },
    ],
  });
  const o = put(s, 'Offering'),
    old = ref(o);
  s = act(s, 'activate', { card: o.id, ability: 0 });
  assert.equal(s.objects[o.id].zone, 'graveyard');
  assert.equal(s.stack.length, 2);
  assert.deepEqual(s.stack[0].source, old);
  assert.equal(s.stack[1].effects[0].op, 'gainLife');
  s = resolve(s);
  assert.equal(s.players[0].life, 22);
  const hand = s.players[0].hand.length;
  s = resolve(s);
  assert.equal(s.players[0].hand.length, hand + 1);
});
test('unpayable self-sacrifice activation rejects without moving or tapping its source', () => {
  const s = game({
    ...watcher('Offering', 'selfDies'),
    activated: [
      {
        cost: { mana: { generic: 4 }, tap: true, sacrificeSelf: true },
        effects: [{ op: 'draw', count: 1 }],
        text: 'Draw a card.',
      },
    ],
  });
  const o = put(s, 'Offering');
  const before = structuredClone(s);
  const r = dispatch(s, { type: 'activate', player: 0, card: o.id, ability: 0 });
  assert.equal(r.ok, false);
  assert.deepEqual(s, before);
});
