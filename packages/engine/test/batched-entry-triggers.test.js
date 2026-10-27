import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createGame,
  createRegistry,
  dispatch,
  exportReplay,
  replay,
  validateEventSpec,
  playerView,
  hasKeyword,
} from '../src/index.js';
import { notifyEntryGroup, move, addModifier } from '../src/model.js';
import { matchesEvent } from '../src/events.js';
import {
  enterBattlefield,
  enterBattlefieldBatch,
  resolveEffects,
  stabilize,
} from '../src/effects.js';
import { fixture, put, act, resolve } from './helpers.js';

const grouped = { event: 'enterGroup', controller: 'you', filter: { token: true } };
function witness(s, event = grouped, options = {}, player = 0) {
  const o = put(s, 'Grizzly Bears', player);
  o.definitionOverride = {
    ...CARDS['Grizzly Bears'],
    triggers: [{ event, effects: [{ op: 'gainLife', amount: 1 }], ...options }],
  };
  return o;
}
function effect(s, effects, extra = {}) {
  return resolveEffects(s, { controller: 0, source: null, effects, ...extra });
}
const tokens = (count = 3, extra = {}) => ({
  op: 'token',
  definition: 'Rabbit Token',
  count,
  ...extra,
});

test('entry-group predicates validate and bind identity/controller/filter to one member', () => {
  assert.deepEqual(validateEventSpec(grouped), []);
  for (const bad of [
    { step: 'end' },
    { castByController: true },
    { drawNumber: 1 },
    { firstEachTurn: true },
  ])
    assert.ok(validateEventSpec({ ...grouped, ...bad }).length);
  const source = { id: 'source', controller: 0 };
  const objects = [
    { id: 'mine', controller: 0, token: false, definition: CARDS.Forest },
    { id: 'enemy', controller: 1, token: true, definition: CARDS['Rabbit Token'] },
  ];
  assert.equal(matchesEvent(grouped, 'enterGroup', { objects }, source), false);
  objects[1].controller = 0;
  assert.equal(matchesEvent(grouped, 'enterGroup', { objects }, source), true);
  assert.equal(
    matchesEvent({ ...grouped, object: 'source' }, 'enterGroup', { objects }, source),
    false,
  );
  objects[1].id = 'source';
  assert.equal(
    matchesEvent({ ...grouped, excludeSource: true }, 'enterGroup', { objects }, source),
    false,
  );
});

test('one ordinary multi-token instruction is one group; sequential instructions stay separate', () => {
  const s = fixture();
  witness(s);
  const individual = witness(s, { ...grouped, event: 'enter' });
  effect(s, [tokens()]);
  assert.equal(s.pendingTriggers.length, 4);
  assert.equal(s.pendingTriggers.filter((t) => t.source.id === individual.id).length, 3);
  s.pendingTriggers = [];
  effect(s, [tokens(2), tokens(2)]);
  assert.equal(s.pendingTriggers.filter((t) => t.source.id !== individual.id).length, 2);
  s.pendingTriggers = [];
  effect(s, [tokens(0)]);
  assert.equal(s.pendingTriggers.length, 0);
});

test('simultaneous entrants observe one another, including copied token watchers', () => {
  const s = fixture();
  const w = witness(s, { ...grouped, excludeSource: true });
  move(s, w, 'hand');
  const rabbit = put(s, 'Rabbit Token', 0, 'void');
  enterBattlefieldBatch(s, [{ object: rabbit }, { object: w }]);
  assert.equal(s.pendingTriggers.length, 1);
  s.pendingTriggers = [];
  effect(s, [{ op: 'copyToken', count: 2 }], {
    target: { kind: 'object', id: w.id, incarnation: w.incarnation },
  });
  assert.equal(s.pendingTriggers.length, 3, 'original and both copies see the same group');
});

test('entry facts include simultaneous anthems and replacement counters before matching', () => {
  const s = fixture();
  witness(s, {
    event: 'enterGroup',
    controller: 'you',
    filter: { all: [{ type: 'creature' }, { power: { lte: 2 } }] },
  });
  const a = put(s, 'Glorious Anthem', 0, 'hand');
  const b = put(s, 'Grizzly Bears', 0, 'hand');
  enterBattlefieldBatch(s, [{ object: b }, { object: a }]);
  assert.equal(s.pendingTriggers.length, 0);
  const h = put(s, 'Goldvein Hydra', 0, 'hand');
  enterBattlefield(s, h);
  assert.equal(s.pendingTriggers.length, 1, 'zero X plus anthem is one power');
});

