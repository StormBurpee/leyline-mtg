import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  DECKS,
  expandDeck,
  createGame,
  dispatch,
  legalActions,
  stats,
  ref,
  planPayment,
  parseDeck,
  exportReplay,
  replay,
  playerView,
  assertInvariants,
  suggestedDamage,
} from '../src/index.js';
import { move } from '../src/model.js';
import { stateBasedActions, stabilize } from '../src/effects.js';
import { beginDamage } from '../src/combat.js';
import { cleanup } from '../src/turn.js';
import { fixture, put, lands, act, resolve } from './helpers.js';

test('starter decks are 60-card valid registries', () => {
  for (const d of Object.values(DECKS)) {
    assert.equal(expandDeck(d.cards).length, 60);
    assert.ok(createGame({ decks: [expandDeck(d.cards), expandDeck(d.cards)] }));
  }
});
test('seeded setup is deterministic; distinct seeds differ', () => {
  assert.deepEqual(createGame({ seed: 11 }), createGame({ seed: 11 }));
  assert.notDeepEqual(
    createGame({ seed: 11 }).players[0].hand,
    createGame({ seed: 12 }).players[0].hand,
  );
});
test('invalid seed and unsupported card are rejected', () => {
  assert.throws(() => createGame({ seed: -1 }), /Seed/);
  assert.throws(
    () => createGame({ decks: [['Black Lotus'], ['Island']], minimumDeckSize: 1 }),
    /Unsupported/,
  );
});
test('London mulligan redraws seven and bottoms chosen cards after keep', () => {
  let s = createGame();
  s = act(s, 'mulligan');
  assert.equal(s.players[0].hand.length, 7);
  s = act(s, 'keep');
  assert.equal(s.choice.kind, 'bottom');
  const id = s.players[0].hand[2];
  s = act(s, 'bottom', { cards: [id] });
  assert.equal(s.players[0].hand.length, 6);
  assert.equal(s.players[0].library.at(-1), id);
  s = act(s, 'keep');
  assert.equal(s.status, 'playing');
});
test('cannot choose duplicate mulligan bottoms', () => {
  let s = createGame();
  s = act(s, 'mulligan');
  s = act(s, 'mulligan');
  s = act(s, 'keep');
  const id = s.players[0].hand[0];
  assert.equal(dispatch(s, { type: 'bottom', player: 0, cards: [id, id] }).ok, false);
});
test('starting player skips first draw; second player does not', () => {
  let s = createGame({ mulligan: false });
  s = resolve(s);
  assert.equal(s.step, 'draw');
  assert.equal(s.players[0].hand.length, 7);
  s.turn = 2;
  s.active = 1;
  s.priority = 1;
  s.step = 'upkeep';
  s = resolve(s);
  assert.equal(s.players[1].hand.length, 8);
});
test('land is a special action and only once per turn', () => {
  let s = fixture();
  const a = put(s, 'Island', 0, 'hand'),
    b = put(s, 'Island', 0, 'hand');
  s = act(s, 'playLand', { card: a.id });
  assert.equal(s.stack.length, 0);
  assert.equal(s.priority, 0);
  assert.equal(dispatch(s, { type: 'playLand', player: 0, card: b.id }).ok, false);
});
test('cannot play land on opponent turn or in response', () => {
  let s = fixture();
  const land = put(s, 'Island', 1, 'hand');
  s.priority = 1;
  assert.equal(dispatch(s, { type: 'playLand', player: 1, card: land.id }).ok, false);
});
test('payment reserves colored symbols before generic; plans are pure', () => {
  const s = fixture();
  lands(s, 'Island', 2);
  lands(s, 'Mountain', 1);
  const before = structuredClone(s),
    plan = planPayment(s, 0, { U: 2, generic: 1 });
  assert.equal(plan.taps.length, 3);
  assert.deepEqual(s, before);
  assert.equal(planPayment(s, 0, { U: 3 }), null);
});
test('manual floating mana is spent before tapping additional sources', () => {
  let s = fixture();
  const [land] = lands(s, 'Mountain', 1);
  s = act(s, 'tapMana', { card: land.id });
  const bolt = put(s, 'Lightning Bolt', 0, 'hand');
  s = act(s, 'cast', { card: bolt.id, target: { kind: 'player', id: 1 }, autoTap: false });
  assert.equal(s.players[0].mana.R, 0);
});
test('mana empties on each step transition', () => {
  let s = fixture();
  const [land] = lands(s, 'Island', 1);
  s = act(s, 'tapMana', { card: land.id });
  s = resolve(s);
  assert.equal(s.players[0].mana.U, 0);
});
test('invalid command is atomic and retains original identity', () => {
  const s = fixture(),
    before = structuredClone(s);
  const bolt = put(s, 'Lightning Bolt', 0, 'hand');
  const snapshot = structuredClone(s);
  const r = dispatch(s, {
    type: 'cast',
    player: 0,
    card: bolt.id,
    target: { kind: 'player', id: 1 },
  });
  assert.equal(r.ok, false);
  assert.equal(r.state, s);
  assert.deepEqual(s, snapshot);
});
test('revision lease rejects stale clicks', () => {
  let s = fixture();
  s = act(s, 'pass');
  assert.equal(
    dispatch(s, { type: 'pass', player: 1, expectedRevision: 0 }).error.code,
    'STALE_COMMAND',
  );
});
test('caster retains priority, two consecutive passes resolve one object', () => {
  let s = fixture();
  lands(s, 'Mountain', 1);
  const bolt = put(s, 'Lightning Bolt', 0, 'hand');
  s = act(s, 'cast', { card: bolt.id, target: { kind: 'player', id: 1 } });
  assert.equal(s.priority, 0);
  s = act(s, 'pass');
  assert.equal(s.players[1].life, 20);
  s = act(s, 'pass');
  assert.equal(s.players[1].life, 17);
  assert.equal(s.priority, s.active);
  assert.equal(s.objects[bolt.id].zone, 'graveyard');
});
test('response resets pass count; counterspell resolves LIFO', () => {
  let s = fixture();
  lands(s, 'Mountain', 1);
  lands(s, 'Island', 2, 1);
  const bolt = put(s, 'Lightning Bolt', 0, 'hand'),
    counter = put(s, 'Counterspell', 1, 'hand');
  s = act(s, 'cast', { card: bolt.id, target: { kind: 'player', id: 1 } });
  const target = { kind: 'stack', id: s.stack[0].id };
  s = act(s, 'pass');
  s = act(s, 'cast', { card: counter.id, target });
  assert.equal(s.passes, 0);
  s = resolve(s);
  assert.equal(s.stack.length, 0);
  assert.equal(s.players[1].life, 20);
  assert.equal(s.objects[bolt.id].zone, 'graveyard');
});
test('creatures cannot be cast at instant speed', () => {
  let s = fixture();
  lands(s, 'Forest', 2, 1);
  const bear = put(s, 'Grizzly Bears', 1, 'hand');
  s.priority = 1;
  assert.equal(dispatch(s, { type: 'cast', player: 1, card: bear.id }).ok, false);
});
test('target becoming illegal fizzles spell without refund', () => {
  let s = fixture();
  lands(s, 'Mountain', 1);
  lands(s, 'Island', 1, 1);
  const bear = put(s, 'Grizzly Bears', 1),
    bolt = put(s, 'Lightning Bolt', 0, 'hand'),
    bounce = put(s, 'Unsummon', 1, 'hand');
  s = act(s, 'cast', { card: bolt.id, target: ref(bear) });
  s = act(s, 'pass');
  s = act(s, 'cast', { card: bounce.id, target: ref(s.objects[bear.id]) });
  s = resolve(s);
  assert.equal(s.objects[bear.id].zone, 'hand');
  s = resolve(s);
  assert.ok(s.events.some((e) => e.type === 'fizzled'));
  assert.equal(s.objects[bolt.id].zone, 'graveyard');
});
test('zone incarnation prevents old spell hitting a returned object', () => {
  let s = fixture();
  lands(s, 'Mountain', 1);
  const bear = put(s, 'Grizzly Bears', 1),
    bolt = put(s, 'Lightning Bolt', 0, 'hand');
  s = act(s, 'cast', { card: bolt.id, target: ref(bear) });
  move(s, s.objects[bear.id], 'hand');
  move(s, s.objects[bear.id], 'battlefield');
  s = resolve(s);
  assert.equal(s.objects[bear.id].damage, 0);
  assert.ok(s.events.some((e) => e.type === 'fizzled'));
});
test('Doom Blade cannot target black creatures', () => {
  let s = fixture();
  lands(s, 'Swamp', 2);
  const rat = put(s, 'Typhoid Rats', 1),
    blade = put(s, 'Doom Blade', 0, 'hand');
  assert.equal(
    dispatch(s, { type: 'cast', player: 0, card: blade.id, target: ref(rat) }).ok,
    false,
  );
});
test('Negate cannot target creature spells', () => {
  let s = fixture();
  lands(s, 'Forest', 2);
  lands(s, 'Island', 2, 1);
  const bear = put(s, 'Grizzly Bears', 0, 'hand'),
    negate = put(s, 'Negate', 1, 'hand');
  s = act(s, 'cast', { card: bear.id });
  s = act(s, 'pass');
  assert.equal(
    dispatch(s, {
      type: 'cast',
      player: 1,
      card: negate.id,
      target: { kind: 'stack', id: s.stack[0].id },
    }).ok,
    false,
  );
});
test('fresh mana creature cannot tap but a land can', () => {
  let s = fixture();
  const elf = put(s, 'Llanowar Elves', 0, 'battlefield', { ready: false }),
    forest = put(s, 'Forest', 0, 'battlefield', { ready: false });
  assert.equal(dispatch(s, { type: 'tapMana', player: 0, card: elf.id }).ok, false);
  assert.equal(dispatch(s, { type: 'tapMana', player: 0, card: forest.id }).ok, true);
});
test('ETB is a separate stack ability and grants response window', () => {
  let s = fixture();
  lands(s, 'Forest', 2);
  const card = put(s, 'Elvish Visionary', 0, 'hand');
  s = act(s, 'cast', { card: card.id });
  s = resolve(s);
  assert.equal(s.stack.length, 1);
  assert.equal(s.stack[0].kind, 'ability');
  assert.equal(s.players[0].hand.length, 0);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 1);
});
test('multiple triggers require ordering and resolve APNAP', () => {
  let s = fixture();
  put(s, 'Soul Warden', 0);
  put(s, 'Soul Warden', 0);
  put(s, 'Soul Warden', 1);
  lands(s, 'Forest', 2);
  const bear = put(s, 'Grizzly Bears', 0, 'hand');
  s = act(s, 'cast', { card: bear.id });
  s = resolve(s);
  assert.equal(s.choice.kind, 'orderTriggers');
  assert.equal(s.choice.player, 0);
  s = act(s, 'orderTriggers', { ids: s.choice.entries.map((e) => e.id) });
  assert.equal(s.stack.at(-1).controller, 1);
  s = resolve(s);
  assert.equal(s.players[1].life, 21);
});
test('tokens disappear after changing zones', () => {
  let s = fixture();
  const token = put(s, 'Goblin Token');
  move(s, token, 'hand');
  stabilize(s);
  assert.equal(s.objects[token.id], undefined);
  assert.ok(!s.players[0].hand.includes(token.id));
});
test('Anthem applies dynamically; removing it causes simultaneous deaths', () => {
  const s = fixture(),
    a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears'),
    anthem = put(s, 'Glorious Anthem');
  a.damage = 2;
  b.damage = 2;
  assert.equal(stats(s, a).toughness, 3);
  move(s, anthem, 'graveyard');
  stabilize(s);
  assert.equal(a.zone, 'graveyard');
  assert.equal(b.zone, 'graveyard');
});
test('Pacifism falls off when its target leaves and cannot attach to reincarnation', () => {
  let s = fixture();
  lands(s, 'Plains', 2);
  const bear = put(s, 'Grizzly Bears', 1),
    aura = put(s, 'Pacifism', 0, 'hand');
  s = act(s, 'cast', { card: aura.id, target: ref(bear) });
  s = resolve(s);
  move(s, s.objects[bear.id], 'hand');
  stabilize(s);
  assert.equal(s.objects[aura.id].zone, 'graveyard');
});
test('zero life and empty draw lose simultaneously', () => {
  const s = fixture();
  s.players[0].life = 0;
  s.players[1].failedDraw = true;
  stabilize(s);
  assert.equal(s.status, 'finished');
  assert.equal(s.winner, null);
});
test('cleanup expires buffs, clears damage, and requests exact discard', () => {
  let s = fixture();
  const bear = put(s, 'Grizzly Bears');
  s.modifiers.push({
    objectId: bear.id,
    incarnation: bear.incarnation,
    power: 3,
    toughness: 3,
    expires: s.turn,
  });
  bear.damage = 4;
  for (let i = 0; i < 9; i++) put(s, 'Island', 0, 'hand');
  cleanup(s);
  assert.equal(s.choice.kind, 'discard');
  s = act(s, 'discard', { cards: s.players[0].hand.slice(0, 2) });
  assert.equal(s.turn, 4);
  assert.equal(s.objects[bear.id].damage, 0);
  assert.equal(s.objects[bear.id].zone, 'battlefield');
  assert.equal(stats(s, s.objects[bear.id]).toughness, 2);
});
test('deck importer rejects unsupported and excess copies rather than pretending', () => {
  assert.ok(parseDeck('60 Black Lotus').errors.some((e) => e.includes('Unsupported')));
  assert.ok(parseDeck('60 Lightning Bolt').errors.some((e) => e.includes('four')));
  assert.equal(parseDeck('60 Island (M21) 265').errors.length, 0);
});
test('replay round trip preserves deterministic state', () => {
  let s = createGame({ seed: 871 });
  s = act(s, 'keep');
  s = act(s, 'mulligan');
  s = act(s, 'keep');
  s = act(s, 'bottom', { cards: [s.players[1].hand[0]] });
  s = resolve(s);
  s = resolve(s);
  const land = legalActions(s, 0).find((a) => a.type === 'playLand');
  if (land) s = act(s, land.type, land);
  assert.deepEqual(replay(JSON.parse(JSON.stringify(exportReplay(s)))), s);
});
test('public view hides opponent hand, libraries, configuration and RNG', () => {
  const s = createGame(),
    v = playerView(s, 0);
  assert.ok(v.objects[v.players[1].hand[0]].hidden);
  assert.equal(v.objects[v.players[1].hand[0]].name, undefined);
  assert.equal(v.config, undefined);
  assert.equal(v.rng, undefined);
  assert.equal(v.history, undefined);
  assert.ok(v.objects[s.players[0].hand[0]].name);
});
test('concession works without priority', () => {
  let s = fixture();
  s = act(s, 'concede', {}, 1);
  assert.equal(s.winner, 0);
  assert.equal(dispatch(s, { type: 'pass', player: 0 }).ok, false);
});

