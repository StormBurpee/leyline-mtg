import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  CARDS,
  CARD_IDS,
  createGame,
  createRegistry,
  dispatch,
  chooseBotCommand,
  exportReplay,
  replay,
  validateDefinition,
  validateEventSpec,
  ref,
} from '../src/index.js';
import {
  move,
  sacrificePermanents,
  captureDepartureContext,
  finishDepartureBatch,
  addModifier,
} from '../src/model.js';
import { resolveEffects, stateBasedActions, stabilize } from '../src/effects.js';
import { matchesEvent } from '../src/events.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';

const slugs = ['g-raha-tia', 'great-fierce-bee', 'homicide-investigator', 'vengeful-townsfolk'];
const sources = await Promise.all(
  slugs.map(async (slug) =>
    JSON.parse(await readFile(new URL(`../../cards/cards/${slug}.json`, import.meta.url), 'utf8')),
  ),
);
const identities = { ...CARD_IDS, ...Object.fromEntries(sources.map((s) => [s.id, s.name])) };
const compiled = sources.map((source) => {
  const result = compileCard(source, { identities });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result.definition;
});
const catalog = createRegistry({
  ...CARDS,
  ...Object.fromEntries(compiled.map((d) => [d.name, d])),
});
function setup() {
  const s = fixture();
  s.catalog = catalog;
  return s;
}
function settle(s) {
  stabilize(s);
  for (
    let i = 0;
    i < 100 && (s.choice || s.stack.length || s.resolving || s.pendingTriggers.length);
    i++
  ) {
    const p = s.choice?.player ?? s.priority;
    const r = dispatch(s, s.choice ? chooseBotCommand(s, p) : { type: 'pass', player: p });
    assert.equal(r.ok, true, r.error?.message);
    s = r.state;
  }
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 0);
  assert.equal(s.pendingTriggers.length, 0);
  return s;
}
function witness(s, event = { event: 'diesGroup' }, options = {}) {
  const o = put(s, 'Grizzly Bears');
  o.definitionOverride = {
    ...CARDS['Grizzly Bears'],
    triggers: [{ event, effects: [{ op: 'gainLife', amount: 1 }], ...options }],
  };
  return o;
}
function effect(s, effects, extra = {}) {
  return resolveEffects(s, { controller: 0, source: null, effects, ...extra });
}

test('four complete cards pass source schema, semantic validation and native roundtrip', async () => {
  const schema = JSON.parse(
    await readFile(new URL('../../cards/schema/card.schema.json', import.meta.url)),
  );
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const idsByName = Object.fromEntries(Object.entries(identities).map(([id, name]) => [name, id]));
  for (const [i, source] of sources.entries()) {
    assert.equal(validate(source), true, JSON.stringify(validate.errors));
    assert.deepEqual(validateDefinition(compiled[i]), []);
    const restored = sourceFromDefinition(compiled[i], { id: source.id, idsByName });
    const result = compileCard(restored, { identities });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(canonical(result.definition), canonical(compiled[i]));
  }
  for (const event of ['diesGroup', 'battlefieldToGraveyardGroup']) {
    assert.deepEqual(
      validateEventSpec({
        event,
        controller: 'you',
        excludeSource: true,
        filter: { token: false },
      }),
      [],
    );
    assert.ok(validateEventSpec({ event, firstEachTurn: true }).length);
    assert.ok(validateEventSpec({ event, step: 'end' }).length);
    assert.ok(
      validateDefinition({
        ...CARDS['Grizzly Bears'],
        triggers: [
          {
            event: { event },
            target: { scope: 'graveyard', excludeSource: true },
            effects: [{ op: 'moveTarget', destination: 'hand' }],
          },
        ],
      }).length,
      'ambiguous cross-object graveyard source exclusion remains unsupported',
    );
  }
});

test('aggregate identity, controller and type predicates match the same member', () => {
  const source = { id: 'source', controller: 0 };
  const objects = [
    { id: 'mine', controller: 0, definition: CARDS.Forest },
    { id: 'enemy', controller: 1, definition: CARDS['Grizzly Bears'] },
  ];
  const event = {
    event: 'battlefieldToGraveyardGroup',
    controller: 'you',
    filter: { type: 'creature' },
  };
  assert.equal(matchesEvent(event, event.event, { objects }, source), false);
  objects[1].controller = 0;
  assert.equal(matchesEvent(event, event.event, { objects }, source), true);
  assert.equal(
    matchesEvent({ ...event, object: 'source' }, event.event, { objects }, source),
    false,
  );
});

