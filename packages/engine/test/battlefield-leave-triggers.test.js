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
  stats,
  definition,
} from '../src/index.js';
import { move, sacrificePermanents, addModifier, ref, notifyTriggers } from '../src/model.js';
import { resolveEffects, enterBattlefield, stabilize } from '../src/effects.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';

const names = [
  'City Pigeon',
  'Cryogen Relic',
  'Featherbrained Filcher',
  "Greed's Gambit",
  'Molten Man, Inferno Incarnate',
  'Momo, Playful Pet',
  'Mouser Foundry',
  'Nutrient Block',
  'Suki, Courageous Rescuer',
  'Super Shredder',
  'Three Tree Scribe',
  'Weapons Manufacturing',
  'Zoo Escapees',
  'Greed Bat Token',
  'Munitions Token',
];
const sources = await Promise.all(
  names.map(async (name) =>
    JSON.parse(
      await readFile(
        new URL(
          `../../cards/cards/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`,
          import.meta.url,
        ),
        'utf8',
      ),
    ),
  ),
);
const identities = { ...CARD_IDS, ...Object.fromEntries(sources.map((s) => [s.id, s.name])) };
const mechanics = JSON.parse(
  await readFile(new URL('../../cards/mechanics.json', import.meta.url)),
);
const compiled = sources.map((source) => {
  const result = compileCard(source, { identities, mechanics });
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
function effect(s, effects, extra = {}) {
  return resolveEffects(s, { controller: 0, source: null, effects, ...extra });
}
function witness(s, event = { event: 'leave' }, extra = {}) {
  const o = put(s, 'Grizzly Bears');
  o.definitionOverride = {
    ...CARDS['Grizzly Bears'],
    triggers: [{ event, effects: [{ op: 'gainLife', amount: 1 }], ...extra }],
  };
  return o;
}
function tokens(s, name) {
  return Object.values(s.objects).filter(
    (o) => o.token && o.name === name && o.zone === 'battlefield',
  );
}

test('thirteen complete cards and two exact tokens pass schema, definition validation and roundtrip', async () => {
  const schema = JSON.parse(
    await readFile(new URL('../../cards/schema/card.schema.json', import.meta.url)),
  );
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const idsByName = Object.fromEntries(Object.entries(identities).map(([id, name]) => [name, id]));
  for (const [i, source] of sources.entries()) {
    assert.equal(validate(source), true, `${source.name}: ${JSON.stringify(validate.errors)}`);
    assert.deepEqual(validateDefinition(compiled[i]), []);
    const result = compileCard(sourceFromDefinition(compiled[i], { id: source.id, idsByName }), {
      identities,
      mechanics,
    });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(canonical(result.definition), canonical(compiled[i]));
  }
  assert.deepEqual(
    validateEventSpec({ event: 'leave', object: 'source', destinations: ['hand', 'exile'] }),
    [],
  );
  for (const event of [
    { event: 'leave', destinations: [] },
    { event: 'leave', destinations: ['battlefield'] },
    { event: 'leave', destinations: ['graveyard', 'graveyard'] },
    { event: 'leave', destinations: 'hand' },
    { event: 'dies', destinations: ['graveyard'] },
    { event: 'leave', step: 'end' },
    { event: 'leave', object: 'source', excludeSource: true },
  ])
    assert.ok(validateEventSpec(event).length, JSON.stringify(event));
});

test('leave observes every actual battlefield departure, not other-zone moves or entry', () => {
  for (const to of ['hand', 'library', 'exile', 'graveyard', 'stack', 'void']) {
    const s = setup();
    const source = witness(s, { event: 'leave', object: 'source' });
    const before = ref(source);
    move(s, source, to);
    assert.equal(s.pendingTriggers.length, 1, to);
    assert.deepEqual(s.pendingTriggers[0].source, before);
    assert.deepEqual(s.pendingTriggers[0].departedSource, ref(source));
  }
  for (const [from, to] of [
    ['hand', 'graveyard'],
    ['exile', 'hand'],
    ['stack', 'graveyard'],
    ['hand', 'battlefield'],
  ]) {
    const s = setup();
    witness(s);
    move(s, put(s, 'Grizzly Bears', 0, from), to);
    assert.equal(s.pendingTriggers.length, 0, `${from}->${to}`);
  }
});

test('all simultaneous wipe destinations retain departing observers and pre-move controller/type facts', () => {
  for (const op of ['destroyAll', 'bounceAll', 'exileAll']) {
    for (const reverse of [false, true]) {
      const s = setup();
      const first = put(s, 'Llanowar Elves', 1);
      const watcher = witness(s, {
        event: 'leave',
        controller: 'you',
        filter: { type: 'creature' },
        excludeSource: true,
      });
      const last = put(s, 'Llanowar Elves', 1);
      first.controller = last.controller = watcher.controller = 1;
      if (reverse) s.objects = Object.fromEntries(Object.entries(s.objects).reverse());
      effect(s, [{ op, where: { type: 'creature' } }]);
      assert.equal(s.pendingTriggers.length, 2, `${op}/${reverse}`);
      assert.ok(s.pendingTriggers.every((t) => t.controller === 1));
      assert.ok(s.pendingTriggers.every((t) => t.eventSource.definition.subtypes.includes('Elf')));
    }
  }
});

test('destination filtering uses replacement result; dying and nondeath are not conflated', () => {
  for (const rip of [false, true]) {
    const s = setup();
    const watcher = put(s, 'Three Tree Scribe');
    const victim = put(s, 'City Pigeon');
    const replacement = rip ? put(s, 'Rest in Peace') : null;
    sacrificePermanents(s, replacement ? [replacement, watcher, victim] : [watcher, victim]);
    assert.equal(victim.zone, rip ? 'exile' : 'graveyard');
    assert.equal(
      s.pendingTriggers.filter((t) => t.name === 'Three Tree Scribe').length,
      rip ? 2 : 0,
    );
    assert.equal(s.pendingTriggers.filter((t) => t.name === 'City Pigeon').length, 1);
  }
});

test('predeparture ability loss prevents leave triggers and old-source effects never follow reentry', () => {
  let s = setup();
  const pigeon = put(s, 'City Pigeon');
  addModifier(s, {
    objectId: pigeon.id,
    incarnation: pigeon.incarnation,
    removeAbilities: true,
    expires: s.turn,
  });
  move(s, pigeon, 'hand');
  assert.equal(s.pendingTriggers.length, 0);
  const shredder = put(s, 'Super Shredder');
  move(s, put(s, 'Forest'), 'exile');
  assert.equal(s.pendingTriggers.length, 1);
  move(s, shredder, 'hand');
  move(s, shredder, 'battlefield');
  s = settle(s);
  assert.equal(s.objects[shredder.id].plusCounters, 0);
  move(s, put(s, 'Forest', 1), 'exile');
  s = settle(s);
  assert.equal(s.objects[shredder.id].plusCounters, 1);
});

test('tokens trigger before ceasing to exist, using last controller rather than owner', () => {
  let s = setup();
  const token = put(s, 'Munitions Token', 1);
  token.controller = 0;
  move(s, token, 'hand');
  assert.equal(s.pendingTriggers[0].controller, 0);
  stabilize(s);
  assert.equal(s.objects[token.id], undefined);
  assert.equal(s.choice.kind, 'triggerTarget');
  s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.players[1].life, 18);
});

test('departing observers preserve APNAP stacking and same-controller ordering choices', () => {
  let s = setup();
  put(s, 'City Pigeon');
  put(s, 'Featherbrained Filcher');
  put(s, 'City Pigeon', 1);
  effect(s, [{ op: 'exileAll', where: { type: 'creature' } }]);
  stabilize(s);
  assert.equal(s.choice.kind, 'orderTriggers');
  assert.equal(s.choice.player, 0);
  s = act(s, 'orderTriggers', { ids: s.choice.entries.map((t) => t.id) });
  assert.deepEqual(
    s.stack.map((t) => t.controller),
    [0, 0, 1],
  );
  s = settle(s);
  assert.equal(tokens(s, 'Food Token').filter((o) => o.controller === 0).length, 2);
  assert.equal(tokens(s, 'Food Token').filter((o) => o.controller === 1).length, 1);
});

test('City Pigeon, Featherbrained Filcher and Zoo Escapees create the exact usable tokens for every ordinary destination', () => {
  for (const [name, tokenName] of [
    ['City Pigeon', 'Food Token'],
    ['Featherbrained Filcher', 'Food Token'],
    ['Zoo Escapees', 'Mutagen Token'],
  ]) {
    for (const to of ['hand', 'library', 'graveyard', 'exile']) {
      let s = setup();
      const o = put(s, name);
      move(s, o, to);
      s = settle(s);
      const created = tokens(s, tokenName);
      assert.equal(created.length, 1, `${name}/${to}`);
      assert.deepEqual(definition(s, created[0]), CARDS[tokenName]);
    }
  }
  assert.deepEqual(catalog['City Pigeon'].keywords, ['flying']);
  assert.deepEqual(catalog['Featherbrained Filcher'].keywords, ['flying']);
});

test('Cryogen Relic draws on enter and departure; sacrifice is a cost above its optional stun activation', () => {
  let s = setup();
  const relic = put(s, 'Cryogen Relic', 0, 'hand');
  enterBattlefield(s, relic, 0);
  s = settle(s);
  assert.equal(s.players[0].hand.length, 1);
  const tapped = put(s, 'Grizzly Bears');
  tapped.tapped = true;
  s.players[0].mana.U = 2;
  s = act(s, 'activate', { card: relic.id, ability: 0, targets: { chosen: [ref(tapped)] } });
  assert.equal(s.objects[relic.id].zone, 'graveyard');
  assert.equal(s.stack.length, 2);
  assert.equal(s.stack.at(-1).name, 'Cryogen Relic');
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 2);
  assert.equal(s.objects[tapped.id].stunCounters ?? 0, 0);
  s = resolve(s);
  assert.equal(s.objects[tapped.id].stunCounters, 1);
  s = setup();
  const second = put(s, 'Cryogen Relic');
  s.players[0].mana.U = 2;
  s = act(s, 'activate', { card: second.id, ability: 0, targets: { chosen: [] } });
  s = settle(s);
  assert.equal(s.players[0].hand.length, 1);
});

