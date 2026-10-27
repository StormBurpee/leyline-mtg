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
  validateDefinition,
} from '../src/index.js';
import { addObject, ref, move, notifyTriggers } from '../src/model.js';
import { enterBattlefield, enterBattlefieldBatch, stabilize } from '../src/effects.js';
import { act, resolve, put } from './helpers.js';
const modes = [
  { label: 'Destroy target artifact', target: 'artifact', effects: [{ op: 'destroy' }] },
  { label: 'Gain 3 life', effects: [{ op: 'gainLife', amount: 3 }] },
  {
    label: 'Tap up to one creature',
    targetGroups: [{ id: 'chosen', selector: 'creature', min: 0, max: 1 }],
    effects: [{ op: 'tap', targetGroup: 'chosen' }],
  },
];
const modal = {
  name: 'Modal trigger fixture',
  type: 'creature',
  cost: {},
  power: 2,
  toughness: 2,
  triggers: [{ event: 'selfEnters', modes }],
};
function setup(def = modal) {
  const s = createGame({
    mulligan: false,
    catalog: createRegistry([...Object.values(CARDS), def]),
  });
  s.step = 'main1';
  s.turn = 3;
  const card = addObject(s, def.name, 0, 'hand');
  return { s, card };
}
function enter(s, card) {
  enterBattlefield(s, card, card.owner);
  stabilize(s);
  return s;
}
function reject(s, command) {
  const snapshot = structuredClone(s),
    result = dispatch(s, { player: s.choice?.player ?? s.priority, ...command });
  assert.equal(result.ok, false);
  assert.equal(result.state, s);
  assert.deepEqual(s, snapshot);
}
test('choose-one trigger mode is announced after SBA and before its selected targets; no priority between', () => {
  let { s, card } = setup();
  const artifact = put(s, 'Expedition Map', 1);
  enter(s, card);
  assert.equal(s.choice.kind, 'triggerMode');
  assert.equal(s.stack.length, 0);
  assert.deepEqual(s.choice.modes, [0, 1, 2]);
  assert.deepEqual(
    legalActions(s, 0)
      .filter((a) => a.type === 'chooseTriggerMode')
      .map((a) => a.mode),
    [0, 1, 2],
  );
  reject(s, { type: 'pass' });
  reject(s, { type: 'chooseTriggerTarget', target: ref(artifact) });
  for (const mode of [undefined, -1, 3, 1.2, '0', null])
    reject(s, { type: 'chooseTriggerMode', mode });
  reject(s, { type: 'chooseTriggerMode', mode: 0, player: 1 });
  s = act(s, 'chooseTriggerMode', { mode: 0 });
  assert.equal(s.choice.kind, 'triggerTarget');
  assert.equal(s.stack.length, 0);
  reject(s, { type: 'pass' });
  reject(s, { type: 'chooseTriggerMode', mode: 1 });
  s = act(s, 'chooseTriggerTarget', { target: ref(artifact) });
  assert.equal(s.stack.at(-1).mode, 0);
  assert.match(s.stack.at(-1).label, /Destroy target artifact/);
  assert.equal(s.stack.at(-1).modes, undefined);
  s = resolve(s);
  assert.equal(s.objects[artifact.id].zone, 'graveyard');
  assert.equal(s.players[0].life, 20);
});
test('unavailable required targets remove that mode, optional zero targets remain legal, all unavailable modes remove trigger', () => {
  let { s, card } = setup();
  enter(s, card);
  assert.deepEqual(s.choice.modes, [1, 2]);
  reject(s, { type: 'chooseTriggerMode', mode: 0 });
  s = act(s, 'chooseTriggerMode', { mode: 2 });
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [] } });
  s = resolve(s);
  assert.equal(s.choice, null);
  assert.equal(s.objects[card.id].tapped, false);
  ({ s, card } = setup({
    ...modal,
    triggers: [
      { event: 'selfEnters', modes: [modes[0], { ...modes[0], label: 'Also destroy artifact' }] },
    ],
  }));
  enter(s, card);
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 0);
  assert.equal(s.events.at(-1).reason, 'no legal mode');
});
test('selected mode is fixed when target leaves and does not follow a new target incarnation', () => {
  let { s, card } = setup();
  const artifact = put(s, 'Expedition Map');
  enter(s, card);
  s = act(s, 'chooseTriggerMode', { mode: 0 });
  s = act(s, 'chooseTriggerTarget', { target: ref(artifact) });
  move(s, s.objects[artifact.id], 'hand');
  move(s, s.objects[artifact.id], 'battlefield');
  s = resolve(s);
  assert.equal(s.objects[artifact.id].zone, 'battlefield');
  assert.equal(s.players[0].life, 20);
});
test('simultaneous modal triggers preserve order, APNAP and per-entry choices without extra priority', () => {
  let { s, card } = setup();
  const other = addObject(s, modal.name, 0, 'hand'),
    opponent = addObject(s, modal.name, 1, 'hand');
  enterBattlefieldBatch(s, [{ object: card }, { object: other }, { object: opponent }]);
  stabilize(s);
  assert.equal(s.choice.kind, 'orderTriggers');
  assert.equal(s.choice.player, 0);
  const ids = s.choice.entries.map((e) => e.id).reverse();
  s = act(s, 'orderTriggers', { ids });
  assert.equal(s.choice.entry.id, ids[0]);
  s = act(s, 'chooseTriggerMode', { mode: 1 });
  assert.equal(s.choice.entry.id, ids[1]);
  assert.equal(s.stack.length, 1);
  reject(s, { type: 'pass' });
  s = act(s, 'chooseTriggerMode', { mode: 2 });
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [] } });
  assert.equal(s.choice.kind, 'triggerMode');
  assert.equal(s.choice.player, 1);
  s = act(s, 'chooseTriggerMode', { mode: 1 });
  assert.deepEqual(
    s.stack.map((e) => e.controller),
    [0, 0, 1],
  );
  assert.deepEqual(
    s.stack.slice(0, 2).map((e) => e.id),
    ids,
  );
});
test('mode is not chosen at occurrence or resolution, survives source departure and optional resolution', () => {
  let { s, card } = setup({
    ...modal,
    toughness: 0,
    triggers: [{ event: 'selfEnters', optional: true, modes }],
  });
  enter(s, card);
  assert.equal(s.objects[card.id].zone, 'graveyard');
  assert.equal(s.choice.kind, 'triggerMode');
  assert.notEqual(s.choice.entry.source.incarnation, s.objects[card.id].incarnation);
  s = act(s, 'chooseTriggerMode', { mode: 1 });
  s = resolve(s);
  assert.equal(s.choice.kind, 'optionalEffect');
  s = act(s, 'resolveOptional', { accept: false });
  assert.equal(s.players[0].life, 20);
  assert.equal(s.choice, null);
});
test('bot picks a legal public mode independent of hidden library order', () => {
  let { s, card } = setup();
  enter(s, card);
  const a = chooseBotCommand(s, 0),
    changed = structuredClone(s);
  changed.players[1].library.reverse();
  changed.players[0].library.reverse();
  assert.deepEqual(chooseBotCommand(changed, 0), a);
  assert.equal(a.type, 'chooseTriggerMode');
  assert.ok(s.choice.modes.includes(a.mode));
  assert.equal(dispatch(s, a).ok, true);
});
test('modal trigger command is replayable before and after target announcement', () => {
  const catalog = createRegistry([...Object.values(CARDS), modal]);
  const deck = [...Array(4).fill(modal.name), ...Array(3).fill('Forest')];
  let s = createGame({
    seed: 2,
    minimumDeckSize: 7,
    mulligan: false,
    catalog,
    decks: [deck, deck],
  });
  while (s.step !== 'main1') s = act(s, 'pass');
  s = resolve(
    act(s, 'cast', { card: s.players[0].hand.find((id) => s.objects[id].name === modal.name) }),
  );
  assert.equal(s.choice.kind, 'triggerMode');
  assert.deepEqual(replay(exportReplay(s)), s);
  s = act(s, 'chooseTriggerMode', { mode: 2 });
  assert.deepEqual(replay(exportReplay(s)), s);
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [] } });
  assert.deepEqual(replay(exportReplay(s)), s);
  s = resolve(s);
  assert.deepEqual(replay(exportReplay(s)), s);
});
test('native modal triggers reject ambiguous shared fields, duplicate labels and unsupported cross-group requirements', () => {
  assert.deepEqual(validateDefinition(modal), []);
  for (const trigger of [
    { event: 'selfEnters', modes, effects: [] },
    { event: 'selfEnters', modes, target: 'creature' },
    { event: 'selfEnters', modes: [modes[0]] },
    { event: 'selfEnters', modes: [modes[0], modes[0]] },
    { event: 'selfEnters', modes: [{ ...modes[0], additionalCost: {} }, modes[1]] },
    { event: 'nonsense', modes },
    {
      event: 'selfEnters',
      modes: [
        {
          ...modes[2],
          targetGroups: [
            { id: 'a', selector: 'creature', min: 0, max: 1 },
            { id: 'b', selector: 'creature', min: 0, max: 1, excludeFrom: ['a'] },
          ],
        },
        modes[1],
      ],
    },
  ])
    assert.ok(validateDefinition({ ...modal, triggers: [trigger] }).length);
});