test('a simultaneous destruction is one event, but distinct instructions in one resolution are two', () => {
  const s = setup();
  witness(s);
  put(s, 'Llanowar Elves');
  put(s, 'Raging Goblin');
  effect(s, [{ op: 'destroyAll', where: { type: 'creature' } }]);
  assert.equal(s.pendingTriggers.length, 1);
  const t = setup();
  witness(t);
  put(t, 'Llanowar Elves');
  put(t, 'Raging Goblin');
  effect(t, [
    { op: 'destroyAll', where: { subtype: 'Elf' } },
    { op: 'destroyAll', where: { subtype: 'Goblin' } },
  ]);
  assert.equal(t.pendingTriggers.length, 2);
});

test('target-group destruction batches all surviving legal targets', () => {
  const s = setup();
  witness(s);
  const a = put(s, 'Llanowar Elves'),
    b = put(s, 'Raging Goblin');
  effect(s, [{ op: 'destroy', targetGroup: 'victims' }], {
    targets: { victims: [ref(a), ref(b)] },
  });
  assert.equal(s.pendingTriggers.length, 1);
  assert.equal(a.zone, 'graveyard');
  assert.equal(b.zone, 'graveyard');
});

test('manual batch completion is explicit and idempotent; independent moves are separate events', () => {
  const s = setup();
  witness(s);
  const a = put(s, 'Llanowar Elves'),
    b = put(s, 'Raging Goblin');
  const ctx = captureDepartureContext(s);
  move(s, a, 'graveyard', ctx);
  move(s, b, 'graveyard', ctx);
  assert.equal(s.pendingTriggers.length, 0);
  finishDepartureBatch(s, ctx);
  finishDepartureBatch(s, ctx);
  assert.equal(s.pendingTriggers.length, 1);
  move(s, put(s, 'Llanowar Elves'), 'graveyard');
  move(s, put(s, 'Raging Goblin'), 'graveyard');
  assert.equal(s.pendingTriggers.length, 3);
});

test('SBA lethal damage and zero toughness share one batch; subsequent SBA cascades are separate', () => {
  const s = setup();
  witness(s);
  const a = put(s, 'Llanowar Elves'),
    b = put(s, 'Raging Goblin');
  a.damage = 1;
  b.minusCounters = 1;
  stateBasedActions(s);
  assert.equal(s.pendingTriggers.length, 1);
  const c = put(s, 'Glorious Anthem'),
    d = put(s, 'Llanowar Elves');
  d.damage = 1;
  // The anthem is an illegal unattached Aura, so it leaves first; the Elf then dies.
  c.definitionOverride = {
    ...CARDS['Glorious Anthem'],
    subtypes: ['Aura'],
    aura: { scope: 'permanent' },
  };
  const all = witness(s, { event: 'battlefieldToGraveyardGroup' });
  stateBasedActions(s);
  assert.equal(d.zone, 'battlefield');
  stateBasedActions(s);
  assert.equal(d.zone, 'graveyard');
  assert.equal(s.pendingTriggers.filter((t) => t.source.id === all.id).length, 2);
});

test('sacrifice preserves stolen controller, type-changing and source LKI independent of move order', () => {
  for (const reverse of [false, true]) {
    const s = setup();
    const watcher = witness(s, {
      event: 'diesGroup',
      controller: 'you',
      excludeSource: true,
      filter: { type: 'creature' },
    });
    const artifact = put(s, 'Fountainport Bell', 1);
    artifact.controller = 0;
    addModifier(s, {
      objectId: artifact.id,
      incarnation: artifact.incarnation,
      addTypes: ['creature'],
      creatureForm: { power: 2, toughness: 2, subtypes: [] },
      untilSourceLeaves: ref(watcher),
    });
    const before = ref(watcher);
    sacrificePermanents(s, reverse ? [artifact, watcher] : [watcher, artifact]);
    assert.equal(s.pendingTriggers.length, 1);
    assert.equal(s.pendingTriggers[0].controller, 0);
    assert.deepEqual(s.pendingTriggers[0].source, before);
    assert.deepEqual(s.pendingTriggers[0].departedSource, ref(watcher));
    assert.equal(s.pendingTriggers[0].sourceStats.power, 2);
  }
});

test('replacement exiles suppress the whole event, including dying replacement source and tokens', () => {
  const s = setup();
  witness(s);
  const rip = put(s, 'Rest in Peace'),
    a = put(s, 'Llanowar Elves'),
    b = put(s, 'Blue Fish Token');
  sacrificePermanents(s, [rip, a, b]);
  assert.equal(s.pendingTriggers.length, 0);
  assert.ok([rip, a, b].every((o) => o.zone === 'exile'));
  move(s, put(s, 'Llanowar Elves', 0, 'hand'), 'graveyard');
  move(s, put(s, 'Llanowar Elves'), 'exile');
  assert.equal(s.pendingTriggers.length, 0);
});