test('entry-group stunned predicates see replacement counters on the same matching entrant', () => {
  const s = fixture();
  const stunned = witness(s, {
    event: 'enterGroup',
    controller: 'you',
    filter: { stunned: true },
  });
  const unstunned = witness(s, {
    event: 'enterGroup',
    controller: 'you',
    filter: { stunned: false },
  });
  const entrant = put(s, 'Grizzly Bears', 0, 'hand');
  entrant.definitionOverride = { ...CARDS['Grizzly Bears'], entryStunCounters: 2 };
  enterBattlefield(s, entrant);
  assert.equal(entrant.stunCounters, 2);
  assert.deepEqual(
    s.pendingTriggers.map((t) => t.source.id),
    [stunned.id],
  );

  s.pendingTriggers = [];
  const enemy = put(s, 'Grizzly Bears', 1, 'hand');
  enemy.definitionOverride = { ...CARDS['Grizzly Bears'], entryStunCounters: 1 };
  enterBattlefieldBatch(s, [
    { object: put(s, 'Grizzly Bears', 0, 'hand') },
    { object: enemy, controller: 1 },
  ]);
  assert.deepEqual(
    s.pendingTriggers.map((t) => t.source.id),
    [unstunned.id],
  );
});

test('suppressed entrants cannot cause group triggers; unaffected members can', () => {
  const s = fixture();
  witness(s);
  const orb = put(s, 'Torpor Orb', 0, 'hand');
  const rabbit = put(s, 'Rabbit Token', 0, 'void');
  enterBattlefieldBatch(s, [{ object: rabbit }, { object: orb }]);
  assert.equal(s.pendingTriggers.length, 0);
  effect(s, [tokens(2)]);
  assert.equal(s.pendingTriggers.length, 0);
  const another = put(s, 'Rabbit Token', 0, 'void');
  const treasure = put(s, 'Treasure Token', 0, 'void');
  enterBattlefieldBatch(s, [{ object: another }, { object: treasure }]);
  assert.equal(s.pendingTriggers.length, 1);
});

test('additional entry triggers add once per applicable doubler, not once per matching entrant', () => {
  const s = fixture();
  witness(s);
  const doubler = put(s, 'Grizzly Bears');
  doubler.definitionOverride = {
    ...CARDS['Grizzly Bears'],
    additionalEnterTrigger: { type: 'creature' },
  };
  const other = put(s, 'Grizzly Bears');
  other.definitionOverride = {
    ...CARDS['Grizzly Bears'],
    additionalEnterTrigger: { type: 'artifact' },
  };
  const entrants = ['Rabbit Token', 'Rabbit Token', 'Treasure Token'].map((name) => ({
    object: put(s, name, 0, 'void'),
  }));
  enterBattlefieldBatch(s, entrants);
  assert.equal(s.pendingTriggers.length, 3);
  s.pendingTriggers = [];
  const once = witness(s, grouped, { oncePerTurn: true });
  effect(s, [tokens()]);
  assert.equal(s.pendingTriggers.filter((t) => t.source.id === once.id).length, 1);
});

test('once-per-turn is consumed on occurrence, refreshes by turn and incarnation, and respects ability loss', () => {
  const s = fixture();
  const w = witness(s, grouped, { oncePerTurn: true });
  effect(s, [tokens(), tokens()]);
  assert.equal(s.pendingTriggers.length, 1);
  s.pendingTriggers = [];
  effect(s, [tokens()]);
  assert.equal(s.pendingTriggers.length, 0);
  s.turn++;
  effect(s, [tokens()]);
  assert.equal(s.pendingTriggers.length, 1);
  move(s, w, 'exile');
  enterBattlefield(s, w);
  effect(s, [tokens()]);
  assert.equal(s.pendingTriggers.length, 2);
  s.turn++;
  addModifier(s, {
    objectId: w.id,
    incarnation: w.incarnation,
    removeAbilities: true,
    expires: s.turn,
  });
  effect(s, [tokens()]);
  assert.equal(s.pendingTriggers.length, 2);
});

test('entry choices stage all tokens, then commit once before continuing and retain temporary keywords', () => {
  let s = fixture();
  const d = { ...CARDS['Rabbit Token'], name: 'Choosing Token', chooseCreatureType: true };
  s.catalog = createRegistry({ ...CARDS, [d.name]: d });
  witness(s);
  const hp = s.players[0].life;
  assert.equal(
    effect(s, [
      tokens(2, { definition: d.name, temporaryKeywords: ['haste'] }),
      { op: 'gainLife', amount: 5 },
    ]),
    false,
  );
  const ids = s.choice.entries.map((e) => e.object.id);
  assert.equal(s.choice.kind, 'creatureType');
  assert.ok(ids.every((id) => s.objects[id].zone === 'void'));
  assert.equal(s.pendingTriggers.length, 0);
  assert.equal(s.players[0].life, hp);
  const before = structuredClone(s);
  const invalid = dispatch(s, { type: 'chooseCreatureType', player: 0, creatureType: 'NotAType' });
  assert.equal(invalid.ok, false);
  assert.deepEqual(s, before);
  s = act(s, 'chooseCreatureType', { creatureType: 'Rabbit' });
  assert.equal(s.choice.kind, 'creatureType');
  assert.ok(ids.every((id) => s.objects[id].zone === 'void'));
  s = act(s, 'chooseCreatureType', { creatureType: 'Bird' });
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 1);
  assert.equal(s.players[0].life, hp + 5);
  assert.ok(
    ids.every(
      (id) => s.objects[id].zone === 'battlefield' && hasKeyword(s, s.objects[id], 'haste'),
    ),
  );
  assert.deepEqual(
    ids.map((id) => s.objects[id].chosenCreatureType),
    ['Rabbit', 'Bird'],
  );
  const view = playerView(s, 1);
  assert.equal(view.stack.length, 1);
  assert.ok(ids.every((id) => view.objects[id].zone === 'battlefield'));
  assert.equal(
    Object.hasOwn(view.stack[0], 'eventSource'),
    false,
    'no arbitrary representative or hidden object',
  );
});