test('modal announcements use opaque session commands without concealed handles', async () => {
  const { createSession } = await import('../../simulation/session.js');
  const deck = [...Array(4).fill(modal.name), ...Array(3).fill('Forest')];
  const session = createSession({
    mulligan: false,
    minimumDeckSize: 7,
    decks: [deck, deck],
    catalog: createRegistry([modal, CARDS.Forest]),
  });
  const step = (select) => {
    const c = session.context();
    const action = select(c);
    assert.ok(action);
    assert.equal(session.step(action).ok, true);
  };
  while (session.context().observation.step !== 'main1')
    step((c) => c.actions.find((a) => a.type === 'pass'));
  step((c) => c.actions.find((a) => a.type === 'cast'));
  step((c) => c.actions.find((a) => a.type === 'pass'));
  step((c) => c.actions.find((a) => a.type === 'pass'));
  let c = session.context();
  assert.equal(c.observation.choice.kind, 'triggerMode');
  assert.equal(c.observation.choice.remainingEntries, undefined);
  assert.equal(c.observation.choice.remaining, undefined);
  assert.ok(c.observation.choice.entry.source.id.startsWith('object:'));
  assert.equal(c.observation.players[1].hand, undefined);
  assert.equal(c.observation.players[0].library, undefined);
  step((c) => c.actions.find((a) => a.type === 'chooseTriggerMode' && a.mode === 2));
  step((c) =>
    c.actions.find((a) => a.type === 'chooseTriggerTargets' && a.targets.chosen.length === 1),
  );
  assert.equal(session.context().observation.stack.at(-1).mode, 2);
});
