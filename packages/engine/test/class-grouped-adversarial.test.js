import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CARDS,
  createRegistry,
  definition,
  dispatch,
  ref,
  stats,
  playerView,
  chooseBotCommand,
  legalActions,
} from '../src/index.js';
import { addModifier, addObject } from '../src/model.js';
import { enterBattlefieldBatch, stabilize } from '../src/effects.js';
import { compileCard } from '../../cards/compiler.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
const slugs = ['caretaker-s-talent', 'builder-s-talent', 'white-wall-token'];
const sources = slugs.map((slug) =>
  JSON.parse(fs.readFileSync(new URL(`../../cards/cards/${slug}.json`, import.meta.url))),
);
const identities = Object.fromEntries(sources.map((source) => [source.id, source.name]));
const definitions = sources.map((source) => {
  const result = compileCard(source, { identities });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.definition;
});
const catalog = createRegistry({
  ...CARDS,
  ...Object.fromEntries(definitions.map((d) => [d.name, d])),
});
function setup() {
  const s = fixture();
  s.catalog = catalog;
  lands(s, 'Plains', 16);
  return s;
}
function level(s, source, index = 0) {
  return resolve(act(s, 'activate', { card: source.id, ability: index }));
}
function batch(s, names, player = 0) {
  const cards = names.map((name) => put(s, name, player, 'void'));
  enterBattlefieldBatch(
    s,
    cards.map((object) => ({ object, controller: player })),
  );
  stabilize(s);
  return cards;
}
function choose(s, target) {
  return act(s, 'chooseTriggerTarget', { target: ref(target) });
}
test('Caretaker once-per-turn survives level gain, ability loss/restoration and control change', () => {
  let s = setup();
  const source = put(s, "Caretaker's Talent");
  batch(s, ['Food Token']);
  s = resolve(s);
  s = level(s, source);
  s = choose(
    s,
    Object.values(s.objects).find((o) => o.name === 'Food Token'),
  );
  s = resolve(s);
  assert.equal(s.stack.length, 0, 'acquiring the second trigger does not reset the first');
  addModifier(s, {
    objectId: source.id,
    incarnation: source.incarnation,
    removeAbilities: true,
    expires: s.turn,
  });
  batch(s, ['Food Token']);
  s.modifiers = [];
  batch(s, ['Food Token']);
  assert.equal(s.stack.length, 0);
  s.objects[source.id].controller = 1;
  batch(s, ['Food Token'], 1);
  assert.equal(s.stack.length, 0);
  s.turn++;
  batch(s, ['Food Token'], 1);
  assert.equal(s.stack[0].controller, 1);
});

test('Caretaker token copying itself starts the copy at level 1 and both observe its entry', () => {
  let s = setup();
  const source = addObject(s, "Caretaker's Talent", 0, 'battlefield', {
    ...catalog["Caretaker's Talent"],
    token: true,
  });
  s = level(s, source);
  s = choose(s, source);
  s = resolve(s);
  assert.equal(s.choice.kind, 'orderTriggers');
  assert.equal(s.choice.entries.length, 2);
  const copy = Object.values(s.objects).find((o) => o.name === source.name && o.id !== source.id);
  assert.ok(copy.token);
  assert.equal(copy.classLevel, undefined);
  assert.equal(definition(s, copy).triggers.length, 1);
  assert.equal(s.objects[source.id].classLevel, 2);
  const before = s.players[0].hand.length;
  s = act(s, 'orderTriggers', { ids: s.choice.entries.map((e) => e.id) });
  s = resolve(resolve(s));
  assert.equal(s.players[0].hand.length, before + 2);
});

test('Caretaker copying a modified creature token copies no counters or continuous anthem bonuses', () => {
  let s = setup();
  const anthem = put(s, "Caretaker's Talent"),
    source = put(s, "Caretaker's Talent"),
    token = put(s, 'White Wall Token');
  anthem.classLevel = 3;
  token.plusCounters = 3;
  addModifier(s, {
    objectId: token.id,
    incarnation: token.incarnation,
    power: 5,
    toughness: 5,
    expires: s.turn,
  });
  s = level(s, source);
  s = choose(s, token);
  s = resolve(s);
  const copy = Object.values(s.objects).find((o) => o.name === token.name && o.id !== token.id);
  assert.equal(copy.plusCounters, 0);
  assert.deepEqual(stats(s, copy), { power: 2, toughness: 6 });
  assert.deepEqual(stats(s, s.objects[token.id]), { power: 10, toughness: 14 });
});

