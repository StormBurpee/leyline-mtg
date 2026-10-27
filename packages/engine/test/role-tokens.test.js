import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CARDS, createGame, createRegistry, dispatch } from '../src/index.js';
import { compilePack } from '../../cards/pack.js';
import {
  addObject,
  ref,
  definition,
  copiableDefinition,
  stats,
  hasKeyword,
  notifyTriggers,
  move,
  addModifier,
  wardCosts,
} from '../src/model.js';
import {
  resolveEffects,
  enterBattlefield,
  enterBattlefieldBatch,
  stabilize,
  resolveTop,
  notifyTargeted,
} from '../src/effects.js';
const sources = ['cursed', 'monster', 'royal', 'sorcerer', 'wicked', 'young-hero'].map((name) =>
  JSON.parse(readFileSync(new URL(`../../cards/cards/${name}-role.json`, import.meta.url))),
);
const compiled = compilePack(sources);
assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
const catalog = createRegistry({
  ...CARDS,
  ...Object.fromEntries(compiled.definitions.map((d) => [d.name, d])),
});
function fixture() {
  const s = createGame({ catalog, mulligan: false });
  s.step = 'main1';
  s.turn = 3;
  return s;
}
function put(s, name, player = 0, zone = 'battlefield') {
  return addObject(s, name, player, zone);
}
function role(s, name, target, controller = 0) {
  const o = put(s, name, controller, 'void');
  enterBattlefield(s, o, controller, ref(target));
  return o;
}
function create(s, name, target, controller = 0, subject) {
  const source = put(s, 'Llanowar Elves', controller);
  const entry = {
    source: ref(source),
    controller,
    target: ref(target),
    effects: [{ op: 'attachedToken', definition: name, ...(subject ? { subject } : {}) }],
  };
  resolveEffects(s, entry);
  return entry;
}

