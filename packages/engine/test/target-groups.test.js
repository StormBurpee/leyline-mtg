import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTargetGroups } from '../src/target-group-schema.js';
import { captureDepartureContext, move, ref } from '../src/model.js';
import { fixture, put } from './helpers.js';

test('target declarations validate cardinality, selectors, and prior-group exclusions', () => {
  const groups = [
    { id: 'actor', selector: 'creature', min: 1, max: 1 },
    { id: 'victims', selector: 'creature', min: 0, max: 2, excludeFrom: ['actor'] },
  ];
  assert.deepEqual(validateTargetGroups(groups), []);
  for (const bad of [
    [...groups, groups[0]],
    [{ ...groups[0], min: 2 }],
    [{ ...groups[0], id: 'constructor' }],
    [{ ...groups[0], excludeFrom: ['victims'] }, groups[1]],
    [{ ...groups[0], selector: 'unknown' }],
  ])
    assert.ok(validateTargetGroups(bad).length);
});

test('simultaneous departures preserve queued source facts from before the batch', () => {
  const s = fixture();
  const aura = put(s, 'Unflinching Courage'),
    creature = put(s, 'Grizzly Bears');
  aura.attachedTo = ref(creature);
  const entry = { source: ref(creature), eventSource: { ...ref(creature) } };
  s.pendingTriggers.push(entry);
  const context = captureDepartureContext(s);
  move(s, aura, 'graveyard', context);
  move(s, creature, 'graveyard', context);
  assert.equal(entry.eventSource.power, 4);
  assert.ok(entry.sourceKeywords.includes('lifelink'));
  assert.ok(entry.eventSource.keywords.includes('trample'));
});

import { targetPlanProblem, targetPlans, survivingTargets } from '../src/target-groups.js';
test('plans require distinct targets within a group but allow repeats across declarations', () => {
  const s = fixture(),
    a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears', 1);
  const groups = [
    { id: 'first', selector: 'creature', min: 1, max: 1 },
    { id: 'second', selector: 'creature', min: 1, max: 2 },
  ];
  assert.equal(targetPlanProblem(s, groups, { first: [ref(a)], second: [ref(a)] }, 0), null);
  assert.ok(targetPlanProblem(s, groups, { first: [ref(a)], second: [ref(b), ref(b)] }, 0));
  groups[1].excludeFrom = ['first'];
  assert.ok(targetPlanProblem(s, groups, { first: [ref(a)], second: [ref(a)] }, 0));
  const plans = targetPlans(s, groups, 0);
  assert.equal(plans.length, 2);
  assert.ok(plans.every((plan) => !targetPlanProblem(s, groups, plan, 0)));
  const plan = { first: [ref(a)], second: [ref(b)] };
  move(s, b, 'graveyard');
  assert.deepEqual(survivingTargets(s, groups, plan, 0), { first: [ref(a)], second: [] });
});

import { CARDS, createRegistry, legalActions } from '../src/index.js';
import { act, resolve } from './helpers.js';
function groupedFixture(effects, groups) {
  const s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Grouped fixture': {
      name: 'Grouped fixture',
      type: 'sorcery',
      cost: {},
      targetGroups: groups,
      effects,
    },
  });
  return { s, spell: put(s, 'Grouped fixture', 0, 'hand') };
}
const twoCreatures = [
  { id: 'actor', selector: 'creature', min: 1, max: 1 },
  { id: 'victim', selector: 'creature', min: 1, max: 1 },
];
test('fight damage is simultaneous and uses each creature as its own damage source', () => {
  let { s, spell } = groupedFixture(
    [{ op: 'fight', sourceGroup: 'actor', victimGroup: 'victim' }],
    twoCreatures,
  );
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears', 1);
  const collar = put(s, 'Basilisk Collar');
  collar.attachedTo = ref(a);
  const targets = { actor: [ref(a)], victim: [ref(b)] };
  assert.ok(legalActions(s, 0).some((c) => c.card === spell.id && c.targets));
  s = act(s, 'cast', { card: spell.id, targets });
  s = resolve(s);
  assert.equal(s.objects[a.id].zone, 'graveyard');
  assert.equal(s.objects[b.id].zone, 'graveyard');
  assert.equal(s.players[0].life, 22);
});
test('partly illegal grouped targets do not fizzle the entire spell or suppress untargeted effects', () => {
  let { s, spell } = groupedFixture(
    [
      { op: 'damage', targetGroup: 'victim', amount: 3 },
      { op: 'gainLife', amount: 2 },
    ],
    [{ id: 'victim', selector: 'creature', min: 1, max: 2 }],
  );
  const a = put(s, 'Grizzly Bears', 1),
    b = put(s, 'Grizzly Bears', 1);
  s = act(s, 'cast', { card: spell.id, targets: { victim: [ref(a), ref(b)] } });
  move(s, s.objects[a.id], 'hand');
  s = resolve(s);
  assert.equal(s.objects[b.id].zone, 'graveyard');
  assert.equal(s.players[0].life, 22);
});
test('all illegal targets fizzle, while zero chosen optional targets still resolve', () => {
  const groups = [{ id: 'victim', selector: 'creature', min: 0, max: 1 }];
  for (const choose of [false, true]) {
    let { s, spell } = groupedFixture([{ op: 'gainLife', amount: 2 }], groups);
    const a = put(s, 'Grizzly Bears', 1);
    s = act(s, 'cast', { card: spell.id, targets: { victim: choose ? [ref(a)] : [] } });
    move(s, s.objects[a.id], 'hand');
    s = resolve(s);
    assert.equal(s.players[0].life, choose ? 20 : 22);
  }
});

import { chooseBotCommand } from '../src/index.js';
import { lands } from './helpers.js';
test('bot picks a profitable bite without trading away its creature', () => {
  let s = fixture();
  lands(s, 'Forest', 2);
  const spell = put(s, 'Rabid Bite', 0, 'hand');
  const actor = put(s, 'Grizzly Bears'),
    victim = put(s, 'Grizzly Bears', 1);
  const command = chooseBotCommand(s, 0);
  assert.equal(command.card, spell.id);
  assert.deepEqual(command.targets.actor, [ref(actor)]);
  assert.deepEqual(command.targets.victims, [ref(victim)]);
  s = act(s, 'cast', command);
  s = resolve(s);
  assert.equal(s.objects[actor.id].zone, 'battlefield');
  assert.equal(s.objects[victim.id].zone, 'graveyard');
});

test('one ward trigger per permanent even when selected in two declarations', () => {
  let { s, spell } = groupedFixture(
    [{ op: 'fight', sourceGroup: 'actor', victimGroup: 'victim' }],
    twoCreatures,
  );
  const target = put(s, 'Tolarian Terror', 1);
  s = act(s, 'cast', { card: spell.id, targets: { actor: [ref(target)], victim: [ref(target)] } });
  assert.equal(
    s.stack.filter((e) => e.effects?.some((effect) => effect.op === 'wardPayment')).length,
    1,
  );
});
test('a creature fighting itself takes twice its power as damage', () => {
  let { s, spell } = groupedFixture(
    [{ op: 'fight', sourceGroup: 'actor', victimGroup: 'victim' }],
    twoCreatures,
  );
  const target = put(s, 'Grizzly Bears');
  s = act(s, 'cast', { card: spell.id, targets: { actor: [ref(target)], victim: [ref(target)] } });
  s = resolve(s);
  assert.equal(
    s.events.filter((e) => e.type === 'damage' && e.source === target.id).at(-1).amount,
    4,
  );
});