test('Mouser Foundry creates exact 1/1 artifact Robots on enter/leave and deals three from its sacrificed source', () => {
  let s = setup();
  const foundry = put(s, 'Mouser Foundry', 0, 'hand');
  enterBattlefield(s, foundry, 0);
  s = settle(s);
  let robot = tokens(s, 'Small Robot Token')[0];
  assert.deepEqual(stats(s, robot), { power: 1, toughness: 1 });
  assert.deepEqual(definition(s, robot).types, ['artifact', 'creature']);
  const target = put(s, 'Grizzly Bears', 1);
  s.players[0].mana.R = 5;
  s = act(s, 'activate', { card: foundry.id, ability: 0, target: ref(target) });
  s = resolve(s);
  assert.equal(tokens(s, 'Small Robot Token').length, 2);
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'graveyard');
});

test('Momo chooses among all three real leave modes', () => {
  for (const mode of [0, 1, 2]) {
    let s = setup();
    const momo = put(s, 'Momo, Playful Pet');
    const bear = put(s, 'Grizzly Bears');
    move(s, momo, 'exile');
    stabilize(s);
    assert.equal(s.choice.kind, 'triggerMode');
    s = act(s, 'chooseTriggerMode', { mode });
    if (mode === 1) s = act(s, 'chooseTriggerTarget', { target: ref(bear) });
    s = resolve(s);
    if (mode === 0) assert.equal(tokens(s, 'Food Token').length, 1);
    if (mode === 1) assert.equal(s.objects[bear.id].plusCounters, 1);
    if (mode === 2) {
      assert.equal(s.choice.kind, 'libraryOrder');
      assert.equal(s.choice.cards.length, 2);
    }
  }
  assert.deepEqual(catalog['Momo, Playful Pet'].keywords, ['flying', 'vigilance']);
});

