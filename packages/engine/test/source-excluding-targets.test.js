import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  legalActions,
  legalTarget,
  targetsFor,
  abilityProblem,
  chooseBotCommand,
  dispatch,
  stats,
} from '../src/index.js';
import { move, ref, notifyTriggers } from '../src/model.js';
import { stabilize, enterBattlefield } from '../src/effects.js';
import { validateTargetSpec } from '../src/selectors.js';
import { targetPlans, targetPlanProblem, survivingTargets } from '../src/target-groups.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
const other = { scope: 'permanent', where: { type: 'creature' }, excludeSource: true };
const yours = { ...other, where: { all: [{ type: 'creature' }, { controller: 'you' }] } };
test('source exclusion is explicit, typed, object-only and fails closed without source context', () => {
  assert.deepEqual(validateTargetSpec(other), []);
  assert.ok(validateTargetSpec({ ...other, excludeSource: 'yes' }).length);
  assert.ok(validateTargetSpec({ scope: 'player', excludeSource: true }).length);
  assert.ok(validateTargetSpec({ scope: 'spell', excludeSource: true }).length);
  const s = fixture(),
    source = put(s, 'Grizzly Bears'),
    friend = put(s, 'Grizzly Bears'),
    enemy = put(s, 'Grizzly Bears', 1);
  assert.deepEqual(targetsFor(s, other, 0), []);
  assert.deepEqual(targetsFor(s, other, 0, {}), []);
  assert.equal(legalTarget(s, other, ref(source), 0, ref(source)), false);
  assert.deepEqual(targetsFor(s, other, 0, ref(source)), [ref(friend), ref(enemy)]);
  assert.deepEqual(targetsFor(s, yours, 0, ref(source)), [ref(friend)]);
  assert.ok(legalTarget(s, 'creature', ref(source), 0));
});
test('an ETB trigger omits itself and same-name other objects remain legal', () => {
  let s = fixture();
  const a = put(s, 'Sterling Supplier'),
    b = put(s, 'Sterling Supplier');
  notifyTriggers(s, 'enter', { object: a });
  stabilize(s);
  assert.deepEqual(s.choice.targets, [ref(b)]);
  const bad = dispatch(s, { type: 'chooseTriggerTarget', player: 0, target: ref(a) });
  assert.equal(bad.ok, false);
  assert.deepEqual(chooseBotCommand(s, 0).target, ref(b));
  s = act(s, 'chooseTriggerTarget', { target: ref(b) });
  s = resolve(s);
  assert.equal(s.objects[b.id].plusCounters, 1);
  assert.equal(s.objects[a.id].plusCounters, 0);
});
test('a required other-target trigger with only its source is removed, not stuck', () => {
  const s = fixture(),
    a = put(s, 'Sterling Supplier');
  notifyTriggers(s, 'enter', { object: a });
  stabilize(s);
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 0);
  assert.ok(s.events.some((e) => e.type === 'triggerRemoved'));
});
test('old ETB trigger can target its blinked new source incarnation before target selection', () => {
  let s = fixture();
  const a = put(s, 'Sterling Supplier');
  const old = ref(a);
  notifyTriggers(s, 'enter', { object: a });
  move(s, a, 'exile');
  move(s, a, 'battlefield');
  stabilize(s);
  assert.notDeepEqual(ref(a), old);
  assert.deepEqual(s.choice.entry.source, old);
  assert.deepEqual(s.choice.targets, [ref(a)]);
  s = act(s, 'chooseTriggerTarget', { target: ref(a) });
  s = resolve(s);
  assert.equal(s.objects[a.id].plusCounters, 1);
});
test('source departure after target declaration does not fizzle a legal other target', () => {
  let s = fixture();
  const a = put(s, 'Sterling Supplier'),
    b = put(s, 'Grizzly Bears');
  notifyTriggers(s, 'enter', { object: a });
  stabilize(s);
  s = act(s, 'chooseTriggerTarget', { target: ref(b) });
  move(s, s.objects[a.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[b.id].plusCounters, 1);
});
test('source exclusion survives controller change while its controller predicate is independent', () => {
  const s = fixture(),
    a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears');
  const source = ref(a);
  a.controller = 1;
  assert.equal(legalTarget(s, other, ref(a), 0, source), false);
  assert.equal(legalTarget(s, yours, ref(b), 0, source), true);
});
test('graveyard activation targets are validated before exiling its source', () => {
  let s = fixture();
  lands(s, 'Swamp', 4);
  const a = put(s, 'Bonebind Orator', 0, 'graveyard'),
    b = put(s, 'Grizzly Bears', 0, 'graveyard');
  assert.ok(abilityProblem(s, 0, a.id, 0, ref(a)));
  assert.equal(abilityProblem(s, 0, a.id, 0, ref(b)), null);
  const proposals = legalActions(s, 0).filter((c) => c.card === a.id && c.type === 'activate');
  assert.equal(proposals.length, 1);
  assert.deepEqual(proposals[0].target, ref(b));
  s = act(s, 'activate', { card: a.id, ability: 0, target: ref(b) });
  assert.equal(s.objects[a.id].zone, 'exile');
  s = resolve(s);
  assert.equal(s.objects[b.id].zone, 'hand');
});
test('sacrifice-self activation excludes itself even though payment would remove it', () => {
  let s = fixture();
  lands(s, 'Mountain', 2);
  const a = put(s, 'Aetherjacket'),
    b = put(s, 'Basilisk Collar');
  assert.ok(abilityProblem(s, 0, a.id, 0, ref(a)));
  s = act(s, 'activate', { card: a.id, ability: 0, target: ref(b) });
  assert.equal(s.objects[a.id].zone, 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[b.id].zone, 'graveyard');
});
test('grouped plans, manual validation and surviving bindings share exact source exclusion', () => {
  const s = fixture(),
    a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears'),
    c = put(s, 'Grizzly Bears');
  const groups = [
    { id: 'one', selector: other, min: 1, max: 1 },
    { id: 'two', selector: other, min: 0, max: 1, excludeFrom: ['one'] },
  ];
  assert.ok(targetPlanProblem(s, groups, { one: [ref(a)], two: [] }, 0, ref(a)));
  const plans = targetPlans(s, groups, 0, 256, ref(a));
  assert.equal(plans.length, 4);
  assert.ok(plans.every((plan) => !targetPlanProblem(s, groups, plan, 0, ref(a))));
  assert.equal(targetPlanProblem(s, groups, { one: [ref(c)], two: [ref(b)] }, 0, ref(a)), null);
  const plan = { one: [ref(b)], two: [ref(c)] };
  move(s, b, 'hand');
  assert.deepEqual(survivingTargets(s, groups, plan, 0, ref(a)), { one: [], two: [ref(c)] });
});
test('own dies trigger excludes its first graveyard incarnation without changing source LKI', () => {
  let s = fixture();
  const target = { scope: 'graveyard', where: { type: 'creature' }, excludeSource: true };
  s.catalog = createRegistry({
    ...CARDS,
    'Death other fixture': {
      name: 'Death other fixture',
      type: 'creature',
      cost: {},
      power: 2,
      toughness: 2,
      triggers: [
        {
          event: { event: 'dies', object: 'source' },
          target,
          effects: [{ op: 'moveTarget', destination: 'hand' }],
        },
      ],
    },
  });
  const a = put(s, 'Death other fixture'),
    b = put(s, 'Grizzly Bears', 0, 'graveyard');
  const original = ref(a);
  move(s, a, 'graveyard');
  stabilize(s);
  assert.deepEqual(s.choice.targets, [ref(b)]);
  assert.deepEqual(s.choice.entry.source, original);
  assert.deepEqual(s.choice.entry.targetingSource, ref(a));
  s = act(s, 'chooseTriggerTarget', { target: ref(b) });
  s = resolve(s);
  assert.equal(s.objects[b.id].zone, 'hand');
});

import { createGame, exportReplay, replay, validateDefinition } from '../src/index.js';
import { game } from '../../../apps/web/view.js';
test('optional grouped ETB bounce offers zero targets and rejects its own source', () => {
  let s = fixture();
  const a = put(s, 'Rimekin Recluse'),
    b = put(s, 'Grizzly Bears');
  notifyTriggers(s, 'enter', { object: a });
  stabilize(s);
  assert.equal(s.choice.kind, 'triggerTargets');
  const actions = legalActions(s, 0).filter((c) => c.type === 'chooseTriggerTargets');
  assert.equal(actions.length, 2);
  assert.ok(actions.every((c) => !c.targets.chosen.some((t) => t.id === a.id)));
  assert.equal(
    dispatch(s, { type: 'chooseTriggerTargets', player: 0, targets: { chosen: [ref(a)] } }).ok,
    false,
  );
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [ref(b)] } });
  s = resolve(s);
  assert.equal(s.objects[b.id].zone, 'hand');
});
test('grouped activated proposals and manual commands exclude their source before payment', () => {
  let s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Other group fixture': {
      name: 'Other group fixture',
      type: 'creature',
      cost: {},
      power: 2,
      toughness: 2,
      activated: [
        {
          cost: {},
          targetGroups: [{ id: 'chosen', selector: other, min: 1, max: 1 }],
          effects: [{ op: 'counterOn', amount: 1, targetGroup: 'chosen' }],
        },
      ],
    },
  });
  const a = put(s, 'Other group fixture'),
    b = put(s, 'Grizzly Bears');
  assert.ok(abilityProblem(s, 0, a.id, 0, null, undefined, { chosen: [ref(a)] }));
  const actions = legalActions(s, 0).filter((c) => c.type === 'activate' && c.card === a.id);
  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0].targets, { chosen: [ref(b)] });
  s = act(s, 'activate', { card: a.id, ability: 0, targets: { chosen: [ref(b)] } });
  s = resolve(s);
  assert.equal(s.objects[b.id].plusCounters, 1);
});
test('own death source snapshot never follows subsequent graveyard moves', () => {
  const s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Death snapshot': {
      name: 'Death snapshot',
      type: 'creature',
      cost: {},
      power: 2,
      toughness: 2,
      triggers: [
        {
          event: { event: 'dies', object: 'source' },
          target: { scope: 'graveyard', where: { type: 'creature' }, excludeSource: true },
          effects: [{ op: 'moveTarget', destination: 'hand' }],
        },
      ],
    },
  });
  const a = put(s, 'Death snapshot');
  move(s, a, 'graveyard');
  const firstGrave = ref(a);
  move(s, a, 'exile');
  move(s, a, 'graveyard');
  stabilize(s);
  assert.deepEqual(s.choice.entry.targetingSource, firstGrave);
  assert.deepEqual(s.choice.targets, [ref(a)]);
});
test('unmodeled cross-object death/source-graveyard identity is rejected, not approximated', () => {
  assert.ok(
    validateDefinition({
      name: 'Unsupported death',
      type: 'creature',
      cost: {},
      power: 1,
      toughness: 1,
      triggers: [
        {
          event: { event: 'dies', controller: 'you' },
          target: { scope: 'graveyard', where: { type: 'creature' }, excludeSource: true },
          effects: [{ op: 'moveTarget', destination: 'hand' }],
        },
      ],
    }).some((x) => x.includes('own-dies')),
  );
});
test('UI battlefield highlights use the selected source incarnation', () => {
  const s = fixture(),
    a = put(s, 'Hotfoot Gnome'),
    b = put(s, 'Grizzly Bears');
  const html = game(
    s,
    {
      mode: 'hotseat',
      seat: 0,
      selected: a.id,
      activation: 0,
      targeting: true,
      chosen: [],
      blocks: [],
      sideTab: 'stack',
      stops: {},
      handExpanded: false,
    },
    {},
  );
  const own = html.match(new RegExp(`<button class="permanent [^"]*" data-card="${a.id}"`))[0];
  const otherCard = html.match(
    new RegExp(`<button class="permanent [^"]*" data-card="${b.id}"`),
  )[0];
  assert.ok(!own.includes('targetable'));
  assert.ok(otherCard.includes('targetable'));
});
test('grouped source-excluding trigger choice, bot and resolution round-trip through replay', () => {
  const card = { ...CARDS['Felidar Savior'], cost: {} };
  const deck = [...Array(4).fill(card.name), ...Array(3).fill('Plains')];
  let s = createGame({
    catalog: createRegistry([card, CARDS.Plains]),
    decks: [deck, deck],
    minimumDeckSize: 7,
    mulligan: false,
  });
  s = resolve(s);
  s = resolve(s);
  const first = s.players[0].hand.find((id) => s.objects[id].name === card.name);
  s = resolve(act(s, 'cast', { card: first }));
  assert.equal(s.choice.kind, 'triggerTargets');
  assert.deepEqual(chooseBotCommand(s, 0).targets, { chosen: [] });
  assert.deepEqual(replay(exportReplay(s)), s);
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [] } });
  s = resolve(s);
  const second = s.players[0].hand.find((id) => s.objects[id].name === card.name);
  s = resolve(act(s, 'cast', { card: second }));
  assert.deepEqual(chooseBotCommand(s, 0).targets, { chosen: [ref(s.objects[first])] });
  assert.deepEqual(replay(exportReplay(s)), s);
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [ref(s.objects[first])] } });
  s = resolve(s);
  assert.equal(s.objects[first].plusCounters, 1);
  assert.equal(s.objects[second].plusCounters, 0);
  assert.deepEqual(replay(exportReplay(s)), s);
});

