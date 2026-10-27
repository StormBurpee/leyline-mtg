import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createGame,
  dispatch,
  exportReplay,
  replay,
  chooseBotCommand,
} from '../src/index.js';
import { addLoreCounters, move, ref, addObject } from '../src/model.js';
import { enterBattlefieldBatch, resolveTop, stabilize } from '../src/effects.js';
import { advanceStep } from '../src/turn.js';
import { validateEventSpec } from '../src/events.js';
import { fixture, put, act, resolve, lands } from './helpers.js';

function enter(s, name, player = 0) {
  const o = put(s, name, player, 'hand');
  assert.equal(enterBattlefieldBatch(s, [{ object: o, controller: player }]), true);
  return o;
}
function settle(s) {
  resolveTop(s);
  stabilize(s);
}

test('Saga enters with lore, chapters use real stack, main1 adds lore only for active controller', () => {
  const s = fixture(),
    o = enter(s, 'Summon: Choco/Mog');
  assert.equal(o.loreCounters, 1);
  assert.equal(s.pendingTriggers[0].sagaChapter, 1);
  stabilize(s);
  assert.match(s.stack[0].label, /Chapter 1/);
  assert.equal(o.zone, 'battlefield');
  settle(s);
  s.step = 'draw';
  advanceStep(s);
  assert.equal(o.loreCounters, 2);
  assert.equal(s.pendingTriggers[0].sagaChapter, 2);
  stabilize(s);
  settle(s);
  s.active = 1;
  s.step = 'draw';
  advanceStep(s);
  assert.equal(o.loreCounters, 2);
  s.active = 0;
  s.step = 'main1';
  advanceStep(s);
  assert.equal(o.loreCounters, 2);
});

test('combined chapters crossed all trigger; final waits for every pending chapter, then emits sacrifice', () => {
  const s = fixture(),
    o = enter(s, 'Summon: Choco/Mog');
  addLoreCounters(s, o, 3);
  assert.deepEqual(
    s.pendingTriggers.map((e) => e.sagaChapter),
    [1, 2, 3, 4],
  );
  stabilize(s);
  assert.equal(s.choice.kind, 'orderTriggers');
  assert.equal(o.zone, 'battlefield');
  let next = act(s, 'orderTriggers', { ids: s.choice.entries.map((e) => e.id) });
  for (let i = 0; i < 3; i++) {
    settle(next);
    assert.equal(next.objects[o.id].zone, 'battlefield');
  }
  settle(next);
  assert.equal(next.objects[o.id].zone, 'graveyard');
  assert.ok(next.events.some((e) => e.type === 'sacrificed' && e.objectId === o.id));
});

test('final chapter lost from stack sacrifices; removed lore prevents sacrifice; old incarnation cannot hold new Saga alive', () => {
  const s = fixture(),
    o = enter(s, 'Summon: Choco/Mog');
  s.pendingTriggers = [];
  o.loreCounters = 3;
  addLoreCounters(s, o);
  stabilize(s);
  const old = s.stack[0];
  s.stack = [];
  o.loreCounters = 2;
  stabilize(s);
  assert.equal(o.zone, 'battlefield');
  o.loreCounters = 4;
  stabilize(s);
  assert.equal(o.zone, 'graveyard');
  enterBattlefieldBatch(s, [{ object: o }]);
  s.pendingTriggers = [];
  o.loreCounters = 4;
  s.stack = [old];
  stabilize(s);
  assert.equal(o.zone, 'graveyard');
  assert.notEqual(o.incarnation, old.source.incarnation);
});

test('targetless final trigger is removed before Saga sacrifice; chapterless Saga survives', () => {
  const s = fixture(),
    o = enter(s, 'Welcome to Sweettooth');
  s.pendingTriggers = [];
  o.loreCounters = 2;
  addLoreCounters(s, o);
  stabilize(s);
  assert.equal(o.zone, 'graveyard');
  const d = {
    name: 'Chapterless',
    type: 'enchantment',
    types: ['enchantment'],
    cost: {},
    color: [],
    keywords: [],
    subtypes: ['Saga'],
    text: '',
  };
  const blank = addObject(s, d.name, 0, 'hand', d);
  enterBattlefieldBatch(s, [{ object: blank }]);
  assert.equal(blank.loreCounters, 1);
  blank.loreCounters = 99;
  stabilize(s);
  assert.equal(blank.zone, 'battlefield');
  s.step = 'draw';
  advanceStep(s);
  assert.equal(blank.loreCounters, 99);
});