test('Three Tree Scribe counts other friendly bounced creatures and itself, not dying or enemy creatures', () => {
  for (const [to, owner, expected] of [
    ['hand', 0, 1],
    ['exile', 0, 1],
    ['library', 0, 1],
    ['graveyard', 0, 0],
    ['hand', 1, 0],
  ]) {
    const s = setup();
    put(s, 'Three Tree Scribe');
    move(s, put(s, 'Grizzly Bears', owner), to);
    assert.equal(s.pendingTriggers.length, expected, `${to}/${owner}`);
  }
  let s = setup();
  const scribe = put(s, 'Three Tree Scribe');
  const target = put(s, 'Grizzly Bears');
  move(s, scribe, 'exile');
  stabilize(s);
  s = act(s, 'chooseTriggerTarget', { target: ref(target) });
  s = resolve(s);
  assert.equal(s.objects[target.id].plusCounters, 1);
});

test('Weapons Manufacturing creates nonrecursive Munitions only for friendly nontoken artifact entries', () => {
  let s = setup();
  put(s, 'Weapons Manufacturing');
  for (const [name, owner] of [
    ['Fountainport Bell', 0],
    ['Ornithopter', 0],
    ['Ornithopter', 1],
    ['Small Robot Token', 0],
    ['Grizzly Bears', 0],
  ]) {
    const o = put(s, name, owner, 'hand');
    enterBattlefield(s, o, owner);
    s = settle(s);
  }
  assert.equal(tokens(s, 'Munitions Token').length, 2);
  const munition = tokens(s, 'Munitions Token')[0];
  sacrificePermanents(s, [munition]);
  stabilize(s);
  s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.players[1].life, 18);
});

