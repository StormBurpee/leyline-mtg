import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, put, act, resolve } from './helpers.js';
import { ref, move, notifyTriggers } from '../src/model.js';
import { resolveEffects, resolveTop, enterBattlefieldBatch, stabilize } from '../src/effects.js';
const blink = (s, source, object, controller = 'owner') =>
  resolveEffects(s, {
    kind: 'ability',
    name: source.name,
    source: ref(source),
    controller: source.controller,
    sourceKeywords: [],
    effects: [{ op: 'delayedBlink', controller }],
    target: ref(object),
  });
const end = (s) => notifyTriggers(s, 'step', { step: 'end', player: s.active });
const ret = (s) => {
  s.stack.push(s.pendingTriggers.shift());
  resolveTop(s);
};
test('delayed blink exiles now and returns at next end step independently of source departure', () => {
  const s = fixture(),
    source = put(s, 'Abuelo, Ancestral Echo'),
    object = put(s, 'Llanowar Elves');
  const before = object.incarnation;
  blink(s, source, object);
  assert.equal(object.zone, 'exile');
  move(s, source, 'graveyard');
  end(s);
  assert.equal(object.zone, 'exile');
  ret(s);
  assert.equal(object.zone, 'battlefield');
  assert.equal(object.incarnation, before + 2);
  assert.equal(s.delayedTriggers, undefined);
});
test('owner return differs from effect-controller return and never follows a later incarnation', () => {
  for (const control of ['owner', 'you']) {
    const s = fixture(),
      source = put(s, 'Abuelo, Ancestral Echo'),
      object = put(s, 'Llanowar Elves', 1);
    object.controller = 0;
    blink(s, source, object, control);
    end(s);
    ret(s);
    assert.equal(object.controller, control === 'owner' ? 1 : 0);
  }
  const s = fixture(),
    source = put(s, 'Abuelo, Ancestral Echo'),
    object = put(s, 'Llanowar Elves');
  blink(s, source, object);
  move(s, object, 'hand');
  move(s, object, 'exile');
  end(s);
  ret(s);
  assert.equal(object.zone, 'exile');
});
test('a blink created after the end-step event waits for the following end step; countering consumes the delay', () => {
  const s = fixture(),
    source = put(s, 'Abuelo, Ancestral Echo'),
    object = put(s, 'Llanowar Elves');
  end(s);
  blink(s, source, object);
  assert.equal(s.pendingTriggers.length, 0);
  assert.equal(s.delayedTriggers.length, 1);
  end(s);
  assert.equal(s.pendingTriggers.length, 1);
  s.pendingTriggers = [];
  end(s);
  assert.equal(s.pendingTriggers.length, 0);
  assert.equal(object.zone, 'exile');
});
test('exiled tokens cannot return and stale or nonbattlefield targets cannot be blinked', () => {
  const s = fixture(),
    source = put(s, 'Abuelo, Ancestral Echo'),
    token = put(s, 'Soldier Token');
  blink(s, source, token);
  assert.equal(s.delayedTriggers, undefined);
  const object = put(s, 'Llanowar Elves', 0, 'graveyard');
  blink(s, source, object);
  assert.equal(object.zone, 'graveyard');
});
test('delayed return pauses for Cavern type choice and resumes without losing continuation', () => {
  let s = fixture();
  const source = put(s, 'Abuelo, Ancestral Echo'),
    object = put(s, 'Cavern of Souls');
  blink(s, source, object);
  end(s);
  ret(s);
  assert.equal(s.choice.kind, 'creatureType');
  s = act(s, 'chooseCreatureType', { creatureType: 'Lizard' });
  assert.equal(s.objects[object.id].zone, 'battlefield');
  assert.equal(s.objects[object.id].chosenCreatureType, 'Lizard');
  assert.equal(s.resolving, null);
});
test('Abuelo activated ability is legal, targets another owned-side artifact or creature, and returns it', () => {
  let s = fixture();
  const source = put(s, 'Abuelo, Ancestral Echo'),
    object = put(s, 'Llanowar Elves');
  Object.assign(s.players[0].mana, { W: 1, U: 1, C: 1 });
  s = resolve(act(s, 'activate', { card: source.id, ability: 0, target: ref(object) }));
  assert.equal(s.objects[object.id].zone, 'exile');
  end(s);
  ret(s);
  assert.equal(s.objects[object.id].zone, 'battlefield');
});
test('Skyskipper and four-chapter Roll-Roll expose optional zero-or-one blink triggers', () => {
  for (const name of ['Skyskipper Duo', 'Roll-Roll-Roll-Roll']) {
    const s = fixture(),
      object = put(s, 'Llanowar Elves'),
      source = put(s, name, 0, 'hand');
    enterBattlefieldBatch(s, [{ object: source }]);
    const trigger = s.pendingTriggers.find((t) => t.name === name);
    assert.ok(trigger);
    assert.equal(trigger.targetGroups[0].min, 0);
    assert.equal(trigger.targetGroups[0].max, 1);
  }
});
test('delayed blink survives skipped end step from end-turn effect', () => {
  const s = fixture(),
    source = put(s, 'Abuelo, Ancestral Echo'),
    object = put(s, 'Llanowar Elves');
  blink(s, source, object);
  resolveEffects(s, {
    kind: 'ability',
    name: 'end turn',
    source: ref(source),
    controller: 0,
    sourceKeywords: [],
    effects: [{ op: 'endTurn' }],
  });
  assert.equal(object.zone, 'exile');
  assert.equal(s.delayedTriggers.length, 1);
  end(s);
  ret(s);
  assert.equal(object.zone, 'battlefield');
});
test('returned shock land makes its entry choice before returning; no new priority window', () => {
  let s = fixture();
  const source = put(s, 'Abuelo, Ancestral Echo'),
    object = put(s, 'Hallowed Fountain');
  blink(s, source, object);
  end(s);
  ret(s);
  assert.equal(s.choice.kind, 'entryLife');
  assert.equal(s.objects[object.id].zone, 'exile');
  const before = s.players[0].life;
  s = act(s, 'payEntryLife', { pay: true });
  assert.equal(s.objects[object.id].zone, 'battlefield');
  assert.ok(s.objects[object.id].tapped || s.players[0].life === before - 2);
});
test('simultaneous end-step delayed abilities retain their own controllers for APNAP placement', () => {
  const s = fixture(),
    a = put(s, 'Abuelo, Ancestral Echo'),
    b = put(s, 'Abuelo, Ancestral Echo', 1),
    x = put(s, 'Llanowar Elves'),
    y = put(s, 'Llanowar Elves', 1);
  blink(s, a, x);
  blink(s, b, y);
  end(s);
  stabilize(s);
  assert.deepEqual(
    s.stack.map((e) => e.controller),
    [0, 1],
  );
  resolveTop(s);
  assert.equal(y.zone, 'battlefield');
  assert.equal(x.zone, 'exile');
  resolveTop(s);
  assert.equal(x.zone, 'battlefield');
});
