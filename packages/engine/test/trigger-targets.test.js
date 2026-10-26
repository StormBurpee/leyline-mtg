import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  dispatch,
  ref,
  legalActions,
  chooseBotCommand,
} from '../src/index.js';
import { enterBattlefield, stabilize, queueTrigger } from '../src/effects.js';
import { move } from '../src/model.js';
import { fixture, put, act, resolve, lands } from './helpers.js';
const spark = {
  name: 'Target trigger fixture',
  type: 'creature',
  cost: {},
  power: 2,
  toughness: 2,
  triggers: [{ event: 'selfEnters', target: 'any', effects: [{ op: 'damage', amount: 2 }] }],
};
function setup(extra = {}) {
  const s = fixture();
  s.catalog = createRegistry({ ...CARDS, [spark.name]: spark, ...extra });
  return s;
}
function enter(s, name = spark.name, owner = 0) {
  const source = put(s, name, owner, 'hand');
  enterBattlefield(s, source);
  stabilize(s);
  return source;
}
test('ETB targets are chosen before priority, not during resolution', () => {
  let s = setup();
  const source = enter(s);
  assert.equal(s.choice.kind, 'triggerTarget');
  assert.equal(s.stack.length, 0);
  assert.ok(s.choice.targets.some((t) => t.kind === 'object' && t.id === source.id));
  const snapshot = JSON.stringify(s);
  assert.equal(dispatch(s, { type: 'pass', player: 0 }).ok, false);
  assert.equal(
    dispatch(s, { type: 'chooseTriggerTarget', player: 1, target: { kind: 'player', id: 0 } }).ok,
    false,
  );
  assert.equal(JSON.stringify(s), snapshot);
  s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 1);
  assert.equal(s.players[1].life, 20);
  s = resolve(s);
  assert.equal(s.players[1].life, 18);
});
test('a required target with no legal candidate removes the trigger', () => {
  let s = setup({
    [spark.name]: {
      ...spark,
      triggers: [{ event: 'selfEnters', target: 'artifact', effects: [{ op: 'destroy' }] }],
    },
  });
  enter(s);
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 0);
  assert.equal(s.events.at(-1).type, 'triggerRemoved');
});
test('shroud, opposing hexproof and stale incarnations are rejected atomically', () => {
  let s = setup({
    Shield: {
      name: 'Shield',
      type: 'creature',
      cost: {},
      power: 1,
      toughness: 1,
      keywords: ['hexproof'],
    },
    Shroud: {
      name: 'Shroud',
      type: 'creature',
      cost: {},
      power: 1,
      toughness: 1,
      keywords: ['shroud'],
    },
  });
  const shield = put(s, 'Shield', 1),
    shroud = put(s, 'Shroud', 0);
  enter(s);
  const snapshot = JSON.stringify(s);
  for (const target of [
    ref(shield),
    ref(shroud),
    { ...ref(shield), incarnation: shield.incarnation + 1 },
    { kind: 'object', id: 'missing', incarnation: 0 },
    { kind: 'player', id: 2 },
  ])
    assert.equal(dispatch(s, { type: 'chooseTriggerTarget', player: 0, target }).ok, false);
  assert.equal(JSON.stringify(s), snapshot);
});
test('the target is checked again when a triggered ability resolves', () => {
  let s = setup();
  const bear = put(s, 'Grizzly Bears', 1);
  enter(s);
  s = act(s, 'chooseTriggerTarget', { target: ref(bear) });
  move(s, s.objects[bear.id], 'hand');
  move(s, s.objects[bear.id], 'battlefield');
  s = resolve(s);
  assert.equal(s.objects[bear.id].damage, 0);
});
test('targeting an opposing ward permanent queues ward above the ability', () => {
  let s = setup({
    Wardling: {
      name: 'Wardling',
      type: 'creature',
      cost: {},
      power: 3,
      toughness: 3,
      ward: { mana: { generic: 2 } },
    },
  });
  const ward = put(s, 'Wardling', 1);
  enter(s);
  s = act(s, 'chooseTriggerTarget', { target: ref(ward) });
  assert.equal(s.stack.length, 2);
  assert.equal(s.stack.at(-1).relatedStackId, s.stack[0].id);
  s = resolve(s);
  assert.equal(s.choice.kind, 'payCost');
  s = act(s, 'payCost', { pay: false });
  assert.equal(s.stack.length, 0);
  assert.equal(s.objects[ward.id].damage, 0);
});
test('APNAP ordering finishes active-player target choices before the defending player', () => {
  let s = setup();
  const first = put(s, spark.name, 0),
    second = put(s, spark.name, 1);
  queueTrigger(s, first, [{ op: 'draw', count: 1 }], 'A draw');
  queueTrigger(s, first, [{ op: 'damage', amount: 1 }], 'A target', false, 'any');
  queueTrigger(s, second, [{ op: 'damage', amount: 2 }], 'B target', false, 'any');
  stabilize(s);
  const ids = s.choice.entries.map((e) => e.id);
  s = act(s, 'orderTriggers', { ids });
  assert.equal(s.stack[0].label, 'A draw');
  assert.equal(s.choice.player, 0);
  s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
  assert.equal(s.choice.player, 1);
  s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 0 } });
  assert.deepEqual(
    s.stack.map((e) => e.label),
    ['A draw', 'A target', 'B target'],
  );
  assert.equal(s.choice, null);
});
test('optional targeted triggers still select targets, then may be declined on resolution', () => {
  let s = setup({
    [spark.name]: { ...spark, triggers: [{ ...spark.triggers[0], optional: true }] },
  });
  enter(s);
  s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.choice.kind, 'optionalEffect');
  s = act(s, 'resolveOptional', { accept: false });
  assert.equal(s.players[1].life, 20);
});
test('a dead source keeps its triggered ability and last-known lifelink', () => {
  let s = setup({ [spark.name]: { ...spark, keywords: ['lifelink'], toughness: 0 } });
  const source = enter(s);
  assert.equal(s.objects[source.id].zone, 'graveyard');
  s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.players[0].life, 22);
  assert.equal(s.players[1].life, 18);
});
test('the baseline bot can complete a target choice without hidden information', () => {
  let s = setup();
  enter(s);
  const command = chooseBotCommand(s, 0);
  assert.equal(command.type, 'chooseTriggerTarget');
  assert.equal(dispatch(s, command).ok, true);
  assert.equal(legalActions(s, 0)[0].type, 'chooseTriggerTarget');
});

