import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import {
  CARDS,
  createRegistry,
  createGame,
  dispatch,
  ref,
  playerView,
  exportReplay,
  replay,
  chooseBotCommand,
  legalActions,
  stats,
} from '../packages/engine/src/index.js';
import { move, draw, notifyTriggers, addLoreCounters } from '../packages/engine/src/model.js';
import { stabilize } from '../packages/engine/src/effects.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { fixture, put, act, resolve } from '../packages/engine/test/helpers.js';
const names = [
  'A.I.M. Scientists',
  'Abandon Attachments',
  'Celebrate the Mountain-king',
  "Doc Ock's Henchmen",
  'Esgaroth Garrison',
  'Great Gilded Boat',
  'Kang, Temporal Tyrant',
  'Lake-town Lookout',
  'Long Lake Nuisance',
  'M.O.D.O.K.',
  'Madame Masque',
  'Mechanical Mobster',
  'Mob Lookout',
  'Patient Instructor',
  'Prowler, Clawed Thief',
  'Red Room Recruit',
  "The Mountain-king's Return",
  'Unstable Experiment',
];
const sources = names.map((name) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../packages/cards/cards/${name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')}.json`,
        import.meta.url,
      ),
    ),
  ),
);
const identities = {
  'leyline:token/human-soldier-token': 'Human Soldier Token',
  'leyline:token/villain-token': 'Villain Token',
};
const definitions = sources.map((source) => {
  const result = compileCard(source, { identities });
  assert.equal(result.ok, true, `${source.name}: ${JSON.stringify(result.diagnostics)}`);
  return result.definition;
});
const catalog = createRegistry({
  ...CARDS,
  ...Object.fromEntries(definitions.map((d) => [d.name, d])),
});
function position(extra = {}) {
  const s = fixture();
  s.catalog = createRegistry({ ...catalog, ...extra });
  s.players[0].mana = { W: 20, U: 20, B: 20, R: 20, G: 20, C: 20 };
  return s;
}
function enter(name, extra = {}) {
  let s = position(extra);
  const c = put(s, name, 0, 'hand');
  s = act(s, 'cast', { card: c.id });
  s = resolve(s);
  return [s, c];
}
function emptyLibrary(s, p = 0) {
  for (const id of [...s.players[p].library]) move(s, s.objects[id], 'exile');
}
function discard(s, id) {
  return act(s, 'discardEffect', { cards: [id] });
}
const tokenCount = (s) =>
  Object.values(s.objects).filter(
    (o) => o.zone === 'battlefield' && o.name === 'Human Soldier Token',
  ).length;