test('Suki applies the other-creature anthem, own-turn once-per-turn departure and new incarnation reset', () => {
  let s = setup();
  const suki = put(s, 'Suki, Courageous Rescuer');
  const bear = put(s, 'Grizzly Bears');
  assert.deepEqual(stats(s, suki), { power: 2, toughness: 4 });
  assert.deepEqual(stats(s, bear), { power: 3, toughness: 2 });
  move(s, put(s, 'Forest', 1), 'hand');
  assert.equal(s.pendingTriggers.length, 0);
  s.active = 1;
  move(s, put(s, 'Forest'), 'hand');
  assert.equal(s.pendingTriggers.length, 0);
  s.active = 0;
  move(s, put(s, 'Forest'), 'hand');
  move(s, bear, 'exile');
  assert.equal(s.pendingTriggers.length, 1);
  s = settle(s);
  assert.equal(tokens(s, 'Ally Token').length, 1);
  move(s, s.objects[suki.id], 'hand');
  assert.equal(s.pendingTriggers.length, 0);
  move(s, s.objects[suki.id], 'battlefield');
  move(s, put(s, 'Forest'), 'hand');
  s = settle(s);
  assert.equal(tokens(s, 'Ally Token').length, 2);
  s.turn++;
  move(s, put(s, 'Forest'), 'exile');
  s = settle(s);
  assert.equal(tokens(s, 'Ally Token').length, 3);
});

test('Nutrient Block is indestructible Food and draws only on graveyard movement, not replacement exile', () => {
  for (const replacement of [false, true]) {
    let s = setup();
    const block = put(s, 'Nutrient Block');
    effect(s, [{ op: 'destroyAll', where: { type: 'artifact' } }]);
    assert.equal(block.zone, 'battlefield');
    if (replacement) put(s, 'Rest in Peace');
    s.players[0].mana.C = 2;
    s = act(s, 'activate', { card: block.id, ability: 0 });
    s = settle(s);
    assert.equal(s.players[0].life, 23);
    assert.equal(s.players[0].hand.length, replacement ? 0 : 1);
    assert.equal(s.objects[block.id].zone, replacement ? 'exile' : 'graveyard');
  }
});

test('Molten Man searches only basic Mountains tapped, scales all controlled Mountains, and sacrifices a land on departure', () => {
  let s = setup();
  const mountain = put(s, 'Mountain');
  const search = put(s, 'Mountain', 0, 'library');
  put(s, 'Forest', 0, 'library');
  const molten = put(s, 'Molten Man, Inferno Incarnate', 0, 'hand');
  enterBattlefield(s, molten, 0);
  stabilize(s);
  s = resolve(s);
  assert.equal(s.choice.kind, 'librarySearch');
  assert.ok(s.choice.cards.includes(search.id));
  assert.ok(s.choice.cards.every((id) => s.objects[id].name === 'Mountain'));
  s = act(s, 'searchLibrary', { cards: [search.id] });
  assert.equal(s.objects[search.id].tapped, true);
  assert.deepEqual(stats(s, s.objects[molten.id]), { power: 2, toughness: 2 });
  move(s, s.objects[molten.id], 'hand');
  stabilize(s);
  s = resolve(s);
  assert.equal(s.choice.kind, 'sacrifice');
  s = act(s, 'sacrifice', { cards: [mountain.id] });
  assert.equal(s.objects[mountain.id].zone, 'graveyard');
});

