import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  createGame,
  dispatch,
  stats,
  ref,
  hasKeyword,
} from '../src/index.js';
import { addObject, move } from '../src/model.js';
import { advanceStep } from '../src/turn.js';
import { legalTarget, enterBattlefield } from '../src/effects.js';
import { fixture, put, act, resolve } from './helpers.js';
function ready() {
  const s = fixture();
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: 0 };
  return s;
}
test('declaring an attacker queues its trigger before blockers or priority advances', () => {
  let s = ready();
  const a = put(s, 'Pulse Tracker');
  s = act(s, 'attackers', { cards: [a.id] });
  assert.equal(s.step, 'attackers');
  assert.equal(s.priority, 0);
  assert.equal(s.players[1].life, 20);
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(s.players[1].life, 19);
  assert.equal(s.step, 'attackers');
});
test('invalid declarations cannot queue partial triggers', () => {
  const s = ready(),
    a = put(s, 'Pulse Tracker'),
    b = put(s, 'Grizzly Bears');
  b.tapped = true;
  const before = JSON.stringify(s);
  const r = dispatch(s, { type: 'attackers', player: 0, cards: [a.id, b.id] });
  assert.equal(r.ok, false);
  assert.equal(r.state, s);
  assert.equal(JSON.stringify(s), before);
});
test('multiple attack triggers are ordered and source buffs wait for resolution', () => {
  let s = ready();
  const a = put(s, 'Borderland Marauder'),
    b = put(s, 'Steadfast Cathar');
  s = act(s, 'attackers', { cards: [a.id, b.id] });
  assert.equal(s.choice.kind, 'orderTriggers');
  assert.equal(stats(s, s.objects[a.id]).power, 1);
  s = act(s, 'orderTriggers', { ids: s.choice.entries.map((e) => e.id) });
  s = resolve(resolve(s));
  assert.equal(stats(s, s.objects[a.id]).power, 3);
  assert.equal(stats(s, s.objects[b.id]).toughness, 3);
});
test('declaring no attackers triggers nothing', () => {
  let s = ready();
  put(s, 'Pulse Tracker');
  s = act(s, 'attackers', { cards: [] });
  assert.equal(s.stack.length, 0);
});
test('putting a creature onto the battlefield attacking is not a declared attack', () => {
  const s = ready();
  s.choice = null;
  const a = addObject(s, 'Pulse Tracker', 0, 'void');
  enterBattlefield(s, a, 0);
  s.combat.attackers = [ref(a)];
  assert.equal(s.pendingTriggers.length, 0);
});
test('attack damage survives its source leaving; a self modification does not affect a new incarnation', () => {
  let s = ready();
  const a = put(s, 'Scorch Spitter');
  s = act(s, 'attackers', { cards: [a.id] });
  move(s, s.objects[a.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.players[1].life, 19);
  s = ready();
  const b = put(s, 'Borderland Marauder');
  s = act(s, 'attackers', { cards: [b.id] });
  move(s, s.objects[b.id], 'hand');
  enterBattlefield(s, s.objects[b.id], 0);
  s = resolve(s);
  assert.equal(stats(s, s.objects[b.id]).power, 1);
});
test('targeted attack triggers select before priority and recheck at resolution', () => {
  let s = ready();
  const a = put(s, 'Malamet Brawler'),
    b = put(s, 'Grizzly Bears');
  s = act(s, 'attackers', { cards: [a.id, b.id] });
  assert.equal(s.choice.kind, 'triggerTarget');
  assert.equal(s.choice.targets.length, 2);
  s = act(s, 'chooseTriggerTarget', { target: ref(s.objects[b.id]) });
  move(s, s.objects[b.id], 'hand');
  enterBattlefield(s, s.objects[b.id], 0);
  s = resolve(s);
  assert.equal(hasKeyword(s, s.objects[b.id], 'trample'), false);
  assert.ok(s.events.some((e) => e.type === 'fizzled'));
});
test('Civic Gardener can untap a targeted land, not a player or unrelated permanent', () => {
  let s = ready();
  const a = put(s, 'Civic Gardener'),
    land = put(s, 'Forest'),
    artifact = put(s, 'Expedition Map');
  land.tapped = true;
  s = act(s, 'attackers', { cards: [a.id] });
  assert.equal(s.choice.kind, 'triggerTarget');
  assert.ok(s.choice.targets.some((t) => t.id === land.id));
  assert.ok(!s.choice.targets.some((t) => t.id === artifact.id));
  s = act(s, 'chooseTriggerTarget', { target: ref(s.objects[land.id]) });
  s = resolve(s);
  assert.equal(s.objects[land.id].tapped, false);
});
test('legendary target filters distinguish ordinary creatures from legends', () => {
  let s = ready();
  const a = put(s, 'Mirkwood Spider'),
    b = put(s, 'Isamaru, Hound of Konda');
  s = act(s, 'attackers', { cards: [a.id] });
  assert.deepEqual(s.choice.targets, [ref(s.objects[b.id])]);
  s = act(s, 'chooseTriggerTarget', { target: ref(s.objects[b.id]) });
  s = resolve(s);
  assert.equal(hasKeyword(s, s.objects[b.id], 'deathtouch'), true);
});
test('scry on attack remains a resolution choice with no intervening priority', () => {
  let s = ready();
  const a = put(s, 'Lothlórien Lookout');
  s = act(s, 'attackers', { cards: [a.id] });
  s = resolve(s);
  assert.equal(s.choice.kind, 'libraryOrder');
  assert.equal(dispatch(s, { type: 'pass', player: 0 }).ok, false);
  s = act(s, 'orderLibrary', { top: s.choice.cards, rest: [] });
  assert.equal(s.choice, null);
  assert.equal(s.resolving, null);
});
test('the sparring policy sees lethal attack damage before an unbeatable blocker', async () => {
  const { chooseBotCommand } = await import('../src/index.js');
  const s = ready(),
    a = put(s, 'Pulse Tracker');
  put(s, 'Yargle and Multani', 1);
  s.players[1].life = 1;
  const before = JSON.stringify(s),
    cmd = chooseBotCommand(s, 0);
  assert.deepEqual(cmd.cards, [a.id]);
  assert.equal(JSON.stringify(s), before);
});
test('the sparring policy sees a mandatory self-pump before blockers', async () => {
  const { chooseBotCommand } = await import('../src/index.js');
  const s = ready(),
    a = put(s, 'Jumbo Cactuar');
  s.players[1].life = 20;
  const cmd = chooseBotCommand(s, 0);
  assert.deepEqual(cmd.cards, [a.id]);
});
test('untap targeting prefers a useful tapped permanent over an untapped large creature', async () => {
  const { chooseBotCommand } = await import('../src/index.js');
  let s = ready();
  const a = put(s, 'Civic Gardener'),
    land = put(s, 'Forest');
  land.tapped = true;
  put(s, 'Yargle and Multani');
  s = act(s, 'attackers', { cards: [a.id] });
  const cmd = chooseBotCommand(s, 0);
  assert.ok([a.id, land.id].includes(cmd.target.id));
  assert.equal(s.objects[cmd.target.id].tapped, true);
});
test('opponent attack watchers are stacked after the active player’s trigger', () => {
  const watcher = {
    name: 'Attack watcher fixture',
    type: 'creature',
    cost: {},
    power: 1,
    toughness: 3,
    keywords: [],
    triggers: [
      {
        event: { event: 'attack', controller: 'opponent' },
        effects: [{ op: 'gainLife', amount: 1 }],
      },
    ],
  };
  let s = createGame({
    mulligan: false,
    catalog: createRegistry([...Object.values(CARDS), watcher]),
  });
  s.turn = 3;
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: 0 };
  const a = put(s, 'Pulse Tracker');
  put(s, watcher.name, 1);
  s = act(s, 'attackers', { cards: [a.id] });
  assert.deepEqual(
    s.stack.map((e) => e.controller),
    [0, 1],
  );
  s = resolve(s);
  assert.equal(s.players[1].life, 21);
  s = resolve(s);
  assert.equal(s.players[1].life, 20);
});
test('attack damage uses lifelink but life loss does not', () => {
  for (const name of ['Scorch Spitter', 'Pulse Tracker']) {
    let s = ready();
    const a = put(s, name);
    s.modifiers.push({
      objectId: a.id,
      incarnation: a.incarnation,
      power: 0,
      toughness: 0,
      keywords: ['lifelink'],
      expires: s.turn,
    });
    s = act(s, 'attackers', { cards: [a.id] });
    s = resolve(s);
    assert.equal(s.players[1].life, 19);
    assert.equal(s.players[0].life, name === 'Scorch Spitter' ? 21 : 20);
  }
});
test('typed attacking filters do not match a permanent after combat ends', () => {
  let s = ready();
  const a = put(s, 'Grizzly Bears');
  s = act(s, 'attackers', { cards: [a.id] });
  const selector = {
    scope: 'permanent',
    where: { all: [{ type: 'creature' }, { attacking: true }] },
  };
  assert.equal(legalTarget(s, selector, ref(s.objects[a.id]), 0), true);
  s.combat.attackers = [];
  assert.equal(legalTarget(s, selector, ref(s.objects[a.id]), 0), false);
});