test('Man-o-War must return itself when it is the only creature', () => {
  let s = fixture();
  const source = enter(s, "Man-o'-War");
  assert.deepEqual(s.choice.targets, [ref(s.objects[source.id])]);
  s = act(s, 'chooseTriggerTarget', { target: s.choice.targets[0] });
  s = resolve(s);
  assert.equal(s.objects[source.id].zone, 'hand');
});
test('Flametongue Kavu can be forced to damage and kill itself', () => {
  let s = fixture();
  const source = enter(s, 'Flametongue Kavu');
  s = act(s, 'chooseTriggerTarget', { target: ref(s.objects[source.id]) });
  s = resolve(s);
  assert.equal(s.objects[source.id].zone, 'graveyard');
});
test('Reclamation Sage chooses a target before its optional resolution decision', () => {
  let s = fixture();
  const artifact = put(s, 'Ornithopter', 1);
  enter(s, 'Reclamation Sage');
  s = act(s, 'chooseTriggerTarget', { target: ref(artifact) });
  s = resolve(s);
  assert.equal(s.choice.kind, 'optionalEffect');
  const declined = act(s, 'resolveOptional', { accept: false });
  assert.equal(declined.objects[artifact.id].zone, 'battlefield');
  const accepted = act(s, 'resolveOptional', { accept: true });
  assert.equal(accepted.objects[artifact.id].zone, 'graveyard');
});
test('Meteor Golem cannot target lands or its own controller’s permanents', () => {
  let s = fixture();
  const land = put(s, 'Forest', 1),
    own = put(s, 'Grizzly Bears'),
    enemy = put(s, 'Glorious Anthem', 1);
  enter(s, 'Meteor Golem');
  assert.deepEqual(s.choice.targets, [ref(enemy)]);
  for (const target of [ref(land), ref(own)])
    assert.equal(dispatch(s, { type: 'chooseTriggerTarget', player: 0, target }).ok, false);
  s = act(s, 'chooseTriggerTarget', { target: ref(enemy) });
  s = resolve(s);
  assert.equal(s.objects[enemy.id].zone, 'graveyard');
});
for (const name of ['Exclusion Mage', 'Ravenous Chupacabra'])
  test(`${name} only targets opposing creatures`, () => {
    let s = fixture();
    const own = put(s, 'Grizzly Bears'),
      enemy = put(s, 'Grizzly Bears', 1);
    enter(s, name);
    assert.deepEqual(s.choice.targets, [ref(enemy)]);
    s = act(s, 'chooseTriggerTarget', { target: ref(enemy) });
    s = resolve(s);
    assert.equal(s.objects[enemy.id].zone, name === 'Exclusion Mage' ? 'hand' : 'graveyard');
    assert.equal(s.objects[own.id].zone, 'battlefield');
  });