test('APNAP ordering sees both controllers and allows each controller to order its triggers', () => {
  let s = fixture();
  witness(s, { event: 'enterGroup' });
  witness(s, { event: 'enterGroup' });
  witness(s, { event: 'enterGroup' }, {}, 1);
  witness(s, { event: 'enterGroup' }, {}, 1);
  effect(s, [tokens()]);
  stabilize(s);
  assert.equal(s.choice.kind, 'orderTriggers');
  assert.equal(s.choice.player, 0);
  assert.equal(s.choice.entries.length, 2);
  s = act(s, 'orderTriggers', { ids: s.choice.entries.map((t) => t.id) });
  assert.equal(s.choice.player, 1);
  s = act(s, 'orderTriggers', { ids: s.choice.entries.map((t) => t.id) });
  assert.deepEqual(
    s.stack.map((t) => t.controller),
    [0, 0, 1, 1],
  );
});

test('no group observer produces no extra state/log/ID changes; no entry observer preserves legacy token state', () => {
  const s = fixture();
  const o = put(s, 'Rabbit Token');
  const expected = structuredClone(s);
  notifyEntryGroup(s, [o]);
  assert.deepEqual(s, expected);
  const legacy = fixture();
  const modern = structuredClone(legacy);
  legacy.rulesRevision = 3;
  effect(legacy, [tokens(3, { tapped: true })]);
  effect(modern, [tokens(3, { tapped: true })]);
  legacy.rulesRevision = 4;
  assert.deepEqual(modern, legacy);
});

function replayGame(revision) {
  const observer = { ...CARDS['Wildwood Mentor'], cost: {} };
  const maker = { ...CARDS['Hop to It'], cost: {} };
  const catalog = createRegistry([observer, maker, CARDS.Forest, CARDS['Rabbit Token']]);
  let s = createGame({
    catalog,
    mulligan: false,
    minimumDeckSize: 7,
    decks: [['Wildwood Mentor', 'Hop to It', ...Array(5).fill('Forest')], Array(7).fill('Forest')],
  });
  s.rulesRevision = revision;
  while (s.step !== 'main1') s = act(s, 'pass');
  const id = (name) => s.players[0].hand.find((id) => s.objects[id].name === name);
  s = resolve(act(s, 'cast', { card: id('Wildwood Mentor') }));
  s = resolve(act(s, 'cast', { card: id('Hop to It') }));
  return s;
}

test('revisions 1–3 retain legacy token/trigger IDs and replay after choices and re-export', () => {
  for (const revision of [1, 2, 3]) {
    let s = replayGame(revision);
    const entries = s.choice.entries;
    const ids = Object.values(s.objects)
      .filter((o) => o.token)
      .map((o) => Number(o.id.slice(1)));
    assert.deepEqual(ids, [ids[0], ids[0] + 2, ids[0] + 4]);
    assert.deepEqual(
      entries.map((t) => Number(t.id.slice(1))),
      ids.map((id) => id + 1),
    );
    const record = exportReplay(s);
    assert.deepEqual(replay(record), s);
    const unmarked = {
      ...record,
      version: revision === 1 ? '0.42.0' : revision === 2 ? '0.48.0' : '0.57.0',
    };
    delete unmarked.rulesRevision;
    assert.deepEqual(replay(unmarked), s);
    s = act(s, 'orderTriggers', { ids: entries.map((t) => t.id).reverse() });
    s = resolve(s);
    assert.equal(exportReplay(s).rulesRevision, revision);
    assert.deepEqual(replay(exportReplay(s)), s);
  }
});

test('revision 4 commits all tokens before ordinary triggers and replays its public ordering choice', () => {
  let s = replayGame(4);
  const ids = Object.values(s.objects)
    .filter((o) => o.token)
    .map((o) => Number(o.id.slice(1)));
  assert.deepEqual(ids, [ids[0], ids[0] + 1, ids[0] + 2]);
  assert.deepEqual(
    s.choice.entries.map((t) => Number(t.id.slice(1))),
    ids.map((id) => id + 3),
  );
  assert.equal(exportReplay(s).rulesRevision, 4);
  assert.deepEqual(replay(exportReplay(s)), s);
  s = act(s, 'orderTriggers', { ids: s.choice.entries.map((t) => t.id) });
  s = resolve(s);
  assert.deepEqual(replay(exportReplay(s)), s);
});
