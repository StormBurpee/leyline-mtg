import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import {
  CARDS,
  createRegistry,
  definition,
  dispatch,
  ref,
  stats,
  keywords,
  playerView,
  chooseBotCommand,
} from '../src/index.js';
import { move, addModifier } from '../src/model.js';
import { enterBattlefield, enterBattlefieldBatch, stabilize } from '../src/effects.js';
import { compileCard } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
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
function reject(s, command) {
  const before = JSON.stringify(s);
  assert.equal(dispatch(s, { player: s.choice?.player ?? s.priority, ...command }).ok, false);
  assert.equal(JSON.stringify(s), before);
}
test('Caretaker, Builder and white Wall are complete source/schema/native roundtrips', () => {
  const validate = new Ajv({ strict: true }).compile(
    JSON.parse(fs.readFileSync(new URL('../../cards/schema/card.schema.json', import.meta.url))),
  );
  for (const [i, source] of sources.entries()) {
    assert.ok(validate(source), JSON.stringify(validate.errors));
    const result = compileCard(
      sourceFromDefinition(definitions[i], {
        id: source.id,
        idsByName: Object.fromEntries(sources.map((v) => [v.name, v.id])),
      }),
      { identities },
    );
    assert.ok(result.ok, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.definition, definitions[i]);
    assert.equal(result.definition.text, source.rulesText);
  }
});
test('Caretaker sees tokens entering with itself, coalesces the batch and consumes once-per-turn on trigger', () => {
  let s = setup();
  const caretaker = put(s, "Caretaker's Talent", 0, 'hand');
  const tokens = ['Food Token', 'White Wall Token', 'Treasure Token'].map((name) =>
    put(s, name, 0, 'void'),
  );
  enterBattlefieldBatch(
    s,
    [caretaker, ...tokens].map((object) => ({ object, controller: 0 })),
  );
  stabilize(s);
  assert.equal(s.stack.length, 1);
  assert.equal(s.stack[0].name, "Caretaker's Talent");
  const before = s.players[0].hand.length;
  s = resolve(s);
  assert.equal(s.players[0].hand.length, before + 1);
  batch(s, ['Food Token', 'White Wall Token']);
  assert.equal(s.stack.length, 0);
  s.turn++;
  batch(s, ['Food Token']);
  assert.equal(s.stack.length, 1);
});
test('Caretaker ignores opposing tokens and own nontokens; queued draw survives loss of source', () => {
  let s = setup();
  const source = put(s, "Caretaker's Talent");
  batch(s, ['Food Token'], 1);
  assert.equal(s.stack.length, 0);
  batch(s, ['Grizzly Bears']);
  assert.equal(s.stack.length, 0);
  batch(s, ['Food Token']);
  assert.equal(s.stack.length, 1);
  move(s, s.objects[source.id], 'graveyard');
  const before = s.players[0].hand.length;
  s = resolve(s);
  assert.equal(s.players[0].hand.length, before + 1);
});
test('Caretaker level 2 copies a noncreature token after its own source leaves, without copying noncopiable state', () => {
  let s = setup();
  const source = put(s, "Caretaker's Talent"),
    food = put(s, 'Food Token'),
    enemy = put(s, 'Food Token', 1);
  food.tapped = true;
  s = level(s, source);
  assert.equal(s.choice.kind, 'triggerTarget');
  reject(s, { type: 'chooseTriggerTarget', target: ref(enemy) });
  s = choose(s, food);
  move(s, s.objects[source.id], 'graveyard');
  s = resolve(s);
  const foods = Object.values(s.objects).filter(
    (o) => o.name === 'Food Token' && o.controller === 0 && o.zone === 'battlefield',
  );
  assert.equal(foods.length, 2);
  assert.equal(foods.find((o) => o.id !== food.id).tapped, false);
});
test('Caretaker level 2 copy rechecks token identity and control when resolving', () => {
  let s = setup();
  const source = put(s, "Caretaker's Talent"),
    food = put(s, 'Food Token');
  s = level(s, source);
  s = choose(s, food);
  s.objects[food.id].controller = 1;
  s = resolve(s);
  assert.equal(
    Object.values(s.objects).filter((o) => o.name === 'Food Token' && o.zone === 'battlefield')
      .length,
    1,
  );
});
test('Caretaker level 3 continuously pumps only own creature tokens and obeys ability loss', () => {
  let s = setup();
  const source = put(s, "Caretaker's Talent"),
    own = put(s, 'White Wall Token'),
    enemy = put(s, 'White Wall Token', 1),
    plain = put(s, 'Grizzly Bears');
  s = level(s, source);
  s = choose(s, own);
  s = resolve(s);
  if (s.stack.length) s = resolve(s);
  s = level(s, source, 1);
  assert.deepEqual(stats(s, s.objects[own.id]), { power: 2, toughness: 6 });
  assert.deepEqual(stats(s, s.objects[enemy.id]), { power: 0, toughness: 4 });
  assert.equal(stats(s, s.objects[plain.id]).power, 2);
  addModifier(s, {
    objectId: source.id,
    incarnation: source.incarnation,
    removeAbilities: true,
    expires: s.turn,
  });
  assert.equal(stats(s, s.objects[own.id]).power, 0);
});
test('Builder entry creates the exact white 0/4 defender, not the existing colorless Wall', () => {
  let s = setup();
  const source = put(s, "Builder's Talent", 0, 'hand');
  enterBattlefield(s, source);
  stabilize(s);
  s = resolve(s);
  const token = Object.values(s.objects).find(
    (o) => o.name === 'White Wall Token' && o.zone === 'battlefield',
  );
  assert.ok(token);
  assert.deepEqual(definition(s, token).color, ['W']);
  assert.deepEqual(definition(s, token).subtypes, ['Wall']);
  assert.deepEqual(stats(s, token), { power: 0, toughness: 4 });
  assert.ok(keywords(s, token).includes('defender'));
});
test('Builder unlocks grouped artifact/enchantment counter trigger only at level 2 and not for creatures or lands', () => {
  let s = setup();
  const source = put(s, "Builder's Talent"),
    bear = put(s, 'Grizzly Bears');
  batch(s, ['Food Token']);
  assert.equal(s.stack.length, 0);
  s = level(s, source);
  batch(s, ['Grizzly Bears', 'Plains']);
  assert.equal(s.stack.length, 0);
  batch(s, ['Food Token', 'Treasure Token', 'White Wall Token']);
  assert.equal(s.choice.kind, 'triggerTarget');
  s = choose(s, bear);
  assert.equal(s.stack.length, 1);
  move(s, s.objects[source.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[bear.id].plusCounters, 1);
});
test('Builder level 3 returns only a targeted own noncreature nonland permanent and queues its entry trigger', () => {
  let s = setup();
  const source = put(s, "Builder's Talent"),
    bear = put(s, 'Grizzly Bears');
  const enchantment = put(s, "Caretaker's Talent", 0, 'graveyard'),
    creature = put(s, 'Grizzly Bears', 0, 'graveyard'),
    land = put(s, 'Plains', 0, 'graveyard'),
    enemy = put(s, "Caretaker's Talent", 1, 'graveyard');
  s = level(s, source);
  s = level(s, source, 1);
  assert.equal(s.choice.kind, 'triggerTarget');
  for (const card of [creature, land, enemy])
    reject(s, { type: 'chooseTriggerTarget', target: ref(card) });
  s = choose(s, enchantment);
  s = resolve(s);
  assert.equal(s.objects[enchantment.id].zone, 'battlefield');
  assert.equal(s.objects[enchantment.id].controller, 0);
  assert.equal(s.choice.kind, 'triggerTarget');
  s = choose(s, bear);
  s = resolve(s);
  assert.equal(s.objects[bear.id].plusCounters, 1);
});
test('Builder level 3 trigger survives source loss but cannot chase a graveyard target through a zone change', () => {
  let s = setup();
  const source = put(s, "Builder's Talent"),
    target = put(s, "Caretaker's Talent", 0, 'graveyard');
  s = level(s, source);
  s = level(s, source, 1);
  s = choose(s, target);
  move(s, s.objects[source.id], 'graveyard');
  move(s, s.objects[target.id], 'hand');
  move(s, s.objects[target.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'graveyard');
});
test('Builder and Caretaker targets use legal opaque-view bot commands', () => {
  let s = setup();
  const source = put(s, "Caretaker's Talent"),
    token = put(s, 'Food Token');
  s = level(s, source);
  const command = chooseBotCommand(playerView(s, 0), 0);
  assert.equal(command.type, 'chooseTriggerTarget');
  assert.equal(command.target.id, token.id);
  assert.equal(dispatch(s, command).ok, true);
});