test('prototype property names are not accepted as cards', () => {
  for (const name of ['constructor', 'toString', '__proto__'])
    assert.ok(parseDeck(`60 ${name}`).errors.some((e) => e.includes('Unsupported')));
});
test('command targets and exported replays cannot mutate live state', () => {
  let s = fixture();
  lands(s, 'Mountain', 1);
  const bolt = put(s, 'Lightning Bolt', 0, 'hand');
  const command = { type: 'cast', player: 0, card: bolt.id, target: { kind: 'player', id: 1 } };
  const result = dispatch(s, command);
  assert.equal(result.ok, true);
  command.target.id = 0;
  assert.equal(result.state.stack[0].target.id, 1);
  const record = exportReplay(result.state);
  record.config.seed = 999;
  record.commands[0].target.id = 0;
  assert.equal(result.state.config.seed, 731);
  assert.equal(result.state.history[0].target.id, 1);
});
test('historical event records are immutable and seed is absent from public events', () => {
  let s = createGame();
  assert.throws(() => {
    s.events[0].type = 'changed';
  }, TypeError);
  const view = playerView(s, 0);
  assert.equal(
    view.events.some((e) => 'seed' in e),
    false,
  );
});

test('malformed mana-source identifiers reject without throwing or mutating state', () => {
  const s = fixture();
  for (const card of ['__proto__', 'constructor', 'missing']) {
    const r = dispatch(s, { type: 'tapMana', player: 0, card });
    assert.equal(r.ok, false);
    assert.equal(r.state, s);
    assert.equal(r.error.code, 'MANA_SOURCE');
  }
});
test('unknown replay schemas and engine versions fail explicitly', () => {
  const record = exportReplay(createGame());
  assert.throws(() => replay({ ...record, schemaVersion: 999 }), /Unsupported replay/);
  assert.throws(() => replay({ ...record, version: '99.0.0' }), /Unsupported replay/);
});
test('legacy 0.1 replay envelopes remain readable', () => {
  const record = exportReplay(createGame({ seed: 17 }));
  record.version = '0.1.0';
  delete record.schemaVersion;
  delete record.config.catalog;
  const restored = replay(record);
  assert.equal(restored.version, '0.27.0');
  assert.equal(restored.seed, 17);
});
