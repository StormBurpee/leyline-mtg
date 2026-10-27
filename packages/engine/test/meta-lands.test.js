import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  dispatch,
  legalActions,
  exportReplay,
  replay,
  createGame,
} from '../src/index.js';
import { planPayment, pay, tapForMana, manaOptions } from '../src/mana.js';
import {
  enterBattlefieldBatch,
  finishEntryLifeChoice,
  finishCreatureTypeChoice,
  resolveTop,
  stabilize,
} from '../src/effects.js';
import { move, ref } from '../src/model.js';
import { fixture, put, act } from './helpers.js';
import { chooseBotCommand } from '../src/bot.js';
const shockNames = [
  'Blood Crypt',
  'Breeding Pool',
  'Godless Shrine',
  'Hallowed Fountain',
  'Overgrown Tomb',
  'Sacred Foundry',
  'Steam Vents',
  'Stomping Ground',
  'Temple Garden',
  'Watery Grave',
];
test('all ten complete shocks and Starting Town are supported', () => {
  for (const name of shockNames) assert.equal(CARDS[name].entryLifePayment, 2);
  assert.deepEqual(CARDS['Starting Town'].manaLifeCosts, { W: 1, U: 1, B: 1, R: 1, G: 1 });
});
test('shock entry is an explicit choice before entry and life payment enters untapped', () => {
  let s = fixture();
  const land = put(s, 'Blood Crypt', 0, 'hand');
  s = act(s, 'playLand', { card: land.id });
  assert.equal(s.objects[land.id].zone, 'hand');
  assert.equal(s.choice.kind, 'entryLife');
  assert.equal(s.players[0].landsPlayed, 1);
  assert.equal(legalActions(s, 0).filter((a) => a.type === 'payEntryLife').length, 2);
  s = act(s, 'payEntryLife', { pay: true });
  assert.equal(s.players[0].life, 18);
  assert.equal(s.objects[land.id].tapped, false);
  assert.equal(s.objects[land.id].zone, 'battlefield');
  assert.equal(s.choice, null);
});
test('declining, insufficient life, exact life, and forced tapped entry', () => {
  for (const [life, payLife, forced, tapped, remaining] of [
    [20, false, false, true, 20],
    [2, true, false, false, 0],
    [20, true, true, true, 18],
  ]) {
    const s = fixture(),
      land = put(s, 'Steam Vents', 0, 'exile');
    s.players[0].life = life;
    enterBattlefieldBatch(s, [{ object: land, tapped: forced }]);
    assert.equal(s.choice.forcedTapped, forced);
    finishEntryLifeChoice(s, { type: 'payEntryLife', pay: payLife });
    assert.equal(land.tapped, tapped);
    assert.equal(s.players[0].life, remaining);
  }
  let s = fixture();
  s.players[0].life = 1;
  const land = put(s, 'Blood Crypt', 0, 'hand');
  s = act(s, 'playLand', { card: land.id });
  assert.equal(s.choice.payable, false);
  const failed = dispatch(s, { type: 'payEntryLife', player: 0, pay: true });
  assert.equal(failed.ok, false);
  assert.equal(s.players[0].life, 1);
  s = act(s, 'payEntryLife', { pay: false });
  assert.equal(s.objects[land.id].tapped, true);
});
test('simultaneous shocks reserve each life payment and enter only after all choices', () => {
  const s = fixture(),
    a = put(s, 'Blood Crypt', 0, 'exile'),
    b = put(s, 'Steam Vents', 0, 'exile');
  s.players[0].life = 3;
  enterBattlefieldBatch(s, [{ object: a }, { object: b }]);
  finishEntryLifeChoice(s, { type: 'payEntryLife', pay: true });
  assert.equal(a.zone, 'exile');
  assert.equal(s.players[0].life, 1);
  assert.equal(s.choice.payable, false);
  finishEntryLifeChoice(s, { type: 'payEntryLife', pay: false });
  assert.equal(a.tapped, false);
  assert.equal(b.tapped, true);
  assert.equal(a.zone, 'battlefield');
});
test('life choice survives an intervening Cavern creature-type choice without double payment', () => {
  const s = fixture(),
    a = put(s, 'Blood Crypt', 0, 'exile'),
    c = put(s, 'Cavern of Souls', 0, 'exile');
  enterBattlefieldBatch(s, [{ object: a }, { object: c }]);
  finishEntryLifeChoice(s, { type: 'payEntryLife', pay: true });
  assert.equal(s.choice.kind, 'creatureType');
  finishCreatureTypeChoice(s, { type: 'chooseCreatureType', creatureType: 'Lizard' });
  assert.equal(s.choice, null);
  assert.equal(s.players[0].life, 18);
  assert.equal(a.tapped, false);
  assert.equal(c.chosenCreatureType, 'Lizard');
});
test('Starting Town checks own first three turns, never an opponent turn', () => {
  for (const [active, controller, turn, tapped] of [
    [0, 0, 1, false],
    [0, 0, 5, false],
    [0, 0, 7, true],
    [1, 1, 6, false],
    [1, 1, 8, true],
    [1, 0, 2, true],
  ]) {
    const s = fixture();
    s.active = active;
    s.turn = turn;
    const land = put(s, 'Starting Town', controller, 'hand');
    enterBattlefieldBatch(s, [{ object: land, controller }]);
    assert.equal(land.tapped, tapped, `${active}/${controller}/${turn}`);
  }
});
test('Town colorless is free, colored mana costs life, and options respect life', () => {
  const s = fixture(),
    a = put(s, 'Starting Town');
  tapForMana(s, a.id, 0, 'C');
  assert.equal(s.players[0].life, 20);
  a.tapped = false;
  tapForMana(s, a.id, 0, 'R');
  assert.equal(s.players[0].life, 19);
  assert.equal(s.players[0].mana.R, 1);
  a.tapped = false;
  s.players[0].life = 0;
  assert.deepEqual(manaOptions(s, a), ['C']);
  assert.throws(() => tapForMana(s, a.id, 0, 'W'), /Choose a color/);
});
test('automatic matching uses the least life including generic and hybrid costs', () => {
  const s = fixture(),
    town = put(s, 'Starting Town'),
    forest = put(s, 'Forest');
  for (const cost of [
    { G: 1, generic: 1 },
    { 'G/W': 1, generic: 1 },
    { C: 1, G: 1 },
  ]) {
    const plan = planPayment(s, 0, cost);
    assert.equal(plan.life, 0);
    assert.deepEqual(new Set(plan.activations.map((a) => a.color)), new Set(['C', 'G']));
  }
  const plan = planPayment(s, 0, { W: 1, generic: 1 });
  assert.equal(plan.life, 1);
  pay(s, 0, { W: 1, generic: 1 });
  assert.equal(s.players[0].life, 19);
  assert.equal(town.tapped, true);
  assert.equal(forest.tapped, true);
});
test('payment cannot collectively overspend life and can use exact available life', () => {
  const s = fixture();
  put(s, 'Starting Town');
  put(s, 'Starting Town');
  s.players[0].life = 1;
  assert.equal(planPayment(s, 0, { W: 2 }), null);
  assert.equal(planPayment(s, 0, { W: 1, generic: 1 }).life, 1);
  pay(s, 0, { W: 1, generic: 1 });
  assert.equal(s.players[0].life, 0);
});
test('convoke can avoid a life payment and a source cannot be spent twice', () => {
  const s = fixture();
  const town = put(s, 'Starting Town');
  put(s, 'Llanowar Elves');
  const plan = planPayment(s, 0, { G: 1, C: 1 }, { convoke: true });
  assert.equal(plan.life, 0);
  assert.equal(plan.activations.length + plan.convoked.length, 2);
  assert.equal(planPayment(s, 0, { W: 2 }, { excludeSources: [town.id] }), null);
});
test('linked exile return offers shock entry choice then continues normally', () => {
  const s = fixture(),
    source = put(s, 'Banishing Light'),
    land = put(s, 'Blood Crypt', 1, 'exile');
  s.linkedExiles = [{ source: ref(source), cards: [ref(land)] }];
  move(s, source, 'graveyard');
  stabilize(s);
  assert.equal(s.choice.kind, 'entryLife');
  assert.equal(s.choice.player, 1);
  finishEntryLifeChoice(s, { type: 'payEntryLife', pay: true });
  assert.equal(land.zone, 'battlefield');
  assert.equal(land.controller, 1);
  assert.equal(land.tapped, false);
  assert.equal(s.players[1].life, 18);
});
test('shock choices replay and bot produces an accepted explicit command', () => {
  let s = createGame({
    mulligan: false,
    decks: [
      [...shockNames.flatMap((n) => Array(4).fill(n)), ...Array(20).fill('Mountain')],
      Array(60).fill('Mountain'),
    ],
  });
  while (s.step !== 'main1') s = act(s, 'pass');
  const shock = s.players[0].hand.find((id) => CARDS[s.objects[id].name].entryLifePayment);
  assert.ok(shock);
  s = act(s, 'playLand', { card: shock });
  const command = chooseBotCommand(s, 0);
  assert.equal(command.type, 'payEntryLife');
  s = act(s, command.type, { pay: command.pay });
  assert.deepEqual(replay(exportReplay(s)), s);
});
test('invalid native entry and mana-life values reject instead of approximating', () => {
  for (const extra of [
    { entryLifePayment: -2 },
    { manaLifeCosts: { W: 0 } },
    { manaLifeCosts: { Q: 1 } },
  ])
    assert.throws(() =>
      createRegistry({ ...CARDS, Broken: { ...CARDS['Starting Town'], name: 'Broken', ...extra } }),
    );
});

test('mana life and other activation life costs share one affordability budget', async () => {
  const { costProblem, payCost } = await import('../src/costs.js');
  const s = fixture();
  put(s, 'Starting Town');
  s.players[0].life = 1;
  assert.match(costProblem(s, 0, { mana: { W: 1 }, life: 1 }), /life/);
  assert.throws(() => payCost(s, 0, { mana: { W: 1 }, life: 1 }), /life/);
  assert.equal(s.players[0].life, 1);
  s.players[0].life = 2;
  assert.equal(costProblem(s, 0, { mana: { W: 1 }, life: 1 }), null);
  payCost(s, 0, { mana: { W: 1 }, life: 1 });
  assert.equal(s.players[0].life, 0);
});
test('bot safety rejects a cast whose mana payment would be lethal', async () => {
  const { actionSafe } = await import('../src/decision-safety.js');
  const s = fixture();
  put(s, 'Starting Town');
  const spell = put(s, 'Opt', 0, 'hand');
  s.players[0].life = 1;
  assert.equal(actionSafe(s, 0, { type: 'cast', card: spell.id }), false);
  s.players[0].life = 2;
  assert.equal(actionSafe(s, 0, { type: 'cast', card: spell.id }), true);
});