test("Greed's Gambit resolves every entry, own-end-step and departure clause in order", () => {
  let s = setup();
  const gambit = put(s, "Greed's Gambit", 0, 'hand');
  enterBattlefield(s, gambit, 0);
  s = settle(s);
  assert.equal(s.players[0].hand.length, 3);
  assert.equal(s.players[0].life, 26);
  assert.equal(tokens(s, 'Greed Bat Token').length, 3);
  const bat = tokens(s, 'Greed Bat Token')[0];
  assert.deepEqual(stats(s, bat), { power: 2, toughness: 1 });
  assert.deepEqual(definition(s, bat).color, ['B']);
  assert.deepEqual(definition(s, bat).keywords, ['flying']);
  notifyTriggers(s, 'step', { step: 'end', player: 1 });
  assert.equal(s.pendingTriggers.length, 0);
  notifyTriggers(s, 'step', { step: 'end', player: 0 });
  s = settle(s);
  assert.equal(s.players[0].hand.length, 2);
  assert.equal(s.players[0].life, 24);
  assert.equal(tokens(s, 'Greed Bat Token').length, 2);
  move(s, s.objects[gambit.id], 'exile');
  s = settle(s);
  assert.equal(s.players[0].hand.length, 0);
  assert.equal(s.players[0].life, 18);
  assert.equal(tokens(s, 'Greed Bat Token').length, 0);
});

test('sacrifice casting cost places leave trigger above the fully cast spell, without starting resolution early', () => {
  let s = setup();
  const pigeon = put(s, 'City Pigeon');
  const spell = put(s, 'Corrupted Conviction', 0, 'hand');
  s.players[0].mana.B = 1;
  s = act(s, 'cast', { card: spell.id, sacrifice: ref(pigeon) });
  assert.deepEqual(
    s.stack.map((t) => t.name),
    ['Corrupted Conviction', 'City Pigeon'],
  );
  assert.equal(tokens(s, 'Food Token').length, 0);
  s = resolve(s);
  assert.equal(tokens(s, 'Food Token').length, 1);
  assert.equal(s.players[0].hand.length, 0);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 2);
});

test('linked exile returns remain immediate duration expiry, not a new triggered return', () => {
  let s = setup();
  const ring = put(s, 'Banishing Light');
  const creature = put(s, 'Grizzly Bears', 1);
  effect(s, [{ op: 'exileUntilSourceLeaves' }], { source: ref(ring), target: ref(creature) });
  assert.equal(creature.zone, 'exile');
  move(s, ring, 'hand');
  stabilize(s);
  assert.equal(s.objects[creature.id].zone, 'battlefield');
  assert.equal(s.stack.length, 0);
  assert.equal(s.pendingTriggers.length, 0);
});

test('target-group linked exile retains one pre-event observer snapshot for simultaneous exiles', () => {
  const s = setup();
  const source = put(s, 'Banishing Light');
  const watcher = witness(s, { event: 'leave', excludeSource: true });
  const other = put(s, 'Grizzly Bears');
  effect(s, [{ op: 'exileUntilSourceLeaves', targetGroup: 'chosen' }], {
    source: ref(source),
    targets: { chosen: [ref(watcher), ref(other)] },
  });
  assert.equal(s.pendingTriggers.length, 1);
  assert.equal(watcher.zone, 'exile');
  assert.equal(other.zone, 'exile');
});

test('games without leave observers allocate no extra trigger IDs, history or state fields', () => {
  for (const to of ['hand', 'exile', 'graveyard']) {
    const s = setup();
    const o = put(s, 'Grizzly Bears');
    const next = s.nextId;
    const events = s.events.length;
    move(s, o, to);
    assert.equal(s.nextId, next);
    assert.equal(s.pendingTriggers.length, 0);
    assert.deepEqual(
      s.events.slice(events).map((e) => e.type),
      ['zoneChange'],
    );
    assert.ok(!Object.keys(s).some((k) => /leave|departure/i.test(k)));
  }
});