test('Roles are actual named colorless enchantment Aura Role tokens attached on entry', () => {
  const s = fixture(),
    creature = put(s, 'Llanowar Elves');
  create(s, 'Monster', creature);
  const token = Object.values(s.objects).find((o) => o.name === 'Monster');
  assert(token.token);
  assert.equal(token.zone, 'battlefield');
  assert.deepEqual(token.attachedTo, ref(creature));
  assert.deepEqual(definition(s, token).subtypes, ['Aura', 'Role']);
  assert.deepEqual(definition(s, token).color, []);
  assert.deepEqual(stats(s, creature), { power: 2, toughness: 2 });
  assert(hasKeyword(s, creature, 'trample'));
});
test('Attached-token creation rejects stale/noncreature bindings without manufacturing a token or entry event', () => {
  const s = fixture(),
    land = put(s, 'Forest');
  const before = Object.keys(s.objects).length;
  create(s, 'Monster', land);
  assert.equal(Object.keys(s.objects).length, before + 1);
  assert(!Object.values(s.objects).some((o) => o.name === 'Monster'));
  const creature = put(s, 'Llanowar Elves'),
    old = ref(creature);
  move(s, creature, 'graveyard');
  enterBattlefield(s, creature);
  resolveEffects(s, {
    source: old,
    controller: 0,
    target: old,
    effects: [{ op: 'attachedToken', definition: 'Monster' }],
  });
  assert(!Object.values(s.objects).some((o) => o.name === 'Monster'));
});
test('Nontargeting source/event attachment ignores hexproof and uses the precise surviving incarnation', () => {
  const s = fixture(),
    creature = put(s, 'Llanowar Elves', 1);
  addModifier(s, {
    objectId: creature.id,
    incarnation: creature.incarnation,
    keywords: ['hexproof', 'shroud'],
    expires: s.turn,
  });
  resolveEffects(s, {
    source: ref(creature),
    controller: 0,
    effects: [{ op: 'attachedToken', definition: 'Monster', subject: 'source' }],
  });
  assert.equal(stats(s, creature).power, 2);
  const source = put(s, 'Llanowar Elves');
  resolveEffects(s, {
    source: ref(source),
    eventSource: ref(creature),
    controller: 1,
    effects: [{ op: 'attachedToken', definition: 'Royal', subject: 'eventSource' }],
  });
  assert.equal(stats(s, creature).power, 3);
});
test('Newest Role survives only among the same controller; older Wicked leaves in the shared SBA batch', () => {
  const s = fixture(),
    creature = put(s, 'Llanowar Elves'),
    wicked = role(s, 'Wicked', creature),
    other = role(s, 'Royal', creature, 1),
    monster = role(s, 'Monster', creature);
  assert.equal(wicked.zone, 'battlefield');
  stabilize(s);
  assert.notEqual(wicked.zone, 'battlefield');
  assert.equal(other.zone, 'battlefield');
  assert.equal(monster.zone, 'battlefield');
  assert.equal(s.stack.length, 1);
  assert.equal(s.stack[0].controller, 0);
  resolveTop(s);
  assert.equal(s.players[1].life, 19);
  assert.deepEqual(stats(s, creature), { power: 3, toughness: 3 });
});
test('Role removal is not sacrifice; simultaneous lethal creature retains prebatch Role stats for death observers', () => {
  const s = fixture(),
    creature = put(s, 'Llanowar Elves'),
    wicked = role(s, 'Wicked', creature);
  const monster = role(s, 'Monster', creature);
  creature.damage = 3;
  const watcher = put(s, 'Llanowar Elves');
  watcher.definitionOverride = {
    ...CARDS['Llanowar Elves'],
    triggers: [
      {
        event: { event: 'dies', filter: { power: { gte: 3 } } },
        effects: [{ op: 'gainLife', amount: 2 }],
      },
    ],
  };
  stabilize(s);
  assert.notEqual(creature.zone, 'battlefield');
  assert.notEqual(wicked.zone, 'battlefield');
  assert(!s.events.some((e) => e.type === 'sacrificed' && e.objectId === wicked.id));
  assert.equal(s.events.filter((e) => e.type === 'triggered').length, 2);
  assert.notEqual(monster.zone, 'battlefield');
});
test('Equal newest timestamps require controller choice, and choosing a Role never protects it from other SBAs', () => {
  let s = fixture();
  const creature = put(s, 'Llanowar Elves'),
    first = role(s, 'Monster', creature),
    second = role(s, 'Royal', creature);
  first.roleTimestamp = second.roleTimestamp;
  stabilize(s);
  assert.equal(s.choice.rule, 'role');
  assert.deepEqual(s.choice.cards, [first.id, second.id]);
  const result = dispatch(s, { type: 'chooseLegend', player: 0, card: first.id });
  assert(result.ok, result.error?.message);
  s = result.state;
  assert.equal(s.objects[first.id].zone, 'battlefield');
  assert.notEqual(s.objects[second.id]?.zone, 'battlefield');
});
test('Cursed base stats apply before counters/pumps and obey relative timestamps of other base setters', () => {
  const s = fixture(),
    creature = put(s, 'Llanowar Elves');
  creature.plusCounters = 2;
  addModifier(s, {
    objectId: creature.id,
    incarnation: creature.incarnation,
    power: 3,
    toughness: 4,
    expires: s.turn,
  });
  const curse = role(s, 'Cursed', creature, 1);
  assert.deepEqual(stats(s, creature), { power: 6, toughness: 7 });
  addModifier(s, {
    objectId: creature.id,
    incarnation: creature.incarnation,
    creatureForm: { power: 4, toughness: 4, subtypes: ['Frog'] },
    expires: s.turn,
  });
  assert.deepEqual(stats(s, creature), { power: 9, toughness: 10 });
  move(s, curse, 'graveyard');
  role(s, 'Cursed', creature, 1);
  assert.deepEqual(stats(s, creature), { power: 6, toughness: 7 });
  assert.equal(copiableDefinition(s, creature).power, 1);
});
test('Royal grants additional ward rather than overwriting printed ward, and the creature owns both triggers', () => {
  const s = fixture(),
    creature = put(s, 'Llanowar Elves', 1);
  creature.definitionOverride = { ...CARDS['Llanowar Elves'], ward: { mana: { generic: 2 } } };
  role(s, 'Royal', creature, 0);
  assert.deepEqual(wardCosts(s, creature), [{ mana: { generic: 2 } }, { mana: { generic: 1 } }]);
  assert.deepEqual(copiableDefinition(s, creature).ward, { mana: { generic: 2 } });
  notifyTargeted(s, { id: 'spell', kind: 'spell', controller: 0, target: ref(creature) });
  assert.equal(s.pendingTriggers.length, 2);
  for (const trigger of s.pendingTriggers) {
    assert.equal(trigger.controller, 1);
    assert.deepEqual(trigger.source, ref(creature));
  }
  addModifier(s, {
    objectId: creature.id,
    incarnation: creature.incarnation,
    removeAbilities: true,
    expires: s.turn,
  });
  assert.deepEqual(wardCosts(s, creature), []);
  role(s, 'Royal', creature, 1);
  assert.deepEqual(wardCosts(s, creature), [{ mana: { generic: 1 } }]);
});
test('Sorcerer grants a creature-controlled attack trigger; Aura departure, control change and copies retain correct identity', () => {
  const s = fixture(),
    creature = put(s, 'Llanowar Elves', 1),
    aura = role(s, 'Sorcerer', creature, 0);
  notifyTriggers(s, 'attack', { object: creature });
  assert.equal(s.pendingTriggers.length, 1);
  assert.equal(s.pendingTriggers[0].controller, 1);
  assert.deepEqual(s.pendingTriggers[0].source, ref(creature));
  assert.equal(copiableDefinition(s, creature).triggers, undefined);
  move(s, aura, 'graveyard');
  assert.equal(definition(s, creature).triggers, undefined);
  stabilize(s);
  resolveTop(s);
  assert.equal(s.choice.kind, 'libraryOrder');
  assert.equal(s.choice.player, 1);
});
test('Young Hero intervening-if checks occurrence and resolution, not Aura controller or bonus stats', () => {
  let s = fixture(),
    creature = put(s, 'Llanowar Elves', 1);
  role(s, 'Young Hero', creature, 0);
  creature.plusCounters = 3;
  notifyTriggers(s, 'attack', { object: creature });
  assert.equal(s.pendingTriggers.length, 0);
  creature.plusCounters = 2;
  notifyTriggers(s, 'attack', { object: creature });
  assert.equal(s.pendingTriggers.length, 1);
  stabilize(s);
  creature.plusCounters = 3;
  resolveTop(s);
  assert.equal(creature.plusCounters, 3);
  s = fixture();
  creature = put(s, 'Llanowar Elves', 1);
  const aura = role(s, 'Young Hero', creature, 0);
  notifyTriggers(s, 'attack', { object: creature });
  stabilize(s);
  move(s, aura, 'graveyard');
  resolveTop(s);
  assert.equal(creature.plusCounters, 1);
});
test('Ability loss timestamps remove existing grants, newer grants survive; attachment loss changes no copy values', () => {
  const s = fixture(),
    creature = put(s, 'Llanowar Elves');
  role(s, 'Sorcerer', creature);
  addModifier(s, {
    objectId: creature.id,
    incarnation: creature.incarnation,
    removeAbilities: true,
    expires: s.turn,
  });
  assert.equal(definition(s, creature).triggers, undefined);
  role(s, 'Young Hero', creature, 1);
  assert.equal(definition(s, creature).triggers.length, 1);
  assert.equal(copiableDefinition(s, creature).triggers, undefined);
});