test('all 18 complete source cards validate schema and native round trip without generated catalog changes', () => {
  const schema = JSON.parse(
    readFileSync(new URL('../packages/cards/schema/card.schema.json', import.meta.url)),
  );
  const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);
  for (const [i, source] of sources.entries()) {
    assert.equal(validate(source), true, `${source.name}: ${JSON.stringify(validate.errors)}`);
    const round = compileCard(
      sourceFromDefinition(definitions[i], {
        id: source.id,
        idsByName: Object.fromEntries(Object.entries(identities).map(([id, name]) => [name, id])),
      }),
      { identities },
    );
    assert.equal(round.ok, true, `${source.name}: ${JSON.stringify(round.diagnostics)}`);
    assert.deepEqual(round.definition, definitions[i]);
  }
});
test('connive rewards only an actually discarded nonland, after the draw and without another priority window', () => {
  for (const nonland of [false, true]) {
    let [s, c] = enter('Red Room Recruit');
    const card = put(s, nonland ? 'Shock' : 'Island', 0, 'hand');
    const before = s.players[0].hand.length;
    s = resolve(s);
    assert.equal(s.choice.kind, 'discardEffect');
    assert.equal(s.players[0].hand.length, before + 1);
    assert.equal(s.objects[c.id].plusCounters, 0);
    s = discard(s, card.id);
    assert.equal(s.objects[c.id].plusCounters, nonland ? 1 : 0);
    assert.equal(s.objects[card.id].zone, 'graveyard');
    assert.equal(s.resolving, null);
  }
});
test('a departed conniver uses last controller, keeps private choices, and never counters its returned incarnation', () => {
  let [s, c] = enter('Red Room Recruit');
  s.objects[c.id].controller = 1;
  move(s, s.objects[c.id], 'hand');
  move(s, s.objects[c.id], 'battlefield');
  const selected = put(s, 'Shock', 1, 'hand');
  const before = s.players[1].hand.length;
  s = resolve(s);
  assert.equal(s.choice.player, 1);
  assert.equal(s.players[1].hand.length, before + 1);
  assert.equal(playerView(s, 0).choice.kind, 'opponentChoice');
  assert.equal(playerView(s, 0).objects[selected.id], undefined);
  const snapshot = structuredClone(s);
  const bad = dispatch(s, { type: 'discardEffect', player: 0, cards: [selected.id] });
  assert.equal(bad.ok, false);
  assert.deepEqual(s, snapshot);
  s = discard(s, selected.id);
  assert.equal(s.objects[c.id].plusCounters, 0);
});
test('failed draw still permits the required discard and nonland counter, then losing is checked', () => {
  let [s, c] = enter('Red Room Recruit');
  emptyLibrary(s);
  const nonland = put(s, 'Shock', 0, 'hand');
  s = resolve(s);
  assert.equal(s.choice.kind, 'discardEffect');
  assert.equal(s.status, 'playing');
  s = discard(s, nonland.id);
  assert.equal(s.objects[c.id].plusCounters, 1);
  assert.equal(s.status, 'finished');
  let [empty] = enter('Red Room Recruit');
  emptyLibrary(empty);
  empty = resolve(empty);
  assert.equal(empty.choice, null);
  assert.equal(empty.status, 'finished');
});
test('recruit continuation observes discard, surviving source independence, and correct token characteristics', () => {
  for (const name of ['Patient Instructor', 'Long Lake Nuisance', 'Esgaroth Garrison']) {
    let [s, c] = enter(name);
    const nonland = put(s, 'Shock', 0, 'hand');
    move(s, s.objects[c.id], 'graveyard');
    s = resolve(s);
    s = discard(s, nonland.id);
    assert.equal(tokenCount(s), 1);
    const t = Object.values(s.objects).find(
      (o) => o.zone === 'battlefield' && o.name === 'Human Soldier Token',
    );
    assert.deepEqual(stats(s, t), { power: 1, toughness: 1 });
    assert.deepEqual(catalog[t.name].subtypes, ['Human', 'Soldier']);
    assert.deepEqual(catalog[t.name].color, ['W']);
  }
  let [s] = enter('Patient Instructor');
  const land = put(s, 'Island', 0, 'hand');
  s = resolve(s);
  s = discard(s, land.id);
  assert.equal(tokenCount(s), 0);
});
test('discardThen optional cost cannot draw for declining, empty hand, or invalid choice; bot declines lethal draw', () => {
  for (const selection of ['decline', 'discard', 'empty']) {
    let s = position();
    const spell = put(s, 'Abandon Attachments', 0, 'hand');
    const payment = selection === 'empty' ? null : put(s, 'Shock', 0, 'hand');
    s = act(s, 'cast', { card: spell.id });
    s = resolve(s);
    if (selection === 'empty') {
      assert.equal(s.choice, null);
      assert.equal(s.players[0].hand.length, 0);
      continue;
    }
    assert.equal(s.choice.optional, true);
    const before = s.players[0].hand.length;
    const invalid = dispatch(s, {
      type: 'discardEffect',
      player: 0,
      cards: [payment.id, payment.id],
    });
    assert.equal(invalid.ok, false);
    s = act(s, 'discardEffect', { cards: selection === 'decline' ? [] : [payment.id] });
    assert.equal(s.players[0].hand.length, before + (selection === 'discard' ? 1 : 0));
  }
  let s = position();
  emptyLibrary(s);
  put(s, 'Shock', 0, 'hand');
  const spell = put(s, 'Abandon Attachments', 0, 'hand');
  s = act(s, 'cast', { card: spell.id });
  s = resolve(s);
  assert.deepEqual(chooseBotCommand(s, 0).cards, []);
});
test('grouped connive retains every target through repeated discard choices and then restores the parent bindings', () => {
  const spell = {
    name: 'Grouped Connive Fixture',
    type: 'sorcery',
    cost: {},
    targetGroups: [
      { id: 'first', selector: 'creature', min: 1, max: 1 },
      { id: 'second', selector: 'creature', min: 1, max: 1 },
      { id: 'player', selector: 'player', min: 1, max: 1 },
    ],
    effects: [
      { op: 'connive', targetGroup: 'first' },
      { op: 'connive', targetGroup: 'second' },
      { op: 'draw', count: 1, player: 'target', targetGroup: 'player' },
      { op: 'gainLife', amount: 2 },
    ],
  };
  let s = position({ [spell.name]: spell });
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears', 1);
  const x = put(s, 'Shock', 0, 'hand'),
    y = put(s, 'Shock', 1, 'hand');
  const card = put(s, spell.name, 0, 'hand');
  const enemyHand = s.players[1].hand.length;
  s = act(s, 'cast', {
    card: card.id,
    targets: { first: [ref(a)], second: [ref(b)], player: [{ kind: 'player', id: 1 }] },
  });
  s = resolve(s);
  assert.equal(s.choice.player, 0);
  s = discard(s, x.id);
  assert.equal(s.objects[a.id].plusCounters, 1);
  assert.equal(s.choice.player, 1);
  assert.equal(s.objects[card.id].zone, 'stack');
  s = discard(s, y.id);
  assert.equal(s.objects[b.id].plusCounters, 1);
  assert.equal(s.players[1].hand.length, enemyHand + 1);
  assert.equal(s.players[0].life, 22);
  assert.equal(s.objects[card.id].zone, 'graveyard');
  assert.equal(s.choice, null);
});
test('targeted connive fizzles on stale incarnation and optional grouped connive does not draw if omitted', () => {
  let [s, c] = enter('Mob Lookout');
  const creature = put(s, 'Grizzly Bears');
  s = act(s, 'chooseTriggerTarget', { target: ref(creature) });
  move(s, s.objects[creature.id], 'hand');
  move(s, s.objects[creature.id], 'battlefield');
  const before = s.players[0].hand.length;
  s = resolve(s);
  assert.equal(s.choice, null);
  assert.equal(s.players[0].hand.length, before);
  s = position();
  const card = put(s, 'Unstable Experiment', 0, 'hand');
  const n = s.players[1].hand.length;
  s = act(s, 'cast', {
    card: card.id,
    targets: { player: [{ kind: 'player', id: 1 }], creature: [] },
  });
  s = resolve(s);
  assert.equal(s.players[1].hand.length, n + 1);
  assert.equal(s.choice, null);
});
test('event-source connive uses departed event creature LKI, not trigger owner', () => {
  const d = {
    name: 'Event Conniver',
    type: 'creature',
    cost: {},
    power: 2,
    toughness: 2,
    triggers: [
      {
        event: { event: 'enter', excludeSource: true, filter: { type: 'creature' } },
        effects: [{ op: 'connive', subject: 'eventSource' }],
      },
    ],
  };
  let s = position({ [d.name]: d });
  put(s, d.name);
  const bear = put(s, 'Grizzly Bears', 1);
  notifyTriggers(s, 'enter', { object: bear });
  s = act(s, 'pass');
  move(s, s.objects[bear.id], 'graveyard');
  const card = put(s, 'Shock', 1, 'hand');
  s = act(s, 'pass');
  assert.equal(s.choice.player, 1);
  s = discard(s, card.id);
  assert.equal(s.objects[bear.id].plusCounters, 0);
});
test('discard continuation validation rejects malformed fields, selectors, nested missing tokens and unsupported bindings', () => {
  const base = { name: 'Bad', type: 'sorcery', cost: {} };
  for (const effect of [
    { op: 'discardThen', count: 0, then: [] },
    { op: 'discardThen', count: 17, then: [] },
    { op: 'discardThen', count: 1, optional: 'yes', then: [] },
    { op: 'discardThen', count: 1, where: { nonsense: true }, then: [] },
    { op: 'discardThen', count: 1, then: [{ op: 'token', definition: 'Missing', count: 1 }] },
    { op: 'connive' },
    { op: 'connive', subject: 'opponent' },
  ])
    assert.throws(() => createRegistry({ ...catalog, Bad: { ...base, effects: [effect] } }));
});
test('connive activations honor your-turn restriction, life payment, anthem, and bot draw safety', () => {
  let s = position();
  const c = put(s, 'M.O.D.O.K.');
  const b = put(s, 'Grizzly Bears', 1);
  assert.deepEqual(stats(s, b), { power: 1, toughness: 1 });
  s.active = 1;
  assert.equal(dispatch(s, { type: 'activate', player: 0, card: c.id, ability: 0 }).ok, false);
  s.active = 0;
  s = act(s, 'activate', { card: c.id, ability: 0 });
  assert.equal(s.players[0].life, 17);
  s = resolve(s);
  assert.equal(s.choice.kind, 'discardEffect');
  s = act(s, 'discardEffect', chooseBotCommand(s, 0));
  emptyLibrary(s);
  assert.ok(!['activate'].includes(chooseBotCommand(s, 0).type));
});
test('draw-trigger clauses wait until connive completion and count each actual draw', () => {
  let [s, c] = enter('Madame Masque');
  s.players[0].cardsDrawn = { turn: s.turn, count: 1 };
  const card = put(s, 'Shock', 0, 'hand');
  s = resolve(s);
  assert.equal(s.pendingTriggers.length, 1);
  assert.equal(s.stack.length, 0);
  s = discard(s, card.id);
  assert.equal(s.stack.at(-1).name, 'Madame Masque');
  s = resolve(s);
  assert.equal(
    Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.name === 'Villain Token')
      .length,
    1,
  );
});
test('paused discard and resumed recruit replay identically with a private bot decision', () => {
  const name = 'Patient Instructor',
    free = { ...catalog[name], cost: {} };
  let s, c;
  for (let seed = 1; seed < 100; seed++) {
    s = createGame({
      catalog: { ...catalog, [name]: free },
      mulligan: false,
      seed,
      decks: [[...Array(4).fill(name), ...Array(56).fill('Island')], Array(60).fill('Forest')],
    });
    c = s.players[0].hand.find((id) => s.objects[id].name === name);
    if (c) break;
  }
  assert.ok(c);
  while (s.step !== 'main1') s = act(s, 'pass');
  s = act(s, 'cast', { card: c });
  s = resolve(s);
  s = resolve(s);
  assert.equal(s.choice.kind, 'discardEffect');
  assert.deepEqual(replay(exportReplay(s)), s);
  const command = chooseBotCommand(playerView(s, 0), 0);
  assert.ok(command.cards.every((id) => s.players[0].hand.includes(id)));
  s = act(s, 'discardEffect', command);
  assert.deepEqual(replay(exportReplay(s)), s);
});
test('A.I.M. Scientists also cycles into a revealed basic land, without an enters connive', () => {
  let s = position();
  const card = put(s, 'A.I.M. Scientists', 0, 'hand');
  const basic = put(s, 'Island', 0, 'library');
  s = act(s, 'cycle', { card: card.id });
  assert.equal(s.objects[card.id].zone, 'graveyard');
  s = resolve(s);
  assert.equal(s.choice.kind, 'librarySearch');
  s = act(s, 'searchLibrary', { cards: [basic.id] });
  assert.equal(s.objects[basic.id].zone, 'hand');
  assert.equal(s.stack.length, 0);
  assert.equal(s.choice, null);
});
test('flash Henchmen connives on attack; Kang drains exactly on the second actual draw', () => {
  let s = position();
  s.active = 1;
  s.step = 'end';
  const hench = put(s, "Doc Ock's Henchmen", 0, 'hand');
  s = act(s, 'cast', { card: hench.id });
  s = resolve(s);
  assert.equal(s.stack.length, 0);
  s.active = 0;
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: 0 };
  s.objects[hench.id].controlledSince = s.turn - 1;
  const kang = put(s, 'Kang, Temporal Tyrant');
  s.players[0].cardsDrawn = { turn: s.turn, count: 1 };
  const payment = put(s, 'Shock', 0, 'hand');
  s = act(s, 'attackers', { cards: [hench.id] });
  assert.equal(s.stack.at(-1).name, "Doc Ock's Henchmen");
  s = resolve(s);
  s = discard(s, payment.id);
  assert.equal(s.stack.at(-1).name, 'Kang, Temporal Tyrant');
  s = resolve(s);
  assert.equal(s.players[0].life, 21);
  assert.equal(s.players[1].life, 19);
  assert.equal(s.objects[hench.id].plusCounters, 1);
});
test('Prowler ignores its own entry and other controllers, but connives for another friendly Villain', () => {
  let [s, p] = enter('Prowler, Clawed Thief');
  assert.equal(s.stack.length, 0);
  const enemy = put(s, 'Red Room Recruit', 1);
  notifyTriggers(s, 'enter', { object: enemy });
  assert.equal(s.pendingTriggers.filter((t) => t.name === p.name).length, 0);
  s.pendingTriggers = [];
  const ally = put(s, 'Red Room Recruit');
  notifyTriggers(s, 'enter', { object: ally });
  assert.equal(s.pendingTriggers.filter((t) => t.name === p.name).length, 1);
});
test('death recruit and attack-group recruit work after source leaves and without crewing the Boat', () => {
  let s = position();
  const lookout = put(s, 'Lake-town Lookout');
  const card = put(s, 'Shock', 0, 'hand');
  move(s, s.objects[lookout.id], 'graveyard');
  stabilize(s);
  s = resolve(s);
  s = discard(s, card.id);
  assert.equal(tokenCount(s), 1);
  s = position();
  const boat = put(s, 'Great Gilded Boat');
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears');
  const payment = put(s, 'Shock', 0, 'hand');
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: 0 };
  s = act(s, 'attackers', { cards: [a.id, b.id] });
  assert.equal(s.stack.length, 1);
  assert.equal(s.stack[0].name, boat.name);
  assert.ok(!s.combat.attackers.some((r) => r.id === boat.id));
  s = resolve(s);
  s = discard(s, payment.id);
  assert.equal(tokenCount(s), 1);
});
test('Esgaroth power includes itself and the recruited token; Boat has a functional crew 2 ability', () => {
  let [s, c] = enter('Esgaroth Garrison');
  assert.equal(stats(s, s.objects[c.id]).power, 1);
  const payment = put(s, 'Shock', 0, 'hand');
  s = resolve(s);
  s = discard(s, payment.id);
  assert.equal(stats(s, s.objects[c.id]).power, 2);
  assert.equal(stats(s, s.objects[c.id]).toughness, 5);
  s = position();
  const boat = put(s, 'Great Gilded Boat'),
    bear = put(s, 'Grizzly Bears');
  s = act(s, 'crew', { card: boat.id, cards: [bear.id] });
  s = resolve(s);
  assert.deepEqual(stats(s, s.objects[boat.id]), { power: 4, toughness: 4 });
  assert.equal(s.objects[bear.id].tapped, true);
});
test('Mechanical Mobster preserves independent targets and exiles before the connive pause', () => {
  let [s, c] = enter('Mechanical Mobster');
  const grave = put(s, 'Shock', 1, 'graveyard'),
    bear = put(s, 'Grizzly Bears');
  const payment = put(s, 'Opt', 0, 'hand');
  s = act(s, 'chooseTriggerTargets', {
    targets: { graveyard: [ref(grave)], creature: [ref(bear)] },
  });
  s = resolve(s);
  assert.equal(s.objects[grave.id].zone, 'exile');
  assert.equal(s.choice.kind, 'discardEffect');
  s = discard(s, payment.id);
  assert.equal(s.objects[bear.id].plusCounters, 1);
  [s, c] = enter('Mechanical Mobster');
  const dead = put(s, 'Shock', 1, 'graveyard'),
    target = put(s, 'Grizzly Bears');
  s = act(s, 'chooseTriggerTargets', {
    targets: { graveyard: [ref(dead)], creature: [ref(target)] },
  });
  move(s, s.objects[target.id], 'hand');
  s = resolve(s);
  assert.equal(s.objects[dead.id].zone, 'exile');
  assert.equal(s.choice, null);
});
test('Celebrate has independent entry triggers, linked-exile return, and recruit even after source departure', () => {
  let s = position();
  const enemy = put(s, 'Grizzly Bears', 1),
    payment = put(s, 'Shock', 0, 'hand'),
    card = put(s, 'Celebrate the Mountain-king', 0, 'hand');
  s = act(s, 'cast', { card: card.id });
  s = resolve(s);
  while (s.choice && s.choice.kind !== 'discardEffect') {
    const cmd = chooseBotCommand(s, s.choice.player);
    s = act(s, cmd.type, cmd);
  }
  assert.equal(s.stack.length, 2);
  while (s.stack.length || s.choice) {
    if (s.choice) {
      assert.equal(s.choice.kind, 'discardEffect');
      s = discard(s, payment.id);
    } else s = resolve(s);
  }
  assert.equal(s.objects[enemy.id].zone, 'exile');
  assert.equal(tokenCount(s), 1);
  move(s, s.objects[card.id], 'graveyard');
  stabilize(s);
  assert.equal(s.objects[enemy.id].zone, 'battlefield');
});
test('all three Mountain-king Saga chapters execute, including bounded reanimation and optional final counter', () => {
  let [s, c] = enter("The Mountain-king's Return");
  const payment = put(s, 'Shock', 0, 'hand');
  s = resolve(s);
  s = discard(s, payment.id);
  assert.equal(tokenCount(s), 1);
  const bear = put(s, 'Grizzly Bears', 0, 'graveyard'),
    expensive = put(s, 'Serra Angel', 0, 'graveyard');
  addLoreCounters(s, s.objects[c.id], 1);
  stabilize(s);
  assert.equal(s.choice.kind, 'triggerTarget');
  assert.ok(!s.choice.targets.some((t) => t.id === expensive.id));
  s = act(s, 'chooseTriggerTarget', { target: ref(bear) });
  s = resolve(s);
  assert.equal(s.objects[bear.id].zone, 'battlefield');
  addLoreCounters(s, s.objects[c.id], 1);
  stabilize(s);
  s = act(s, 'chooseTriggerTargets', { targets: { creature: [ref(s.objects[bear.id])] } });
  s = resolve(s);
  assert.equal(s.objects[bear.id].plusCounters, 1);
  assert.equal(s.objects[c.id].zone, 'graveyard');
});
test('simultaneous multi-permanent connive is rejected until controller-order choices exist', () => {
  assert.throws(() =>
    createRegistry({
      ...catalog,
      Bad: {
        name: 'Bad',
        type: 'sorcery',
        cost: {},
        targetGroups: [{ id: 'chosen', selector: 'creature', min: 0, max: 2 }],
        effects: [{ op: 'connive', targetGroup: 'chosen' }],
      },
    }),
  );
});
test('optional multi-discard proposes only complete payments and cannot pay partially', () => {
  const d = {
    name: 'Double Discard',
    type: 'sorcery',
    cost: {},
    effects: [
      { op: 'discardThen', count: 2, optional: true, then: [{ op: 'gainLife', amount: 3 }] },
    ],
  };
  let s = position({ [d.name]: d });
  const card = put(s, d.name, 0, 'hand');
  for (let i = 0; i < 3; i++) put(s, 'Island', 0, 'hand');
  s = act(s, 'cast', { card: card.id });
  s = resolve(s);
  const proposals = legalActions(s, 0).filter((a) => a.type === 'discardEffect');
  assert.ok(proposals.some((a) => a.cards.length === 2));
  assert.ok(proposals.every((a) => a.cards.length === 0 || a.cards.length === 2));
  for (const proposal of proposals) assert.equal(dispatch(s, { ...proposal, player: 0 }).ok, true);
  assert.equal(
    dispatch(s, { type: 'discardEffect', player: 0, cards: [s.players[0].hand[0]] }).ok,
    false,
  );
  s = act(
    s,
    'discardEffect',
    proposals.find((a) => a.cards.length === 2),
  );
  assert.equal(s.players[0].life, 23);
  s = position({ [d.name]: d });
  const spell = put(s, d.name, 0, 'hand');
  put(s, 'Shock', 0, 'hand');
  s = act(s, 'cast', { card: spell.id });
  s = resolve(s);
  assert.equal(s.choice, null);
  assert.equal(s.players[0].life, 20);
  assert.equal(s.players[0].hand.length, 1);
});