test('new other-target ETB and attack modifiers affect only the chosen creature', () => {
  for (const [name, event, keyword, power, toughness] of [
    ['Starling, Aerial Ally', 'enter', 'flying', 0, 0],
    ['Blooming Stinger', 'enter', 'deathtouch', 0, 0],
    ['Fang Guardian', 'enter', null, 2, 2],
    ['Flesh Burrower', 'attack', 'deathtouch', 0, 0],
    ['Foot Elite', 'attack', 'indestructible', 1, 0],
    ['Hardened Escort', 'attack', 'indestructible', 1, 0],
    ['Cunning Coyote', 'enter', 'haste', 1, 1],
  ]) {
    let s = fixture();
    const a = put(s, name),
      b = put(s, 'Grizzly Bears');
    notifyTriggers(s, event, { object: a });
    stabilize(s);
    assert.deepEqual(s.choice.targets, [ref(b)], name);
    s = act(s, 'chooseTriggerTarget', { target: ref(b) });
    s = resolve(s);
    const actual = stats(s, s.objects[b.id]);
    assert.equal(actual.power, 2 + power, name);
    assert.equal(actual.toughness, 2 + toughness, name);
    if (keyword) assert.ok(keywords(s, s.objects[b.id]).includes(keyword), name);
  }
});
import { keywords } from '../src/index.js';
test('Werefox linked exile with an optional other-target group returns the exact card', () => {
  let s = fixture();
  const a = put(s, 'Werefox Bodyguard'),
    b = put(s, 'Grizzly Bears');
  notifyTriggers(s, 'enter', { object: a });
  stabilize(s);
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [ref(b)] } });
  s = resolve(s);
  assert.equal(s.objects[b.id].zone, 'exile');
  move(s, s.objects[a.id], 'hand');
  stabilize(s);
  assert.equal(s.objects[b.id].zone, 'battlefield');
});
test('Rescue Girl is legal during the controller turn but not restricted to sorcery timing', () => {
  let s = fixture();
  const a = put(s, 'Rescue Girl, First Responder'),
    b = put(s, 'Grizzly Bears');
  s.step = 'declareAttackers';
  assert.equal(abilityProblem(s, 0, a.id, 0, ref(b)), null);
  s.active = 1;
  assert.ok(abilityProblem(s, 0, a.id, 0, ref(b)));
  s.active = 0;
  s = act(s, 'activate', { card: a.id, ability: 0, target: ref(b) });
  s = resolve(s);
  assert.equal(s.objects[b.id].zone, 'hand');
});
test('Rinoa creates exact legendary Angelo and her attack counts all your creatures', () => {
  let s = fixture();
  const a = put(s, 'Rinoa Heartilly', 0, 'hand'),
    b = put(s, 'Grizzly Bears');
  enterBattlefield(s, a);
  stabilize(s);
  s = resolve(s);
  const token = Object.values(s.objects).find((o) => o.name === 'Angelo');
  assert.ok(token?.token);
  assert.equal(s.catalog.Angelo.legendary, true);
  notifyTriggers(s, 'attack', { object: s.objects[a.id] });
  stabilize(s);
  s = act(s, 'chooseTriggerTarget', { target: ref(s.objects[b.id]) });
  s = resolve(s);
  assert.equal(stats(s, s.objects[b.id]).power, 5);
  assert.equal(stats(s, s.objects[b.id]).toughness, 5);
});
test('Extravagant Replication cannot copy itself and can copy an opponent-owned permanent you control', () => {
  let s = fixture();
  const a = put(s, 'Extravagant Replication'),
    b = put(s, 'Grizzly Bears', 1);
  b.controller = 0;
  notifyTriggers(s, 'step', { step: 'upkeep', player: 0 });
  stabilize(s);
  assert.deepEqual(s.choice.targets, [ref(b)]);
  s = act(s, 'chooseTriggerTarget', { target: ref(b) });
  s = resolve(s);
  assert.ok(
    Object.values(s.objects).some(
      (o) => o.token && o.name === 'Grizzly Bears' && o.controller === 0,
    ),
  );
});
