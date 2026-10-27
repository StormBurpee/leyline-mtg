import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  dispatch,
  legalActions,
  castingPayment,
  castingProfile,
  ref,
  stats,
  keywords,
  chooseBotCommand,
} from '../src/index.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
function custom(s, name, cost, extra = {}) {
  s.catalog = createRegistry({
    ...CARDS,
    [name]: {
      name,
      type: 'instant',
      color: [],
      keywords: [],
      cost,
      effects: [],
      sacrificeCost: { where: { type: 'creature' } },
      ...extra,
    },
  });
  return put(s, name, 0, 'hand');
}
test('mandatory cost paid at casting, uses real deaths, cannot regenerate payment on resolution', () => {
  let s = fixture();
  const spell = put(s, 'Corrupted Conviction', 0, 'hand'),
    victim = put(s, 'Grizzly Bears');
  lands(s, 'Swamp', 1);
  const before = s.players[0].hand.length;
  const a = legalActions(s, 0).find((a) => a.type === 'cast' && a.card === spell.id);
  assert.deepEqual(a.sacrifice, ref(victim));
  s = act(s, 'cast', a);
  assert.equal(s.objects[victim.id].zone, 'graveyard');
  assert.equal(s.players[0].hand.length, before - 1);
  assert.equal(s.stack.at(-1).sacrifice.id, victim.id);
  assert.ok(s.events.some((e) => e.type === 'sacrificed' && e.objectId === victim.id));
  s = resolve(s);
  assert.equal(s.players[0].hand.length, before + 1);
});
test('missing, stale, malformed, wrong-controller and wrong-type costs fail atomically', () => {
  const s = fixture(),
    spell = put(s, 'Corrupted Conviction', 0, 'hand');
  const victim = put(s, 'Grizzly Bears'),
    enemy = put(s, 'Grizzly Bears', 1),
    land = lands(s, 'Swamp', 1)[0];
  for (const sacrifice of [
    undefined,
    null,
    ref(enemy),
    ref(land),
    { ...ref(victim), incarnation: 999 },
    { ...ref(victim), optional: true },
  ]) {
    const before = structuredClone(s),
      r = dispatch(s, { type: 'cast', player: 0, card: spell.id, sacrifice });
    assert.equal(r.ok, false);
    assert.deepEqual(s, before);
  }
  assert.equal(
    dispatch(s, {
      type: 'cast',
      player: 0,
      card: spell.id,
      sacrifice: ref(victim),
      target: ref(enemy),
    }).ok,
    false,
  );
});
test('targets are chosen before costs: a creature sacrificed to target itself leaves an illegal resolution target', () => {
  let s = fixture();
  const spell = put(s, 'Final Vengeance', 0, 'hand'),
    victim = put(s, 'Grizzly Bears');
  lands(s, 'Swamp', 1);
  s = act(s, 'cast', { card: spell.id, target: ref(victim), sacrifice: ref(victim) });
  s = resolve(s);
  assert.equal(s.objects[victim.id].zone, 'graveyard');
});
test('mana taps and convoke may precede sacrifice; mana sacrifice cannot pay twice', () => {
  let s = fixture();
  const spell = custom(s, 'Tap then sacrifice', { G: 1 }),
    elf = put(s, 'Llanowar Elves');
  s = act(s, 'cast', { card: spell.id, sacrifice: ref(elf) });
  assert.equal(s.objects[elf.id].zone, 'graveyard');
  s = fixture();
  const conv = custom(s, 'Convoke then sacrifice', { generic: 1 }, { keywords: ['convoke'] }),
    bear = put(s, 'Grizzly Bears', 0, 'battlefield', { ready: false });
  s = act(s, 'cast', {
    card: conv.id,
    sacrifice: ref(bear),
    convoke: [{ card: bear.id, symbol: 'generic' }],
  });
  assert.equal(s.objects[bear.id].zone, 'graveyard');
  s = fixture();
  const art = custom(
      s,
      'Artifact payment',
      { B: 1 },
      { sacrificeCost: { where: { type: 'artifact' } } },
    ),
    treasure = put(s, 'Treasure Token');
  assert.equal(castingPayment(s, 0, castingProfile(s, 0, art), { sacrifice: ref(treasure) }), null);
  const before = structuredClone(s);
  assert.equal(
    dispatch(s, { type: 'cast', player: 0, card: art.id, sacrifice: ref(treasure) }).ok,
    false,
  );
  assert.deepEqual(s, before);
  lands(s, 'Swamp', 1);
  s = act(s, 'cast', { card: art.id, sacrifice: ref(treasure) });
  assert.equal(s.objects[treasure.id], undefined);
});
test('total adjusted cost is locked before the reducer is sacrificed', () => {
  let s = fixture();
  const spell = custom(s, 'Locked sacrifice', { generic: 3, B: 1 });
  s.catalog = createRegistry({
    ...s.catalog,
    Reducer: {
      name: 'Reducer',
      type: 'creature',
      cost: {},
      color: [],
      keywords: [],
      power: 1,
      toughness: 1,
      costModifiers: [{ scope: 'you', change: 'reduce', amount: 2 }],
    },
  });
  const victim = put(s, 'Reducer');
  lands(s, 'Swamp', 2);
  s = act(s, 'cast', { card: spell.id, sacrifice: ref(victim) });
  assert.deepEqual(s.stack.at(-1).castingCost, { generic: 1, B: 1 });
});
test('Duty grants protection and counters only to surviving creatures; Vile requires both ordered opponent sacrifices', () => {
  let s = fixture();
  s.players[0].mana.W = 10;
  const spell = put(s, 'Duty Beyond Death', 0, 'hand'),
    victim = put(s, 'Grizzly Bears'),
    survivor = put(s, 'Grizzly Bears');
  s = act(s, 'cast', { card: spell.id, sacrifice: ref(victim) });
  s = resolve(s);
  assert.equal(stats(s, s.objects[survivor.id]).power, 3);
  assert.ok(keywords(s, s.objects[survivor.id]).includes('indestructible'));
  s = fixture();
  s.players[0].mana.B = 10;
  const vile = put(s, 'Vile Mutilator', 0, 'hand'),
    sacrifice = put(s, 'Grizzly Bears'),
    enemy = put(s, 'Grizzly Bears', 1),
    enchantment = put(s, 'Glorious Anthem', 1);
  s = act(s, 'cast', { card: vile.id, sacrifice: ref(sacrifice) });
  s = resolve(s);
  s = resolve(s);
  assert.equal(s.choice.kind, 'sacrifice');
  assert.deepEqual(s.choice.cards, [enchantment.id]);
  s = act(s, 'sacrifice', { cards: [enchantment.id] });
  assert.deepEqual(s.choice.cards, [enemy.id]);
  s = act(s, 'sacrifice', { cards: [enemy.id] });
  assert.equal(s.objects[enemy.id].zone, 'graveyard');
});
test('unsupported cost variants fail closed at native definition validation', () => {
  for (const sacrificeCost of [
    { where: { type: 'creature' }, optional: true },
    { where: { power: { gte: 3 } } },
    { where: { type: 'creature' }, count: 2 },
  ])
    assert.throws(() =>
      createRegistry({
        Bad: {
          name: 'Bad',
          type: 'instant',
          cost: {},
          color: [],
          keywords: [],
          effects: [],
          sacrificeCost,
        },
      }),
    );
});
test('death-trigger snapshots retain the sacrificed source incarnation, controller and definition', () => {
  let s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    Offering: {
      name: 'Offering',
      type: 'creature',
      cost: {},
      power: 2,
      toughness: 2,
      triggers: [{ event: 'selfDies', effects: [{ op: 'gainLife', amount: 3 }] }],
    },
  });
  const spell = put(s, 'Corrupted Conviction', 0, 'hand'),
    victim = put(s, 'Offering', 1);
  victim.controller = 0;
  const old = ref(victim);
  lands(s, 'Swamp', 1);
  s = act(s, 'cast', { card: spell.id, sacrifice: old });
  assert.equal(s.objects[victim.id].controller, 1);
  const trigger = s.stack.at(-1);
  assert.equal(trigger.kind, 'ability');
  assert.equal(trigger.controller, 0);
  assert.deepEqual(trigger.source, old);
  assert.equal(trigger.sourceDefinition.name, 'Offering');
  s = resolve(s);
  assert.equal(s.players[0].life, 23);
  assert.equal(s.stack.at(-1).name, 'Corrupted Conviction');
});
test('flashback and plotted free casting still require the mandatory sacrifice', () => {
  let s = fixture();
  const flash = custom(s, 'Flash sacrifice', { B: 1 }, { flashback: { generic: 1 } });
  s.players[0].hand = s.players[0].hand.filter((id) => id !== flash.id);
  flash.zone = 'graveyard';
  s.players[0].graveyard.push(flash.id);
  const victim = put(s, 'Grizzly Bears');
  lands(s, 'Swamp', 1);
  s = act(s, 'cast', { card: flash.id, sacrifice: ref(victim) });
  s = resolve(s);
  assert.equal(s.objects[flash.id].zone, 'exile');
  s = fixture();
  const plotted = custom(s, 'Plotted sacrifice', { B: 1 }, { plot: { generic: 1 } });
  s.players[0].hand = s.players[0].hand.filter((id) => id !== plotted.id);
  plotted.zone = 'exile';
  plotted.plotted = { incarnation: plotted.incarnation, turn: s.turn - 1 };
  s.players[0].exile.push(plotted.id);
  assert.equal(
    legalActions(s, 0).some((a) => a.type === 'cast'),
    false,
  );
  const bear = put(s, 'Grizzly Bears');
  s = act(s, 'cast', { card: plotted.id, sacrifice: ref(bear), autoTap: false });
  assert.deepEqual(s.stack.at(-1).castingCost, {});
});
test('Arbiter preserves flying and all four ETB clauses; Embrace accepts Spacecraft and enchantments can pay Final Vengeance', () => {
  let s = fixture();
  s.players[0].mana.B = 10;
  const arbiter = put(s, 'Arbiter of Woe', 0, 'hand'),
    victim = put(s, 'Grizzly Bears'),
    discard = put(s, 'Grizzly Bears', 1, 'hand');
  const hand = s.players[0].hand.length;
  s = act(s, 'cast', { card: arbiter.id, sacrifice: ref(victim) });
  s = resolve(s);
  s = resolve(s);
  assert.equal(s.choice.kind, 'discardEffect');
  s = act(s, 'discardEffect', { cards: [discard.id] });
  assert.equal(s.players[1].life, 18);
  assert.equal(s.players[0].life, 22);
  assert.equal(s.players[0].hand.length, hand);
  assert.ok(keywords(s, s.objects[arbiter.id]).includes('flying'));
  s = fixture();
  s.players[0].mana.B = 10;
  s.catalog = createRegistry({
    ...CARDS,
    Ship: { name: 'Ship', type: 'artifact', cost: {}, subtypes: ['Spacecraft'] },
  });
  const embrace = put(s, 'Embrace Oblivion', 0, 'hand'),
    ship = put(s, 'Ship', 1),
    treasure = put(s, 'Treasure Token');
  s = act(s, 'cast', { card: embrace.id, target: ref(ship), sacrifice: ref(treasure) });
  s = resolve(s);
  assert.equal(s.objects[ship.id].zone, 'graveyard');
  const vengeance = put(s, 'Final Vengeance', 0, 'hand'),
    enchantment = put(s, 'Glorious Anthem'),
    enemy = put(s, 'Grizzly Bears', 1);
  s = act(s, 'cast', { card: vengeance.id, target: ref(enemy), sacrifice: ref(enchantment) });
  s = resolve(s);
  assert.equal(s.objects[enemy.id].zone, 'exile');
  assert.equal(s.objects[enchantment.id].zone, 'graveyard');
});