test('Builder reanimates an Aura through nontargeting entry choice, then its acquired counter trigger', () => {
  let s = setup();
  const source = put(s, "Builder's Talent"),
    own = put(s, 'Grizzly Bears'),
    enemy = put(s, 'Grizzly Bears', 1),
    aura = put(s, 'Frantic Strength', 0, 'graveyard');
  addModifier(s, {
    objectId: enemy.id,
    incarnation: enemy.incarnation,
    keywords: ['hexproof'],
    expires: s.turn,
  });
  s = level(s, source);
  s = level(s, source, 1);
  s = choose(s, aura);
  s = resolve(s);
  assert.equal(s.choice.kind, 'auraEntry');
  assert.equal(s.objects[aura.id].zone, 'graveyard');
  assert.ok(
    legalActions(playerView(s, 0), 0).some(
      (a) => a.type === 'chooseAuraAttachment' && a.card === enemy.id,
    ),
  );
  s = act(s, 'chooseAuraAttachment', { card: enemy.id });
  assert.equal(s.objects[aura.id].zone, 'battlefield');
  assert.equal(s.objects[aura.id].attachedTo.id, enemy.id);
  assert.equal(s.choice.kind, 'triggerTarget');
  s = choose(s, own);
  s = resolve(s);
  assert.equal(s.objects[own.id].plusCounters, 1);
  assert.equal(s.objects[enemy.id].plusCounters, 0);
});

test('Builder may target an Aura with no legal attachment but leaves it in graveyard on resolution', () => {
  let s = setup();
  const source = put(s, "Builder's Talent"),
    aura = put(s, 'Frantic Strength', 0, 'graveyard');
  s = level(s, source);
  s = level(s, source, 1);
  s = choose(s, aura);
  s = resolve(s);
  assert.equal(s.objects[aura.id].zone, 'graveyard');
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 0);
});

test('Builder returns a planeswalker with printed loyalty and level 2 targets remain controller-bound', () => {
  let s = setup();
  const source = put(s, "Builder's Talent"),
    bear = put(s, 'Grizzly Bears'),
    walker = put(s, 'Ajani, Caller of the Pride', 0, 'graveyard');
  s = level(s, source);
  s = level(s, source, 1);
  s = choose(s, walker);
  s = resolve(s);
  assert.equal(s.objects[walker.id].zone, 'battlefield');
  assert.equal(s.objects[walker.id].loyalty, catalog[walker.name].loyalty);
  s = choose(s, bear);
  s.objects[bear.id].controller = 1;
  s = resolve(s);
  assert.equal(s.objects[bear.id].plusCounters, 0);
});

test('Builder and Caretaker same-batch triggers use independent counts and opaque bot choices', () => {
  let s = setup();
  put(s, "Caretaker's Talent");
  const builder = put(s, "Builder's Talent"),
    bear = put(s, 'Grizzly Bears');
  builder.classLevel = 2;
  batch(s, ['Treasure Token', 'Food Token', 'White Wall Token']);
  assert.equal(s.choice.kind, 'orderTriggers');
  assert.equal(s.choice.entries.length, 2);
  s = act(s, 'orderTriggers', { ids: s.choice.entries.map((e) => e.id) });
  assert.equal(s.choice.kind, 'triggerTarget');
  const command = chooseBotCommand(playerView(s, 0), 0);
  assert.equal(command.type, 'chooseTriggerTarget');
  assert.equal(dispatch(s, command).ok, true);
  s = choose(s, bear);
  assert.equal(s.stack.length, 2);
  const before = s.players[0].hand.length;
  s = resolve(resolve(s));
  assert.equal(s.players[0].hand.length, before + 1);
  assert.equal(s.objects[bear.id].plusCounters, 1);
  batch(s, ['Treasure Token', 'Food Token']);
  assert.equal(s.choice.kind, 'triggerTarget');
  s = choose(s, bear);
  assert.equal(s.stack.length, 1);
  assert.equal(s.stack[0].source.id, builder.id);
});