test('Acidic Slime targets artifacts, enchantments and lands but not an ordinary creature', () => {
  let s = fixture();
  const land = put(s, 'Forest', 1),
    artifact = put(s, 'Ornithopter', 1),
    enchantment = put(s, 'Glorious Anthem', 1),
    bear = put(s, 'Grizzly Bears', 1);
  enter(s, 'Acidic Slime');
  assert.deepEqual(
    new Set(s.choice.targets.map((t) => t.id)),
    new Set([land.id, artifact.id, enchantment.id]),
  );
  assert.equal(
    dispatch(s, { type: 'chooseTriggerTarget', player: 0, target: ref(bear) }).ok,
    false,
  );
  s = act(s, 'chooseTriggerTarget', { target: ref(land) });
  s = resolve(s);
  assert.equal(s.objects[land.id].zone, 'graveyard');
});
test('Sage’s Row Denizen uses color, controller and other-creature predicates together', () => {
  let s = fixture();
  enter(s, "Sage's Row Denizen");
  assert.equal(s.choice, null);
  enter(s, 'Raging Goblin');
  assert.equal(s.choice, null);
  enter(s, 'Stormchaser Mage', 1);
  assert.equal(s.choice, null);
  enter(s, 'Stormchaser Mage', 0);
  assert.equal(s.choice.kind, 'triggerTarget');
  const count = s.players[1].library.length;
  s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.players[1].library.length, count - 2);
  assert.equal(s.players[1].graveyard.length, 2);
});

test('ward generated during target selection waits until both APNAP groups are placed', () => {
  let s = setup({
    Wardling: {
      name: 'Wardling',
      type: 'creature',
      cost: {},
      power: 3,
      toughness: 3,
      ward: { mana: { generic: 1 } },
    },
  });
  const a = put(s, spark.name, 0),
    b = put(s, 'Wardling', 1);
  queueTrigger(s, a, [{ op: 'damage', amount: 1 }], 'active trigger', false, 'any');
  queueTrigger(s, b, [{ op: 'damage', amount: 1 }], 'nonactive trigger', false, 'any');
  stabilize(s);
  s = act(s, 'chooseTriggerTarget', { target: ref(b) });
  assert.equal(s.choice.player, 1);
  assert.equal(s.stack.length, 1);
  assert.equal(s.pendingTriggers.length, 1);
  s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 0 } });
  assert.deepEqual(
    s.stack.map((e) => e.label),
    ['active trigger', 'nonactive trigger', 'Wardling · ward'],
  );
});
test('trigger target choices can counter a spell without allowing an ability as a spell target', () => {
  let s = setup();
  lands(s, 'Forest', 2);
  const bear = put(s, 'Grizzly Bears', 0, 'hand');
  s = act(s, 'cast', { card: bear.id });
  const source = put(s, spark.name, 1);
  queueTrigger(s, source, [{ op: 'counter' }], 'counter trigger', false, 'spell');
  stabilize(s);
  assert.equal(s.choice.targets.length, 1);
  s = act(s, 'chooseTriggerTarget', { target: s.choice.targets[0] });
  s = resolve(s);
  assert.equal(s.stack.length, 0);
  assert.equal(s.objects[bear.id].zone, 'graveyard');
});
