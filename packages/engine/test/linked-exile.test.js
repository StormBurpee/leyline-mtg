import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry, ref, dispatch, definition } from '../src/index.js';
import { move, addObject, queueTrigger, notifyTriggers } from '../src/model.js';
import {
  resolveEffects,
  continueResolution,
  flushLinkedReturns,
  stabilize,
} from '../src/effects.js';
import { fixture, put, act, resolve } from './helpers.js';
const exile = (s, source, target) =>
  resolveEffects(s, {
    kind: 'ability',
    source: ref(source),
    controller: source.controller,
    target: ref(target),
    effects: [{ op: 'exileUntilSourceLeaves' }],
  });
test('duration exile returns under its owner immediately without a stack entry; no stale incarnations', () => {
  const s = fixture(),
    source = put(s, 'Pacifism'),
    victim = put(s, 'Grizzly Bears', 1);
  victim.controller = 0;
  exile(s, source, victim);
  assert.equal(victim.zone, 'exile');
  const stack = s.stack.length;
  move(s, source, 'graveyard');
  flushLinkedReturns(s);
  assert.equal(victim.zone, 'battlefield');
  assert.equal(victim.controller, 1);
  assert.equal(s.stack.length, stack);
  exile(s, source, victim);
  assert.equal(victim.zone, 'battlefield');
});
test('source departure before resolution prevents exile, even after it returns', () => {
  const s = fixture(),
    source = put(s, 'Pacifism'),
    victim = put(s, 'Grizzly Bears', 1);
  const old = ref(source);
  move(s, source, 'hand');
  move(s, source, 'battlefield');
  resolveEffects(s, {
    source: old,
    controller: 0,
    target: ref(victim),
    effects: [{ op: 'exileUntilSourceLeaves' }],
  });
  assert.equal(victim.zone, 'battlefield');
});
test('departed exile incarnation and tokens never return', () => {
  const s = fixture(),
    source = put(s, 'Pacifism'),
    victim = put(s, 'Grizzly Bears', 1);
  exile(s, source, victim);
  move(s, victim, 'hand');
  move(s, victim, 'exile');
  move(s, source, 'graveyard');
  flushLinkedReturns(s);
  assert.equal(victim.zone, 'exile');
  const source2 = put(s, 'Pacifism'),
    token = put(s, 'Grizzly Bears', 1);
  token.token = true;
  exile(s, source2, token);
  move(s, source2, 'graveyard');
  flushLinkedReturns(s);
  assert.equal(token.zone, 'exile');
});
test('returning Aura pauses the enclosing resolution and resumes its next instruction exactly once', () => {
  const s = fixture(),
    source = put(s, 'Ornithopter'),
    bear = put(s, 'Grizzly Bears'),
    aura = put(s, 'Pacifism', 1);
  aura.attachedTo = ref(bear);
  exile(s, source, aura);
  const entry = {
    id: 'test-resolution',
    kind: 'ability',
    controller: 0,
    source: ref(bear),
    target: ref(source),
    effects: [{ op: 'destroy' }, { op: 'gainLife', amount: 4 }],
  };
  s.resolving = { entry, index: 0 };
  const life = s.players[0].life;
  continueResolution(s);
  assert.equal(s.choice.kind, 'auraEntry');
  assert.equal(s.players[0].life, life);
  assert.equal(s.resolving.index, 1);
  const result = act(s, 'chooseAuraAttachment', { card: bear.id });
  assert.equal(result.players[0].life, life + 4);
  assert.equal(result.objects[aura.id].zone, 'battlefield');
  assert.equal(result.resolving, null);
});
test('Aura with no legal attachment stays exiled', () => {
  const s = fixture(),
    source = put(s, 'Pacifism'),
    aura = put(s, 'Pacifism', 1);
  exile(s, source, aura);
  move(s, source, 'graveyard');
  flushLinkedReturns(s);
  assert.equal(aura.zone, 'exile');
  assert.equal(s.choice, null);
});
test('simultaneous destruction returns cards after the whole batch, before the next instruction', () => {
  const s = fixture(),
    source = put(s, 'Ornithopter'),
    bear = put(s, 'Grizzly Bears', 1);
  exile(s, source, bear);
  resolveEffects(s, {
    name: source.name,
    sourceDefinition: definition(s, source),
    controller: 0,
    effects: [
      { op: 'destroyAll', where: { type: 'creature' } },
      { op: 'damageAll', where: { type: 'creature' }, amount: 1 },
    ],
    source: ref(source),
  });
  assert.equal(bear.zone, 'battlefield');
  assert.equal(bear.damage, 1);
  assert.equal(source.zone, 'graveyard');
});
test('Cavern return asks for a fresh creature type before continuation', () => {
  const s = fixture(),
    source = put(s, 'Ornithopter'),
    cavern = put(s, 'Cavern of Souls', 1);
  cavern.chosenCreatureType = 'Elf';
  exile(s, source, cavern);
  const entry = {
    id: 'return-cavern',
    kind: 'ability',
    controller: 0,
    source: ref(source),
    target: ref(source),
    effects: [{ op: 'destroy' }, { op: 'gainLife', amount: 2 }],
  };
  s.resolving = { entry, index: 0 };
  continueResolution(s);
  assert.equal(s.choice.kind, 'creatureType');
  const result = act(s, 'chooseCreatureType', { creatureType: 'Wizard' });
  assert.equal(result.objects[cavern.id].chosenCreatureType, 'Wizard');
  assert.equal(result.players[0].life, 22);
});
test('return choices during casting sacrifice payment finish before cast triggers without paying twice', () => {
  let s = fixture();
  const source = put(s, 'Banishing Light'),
    bear = put(s, 'Grizzly Bears', 1),
    aura = put(s, 'Pacifism', 1);
  aura.attachedTo = ref(bear);
  exile(s, source, aura);
  const spell = put(s, 'Final Vengeance', 0, 'hand');
  put(s, 'Swamp');
  s = act(s, 'cast', { card: spell.id, target: ref(bear), sacrifice: ref(source) });
  assert.equal(s.choice.kind, 'auraEntry');
  assert.ok(s.castingCompletion);
  assert.equal(s.events.filter((e) => e.type === 'cast' && e.objectId === spell.id).length, 0);
  s = act(s, 'chooseAuraAttachment', { card: bear.id });
  assert.equal(s.castingCompletion, undefined);
  assert.equal(s.objects[aura.id].zone, 'battlefield');
  assert.equal(s.objects[source.id].zone, 'graveyard');
  assert.equal(s.events.filter((e) => e.type === 'cast' && e.objectId === spell.id).length, 1);
  assert.equal(s.events.filter((e) => e.type === 'mana').length, 1);
  s = resolve(s);
  assert.equal(s.objects[bear.id].zone, 'exile');
});
test('optional linked-exile trigger may choose zero and still gain life', () => {
  let s = fixture();
  const source = put(s, 'Prayer of Binding');
  notifyTriggers(s, 'enters', { object: source });
  stabilize(s);
  assert.equal(s.choice.kind, 'triggerTargets');
  s = act(s, 'chooseTriggerTargets', { targets: { exile: [] } });
  s = resolve(s);
  assert.equal(s.players[0].life, 22);
});
test('compiled Banishing Light casts, exiles an opponent permanent, and returns it when destroyed', () => {
  let s = fixture();
  const light = put(s, 'Banishing Light', 0, 'hand');
  const bear = put(s, 'Grizzly Bears', 1);
  for (let i = 0; i < 5; i++) put(s, 'Plains');
  s = act(s, 'cast', { card: light.id });
  s = resolve(s);
  assert.equal(s.choice.kind, 'triggerTarget');
  s = act(s, 'chooseTriggerTarget', { target: ref(s.objects[bear.id]) });
  s = resolve(s);
  assert.equal(s.objects[bear.id].zone, 'exile');
  const removal = put(s, 'Disenchant', 0, 'hand');
  s = act(s, 'cast', { card: removal.id, target: ref(s.objects[light.id]) });
  s = resolve(s);
  assert.equal(s.objects[light.id].zone, 'graveyard');
  assert.equal(s.objects[bear.id].zone, 'battlefield');
  assert.equal(s.objects[bear.id].controller, 1);
});
test('simultaneous cross-player Aura and Cavern returns stage choices in APNAP order', () => {
  let s = fixture();
  const a = put(s, 'Ornithopter'),
    b = put(s, 'Ornithopter', 1);
  const bear = put(s, 'Grizzly Bears');
  const aura = put(s, 'Pacifism');
  aura.attachedTo = ref(bear);
  const cavern = put(s, 'Cavern of Souls', 1);
  exile(s, a, aura);
  exile(s, b, cavern);
  resolveEffects(s, {
    controller: 0,
    effects: [{ op: 'destroyAll', where: { type: 'artifact' } }],
  });
  assert.equal(s.choice.kind, 'auraEntry');
  assert.equal(s.choice.player, 0);
  s = act(s, 'chooseAuraAttachment', { card: bear.id });
  assert.equal(s.choice.kind, 'creatureType');
  assert.equal(s.choice.player, 1);
  s = act(s, 'chooseCreatureType', { creatureType: 'Elf' });
  assert.equal(s.objects[aura.id].zone, 'battlefield');
  assert.equal(s.objects[cavern.id].zone, 'battlefield');
});
test('returning Aura attachment is not targeting and can enchant a creature with shroud', () => {
  const s = fixture(),
    source = put(s, 'Banishing Light'),
    aura = put(s, 'Pacifism', 1);
  const bear = put(s, 'Grizzly Bears');
  bear.definitionOverride = { ...structuredClone(definition(s, bear)), keywords: ['shroud'] };
  aura.attachedTo = ref(bear);
  exile(s, source, aura);
  move(s, source, 'graveyard');
  flushLinkedReturns(s);
  assert.equal(s.choice.kind, 'auraEntry');
  assert.ok(s.choice.cards.includes(bear.id));
});