test('Homicide Investigator sees own nontoken death, ignores tokens/enemies, consumes once on occurrence', () => {
  let s = setup();
  const investigator = put(s, 'Homicide Investigator');
  sacrificePermanents(s, [put(s, 'Blue Fish Token'), put(s, 'Grizzly Bears', 1)]);
  assert.equal(s.pendingTriggers.length, 0);
  sacrificePermanents(s, [put(s, 'Grizzly Bears'), put(s, 'Llanowar Elves')]);
  assert.equal(s.pendingTriggers.length, 1);
  s.pendingTriggers = []; // Countering/declining never refunds the trigger use.
  move(s, put(s, 'Grizzly Bears'), 'graveyard');
  assert.equal(s.pendingTriggers.length, 0);
  s.turn++;
  sacrificePermanents(s, [investigator, put(s, 'Grizzly Bears')]);
  assert.equal(s.pendingTriggers.length, 1);
  s = settle(s);
  assert.equal(
    Object.values(s.objects).filter((o) => o.name === 'Clue Token' && o.zone === 'battlefield')
      .length,
    1,
  );
});

test("G'raha sees artifact tokens, artifact creatures and creatures once; excludes source and nonartifacts", () => {
  for (const name of ['Treasure Token', 'Ornithopter', 'Grizzly Bears']) {
    let s = setup();
    put(s, "G'raha Tia");
    sacrificePermanents(s, [put(s, name), put(s, name)]);
    assert.equal(s.pendingTriggers.length, 1, name);
    s = settle(s);
    assert.equal(s.players[0].hand.length, 1, name);
  }
  const s = setup();
  const source = put(s, "G'raha Tia");
  sacrificePermanents(s, [
    source,
    put(s, 'Forest'),
    put(s, 'Glorious Anthem'),
    put(s, 'Treasure Token', 1),
  ]);
  assert.equal(s.pendingTriggers.length, 0);
});

test('Great Fierce Bee scries once for any other simultaneous creatures, even while dying itself', () => {
  let s = setup();
  const bee = put(s, 'Great Fierce Bee');
  sacrificePermanents(s, [bee, put(s, 'Grizzly Bears', 1), put(s, 'Blue Fish Token')]);
  assert.equal(s.pendingTriggers.length, 1);
  stabilize(s);
  s = resolve(s);
  assert.equal(s.choice.kind, 'libraryOrder');
  assert.equal(s.choice.cards.length, 1);
  s = settle(s);
  const t = setup();
  move(t, put(t, 'Great Fierce Bee'), 'graveyard');
  assert.equal(t.pendingTriggers.length, 0);
});

test('Vengeful Townsfolk gains one counter per actual batch, never follows a returned incarnation', () => {
  let s = setup();
  const town = put(s, 'Vengeful Townsfolk');
  sacrificePermanents(s, [put(s, 'Grizzly Bears'), put(s, 'Llanowar Elves')]);
  assert.equal(s.pendingTriggers.length, 1);
  s = settle(s);
  assert.equal(s.objects[town.id].plusCounters, 1);
  sacrificePermanents(s, [put(s, 'Grizzly Bears'), put(s, 'Llanowar Elves')]);
  move(s, s.objects[town.id], 'exile');
  move(s, s.objects[town.id], 'battlefield');
  s = settle(s);
  assert.equal(s.objects[town.id].plusCounters, 0);
});

test('token deaths trigger before tokens cease to exist, and APNAP ordering remains explicit', () => {
  let s = setup();
  put(s, 'Great Fierce Bee');
  put(s, 'Vengeful Townsfolk');
  put(s, 'Great Fierce Bee', 1);
  const token = put(s, 'Blue Fish Token');
  token.damage = 1;
  stabilize(s);
  assert.equal(s.objects[token.id], undefined);
  assert.equal(s.choice.kind, 'orderTriggers');
  assert.equal(s.choice.player, 0);
  assert.equal(s.choice.entries.length, 2);
  s = act(s, 'orderTriggers', { ids: s.choice.entries.map((e) => e.id) });
  assert.deepEqual(
    s.stack.map((t) => t.controller),
    [0, 0, 1],
  );
  s = settle(s);
});

test('without aggregate observers legacy pending triggers, event IDs and replay state are unchanged', () => {
  const s = fixture();
  put(s, 'Zulaport Cutthroat');
  const a = put(s, 'Llanowar Elves'),
    b = put(s, 'Raging Goblin');
  const before = s.nextId;
  const context = captureDepartureContext(s);
  assert.equal(Object.hasOwn(context, 'aggregateDepartures'), false);
  move(s, a, 'graveyard', context);
  move(s, b, 'graveyard', context);
  const expected = structuredClone(s);
  finishDepartureBatch(s, context);
  assert.deepEqual(s, expected);
  assert.equal(s.nextId, before + 2);
  assert.equal(s.pendingTriggers.length, 2);
});