test('actual leave cards and target-free token production serialize deterministic command replay', () => {
  const deck = [
    'City Pigeon',
    'Cryogen Relic',
    'Zoo Escapees',
    'Corrupted Conviction',
    'Day of Judgment',
    'Forest',
    'Forest',
  ];
  const defs = deck
    .filter((n, i) => deck.indexOf(n) === i)
    .map((n) => ({ ...catalog[n], cost: {} }));
  let s = createGame({
    catalog: createRegistry([...defs, CARDS['Food Token'], CARDS['Mutagen Token']]),
    minimumDeckSize: 7,
    mulligan: false,
    decks: [deck, Array(7).fill('Forest')],
  });
  while (s.step !== 'main1') s = act(s, 'pass');
  const id = (name) => s.players[0].hand.find((id) => s.objects[id].name === name);
  s = resolve(act(s, 'cast', { card: id('City Pigeon') }));
  const pigeon = Object.values(s.objects).find((o) => o.name === 'City Pigeon');
  // Keep enough library to draw, using a 7-card deck but no draw-trigger cards in this run.
  s = resolve(act(s, 'cast', { card: id('Zoo Escapees') }));
  s = resolve(act(s, 'cast', { card: id('Day of Judgment') }));
  assert.equal(s.choice.kind, 'orderTriggers');
  assert.deepEqual(replay(JSON.parse(JSON.stringify(exportReplay(s)))), s);
  s = settle(s);
  assert.equal(tokens(s, 'Food Token').length, 1);
  assert.equal(tokens(s, 'Mutagen Token').length, 1);
  assert.equal(s.objects[pigeon.id].zone, 'graveyard');
  assert.deepEqual(replay(JSON.parse(JSON.stringify(exportReplay(s)))), s);
});

test('casting-sacrifice leave triggers replay above their spell before any cost-trigger choice resolves', () => {
  const deck = ['City Pigeon', 'Corrupted Conviction', ...Array(7).fill('Forest')];
  let s = createGame({
    catalog: createRegistry([
      { ...catalog['City Pigeon'], cost: {} },
      { ...CARDS['Corrupted Conviction'], cost: {} },
      CARDS.Forest,
      CARDS['Food Token'],
    ]),
    minimumDeckSize: 9,
    mulligan: false,
    seed: 3724,
    decks: [deck, Array(9).fill('Forest')],
  });
  while (s.step !== 'main1') s = act(s, 'pass');
  const id = (name) => s.players[0].hand.find((id) => s.objects[id].name === name);
  const pigeon = id('City Pigeon'),
    conviction = id('Corrupted Conviction');
  assert.ok(pigeon && conviction);
  s = resolve(act(s, 'cast', { card: pigeon }));
  s = act(s, 'cast', { card: conviction, sacrifice: ref(s.objects[pigeon]) });
  assert.deepEqual(
    s.stack.map((t) => t.name),
    ['Corrupted Conviction', 'City Pigeon'],
  );
  assert.deepEqual(replay(JSON.parse(JSON.stringify(exportReplay(s)))), s);
  s = settle(s);
  assert.equal(tokens(s, 'Food Token').length, 1);
  assert.equal(s.players[0].hand.length, 7);
  assert.deepEqual(replay(JSON.parse(JSON.stringify(exportReplay(s)))), s);
});

test('leave source and event characteristics use prebatch anthems and last-known controller', () => {
  const s = setup();
  const suki = put(s, 'Suki, Courageous Rescuer', 1);
  suki.controller = 0;
  const watcher = witness(s, { event: 'leave', filter: { power: { gte: 3 } } });
  // The witness and bear are 3/2 before Suki leaves, but 2/2 afterward.
  const bear = put(s, 'Grizzly Bears');
  effect(s, [{ op: 'bounceAll', where: { type: 'creature' } }]);
  const triggered = s.pendingTriggers.filter((t) => t.source.id === watcher.id);
  assert.equal(triggered.length, 2);
  assert.ok(triggered.every((t) => t.eventSource.power === 3));
  assert.ok(triggered.every((t) => t.sourceStats.power === 3));
  assert.equal(s.pendingTriggers.filter((t) => t.source.id === suki.id).length, 1);
  assert.equal(s.pendingTriggers.find((t) => t.source.id === suki.id).controller, 0);
  assert.equal(bear.zone, 'hand');
});
