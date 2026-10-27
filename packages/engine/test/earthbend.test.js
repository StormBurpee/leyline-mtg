import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, put, act, resolve } from './helpers.js';
import {
  ref,
  move,
  stats,
  definition,
  keywords,
  addModifier,
  notifyTriggers,
  playerView,
} from '../src/model.js';
import { enterBattlefieldBatch, resolveEffects, resolveTop, stabilize } from '../src/effects.js';
import { chooseBotCommand } from '../src/bot.js';
const bend = (s, land, source = land, controller = source.controller) =>
  resolveEffects(s, {
    kind: 'ability',
    source: ref(source),
    controller,
    name: source.name,
    effects: [{ op: 'earthbend', amount: 2 }],
    target: ref(land),
    sourceKeywords: [],
  });
const ret = (s) => {
  s.stack.push(s.pendingTriggers.shift());
  resolveTop(s);
};
test('Ba Sing Se entry condition and sorcery activation create permanent 0/0 haste land with two counters', () => {
  let s = fixture();
  const ba = put(s, 'Ba Sing Se', 0, 'hand');
  enterBattlefieldBatch(s, [{ object: ba }]);
  assert.equal(ba.tapped, true);
  move(s, ba, 'hand');
  put(s, 'Forest');
  enterBattlefieldBatch(s, [{ object: ba }]);
  assert.equal(ba.tapped, false);
  s.players[0].mana.G = 3;
  s = resolve(act(s, 'activate', { card: ba.id, ability: 0, target: ref(ba) }));
  assert.deepEqual(stats(s, s.objects[ba.id]), { power: 2, toughness: 2 });
  assert.ok(keywords(s, s.objects[ba.id]).includes('haste'));
  s.turn++;
  assert.equal(definition(s, s.objects[ba.id]).type, 'creature');
});
test('earthbend retains all types/subtypes/colors, original mana, and existing counters', () => {
  const s = fixture(),
    land = put(s, 'Restless Bivouac');
  addModifier(s, {
    objectId: land.id,
    incarnation: land.incarnation,
    addTypes: ['creature'],
    animation: { power: 5, toughness: 5, colors: ['R'], subtypes: ['Ox'] },
    permanent: true,
  });
  land.plusCounters = 3;
  bend(s, land);
  assert.deepEqual(stats(s, land), { power: 5, toughness: 5 });
  assert.ok(definition(s, land).subtypes.includes('Ox'));
  assert.deepEqual(definition(s, land).color, ['R']);
  assert.ok(definition(s, land).mana);
});
test('death/exile queue real delayed return under effect controller, immune to ability loss and later control change', () => {
  for (const zone of ['graveyard', 'exile']) {
    const s = fixture(),
      land = put(s, 'Forest'),
      source = put(s, 'Ba Sing Se');
    bend(s, land, source);
    land.controller = 1;
    addModifier(s, {
      objectId: land.id,
      incarnation: land.incarnation,
      removeAbilities: true,
      permanent: true,
    });
    move(s, source, 'graveyard');
    move(s, land, zone);
    assert.equal(land.zone, zone);
    assert.equal(s.pendingTriggers.length, 1);
    assert.equal(s.earthbendReturns.length, 0);
    ret(s);
    assert.equal(land.zone, 'battlefield');
    assert.equal(land.controller, 0);
    assert.equal(land.tapped, true);
    assert.equal(land.plusCounters, 0);
    assert.equal(definition(s, land).type, 'land');
  }
});
test('return is consumed once, respects destination incarnation, and does not trigger for bounce', () => {
  const s = fixture(),
    land = put(s, 'Forest');
  bend(s, land);
  bend(s, land);
  move(s, land, 'exile');
  assert.equal(s.pendingTriggers.length, 2);
  ret(s);
  const incarnation = land.incarnation;
  ret(s);
  assert.equal(land.incarnation, incarnation);
  bend(s, land);
  move(s, land, 'hand');
  assert.equal(s.pendingTriggers.length, 0);
  assert.equal(s.earthbendReturns.length, 0);
  enterBattlefieldBatch(s, [{ object: land }]);
  bend(s, land);
  move(s, land, 'graveyard');
  move(s, land, 'exile');
  ret(s);
  assert.equal(land.zone, 'exile');
});
test('return pauses for Cavern entry type and resumes resolving exact return once', () => {
  let s = fixture();
  const land = put(s, 'Cavern of Souls');
  bend(s, land);
  move(s, land, 'exile');
  ret(s);
  assert.equal(s.choice.kind, 'creatureType');
  s = act(s, 'chooseCreatureType', { creatureType: 'Elf' });
  assert.equal(s.objects[land.id].zone, 'battlefield');
  assert.equal(s.objects[land.id].chosenCreatureType, 'Elf');
  assert.equal(s.objects[land.id].tapped, true);
  assert.equal(s.resolving, null);
});
test('Ascension quest counter precedes distinct targeted reflexive trigger; threshold is rechecked and has departure LKI', () => {
  for (const after of ['unchanged', 'remove', 'leave']) {
    const s = fixture(),
      a = put(s, 'Earthbender Ascension'),
      land = put(s, 'Forest'),
      creature = put(s, 'Llanowar Elves');
    a.questCounters = 3;
    notifyTriggers(s, 'enter', { object: land });
    const trigger = s.pendingTriggers.pop();
    resolveEffects(s, trigger);
    assert.equal(a.questCounters, 4);
    assert.equal(s.pendingTriggers.length, 1);
    const r = s.pendingTriggers.pop();
    r.target = ref(creature);
    s.stack.push(r);
    if (after === 'remove') a.questCounters = 3;
    if (after === 'leave') move(s, a, 'graveyard');
    resolveTop(s);
    assert.equal(creature.plusCounters, after === 'remove' ? 0 : 1);
    assert.equal(keywords(s, creature).includes('trample'), after !== 'remove');
  }
});
test('Ascension ETB sole illegal target fizzles search; legal target searches only after earthbend', () => {
  for (const illegal of [true, false]) {
    const s = fixture(),
      a = put(s, 'Earthbender Ascension', 0, 'hand'),
      land = put(s, 'Forest');
    enterBattlefieldBatch(s, [{ object: a }]);
    const trigger = s.pendingTriggers.pop();
    trigger.target = ref(land);
    s.stack.push(trigger);
    if (illegal) move(s, land, 'hand');
    resolveTop(s);
    if (illegal) assert.equal(s.choice, null);
    else {
      assert.equal(land.plusCounters, 2);
      assert.equal(s.choice.kind, 'librarySearch');
    }
  }
});
test('bot can activate earthbend on opaque public state and public quest counters remain visible', () => {
  const s = fixture(),
    ba = put(s, 'Ba Sing Se'),
    land = put(s, 'Forest'),
    a = put(s, 'Earthbender Ascension');
  a.questCounters = 3;
  s.players[0].mana.G = 3;
  const view = playerView(s, 0);
  assert.equal(view.objects[a.id].questCounters, 3);
  const c = chooseBotCommand(view, 0);
  assert.equal(c.type, 'activate');
  assert.equal(c.card, ba.id);
  assert.ok(c.target);
  assert.doesNotThrow(() => act(s, c.type, c));
});
test('simultaneous basic land does not untap Ba Sing Se; quest counters reset on new incarnation', () => {
  const s = fixture(),
    ba = put(s, 'Ba Sing Se', 0, 'hand'),
    land = put(s, 'Forest', 0, 'hand'),
    a = put(s, 'Earthbender Ascension');
  enterBattlefieldBatch(s, [{ object: land }, { object: ba }]);
  assert.equal(ba.tapped, true);
  a.questCounters = 5;
  move(s, a, 'hand');
  assert.equal(a.questCounters, undefined);
});
test('fourth quest counter opens real target choice, including the newly earthbent land', () => {
  let s = fixture();
  const a = put(s, 'Earthbender Ascension'),
    land = put(s, 'Forest');
  bend(s, land);
  a.questCounters = 3;
  notifyTriggers(s, 'enter', { object: land });
  s.stack.push(s.pendingTriggers.pop());
  resolveTop(s);
  stabilize(s);
  assert.equal(s.choice.kind, 'triggerTarget');
  assert.ok(s.choice.targets.some((t) => t.id === land.id));
  const c = chooseBotCommand(playerView(s, 0), 0);
  s = act(s, c.type, c);
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(s.objects[land.id].plusCounters, 3);
});
test('earthbend delayed ability is counterable and cannot recur after countering', () => {
  const s = fixture(),
    land = put(s, 'Forest');
  bend(s, land);
  move(s, land, 'graveyard');
  const delayed = s.pendingTriggers.pop();
  s.stack.push(delayed);
  resolveEffects(s, {
    source: null,
    controller: 1,
    effects: [{ op: 'counterAbility' }],
    target: { kind: 'stack', id: delayed.id },
  });
  assert.equal(s.stack.length, 0);
  assert.equal(land.zone, 'graveyard');
  assert.equal(s.earthbendReturns.length, 0);
});
test('earthbend returns a land put in graveyard even after it stops being a creature', () => {
  const s = fixture(),
    land = put(s, 'Forest');
  bend(s, land);
  addModifier(s, {
    objectId: land.id,
    incarnation: land.incarnation,
    landForm: { mana: ['G'] },
    permanent: true,
  });
  assert.equal(definition(s, land).type, 'land');
  move(s, land, 'graveyard');
  assert.equal(s.pendingTriggers.length, 1);
  ret(s);
  assert.equal(land.zone, 'battlefield');
  assert.equal(land.tapped, true);
});