test('actual cards cast, die together, investigate and serialize deterministic command replay', () => {
  const names = ['Homicide Investigator', 'Vengeful Townsfolk', 'Grizzly Bears', 'Day of Judgment'];
  const defs = names.map((name) => ({ ...catalog[name], cost: {} }));
  const deck = [...names, ...Array(3).fill('Forest')];
  let s = createGame({
    catalog: createRegistry([...defs, CARDS.Forest, CARDS['Clue Token']]),
    minimumDeckSize: 7,
    mulligan: false,
    decks: [deck, Array(7).fill('Forest')],
  });
  while (s.step !== 'main1') s = act(s, 'pass');
  const id = (name) => s.players[0].hand.find((id) => s.objects[id].name === name);
  for (const name of names.slice(0, 3)) s = resolve(act(s, 'cast', { card: id(name) }));
  s = resolve(act(s, 'cast', { card: id('Day of Judgment') }));
  assert.equal(s.choice.kind, 'orderTriggers');
  assert.equal(s.choice.entries.length, 2);
  assert.deepEqual(replay(JSON.parse(JSON.stringify(exportReplay(s)))), s);
  s = settle(s);
  assert.equal(
    Object.values(s.objects).filter((o) => o.name === 'Clue Token' && o.zone === 'battlefield')
      .length,
    1,
  );
  assert.deepEqual(replay(JSON.parse(JSON.stringify(exportReplay(s)))), s);
});

test('legend choices and final Saga sacrifices complete the same SBA death event', () => {
  let s = setup();
  const source = witness(s, { event: 'battlefieldToGraveyardGroup' });
  const first = put(s, "G'raha Tia"),
    second = put(s, "G'raha Tia");
  const saga = put(s, 'Summon: Choco/Mog');
  saga.loreCounters = 4;
  const doomed = put(s, 'Llanowar Elves');
  doomed.damage = 1;
  stabilize(s);
  assert.equal(s.choice.kind, 'legendRule');
  assert.ok([first, second, saga, doomed].every((o) => o.zone === 'battlefield'));
  assert.equal(s.pendingTriggers.length, 0);
  s = act(s, 'chooseLegend', { card: first.id });
  assert.equal(s.objects[first.id].zone, 'battlefield');
  for (const o of [second, saga, doomed]) assert.equal(s.objects[o.id].zone, 'graveyard');
  const waiting = [...s.stack, ...(s.choice?.entries ?? [])];
  assert.equal(waiting.filter((t) => t.source.id === source.id).length, 1);
});

test('all-player sacrifice waits for both choices, then emits one event rather than one per player', () => {
  let s = setup();
  const watcher = put(s, 'Great Fierce Bee');
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears', 1);
  effect(s, [{ op: 'sacrifice', player: 'all', count: 1, where: { type: 'creature' } }]);
  assert.equal(s.choice.player, 0);
  s = act(s, 'sacrifice', { cards: [a.id] });
  assert.equal(s.objects[a.id].zone, 'battlefield');
  assert.equal(s.pendingTriggers.length, 0);
  s = act(s, 'sacrifice', { cards: [b.id] });
  assert.equal(s.objects[a.id].zone, 'graveyard');
  assert.equal(s.objects[b.id].zone, 'graveyard');
  assert.equal(s.stack.filter((t) => t.source.id === watcher.id).length, 1);
});

test('aggregate once-per-turn uses do not follow a returned incarnation and ability loss prevents watching', () => {
  const s = setup();
  const source = put(s, 'Homicide Investigator');
  move(s, put(s, 'Grizzly Bears'), 'graveyard');
  assert.equal(s.pendingTriggers.length, 1);
  move(s, source, 'exile');
  move(s, source, 'battlefield');
  move(s, put(s, 'Grizzly Bears'), 'graveyard');
  assert.equal(s.pendingTriggers.length, 2);
  s.turn++;
  addModifier(s, {
    objectId: source.id,
    incarnation: source.incarnation,
    removeAbilities: true,
    expires: s.turn,
  });
  move(s, put(s, 'Grizzly Bears'), 'graveyard');
  assert.equal(s.pendingTriggers.length, 2);
});

test('ability-stripping mass destruction emits one aggregate event for surviving observers', () => {
  const s = setup();
  put(s, 'Great Fierce Bee');
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Llanowar Elves');
  effect(s, [{ op: 'stripDestroyByManaValue', amount: 2 }]);
  assert.equal(a.zone, 'graveyard');
  assert.equal(b.zone, 'graveyard');
  assert.equal(s.pendingTriggers.length, 1);
});