test('Anima final sacrifice waits for opponent sacrifice choice and emits genuine sacrifice events', () => {
  const s = fixture(),
    o = enter(s, 'Summon: Anima'),
    victim = put(s, 'Llanowar Elves', 1);
  s.pendingTriggers = [];
  o.loreCounters = 3;
  addLoreCounters(s, o);
  stabilize(s);
  resolveTop(s);
  assert.equal(s.choice.kind, 'sacrifice');
  assert.equal(o.zone, 'battlefield');
  const command = chooseBotCommand(s, s.choice.player);
  assert.ok(command);
  const result = dispatch(s, command);
  assert.equal(result.ok, true, result.error?.message);
  assert.equal(result.state.objects[victim.id].zone, 'graveyard');
  assert.equal(result.state.objects[o.id].zone, 'graveyard');
  assert.equal(result.state.players[1].life, 17);
  assert.equal(result.state.events.filter((e) => e.type === 'sacrificed').length, 2);
});

test('simultaneous Saga entry APNAP ordering and controller assignment', () => {
  const s = fixture(),
    a = put(s, 'Summon: Choco/Mog', 0, 'hand'),
    b = put(s, 'Summon: Choco/Mog', 0, 'hand');
  enterBattlefieldBatch(s, [
    { object: a, controller: 1 },
    { object: b, controller: 0 },
  ]);
  stabilize(s);
  assert.deepEqual(
    s.stack.map((e) => e.controller),
    [0, 1],
  );
  assert.equal(a.loreCounters, 1);
  assert.equal(b.loreCounters, 1);
});

test('complete Saga card effects: real tokens, source exclusion, numeric Food counters and typed creature stats', () => {
  let s = fixture();
  const w = enter(s, 'Welcome to Sweettooth');
  stabilize(s);
  settle(s);
  const human = Object.values(s.objects).find((o) => o.name === 'White Human Token');
  assert.ok(human);
  addLoreCounters(s, w);
  stabilize(s);
  settle(s);
  assert.ok(Object.values(s.objects).some((o) => o.name === 'Food Token'));
  addLoreCounters(s, w);
  stabilize(s);
  s = act(s, 'chooseTriggerTarget', { target: ref(human) });
  settle(s);
  assert.equal(s.objects[human.id].plusCounters, 2);
  assert.equal(s.objects[w.id].zone, 'graveyard');
  assert.equal(CARDS['Summon: Shiva'].types.includes('enchantment'), true);
  assert.equal(CARDS['Summon: Shiva'].types.includes('creature'), true);
});

test('chapter predicate rejects unbounded/non-source/foreign chapter fields', () => {
  for (const event of [
    { event: 'chapter', object: 'source', chapters: [0] },
    { event: 'chapter', object: 'source', chapters: [1, 1] },
    { event: 'chapter', chapters: [1] },
    { event: 'enter', object: 'source', chapters: [1] },
  ])
    assert.ok(validateEventSpec(event).length);
  assert.deepEqual(validateEventSpec({ event: 'chapter', object: 'source', chapters: [1, 3] }), []);
});

test('Saga gameplay and generic bot choices replay deterministically', () => {
  const deck = [...Array(8).fill('Plains'), ...Array(4).fill('Three Blind Mice')];
  let s = createGame({ decks: [deck, deck], mulligan: false, seed: 77, minimumDeckSize: 12 });
  for (let i = 0; i < 160 && s.status === 'playing'; i++) {
    const command = chooseBotCommand(s, s.choice?.player ?? s.priority);
    assert.ok(command);
    const result = dispatch(s, command);
    assert.equal(result.ok, true, result.error?.message);
    s = result.state;
  }
  assert.ok(s.events.some((e) => e.type === 'loreCounters'));
  assert.deepEqual(replay(exportReplay(s)), s);
});

