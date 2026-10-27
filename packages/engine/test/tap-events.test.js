import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry, stats, ref } from '../src/index.js';
import { tapObjects, untapObject, move, addObject } from '../src/model.js';
import { tapForMana } from '../src/mana.js';
import { payCost } from '../src/costs.js';
import { enterBattlefield, stabilize } from '../src/effects.js';
import { validateEventSpec } from '../src/events.js';
import { fixture, put, act, resolve } from './helpers.js';

test('tap events require actual battlefield transitions and allocate no IDs without watchers', () => {
  const s = fixture(),
    land = put(s, 'Forest'),
    absent = put(s, 'Wanderbrine Preacher', 0, 'hand');
  const before = s.nextId;
  assert.equal(tapObjects(s, [land, land, absent]), 1);
  assert.equal(s.nextId, before);
  assert.equal(tapObjects(s, [land]), 0);
  const entering = addObject(s, 'Wanderbrine Preacher', 0, 'void');
  enterBattlefield(s, entering, 0, null, { tapped: true });
  assert.equal(s.pendingTriggers.length, 0);
  untapObject(s, entering);
  tapObjects(s, [entering]);
  assert.equal(s.pendingTriggers.length, 1);
});
test('all simultaneous taps precede observation, including filtered conditions', () => {
  const s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    Watcher: {
      ...CARDS['Wanderbrine Preacher'],
      name: 'Watcher',
      triggers: [
        {
          event: { event: 'tap', object: 'source' },
          condition: {
            kind: 'compare',
            left: { kind: 'count', zone: 'battlefield', player: 'you', where: { tapped: true } },
            operator: 'gte',
            right: 2,
          },
          effects: [{ op: 'gainLife', amount: 2 }],
        },
      ],
    },
  });
  const a = put(s, 'Watcher'),
    b = put(s, 'Watcher');
  tapObjects(s, [a, b]);
  assert.equal(s.pendingTriggers.length, 2);
});
test('mana taps and activated tap costs queue normal triggers, including tap then sacrifice', () => {
  const s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    Producer: { ...CARDS['Wanderbrine Preacher'], name: 'Producer', mana: ['G'] },
  });
  const a = put(s, 'Producer');
  tapForMana(s, a.id, 0, 'G');
  assert.equal(s.players[0].mana.G, 1);
  assert.equal(s.pendingTriggers.length, 1);
  const b = put(s, 'Wanderbrine Preacher');
  payCost(s, 0, { tap: true, sacrificeSelf: true }, { sourceId: b.id });
  assert.equal(s.pendingTriggers.length, 2);
  assert.equal(b.zone, 'graveyard');
  assert.notEqual(s.pendingTriggers[1].source.incarnation, b.incarnation);
});
test('attack taps trigger; vigilance does not; crew taps summoning-sick creatures', () => {
  let s = fixture();
  const a = put(s, 'Wanderbrine Preacher'),
    b = put(s, 'Wylie Duke, Atiin Hero');
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: 0 };
  s = act(s, 'attackers', { cards: [a.id, b.id] });
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(s.players[0].life, 22);
  s = fixture();
  const c = put(s, 'Wanderbrine Preacher', 0, 'battlefield', { ready: false }),
    v = put(s, 'Skybox Ferry');
  s = act(s, 'crew', { card: v.id, cards: [c.id] });
  assert.equal(s.stack.length, 2);
  assert.equal(s.stack.at(-1).name, c.name);
});
test('Nanoform consumes once-per-turn at occurrence and excludes its own incarnation as target', () => {
  let s = fixture();
  const a = put(s, 'Nanoform Sentinel'),
    b = put(s, 'Forest');
  tapObjects(s, [a, b]);
  stabilize(s);
  assert.ok(!s.choice.targets.some((t) => t.id === a.id));
  s = act(s, 'chooseTriggerTarget', { target: ref(b) });
  s = resolve(s);
  assert.equal(s.objects[b.id].tapped, false);
  untapObject(s, s.objects[a.id]);
  tapObjects(s, [s.objects[a.id]]);
  assert.equal(s.pendingTriggers.length, 0);
  s.turn++;
  untapObject(s, s.objects[a.id]);
  tapObjects(s, [s.objects[a.id]]);
  assert.equal(s.pendingTriggers.length, 1);
});
test('Hemosymbic uses resolving power and source LKI after departure, not a returned incarnation', () => {
  for (const depart of [false, true]) {
    let s = fixture();
    const a = put(s, 'Hemosymbic Mite'),
      b = put(s, 'Grizzly Bears');
    tapObjects(s, [a]);
    stabilize(s);
    s = act(s, 'chooseTriggerTarget', { target: ref(b) });
    s.objects[a.id].plusCounters = 3;
    if (depart) {
      move(s, s.objects[a.id], 'graveyard');
      move(s, s.objects[a.id], 'battlefield');
      s.objects[a.id].plusCounters = 20;
    }
    s = resolve(s);
    assert.equal(stats(s, s.objects[b.id]).power, 6);
  }
});
test('generic tap predicates do not pretend to support mana-only or one-or-more aggregation', () => {
  assert.deepEqual(validateEventSpec({ event: 'tap', object: 'source' }), []);
  for (const extra of [{ forMana: true }, { oneOrMore: true }, { firstEachTurn: true }])
    assert.ok(validateEventSpec({ event: 'tap', object: 'source', ...extra }).length);
});
test('convoke and harmonize casting taps trigger above the spell', () => {
  let s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    Convoke: {
      name: 'Convoke',
      type: 'instant',
      cost: { generic: 1 },
      color: [],
      keywords: ['convoke'],
      effects: [],
    },
  });
  const source = put(s, 'Wanderbrine Preacher', 0, 'battlefield', { ready: false }),
    spell = put(s, 'Convoke', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, convoke: [{ card: source.id, symbol: 'generic' }] });
  assert.equal(s.stack.at(-1).name, source.name);
  s = resolve(s);
  assert.equal(s.players[0].life, 22);
  s = fixture();
  const a = put(s, 'Wanderbrine Preacher'),
    ride = put(s, 'Wild Ride', 0, 'graveyard');
  for (let i = 0; i < 5; i++) put(s, 'Mountain');
  s = act(s, 'cast', { card: ride.id, target: ref(a), harmonize: ref(a) });
  assert.equal(s.stack.at(-1).name, a.name);
  assert.equal(s.objects[a.id].tapped, true);
});
test('teamwork taps trigger above their spell and are not mistaken for mana abilities', () => {
  let s = fixture();
  const a = put(s, 'Wanderbrine Preacher'),
    b = put(s, 'Wanderbrine Preacher'),
    counter = put(s, 'We Say Thee Nay!', 0, 'hand'),
    enemy = put(s, 'Unsummon', 1, 'hand');
  put(s, 'Island');
  put(s, 'Island');
  put(s, 'Island', 1);
  s.priority = 1;
  s = act(s, 'cast', { card: enemy.id, target: ref(a) }, 1);
  s = act(s, 'pass', {}, 1);
  s = act(s, 'cast', {
    card: counter.id,
    target: { kind: 'stack', id: s.stack[0].id },
    additionalCost: { teamwork: [ref(a), ref(b)] },
  });
  assert.equal(s.choice.kind, 'orderTriggers');
  assert.equal(s.choice.entries.length, 2);
  assert.equal(s.players[0].life, 20);
});
test('tapAll and multi-target tap resolve a simultaneous transition batch', async () => {
  const { resolveEffects } = await import('../src/effects.js');
  for (const grouped of [false, true]) {
    const s = fixture();
    const a = put(s, 'Wanderbrine Preacher'),
      b = put(s, 'Wanderbrine Preacher');
    const entry = {
      controller: 0,
      source: ref(a),
      effects: [
        grouped ? { op: 'tap', targetGroup: 0 } : { op: 'tapAll', where: { controller: 'you' } },
      ],
      ...(grouped ? { targets: [[ref(a), ref(b)]] } : {}),
    };
    resolveEffects(s, entry);
    assert.equal(s.pendingTriggers.length, 2);
    assert.ok(a.tapped && b.tapped);
    resolveEffects(s, entry);
    assert.equal(s.pendingTriggers.length, 2);
  }
});
test('public tap commands preserve exact replay, with normal stacked rather than immediate payoff', async () => {
  const { createGame, exportReplay, replay, dispatch } = await import('../src/index.js');
  const free = {
    ...CARDS['Wanderbrine Preacher'],
    name: 'Replay tapper',
    cost: {},
    keywords: ['haste'],
    mana: ['G'],
  };
  const deck = [...Array(3).fill(free.name), ...Array(4).fill('Forest')];
  let s = createGame({
    catalog: createRegistry([free, CARDS.Forest]),
    decks: [deck, deck],
    minimumDeckSize: 7,
    mulligan: false,
  });
  s = resolve(resolve(s));
  const id = s.players[0].hand.find((id) => s.objects[id].name === free.name);
  s = resolve(act(s, 'cast', { card: id }));
  const result = dispatch(s, { type: 'tapMana', player: 0, card: id, color: 'G' });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  s = result.state;
  assert.equal(s.players[0].life, 20);
  assert.equal(s.stack.length, 1);
  assert.deepEqual(replay(exportReplay(s)), s);
  s = resolve(s);
  assert.equal(s.players[0].life, 22);
  assert.deepEqual(replay(exportReplay(s)), s);
});
