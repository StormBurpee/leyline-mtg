import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, ref, keywords, stats, dispatch, chooseBotCommand } from '../src/index.js';
import { definition, move, addModifier, notifyTriggers } from '../src/model.js';
import { legalTarget, resolveEffects, stabilize } from '../src/effects.js';
import { finishCleanup } from '../src/turn.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
function effect(s, source, target, effects) {
  resolveEffects(s, {
    controller: source.controller,
    source: ref(source),
    target: ref(target),
    effects,
  });
}

test('Wasp taps and removes abilities only for its exact battlefield incarnation', () => {
  const s = fixture(),
    wasp = put(s, 'The Wondrous Wasp'),
    elf = put(s, 'Llanowar Elves', 1);
  effect(s, wasp, elf, [{ op: 'tap' }, { op: 'removeAbilities', until: 'sourceLeaves' }]);
  assert.equal(elf.tapped, true);
  assert.equal(definition(s, elf).mana, undefined);
  assert.equal(stats(s, elf).power, 1);
  finishCleanup(s);
  assert.equal(definition(s, elf).mana, undefined);
  move(s, wasp, 'hand');
  move(s, wasp, 'battlefield');
  assert.ok(definition(s, elf).mana);
});

test('ability loss respects earlier and later keyword grants and counters, never strips P/T modification', () => {
  const s = fixture(),
    wasp = put(s, 'The Wondrous Wasp'),
    elf = put(s, 'Llanowar Elves');
  effect(s, wasp, elf, [{ op: 'keywordCounters', keywords: ['flying'] }]);
  addModifier(s, {
    objectId: elf.id,
    incarnation: elf.incarnation,
    keywords: ['lifelink'],
    power: 3,
    toughness: 3,
    expires: s.turn,
  });
  effect(s, wasp, elf, [{ op: 'removeAbilities', until: 'sourceLeaves' }]);
  assert.equal(keywords(s, elf).includes('flying'), false);
  assert.equal(keywords(s, elf).includes('lifelink'), false);
  assert.equal(stats(s, elf).power, 4);
  effect(s, wasp, elf, [{ op: 'keywordCounters', keywords: ['flying'] }]);
  assert.ok(keywords(s, elf).includes('flying'));
  move(s, wasp, 'graveyard');
  assert.ok(keywords(s, elf).includes('lifelink'));
});

test('Wasp leaving before trigger resolution does not start an ability-loss duration', () => {
  const s = fixture(),
    wasp = put(s, 'The Wondrous Wasp'),
    elf = put(s, 'Llanowar Elves');
  const entry = {
    controller: 0,
    source: ref(wasp),
    target: ref(elf),
    effects: [{ op: 'tap' }, { op: 'removeAbilities', until: 'sourceLeaves' }],
  };
  move(s, wasp, 'graveyard');
  resolveEffects(s, entry);
  assert.equal(elf.tapped, true);
  assert.ok(definition(s, elf).mana);
});

test('Day of Black Sun removes indestructible and dies triggers before simultaneous destruction', () => {
  let s = fixture();
  const day = put(s, 'Day of Black Sun', 0, 'hand'),
    small = put(s, 'Blood Artist'),
    large = put(s, 'Qarsi Revenant', 1);
  addModifier(s, {
    objectId: small.id,
    incarnation: small.incarnation,
    keywords: ['indestructible'],
    expires: s.turn,
  });
  lands(s, 'Swamp', 4);
  s = act(s, 'cast', { card: day.id, x: 2 });
  s = resolve(s);
  assert.equal(s.objects[small.id].zone, 'graveyard');
  assert.equal(s.stack.length, 0);
  assert.equal(s.players[0].life, 20);
  assert.equal(s.objects[large.id].zone, 'battlefield');
});

