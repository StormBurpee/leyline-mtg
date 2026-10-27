import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  dispatch,
  legalActions,
  abilityProblem,
  activationCost,
  MAX_X,
  ref,
  stats,
  playerView,
  chooseBotCommand,
  canBlock,
} from '../src/index.js';
import { move } from '../src/model.js';
import { resolveEffects } from '../src/effects.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
const x = { kind: 'x' };
function position(ability = {}, extra = {}) {
  const s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'X Adept': {
      name: 'X Adept',
      type: 'creature',
      cost: { U: 1 },
      power: 1,
      toughness: 4,
      activated: [
        { cost: { mana: { X: 1, U: 1 } }, effects: [{ op: 'draw', count: x }], ...ability },
      ],
      ...extra,
    },
  });
  return { s, o: put(s, 'X Adept') };
}
function reject(s, o, extra) {
  const before = structuredClone(s);
  const r = dispatch(s, { type: 'activate', player: 0, card: o.id, ability: 0, ...extra });
  assert.equal(r.ok, false, JSON.stringify(extra));
  assert.deepEqual(s, before);
}
test('activated X must be explicit, integral, bounded and belongs to the chosen ability', () => {
  const { s, o } = position();
  lands(s, 'Island', 5);
  for (const value of [undefined, null, -1, 0.1, '2', NaN, Infinity, MAX_X + 1])
    reject(s, o, { x: value });
  assert.equal(abilityProblem(s, 0, o.id, 0, undefined, undefined, undefined, undefined, 0), null);
  assert.deepEqual(
    legalActions(s, 0)
      .filter((a) => a.type === 'activate')
      .map((a) => a.x),
    [0, 1, 2, 3, 4],
  );
  const other = position({ cost: {}, effects: [{ op: 'draw', count: 1 }] });
  reject(other.s, other.o, { x: 0 });
});
test('repeated activated X and actual payment are locked; manual mana never silently auto-taps', () => {
  let { s, o } = position({ cost: { mana: { X: 2, U: 1 } } });
  lands(s, 'Island', 7);
  reject(s, o, { x: 3, autoTap: false });
  s = act(s, 'activate', { card: o.id, ability: 0, x: 3 });
  assert.equal(s.stack.at(-1).x, 3);
  assert.deepEqual(s.stack.at(-1).activationCost, { mana: { U: 1, generic: 6 } });
  assert.deepEqual(playerView(s, 1).stack.at(-1).activationCost, s.stack.at(-1).activationCost);
  assert.equal(Object.values(s.objects).filter((o) => o.name === 'Island' && o.tapped).length, 7);
  const hand = s.players[0].hand.length;
  move(s, s.objects[o.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.players[0].hand.length, hand + 3);
});
test('power-up substitutes X before generic and colored reduction and never changes announced X', () => {
  let { s, o } = position(
    {
      powerUp: true,
      cost: { mana: { X: 2, U: 2 } },
      effects: [{ op: 'counterOn', subject: 'source', amount: x }],
    },
    { cost: { generic: 2, U: 1 } },
  );
  o.enteredTurn = s.turn;
  lands(s, 'Island', 5);
  assert.deepEqual(activationCost(s, o, s.catalog[o.name].activated[0], 3).mana, {
    U: 1,
    generic: 4,
  });
  s = act(s, 'activate', { card: o.id, ability: 0, x: 3 });
  assert.equal(s.stack.at(-1).x, 3);
  s = resolve(s);
  assert.equal(stats(s, s.objects[o.id]).power, 4);
  reject(s, s.objects[o.id], { x: 0 });
});
test('source tap and selected sacrifice mana reservations use substituted X costs', () => {
  let { s, o } = position(
    { cost: { mana: { X: 1 }, tap: true, sacrifice: { count: 1, where: { type: 'artifact' } } } },
    { mana: ['U'] },
  );
  const treasure = put(s, 'Treasure Token'),
    island = put(s, 'Island');
  assert.deepEqual(
    legalActions(s, 0)
      .filter((a) => a.type === 'activate' && a.card === o.id)
      .map((a) => a.x),
    [0, 1],
  );
  reject(s, o, { x: 2, sacrifices: [ref(treasure)] });
  s = act(s, 'activate', { card: o.id, ability: 0, x: 1, sacrifices: [ref(treasure)] });
  assert.equal(s.objects[o.id].tapped, true);
  assert.equal(s.objects[island.id].tapped, true);
  assert.notEqual(s.objects[treasure.id]?.zone, 'battlefield');
  const stale = structuredClone(s.stack.at(-1).source);
  move(s, s.objects[o.id], 'hand');
  move(s, s.objects[o.id], 'battlefield');
  assert.notEqual(stale.incarnation, s.objects[o.id].incarnation);
  const hand = s.players[0].hand.length;
  s = resolve(s);
  assert.equal(s.players[0].hand.length, hand + 1);
});
test('X targets are chosen before sacrifice; illegal incarnations fizzle without refunding X payment', () => {
  let { s, o } = position({
    cost: {
      mana: { X: 1 },
      sacrifice: { count: 1, where: { type: 'creature' }, excludeSource: true },
    },
    target: 'creature',
    effects: [{ op: 'damage', amount: x }],
  });
  const victim = put(s, 'Grizzly Bears');
  lands(s, 'Island', 3);
  const stale = ref(victim);
  s = act(s, 'activate', { card: o.id, ability: 0, x: 3, target: stale, sacrifices: [stale] });
  assert.equal(s.stack.at(-1).x, 3);
  move(s, s.objects[victim.id], 'battlefield');
  s = resolve(s);
  assert.equal(s.objects[victim.id].damage, 0);
  assert.equal(s.objects[victim.id].zone, 'battlefield');
});
test('zero, source reincarnation and copying a permanent retain correct X context', () => {
  let { s, o } = position({
    cost: { mana: { X: 1 } },
    effects: [
      { op: 'counterOn', subject: 'source', amount: x },
      { op: 'gainLife', amount: x },
    ],
  });
  s = act(s, 'activate', { card: o.id, ability: 0, x: 0 });
  s = resolve(s);
  assert.equal(stats(s, s.objects[o.id]).power, 1);
  assert.equal(s.players[0].life, 20);
  lands(s, 'Island', 3);
  s = act(s, 'activate', { card: o.id, ability: 0, x: 3 });
  move(s, s.objects[o.id], 'hand');
  move(s, s.objects[o.id], 'battlefield');
  s = resolve(s);
  assert.equal(stats(s, s.objects[o.id]).power, 1);
  assert.equal(s.players[0].life, 23);
  resolveEffects(s, {
    controller: 0,
    source: ref(s.objects[o.id]),
    target: ref(s.objects[o.id]),
    effects: [{ op: 'copyToken', count: 1 }],
  });
  const copy = Object.values(s.objects).find(
    (v) => v.token && v.zone === 'battlefield' && v.name === o.name,
  );
  assert.ok(copy);
  s.players[0].mana.U = 2;
  s = act(s, 'activate', { card: copy.id, ability: 0, x: 2 });
  s = resolve(s);
  assert.equal(stats(s, s.objects[copy.id]).power, 3);
});
test('bounded proposals include actual maximum for repeated X and accept exact large manual X', () => {
  const { s, o } = position({ cost: { mana: { X: 2, U: 1 } } });
  s.players[0].mana.U = 2001;
  const actions = legalActions(s, 0).filter((a) => a.type === 'activate');
  assert.ok(actions.length <= 12);
  assert.ok(actions.some((a) => a.x === 1000));
  assert.ok(!actions.some((a) => a.x === 777));
  assert.equal(legalActions(s, 0, { x: 777 }).filter((a) => a.type === 'activate')[0].x, 777);
  assert.equal(
    dispatch(s, { type: 'activate', player: 0, card: o.id, ability: 0, x: 777 }).ok,
    true,
  );
});
test('bot prefers useful paid X over zero but refuses drawing past its remaining library', () => {
  let { s, o } = position({ exhaust: true });
  lands(s, 'Island', 5);
  const action = chooseBotCommand(s, 0);
  assert.equal(action.type, 'activate');
  assert.equal(action.card, o.id);
  assert.equal(action.x, 4);
  assert.equal(dispatch(s, action).ok, true);
  for (const id of s.players[0].library.slice(2)) move(s, s.objects[id], 'exile');
  const safe = chooseBotCommand(s, 0);
  assert.equal(safe.type, 'activate');
  assert.equal(safe.x, 2);
});
test('conditional unblockability uses current power at declaration and is not a recursive stat bonus', () => {
  const { s, o } = position(
    {},
    {
      conditionalCombatRestrictions: [
        { restriction: 'unblockable', condition: { kind: 'sourcePowerAtMost', count: 1 } },
      ],
    },
  );
  const blocker = put(s, 'Grizzly Bears', 1);
  assert.equal(canBlock(s, blocker, o, 1), false);
  o.plusCounters = 1;
  assert.equal(canBlock(s, blocker, o, 1), true);
  s.modifiers.push({
    objectId: o.id,
    incarnation: o.incarnation,
    power: -4,
    toughness: 0,
    expires: s.turn,
  });
  assert.equal(canBlock(s, blocker, o, 1), false);
  assert.throws(() =>
    createRegistry([
      {
        name: 'Recursive',
        type: 'creature',
        cost: {},
        power: 1,
        toughness: 1,
        conditionalBonuses: [
          {
            affects: 'self',
            condition: { kind: 'sourcePowerAtMost', count: 1 },
            power: 1,
            toughness: 1,
          },
        ],
      },
    ]),
  );
});

test('power-up excess colored and colorless reductions reduce X generic, never another color', () => {
  const { s, o } = position(
    {
      powerUp: true,
      cost: { mana: { X: 2, U: 1, R: 1 } },
      effects: [{ op: 'gainLife', amount: x }],
    },
    { cost: { U: 2, C: 2 } },
  );
  o.enteredTurn = s.turn;
  assert.deepEqual(activationCost(s, o, s.catalog[o.name].activated[0], 3).mana, {
    R: 1,
    generic: 3,
  });
  assert.deepEqual(activationCost(s, o, s.catalog[o.name].activated[0], 0).mana, { R: 1 });
});
test('different activations retain independent X through optional resolution continuation', () => {
  let { s, o } = position({
    cost: { mana: { X: 1 } },
    effects: [
      {
        op: 'chooseEffect',
        options: [
          { label: 'Gain life', effects: [{ op: 'gainLife', amount: x }] },
          { label: 'Counters', effects: [{ op: 'counterOn', subject: 'source', amount: x }] },
        ],
      },
    ],
  });
  s.players[0].mana.U = 5;
  s = act(s, 'activate', { card: o.id, ability: 0, x: 2 });
  s = act(s, 'activate', { card: o.id, ability: 0, x: 3 });
  assert.deepEqual(
    s.stack.map((e) => e.x),
    [2, 3],
  );
  s = resolve(s);
  assert.equal(s.choice.kind, 'effectChoice');
  assert.equal(s.resolving.entry.x, 3);
  s = act(s, 'chooseEffect', { option: 0 });
  assert.equal(s.players[0].life, 23);
  s = resolve(s);
  s = act(s, 'chooseEffect', { option: 1 });
  assert.equal(stats(s, s.objects[o.id]).power, 3);
});
test('bot includes pending activated X draw in its bounded safety check', () => {
  let { s, o } = position({ cost: { mana: { X: 1 } } });
  s.players[0].mana.U = 8;
  for (const id of s.players[0].library.slice(4)) move(s, s.objects[id], 'exile');
  s = act(s, 'activate', { card: o.id, ability: 0, x: 4 });
  assert.notEqual(chooseBotCommand(s, 0).type, 'activate');
});

test('activated-X registries reject costs whose supported range can overflow proposal arithmetic', () => {
  assert.throws(
    () => position({ cost: { mana: { X: 1, generic: Number.MAX_SAFE_INTEGER } } }),
    /safe integer budget/,
  );
  assert.throws(
    () => position({ cost: { mana: { X: 10, generic: Number.MAX_SAFE_INTEGER - 9999 } } }),
    /safe integer budget/,
  );
  const { s, o } = position({
    cost: { mana: { X: 10, generic: Number.MAX_SAFE_INTEGER - 10000 } },
  });
  assert.doesNotThrow(() => legalActions(s, 0));
  assert.deepEqual(
    legalActions(s, 0).filter((a) => a.type === 'activate' && a.card === o.id),
    [],
  );
});