test('Avengers chapters create menace Villains, spare Villains, damage opponent and count Treasures', () => {
  const s = fixture(),
    saga = enter(s, 'Avengers: Under Siege');
  stabilize(s);
  settle(s);
  const villains = Object.values(s.objects).filter((o) => o.name === 'Villain Token');
  assert.equal(villains.length, 2);
  const other = put(s, 'Llanowar Elves');
  addLoreCounters(s, saga);
  stabilize(s);
  settle(s);
  assert.equal(other.zone, 'graveyard');
  assert.ok(villains.every((o) => o.zone === 'battlefield' && o.damage === 0));
  assert.equal(s.players[1].life, 18);
  addLoreCounters(s, saga);
  stabilize(s);
  settle(s);
  assert.equal(Object.values(s.objects).filter((o) => o.name === 'Treasure Token').length, 2);
  assert.equal(saga.zone, 'graveyard');
});

test('Leaves group counters apply to two targets and graveyard Lesson satisfies final draw', () => {
  let s = fixture(),
    saga = enter(s, 'Leaves from the Vine');
  s.pendingTriggers = [];
  saga.loreCounters = 1;
  const a = put(s, 'Llanowar Elves'),
    b = put(s, 'Llanowar Elves');
  addLoreCounters(s, saga);
  stabilize(s);
  s = act(s, 'chooseTriggerTargets', { targets: { creatures: [ref(a), ref(b)] } });
  settle(s);
  assert.equal(s.objects[a.id].plusCounters, 1);
  assert.equal(s.objects[b.id].plusCounters, 1);
  const lesson = Object.values(CARDS).find((d) => d.subtypes.includes('Lesson'));
  assert.ok(lesson);
  put(s, lesson.name, 0, 'graveyard');
  const before = s.players[0].hand.length;
  addLoreCounters(s, s.objects[saga.id]);
  stabilize(s);
  settle(s);
  assert.equal(s.players[0].hand.length, before + 1);
});

test('Choco/Mog excludes source from pump, Fat Chocobo creates landfall Bird with real trigger', () => {
  const s = fixture(),
    saga = enter(s, 'Summon: Choco/Mog'),
    other = put(s, 'Llanowar Elves');
  stabilize(s);
  settle(s);
  assert.equal(
    s.modifiers.some((m) => m.target?.id === saga.id),
    false,
  );
  const fat = enter(s, 'Summon: Fat Chocobo');
  stabilize(s);
  settle(s);
  const bird = Object.values(s.objects).find((o) => o.name === 'Wark Bird Token');
  assert.ok(bird);
  const land = put(s, 'Forest', 0, 'hand');
  enterBattlefieldBatch(s, [{ object: land }]);
  stabilize(s);
  assert.equal(s.stack[0].name, 'Wark Bird Token');
});

test('Galactus optional first target may be zero; final creates exact flying trampling legendary token', () => {
  let s = fixture(),
    saga = enter(s, 'The Coming of Galactus');
  stabilize(s);
  s = act(s, 'chooseTriggerTargets', { targets: { permanent: [] } });
  settle(s);
  s.objects[saga.id].loreCounters = 3;
  addLoreCounters(s, s.objects[saga.id]);
  stabilize(s);
  settle(s);
  const galactus = Object.values(s.objects).find((o) => o.name === 'Galactus Token');
  assert.ok(galactus);
  assert.equal(CARDS[galactus.name].power, 16);
  assert.equal(CARDS[galactus.name].legendary, true);
  assert.deepEqual(CARDS[galactus.name].keywords, ['flying', 'trample']);
  assert.equal(s.objects[saga.id].zone, 'graveyard');
});

test('Saga sacrifice survives legend choices and shares their state-based departure batch', () => {
  let s = fixture(),
    saga = enter(s, 'Summon: Choco/Mog');
  s.pendingTriggers = [];
  saga.loreCounters = 4;
  const first = put(s, 'Galactus Token'),
    second = put(s, 'Galactus Token');
  stabilize(s);
  assert.equal(s.choice.kind, 'legendRule');
  assert.deepEqual(s.choice.sagaSacrifices, [saga.id]);
  s = act(s, 'chooseLegend', { card: first.id });
  assert.equal(s.objects[saga.id].zone, 'graveyard');
  assert.equal(s.objects[first.id].zone, 'battlefield');
  assert.equal(s.objects[second.id], undefined);
  assert.equal(s.events.filter((e) => e.type === 'sacrificed' && e.objectId === saga.id).length, 1);
});