test('Simultaneous attached Role entry uses one timestamp and asks which Role to keep', () => {
  const s = fixture(),
    creature = put(s, 'Llanowar Elves'),
    first = put(s, 'Monster', 0, 'void'),
    second = put(s, 'Royal', 0, 'void');
  enterBattlefieldBatch(s, [
    { object: first, attachment: ref(creature) },
    { object: second, attachment: ref(creature) },
  ]);
  assert.equal(first.roleTimestamp, second.roleTimestamp);
  stabilize(s);
  assert.equal(s.choice.rule, 'role');
});

test('Ability removal does not erase newer spell-created base-stat effects over an older Cursed Role', () => {
  const s = fixture(),
    creature = put(s, 'Llanowar Elves');
  role(s, 'Cursed', creature, 1);
  addModifier(s, {
    objectId: creature.id,
    incarnation: creature.incarnation,
    creatureForm: { power: 4, toughness: 4, subtypes: ['Frog'] },
    expires: s.turn,
  });
  addModifier(s, {
    objectId: creature.id,
    incarnation: creature.incarnation,
    removeAbilities: true,
    expires: s.turn,
  });
  assert.deepEqual(stats(s, creature), { power: 4, toughness: 4 });
  role(s, 'Cursed', creature, 0);
  assert.deepEqual(stats(s, creature), { power: 1, toughness: 1 });
});