test('Nowhere to Run bypasses opponent creature hexproof and ward without removing abilities', () => {
  let s = fixture();
  const target = put(s, 'Llanowar Elves', 1);
  addModifier(s, {
    objectId: target.id,
    incarnation: target.incarnation,
    keywords: ['hexproof'],
    expires: s.turn,
  });
  assert.equal(legalTarget(s, 'creature', ref(target), 0), false);
  const nowhere = put(s, 'Nowhere to Run');
  assert.equal(legalTarget(s, 'creature', ref(target), 0), true);
  assert.ok(keywords(s, target).includes('hexproof'));
  const wasp = put(s, 'The Wondrous Wasp', 1);
  effect(s, wasp, nowhere, [{ op: 'removeAbilities', until: 'sourceLeaves' }]);
  assert.equal(legalTarget(s, 'creature', ref(target), 0), false);
});

test('Tidebinder targets abilities not spells, counters one and suppresses the original permanent', () => {
  let s = fixture();
  const target = put(s, 'Hired Claw', 1),
    binder = put(s, "Tishana's Tidebinder");
  s.stack.push({
    id: 'ability-test',
    kind: 'ability',
    name: target.name,
    controller: 1,
    source: ref(target),
    sourceDefinition: structuredClone(definition(s, target)),
    effects: [{ op: 'draw', count: 1 }],
  });
  assert.ok(legalTarget(s, { scope: 'ability' }, { kind: 'stack', id: 'ability-test' }, 0));
  assert.equal(legalTarget(s, 'spell', { kind: 'stack', id: 'ability-test' }, 0), false);
  resolveEffects(s, {
    controller: 0,
    source: ref(binder),
    target: { kind: 'stack', id: 'ability-test' },
    effects: [{ op: 'counterAbility', removeSourceAbilities: true }],
  });
  assert.equal(s.stack.length, 0);
  assert.equal(definition(s, target).activated, undefined);
  move(s, binder, 'graveyard');
  assert.ok(definition(s, target).activated);
});

test('Tidebinder ETB offers ability stack targets and survives the standard trigger selection lifecycle', () => {
  let s = fixture();
  const source = put(s, 'Hired Claw', 1),
    binder = put(s, "Tishana's Tidebinder", 0, 'hand');
  lands(s, 'Island', 3);
  s.stack.push({
    id: 'ability-fixture',
    kind: 'ability',
    name: source.name,
    controller: 1,
    source: ref(source),
    sourceDefinition: structuredClone(definition(s, source)),
    effects: [{ op: 'draw', count: 1 }],
  });
  s = act(s, 'cast', { card: binder.id });
  s = resolve(s);
  assert.equal(s.choice.kind, 'triggerTargets');
  const bot = chooseBotCommand(s, 0);
  assert.deepEqual(bot.targets.chosen, [{ kind: 'stack', id: 'ability-fixture' }]);
  s = act(s, 'chooseTriggerTargets', {
    targets: { chosen: [{ kind: 'stack', id: 'ability-fixture' }] },
  });
  s = resolve(s);
  assert.equal(s.stack.length, 0);
  assert.equal(definition(s, s.objects[source.id]).activated, undefined);
});

test('Nowhere prevents ward triggers but never shroud, and face-down ward is removed by Wasp', () => {
  let s = fixture();
  const creature = put(s, 'Pyrotechnic Performer', 1);
  creature.faceDown = true;
  const nowhere = put(s, 'Nowhere to Run');
  const bounce = put(s, 'Unsummon', 0, 'hand');
  lands(s, 'Island', 1);
  s = act(s, 'cast', { card: bounce.id, target: ref(creature) });
  assert.equal(s.stack.length, 1);
  addModifier(s, {
    objectId: creature.id,
    incarnation: creature.incarnation,
    keywords: ['shroud'],
    expires: s.turn,
  });
  assert.equal(legalTarget(s, 'creature', ref(s.objects[creature.id]), 0), false);
  const wasp = put(s, 'The Wondrous Wasp');
  effect(s, wasp, s.objects[creature.id], [{ op: 'removeAbilities', until: 'sourceLeaves' }]);
  assert.equal(definition(s, s.objects[creature.id]).ward, undefined);
  assert.equal(legalTarget(s, 'creature', ref(s.objects[creature.id]), 0), true);
});
