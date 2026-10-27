import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import {
  dispatch,
  legalActions,
  chooseBotCommand,
  definition,
  stats,
  keywords,
  ref,
  exportReplay,
  replay,
  stationProblem,
  stationPlan,
  stationCandidates,
  createRegistry,
  canAttack,
  hasType,
  validateDefinition,
  abilityProblem,
} from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import {
  move,
  notifyTriggers,
  addModifier,
  counterKinds,
  removeOneCounter,
  copiableDefinition,
  captureDepartureContext,
  finishDepartureBatch,
} from '../packages/engine/src/model.js';
import { resolveEffects, stabilize } from '../packages/engine/src/effects.js';
import { createSession } from '../packages/simulation/session.js';
import { fixture, put, act } from '../packages/engine/test/helpers.js';
import {
  stationNames,
  stationSources,
  stationDefinitions,
  stationCatalog,
  stationIdentities,
  stationPosition,
} from './helpers/station-catalog.js';
function position(extra = {}) {
  const s = fixture();
  s.catalog = createRegistry({ ...stationCatalog, ...extra });
  return s;
}
function settle(s) {
  for (let i = 0; i < 120 && (s.choice || s.stack.length || s.resolving); i++) {
    const command = s.choice ? chooseBotCommand(s, s.choice.player) : { type: 'pass' };
    s = act(s, command.type, command);
  }
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 0);
  assert.equal(s.resolving, null);
  return s;
}
const station = (s, id, payer) => act(s, 'station', { card: id, cards: [payer] });
const charge = (s, id, payer) => settle(station(s, id, payer));
const validate = new Ajv({ allErrors: true, strict: true }).compile(
  JSON.parse(await readFile(new URL('../packages/cards/schema/card.schema.json', import.meta.url))),
);
const entry = (source, effects) => ({
  id: 'test',
  kind: 'ability',
  controller: source.controller,
  name: source.name,
  source: ref(source),
  effects,
  sourceKeywords: [],
  target: null,
  targetKind: null,
});

test('17 complete Station sources validate, round-trip and retain threshold P/T only in the striation', () => {
  const idsByName = Object.fromEntries(
    Object.entries(stationIdentities).map(([id, name]) => [name, id]),
  );
  for (const source of stationSources) {
    assert.equal(validate(source), true, `${source.name}: ${JSON.stringify(validate.errors)}`);
    const compiled = compileCard(source, { identities: stationIdentities });
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    assert.equal(compiled.definition.power, undefined);
    assert.equal(compiled.definition.toughness, undefined);
    const round = compileCard(
      sourceFromDefinition(compiled.definition, { id: source.id, idsByName }),
      { identities: stationIdentities },
    );
    assert.equal(round.ok, true, JSON.stringify(round.diagnostics));
    assert.deepEqual(round.definition, compiled.definition);
  }
});
for (const name of stationNames)
  test(`${name}: full cast/entry, station threshold and granted abilities execute`, () => {
    let s = position();
    for (const p of s.players)
      for (const color of ['W', 'U', 'B', 'R', 'G', 'C']) p.mana[color] = 50;
    const payer = put(s, 'Grizzly Bears');
    payer.plusCounters = 50;
    const enemy = put(s, 'Grizzly Bears', 1);
    enemy.plusCounters = 10;
    put(s, 'Forest');
    put(s, 'Glorious Anthem', 1);
    put(s, 'Grizzly Bears', 0, 'graveyard');
    put(s, 'Yargle and Multani', 0, 'library');
    const source = put(s, name, 0, 'hand');
    s = settle(
      act(s, name === 'Kavaron, Memorial World' ? 'playLand' : 'cast', { card: source.id }),
    );
    assert.equal(s.objects[source.id].zone, 'battlefield');
    if (s.objects[payer.id].zone !== 'battlefield')
      throw Error(`${name} removed the station payer`);
    const expected = Math.max(0, stats(s, s.objects[payer.id]).power);
    s = charge(s, source.id, payer.id);
    assert.equal(s.objects[source.id].chargeCounters, expected);
    const d = definition(s, s.objects[source.id]),
      last = d.stationLevels.at(-1);
    if (last.power !== undefined) {
      assert.equal(hasType(d, 'creature'), true);
      assert.ok(keywords(s, s.objects[source.id]).includes('flying'));
      assert.deepEqual(stats(s, s.objects[source.id]), {
        power: last.power,
        toughness: last.toughness,
      });
      s.objects[source.id].controlledSince = 0;
      s.step = 'attackers';
      s.choice = { kind: 'attackers', player: 0 };
      s = settle(act(s, 'attackers', { cards: [source.id] }));
    } else {
      assert.equal(hasType(d, 'creature'), false);
      s.objects[source.id].tapped = false;
      const a = legalActions(s, 0).find((a) => a.type === 'activate' && a.card === source.id);
      assert.ok(a);
      s = settle(act(s, 'activate', a));
      assert.ok(
        Object.values(s.objects).some((o) => o.name === 'Robot Token' && o.zone === 'battlefield'),
      );
    }
    assert.equal(s.objects[source.id].zone, 'battlefield');
  });

test('station is exactly one other untapped creature, ignores sickness and cannot pay multiple creatures or itself', () => {
  let s = position();
  const ship = put(s, 'Galvanizing Sawship'),
    bear = put(s, 'Grizzly Bears', 0, 'battlefield', { ready: false }),
    enemy = put(s, 'Grizzly Bears', 1),
    land = put(s, 'Forest'),
    hand = put(s, 'Grizzly Bears', 0, 'hand');
  ship.tapped = true;
  for (const cards of [
    [],
    [bear.id, bear.id],
    [bear.id, enemy.id],
    [ship.id],
    [enemy.id],
    [land.id],
    [hand.id],
    ['missing'],
    null,
  ]) {
    const before = structuredClone(s),
      r = dispatch(s, { type: 'station', player: 0, card: ship.id, cards });
    assert.equal(r.ok, false, JSON.stringify(cards));
    assert.deepEqual(s, before);
  }
  assert.equal(stationProblem(s, 0, ship.id, [bear.id]), null);
  s = station(s, ship.id, bear.id);
  assert.equal(s.objects[bear.id].tapped, true);
  assert.equal(s.objects[ship.id].chargeCounters, undefined);
  assert.equal(s.objects[ship.id].tapped, true);
  assert.equal(s.stack.at(-1).target, null);
  assert.match(stationProblem(s, 0, ship.id, [bear.id]), /sorcery/);
  s = settle(s);
  assert.equal(s.objects[ship.id].chargeCounters, 2);
});

test('station enforces sorcery timing, priority and ability presence; rejection is atomic', () => {
  const s = position(),
    ship = put(s, 'Wurmwall Sweeper'),
    bear = put(s, 'Grizzly Bears');
  for (const mutate of [
    (x) => (x.active = 1),
    (x) => (x.step = 'beginCombat'),
    (x) => (x.priority = 1),
    (x) => x.stack.push(entry(ship, [])),
    (x) => (x.objects[ship.id].faceDown = true),
    (x) => (x.objects[ship.id].controller = 1),
    (x) => (x.choice = { kind: 'attackers', player: 0 }),
  ]) {
    const state = structuredClone(s);
    mutate(state);
    const before = structuredClone(state);
    assert.equal(
      dispatch(state, { type: 'station', player: 0, card: ship.id, cards: [bear.id] }).ok,
      false,
    );
    assert.deepEqual(state, before);
  }
  addModifier(s, {
    objectId: ship.id,
    incarnation: ship.incarnation,
    removeAbilities: true,
    expires: s.turn,
  });
  assert.match(stationProblem(s, 0, ship.id, [bear.id]), /with station/);
});

test('Pilot crew/saddle bonus does not affect station, and zero or negative power never removes counters', () => {
  let s = position();
  const ship = put(s, 'Wurmwall Sweeper'),
    pilot = put(s, 'Pilot Token');
  s = charge(s, ship.id, pilot.id);
  assert.equal(s.objects[ship.id].chargeCounters, 1);
  for (const power of [0, -4]) {
    const bear = put(s, 'Grizzly Bears');
    addModifier(s, {
      objectId: bear.id,
      incarnation: bear.incarnation,
      power: power - 2,
      toughness: 0,
      expires: s.turn,
    });
    assert.equal(stationProblem(s, 0, ship.id, [bear.id]), null);
    s = charge(s, ship.id, bear.id);
    assert.equal(s.objects[ship.id].chargeCounters, 1);
  }
});

test('power is measured at resolution, including gains, reductions and effects caused by tapping the payer', () => {
  for (const delta of [4, -2, -5]) {
    let s = position();
    const ship = put(s, 'Wurmwall Sweeper'),
      bear = put(s, 'Grizzly Bears');
    s = station(s, ship.id, bear.id);
    s.objects[bear.id].plusCounters = 2;
    addModifier(s, {
      objectId: bear.id,
      incarnation: bear.incarnation,
      power: delta,
      toughness: 0,
      expires: s.turn,
    });
    s = settle(s);
    assert.equal(s.objects[ship.id].chargeCounters ?? 0, Math.max(0, 4 + delta));
  }
  let s = position();
  const ship = put(s, 'Wurmwall Sweeper'),
    wylie = put(s, 'Wylie Duke, Atiin Hero');
  const before = s.players[0].library.length;
  s = station(s, ship.id, wylie.id);
  assert.equal(s.stack[0].effects[0].op, 'stationCharge');
  assert.ok(s.stack.length > 1);
  s = settle(s);
  assert.equal(s.players[0].life, 21);
  assert.equal(s.players[0].library.length, before - 1);
  assert.equal(s.objects[ship.id].chargeCounters, 4);
});

test('payer LKI is its last battlefield power, not activation power or a returned incarnation', () => {
  let s = position();
  const ship = put(s, 'Wurmwall Sweeper'),
    bear = put(s, 'Grizzly Bears');
  s = station(s, ship.id, bear.id);
  s.objects[bear.id].plusCounters = 3;
  move(s, s.objects[bear.id], 'hand');
  move(s, s.objects[bear.id], 'battlefield');
  s.objects[bear.id].plusCounters = 30;
  move(s, s.objects[bear.id], 'graveyard');
  s = settle(s);
  assert.equal(s.objects[ship.id].chargeCounters, 5);
});

test('simultaneous departure LKI includes an anthem before the entire departure batch', () => {
  let s = position();
  const ship = put(s, 'Wurmwall Sweeper'),
    bear = put(s, 'Grizzly Bears'),
    anthem = put(s, 'Lumen-Class Frigate');
  anthem.chargeCounters = 2;
  s = station(s, ship.id, bear.id);
  const context = captureDepartureContext(s);
  move(s, s.objects[anthem.id], 'graveyard', context);
  move(s, s.objects[bear.id], 'graveyard', context);
  finishDepartureBatch(s, context);
  s = settle(s);
  assert.equal(s.objects[ship.id].chargeCounters, 3);
});

test('resolution stays bound to exact source identity but survives ability, subtype and controller changes', () => {
  for (const mutate of [
    (s, ship) =>
      addModifier(s, {
        objectId: ship.id,
        incarnation: ship.incarnation,
        removeAbilities: true,
        expires: s.turn,
      }),
    (s, ship) =>
      (ship.definitionOverride = {
        name: 'Changed source',
        type: 'enchantment',
        cost: {},
        keywords: [],
        color: [],
        subtypes: [],
        text: '',
      }),
    (s, ship) => (ship.controller = 1),
  ]) {
    let s = position();
    const ship = put(s, 'Wurmwall Sweeper'),
      bear = put(s, 'Grizzly Bears');
    s = station(s, ship.id, bear.id);
    mutate(s, s.objects[ship.id]);
    s = settle(s);
    assert.equal(s.objects[ship.id].chargeCounters, 2);
  }
  let s = position();
  const ship = put(s, 'Wurmwall Sweeper'),
    bear = put(s, 'Grizzly Bears');
  s = station(s, ship.id, bear.id);
  move(s, s.objects[ship.id], 'hand');
  move(s, s.objects[ship.id], 'battlefield');
  s = settle(s);
  assert.equal(s.objects[ship.id].chargeCounters, undefined);
});

test('charge counters are removable counters; thresholds rise and fall, survive turn changes and do not use other counters', () => {
  const s = position(),
    ship = put(s, 'Lumen-Class Frigate'),
    bear = put(s, 'Grizzly Bears');
  ship.plusCounters = 12;
  ship.questCounters = 12;
  ship.chargeCounters = 1;
  assert.equal(definition(s, ship).type, 'artifact');
  assert.equal(stats(s, bear).power, 2);
  ship.chargeCounters = 2;
  assert.equal(stats(s, bear).power, 3);
  assert.equal(definition(s, ship).type, 'artifact');
  ship.chargeCounters = 12;
  assert.equal(definition(s, ship).type, 'creature');
  assert.deepEqual(stats(s, ship), { power: 15, toughness: 17 });
  assert.ok(counterKinds(ship).includes('charge'));
  removeOneCounter(ship, 'charge');
  assert.equal(ship.chargeCounters, 11);
  assert.equal(definition(s, ship).type, 'artifact');
  assert.deepEqual(stats(s, ship), { power: 0, toughness: 0 });
  ship.chargeCounters = 12;
  s.active = 1;
  s.turn++;
  assert.equal(definition(s, ship).type, 'creature');
  move(s, ship, 'hand');
  assert.equal(ship.chargeCounters, undefined);
});

test('threshold layer-4 type/P/T survives ability loss, loses keywords/anthem/activation, and respects later animation P/T', () => {
  const s = position(),
    ship = put(s, 'Lumen-Class Frigate'),
    bear = put(s, 'Grizzly Bears');
  ship.chargeCounters = 12;
  addModifier(s, {
    objectId: ship.id,
    incarnation: ship.incarnation,
    removeAbilities: true,
    expires: s.turn,
  });
  assert.deepEqual(stats(s, ship), { power: 3, toughness: 5 });
  assert.equal(definition(s, ship).type, 'creature');
  assert.deepEqual(keywords(s, ship), []);
  assert.equal(stats(s, bear).power, 2);
  assert.equal(definition(s, ship).station, undefined);
  addModifier(s, {
    objectId: ship.id,
    incarnation: ship.incarnation,
    addTypes: ['creature'],
    animation: { power: 7, toughness: 7, subtypes: [] },
    expires: s.turn,
  });
  assert.deepEqual(stats(s, ship), { power: 7, toughness: 7 });
  ship.chargeCounters = 0;
  assert.deepEqual(stats(s, ship), { power: 7, toughness: 7 });
});

test('station cards have no P/T outside battlefield; copy values preserve striations but not counters or active characteristics', () => {
  let s = position();
  const ship = put(s, 'Galvanizing Sawship');
  ship.chargeCounters = 3;
  for (const zone of ['hand', 'library', 'graveyard', 'exile', 'stack']) {
    const other = put(s, 'Galvanizing Sawship', 0, zone);
    assert.deepEqual(stats(s, other), { power: 0, toughness: 0 });
    assert.equal(definition(s, other).type, 'artifact');
  }
  const copied = copiableDefinition(s, ship);
  assert.equal(copied.type, 'artifact');
  assert.equal(copied.power, undefined);
  assert.equal(copied.stationLevels[0].power, 6);
  const effect = entry(ship, [{ op: 'copyToken', subject: 'source', count: 1 }]);
  resolveEffects(s, effect);
  s = settle(s);
  const token = Object.values(s.objects).find((o) => o.token && o.name === ship.name);
  assert.ok(token);
  assert.equal(token.chargeCounters, undefined);
  assert.equal(definition(s, token).type, 'artifact');
  token.chargeCounters = 3;
  assert.equal(definition(s, token).type, 'creature');
  assert.deepEqual(stats(s, token), { power: 6, toughness: 5 });
});

test('summoning sickness depends on control duration, not threshold crossing; haste works only while unlocked', () => {
  let s = position();
  const old = put(s, 'Wurmwall Sweeper'),
    fresh = put(s, 'Wurmwall Sweeper', 0, 'battlefield', { ready: false }),
    fast = put(s, 'Galvanizing Sawship', 0, 'battlefield', { ready: false });
  old.chargeCounters = 4;
  fresh.chargeCounters = 4;
  fast.chargeCounters = 3;
  assert.equal(canAttack(s, old, 0), true);
  assert.equal(canAttack(s, fresh, 0), false);
  assert.equal(canAttack(s, fast, 0), true);
  fast.chargeCounters = 2;
  assert.equal(canAttack(s, fast, 0), false);
  const payer = put(s, 'Grizzly Bears');
  s = charge(s, old.id, payer.id);
  assert.equal(s.objects[old.id].chargeCounters, 6);
});

test('threshold triggers and activations disappear below threshold, while an announced ability resolves independently', () => {
  let s = position();
  const ship = put(s, 'Debris Field Crusher');
  assert.equal(definition(s, ship).activated, undefined);
  ship.chargeCounters = 8;
  assert.equal(definition(s, ship).activated.length, 1);
  s.players[0].mana.R = 2;
  s = act(s, 'activate', { card: ship.id, ability: 0 });
  s.objects[ship.id].chargeCounters = 0;
  s = settle(s);
  assert.equal(definition(s, s.objects[ship.id]).activated, undefined);
  s.objects[ship.id].chargeCounters = 8;
  assert.equal(stats(s, s.objects[ship.id]).power, 3);
});

test('malformed and unsupported Station definitions fail closed without broadening rules-bearing counters', () => {
  const source = stationSources.find((c) => c.name === 'Galvanizing Sawship'),
    base = source.abilities.find((a) => a.kind === 'stationLevel');
  for (const abilities of [
    [{ kind: 'station', value: 1 }],
    [{ kind: 'station' }, { kind: 'station' }],
    [{ ...base, threshold: 0 }],
    [{ ...base, threshold: 1.5 }],
    [{ ...base, power: '*' }],
    [{ ...base, power: undefined }].map(({ power, ...a }) => a),
    [{ ...base, abilities: [null] }],
    [{ ...base, abilities: [{ kind: 'station' }] }],
    [{ ...base, abilities: [{ kind: 'keyword', keyword: 'ward', cost: { mana: '{2}' } }] }],
    [{ ...base, abilities: [{ kind: 'keyword', keyword: 'changeling' }] }],
    [{ ...base, abilities: [{ kind: 'mana', produces: 'R' }] }],
    [base, base],
  ])
    assert.equal(compileCard({ ...source, abilities }).ok, false, JSON.stringify(abilities));
  const d = stationDefinitions.find((d) => d.name === 'Galvanizing Sawship');
  for (const bad of [
    { station: false },
    { stationLevels: [null] },
    { stationLevels: [{ threshold: 3, grants: { keywords: [], shield: true } }] },
    { power: 6, toughness: 5 },
  ])
    assert.ok(validateDefinition({ ...d, ...bad }).length);
  const unknown = structuredClone(d);
  unknown.stationLevels[0].grants.activated = [
    { cost: {}, effects: [{ op: 'token', definition: 'Missing Token', count: 1 }] },
  ];
  assert.throws(
    () => createRegistry({ ...stationCatalog, [unknown.name]: unknown }),
    /Missing Token/,
  );
});

test('bot stations without infinite repeat and deterministic replay/opaque actions preserve the selected payer', () => {
  let s = stationPosition();
  const before = exportReplay(s),
    action = legalActions(s, 0).find((a) => a.type === 'station');
  assert.equal(chooseBotCommand(s, 0).type, 'station');
  s = settle(act(s, 'station', action));
  assert.deepEqual(replay(exportReplay(s)), s);
  const charged = s.objects[action.card].chargeCounters;
  assert.ok(charged > 0);
  const session = createSession(before.config);
  for (const [i, command] of before.commands.entries()) {
    const ctx = session.context(),
      prior = replay({ ...before, commands: before.commands.slice(0, i) });
    const proposed =
      command.type === 'attackers'
        ? command
        : ctx.actions.find(
            (a) =>
              a.type === command.type &&
              (!command.card ||
                ctx.observation.objects[a.card]?.name === prior.objects[command.card].name),
          );
    const translated = proposed ?? chooseBotCommand(ctx.observation, ctx.player);
    assert.equal(translated?.type, command.type);
    assert.equal(session.step(translated).ok, true);
  }
  const cmd = session.context().actions.find((a) => a.type === 'station');
  assert.match(cmd.card, /^object:/);
  assert.match(cmd.cards[0], /^object:/);
  assert.equal(session.step(cmd).ok, true);
  let observed = session.context();
  assert.match(observed.observation.stack[0].stationPayer.id, /^object:/);
  for (let i = 0; i < 50 && session.context().observation.stack.length; i++)
    assert.equal(session.step(session.context().actions.find((a) => a.type === 'pass')).ok, true);
  const bot = structuredClone(s);
  bot.objects[action.card].chargeCounters = 100;
  assert.notEqual(chooseBotCommand(bot, 0)?.type, 'station');
});

test('losing a charge threshold removes an attacker or blocker from combat, even after it becomes a creature again', () => {
  for (const attacking of [true, false]) {
    const s = position(),
      ship = put(s, 'Wurmwall Sweeper', attacking ? 0 : 1),
      other = put(s, 'Grizzly Bears');
    ship.chargeCounters = 4;
    s.combat.attackers = [ref(attacking ? ship : other)];
    s.combat.blocks = attacking ? {} : { [other.id]: [ref(ship)] };
    removeOneCounter(ship, 'charge');
    stabilize(s);
    ship.chargeCounters = 4;
    assert.equal(
      s.combat.attackers.some((r) => r.id === ship.id),
      false,
    );
    assert.equal(
      Object.values(s.combat.blocks)
        .flat()
        .some((r) => r.id === ship.id),
      false,
    );
  }
});

function castToEntry(s, name) {
  for (const color of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[color] = 50;
  const card = put(s, name, 0, 'hand');
  s = act(s, 'cast', { card: card.id });
  s = act(s, 'pass');
  s = act(s, 'pass');
  return { s, id: card.id };
}

test('Atmospheric Greenhouse counters only existing creatures and Wedgelight creates the exact untapped Robot', () => {
  let s = position();
  const bear = put(s, 'Grizzly Bears'),
    enemy = put(s, 'Grizzly Bears', 1),
    other = put(s, 'Wurmwall Sweeper');
  let result = castToEntry(s, 'Atmospheric Greenhouse');
  s = settle(result.s);
  assert.equal(s.objects[bear.id].plusCounters, 1);
  assert.equal(s.objects[enemy.id].plusCounters, 0);
  assert.equal(s.objects[other.id].plusCounters, 0);
  assert.equal(s.objects[result.id].plusCounters, 0);
  result = castToEntry(s, 'Wedgelight Rammer');
  s = settle(result.s);
  const token = Object.values(s.objects).find(
    (o) => o.name === 'Robot Token' && o.zone === 'battlefield',
  );
  assert.deepEqual(stats(s, token), { power: 2, toughness: 2 });
  assert.equal(token.tapped, false);
  assert.deepEqual(definition(s, token).types, ['artifact', 'creature']);
});

test('Dawnsire unlocks a once-per-attack-group 100-damage trigger without becoming a creature at ten', () => {
  let s = position();
  const ship = put(s, 'Dawnsire, Sunstar Dreadnought'),
    a = put(s, 'Grizzly Bears'),
    b = put(s, 'Savannah Lions'),
    enemy = put(s, 'Yargle and Multani', 1);
  ship.chargeCounters = 10;
  assert.equal(definition(s, ship).type, 'artifact');
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: 0 };
  s = act(s, 'attackers', { cards: [a.id, b.id] });
  assert.equal(s.choice.kind, 'triggerTargets');
  assert.equal(s.choice.entry.effects[0].amount, 100);
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [ref(s.objects[enemy.id])] } });
  s.objects[ship.id].chargeCounters = 0;
  s = settle(s);
  assert.equal(s.objects[enemy.id].zone, 'graveyard');
  assert.equal(s.events.filter((e) => e.type === 'triggered' && e.objectId === ship.id).length, 1);
});

test('Debris, Warmaker and Pinnacle entry damage uses exact quantities and target restrictions', () => {
  let s = position();
  let result = castToEntry(s, 'Debris Field Crusher');
  s = result.s;
  assert.equal(s.choice.kind, 'triggerTarget');
  s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
  s = settle(s);
  assert.equal(s.players[1].life, 17);
  assert.equal(definition(s, s.objects[result.id]).activated, undefined);
  const enemy = put(s, 'Yargle and Multani', 1);
  put(s, 'Wurmwall Sweeper');
  result = castToEntry(s, 'Warmaker Gunship');
  s = result.s;
  assert.deepEqual(
    s.choice.targets.map((r) => r.id),
    [enemy.id],
  );
  s = act(s, 'chooseTriggerTarget', { target: ref(s.objects[enemy.id]) });
  put(s, 'Robot Token');
  s = settle(s);
  assert.equal(s.objects[enemy.id].damage, 4); // Debris, Wurmwall, Warmaker itself, Robot.
  result = castToEntry(s, 'Pinnacle Kill-Ship');
  s = result.s;
  assert.equal(s.choice.kind, 'triggerTargets');
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [] } });
  s = settle(s);
  assert.equal(s.objects[enemy.id].damage, 4);
});

test('Extinguisher destroys its target then deals four to every creature; losing its only target counters the whole trigger', () => {
  for (const fizzle of [false, true]) {
    let s = position();
    const victim = put(s, 'Forest', 1),
      bear = put(s, 'Grizzly Bears'),
      giant = put(s, 'Yargle and Multani', 1);
    const result = castToEntry(s, 'Extinguisher Battleship');
    s = result.s;
    s = act(s, 'chooseTriggerTarget', { target: ref(s.objects[victim.id]) });
    if (fizzle) move(s, s.objects[victim.id], 'hand');
    s = settle(s);
    assert.equal(s.objects[bear.id].zone, fizzle ? 'battlefield' : 'graveyard');
    assert.equal(s.objects[giant.id].damage, fizzle ? 0 : 4);
    assert.equal(s.objects[result.id].zone, 'battlefield');
    assert.equal(s.objects[result.id].damage, 0);
  }
});

test('Infinite Guideline counts multicolored permanents including itself once, creates tapped Robots, and unlocks the attack draw', () => {
  let s = position();
  put(s, 'Yargle and Multani');
  put(s, 'Grizzly Bears');
  put(s, 'Yargle and Multani', 1);
  const result = castToEntry(s, 'Infinite Guideline Station');
  s = settle(result.s);
  const robots = Object.values(s.objects).filter(
    (o) => o.name === 'Robot Token' && o.zone === 'battlefield',
  );
  assert.equal(robots.length, 2);
  assert.ok(robots.every((o) => o.tapped));
  const ship = s.objects[result.id];
  assert.equal(definition(s, ship).triggers, undefined);
  ship.chargeCounters = 12;
  ship.controlledSince = 0;
  const before = s.players[0].hand.length;
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: 0 };
  s = settle(act(s, 'attackers', { cards: [ship.id] }));
  assert.equal(s.players[0].hand.length, before + 2);
});

test('Rescue accepts own creature or enchantment graveyard cards and restores them to the battlefield', () => {
  let s = position();
  const enchantment = put(s, 'Glorious Anthem', 0, 'graveyard'),
    creature = put(s, 'Grizzly Bears', 0, 'graveyard');
  const enemy = put(s, 'Grizzly Bears', 1, 'graveyard'),
    land = put(s, 'Forest', 0, 'graveyard');
  const result = castToEntry(s, 'Rescue Skiff');
  s = result.s;
  assert.deepEqual(
    new Set(s.choice.targets.map((r) => r.id)),
    new Set([enchantment.id, creature.id]),
  );
  for (const bad of [enemy, land])
    assert.equal(
      dispatch(s, { type: 'chooseTriggerTarget', player: 0, target: ref(bad) }).ok,
      false,
    );
  s = settle(act(s, 'chooseTriggerTarget', { target: ref(s.objects[enchantment.id]) }));
  assert.equal(s.objects[enchantment.id].zone, 'battlefield');
});

test('Specimen Freighter excludes animated Spacecraft from its optional bounce, and its granted attack mills the defender', () => {
  let s = position();
  const a = put(s, 'Grizzly Bears', 1),
    b = put(s, 'Savannah Lions', 1),
    excluded = put(s, 'Wurmwall Sweeper', 1);
  excluded.chargeCounters = 4;
  const result = castToEntry(s, 'Specimen Freighter');
  s = result.s;
  assert.equal(
    dispatch(s, { type: 'chooseTriggerTargets', player: 0, targets: { chosen: [ref(excluded)] } })
      .ok,
    false,
  );
  s = settle(act(s, 'chooseTriggerTargets', { targets: { chosen: [ref(a), ref(b)] } }));
  assert.equal(s.objects[a.id].zone, 'hand');
  assert.equal(s.objects[b.id].zone, 'hand');
  assert.equal(s.objects[excluded.id].zone, 'battlefield');
  const ship = s.objects[result.id];
  ship.chargeCounters = 9;
  ship.controlledSince = 0;
  const library = s.players[1].library.length;
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: 0 };
  s = settle(act(s, 'attackers', { cards: [ship.id] }));
  assert.equal(s.players[1].library.length, library - 4);
});

test('Susurian sacrifices only nontoken creatures, while Seriema searches legendary creatures and protects only other tapped legends at seven', () => {
  let s = position();
  const creature = put(s, 'Grizzly Bears', 1),
    token = put(s, 'Robot Token', 1);
  const result = castToEntry(s, 'Susurian Dirgecraft');
  s = settle(result.s);
  assert.equal(s.objects[creature.id].zone, 'graveyard');
  assert.equal(s.objects[token.id].zone, 'battlefield');
  const legend = put(s, 'Yargle and Multani', 0, 'library'),
    ordinary = put(s, 'Grizzly Bears', 0, 'library');
  const bird = castToEntry(s, 'The Seriema');
  s = bird.s;
  s = act(s, 'pass');
  s = act(s, 'pass');
  assert.equal(s.choice.kind, 'librarySearch');
  assert.ok(s.choice.cards.includes(legend.id));
  assert.equal(s.choice.cards.includes(ordinary.id), false);
  s = settle(s);
  const target = put(s, 'Yargle and Multani');
  target.tapped = true;
  const other = put(s, 'Grizzly Bears');
  other.tapped = true;
  const ship = s.objects[bird.id];
  ship.chargeCounters = 6;
  assert.equal(keywords(s, target).includes('indestructible'), false);
  ship.chargeCounters = 7;
  ship.tapped = true;
  assert.equal(keywords(s, target).includes('indestructible'), true);
  assert.equal(keywords(s, ship).includes('indestructible'), false);
  assert.equal(keywords(s, other).includes('indestructible'), false);
  target.tapped = false;
  assert.equal(keywords(s, target).includes('indestructible'), false);
});

test('Uthros draws two then discards one and Wurmwall offers exactly two surveilled cards', () => {
  let s = position();
  const before = s.players[0].hand.length,
    library = s.players[0].library.length;
  let result = castToEntry(s, 'Uthros Scanship');
  s = settle(result.s);
  assert.equal(s.players[0].hand.length, before + 1);
  assert.equal(s.players[0].library.length, library - 2);
  assert.equal(s.players[0].graveyard.length, 1);
  result = castToEntry(s, 'Wurmwall Sweeper');
  s = result.s;
  s = act(s, 'pass');
  s = act(s, 'pass');
  assert.equal(s.choice.kind, 'libraryOrder');
  assert.equal(s.choice.cards.length, 2);
  const cards = [...s.choice.cards];
  s = act(s, 'orderLibrary', { top: [], rest: cards });
  assert.ok(cards.every((id) => s.objects[id].zone === 'graveyard'));
});

test('Kavaron retains red mana below threshold, enters tapped, and can sacrifice itself for the unlocked Robot and team haste', () => {
  let s = position();
  const land = put(s, 'Kavaron, Memorial World', 0, 'hand');
  s = act(s, 'playLand', { card: land.id });
  assert.equal(s.objects[land.id].tapped, true);
  s.objects[land.id].tapped = false;
  assert.ok(
    legalActions(s, 0).some((a) => a.type === 'tapMana' && a.card === land.id && a.color === 'R'),
  );
  assert.equal(definition(s, s.objects[land.id]).activated, undefined);
  s.objects[land.id].chargeCounters = 12;
  s.players[0].mana.R = 2;
  s = act(s, 'activate', { card: land.id, ability: 0, sacrifices: [ref(s.objects[land.id])] });
  assert.equal(s.objects[land.id].zone, 'graveyard');
  s = settle(s);
  const robot = Object.values(s.objects).find(
    (o) => o.name === 'Robot Token' && o.zone === 'battlefield',
  );
  assert.deepEqual(stats(s, robot), { power: 3, toughness: 2 });
  assert.ok(keywords(s, robot).includes('haste'));
});

test('charge participates in an actual resolving counter-removal choice and immediately leaves combat', () => {
  let s = position();
  const ship = put(s, 'Wurmwall Sweeper'),
    bear = put(s, 'Grizzly Bears');
  ship.chargeCounters = 4;
  s.combat.attackers = [ref(ship)];
  const before = s.players[0].hand.length;
  resolveEffects(
    s,
    entry(ship, [
      { op: 'removeCounterTrigger', selector: 'creature', effects: [{ op: 'draw', count: 1 }] },
    ]),
  );
  assert.equal(s.choice.kind, 'removeCounter');
  assert.ok(s.choice.counters.includes('charge'));
  s = act(s, 'chooseCounter', { counter: 'charge' });
  assert.equal(s.objects[ship.id].chargeCounters, 3);
  assert.equal(s.combat.attackers.length, 0);
  s.objects[ship.id].chargeCounters = 4;
  s = settle(s);
  assert.equal(s.combat.attackers.length, 0);
  assert.equal(s.players[0].hand.length, before + 1);
});

test('countering station keeps the tapped cost paid and places no charge counters', () => {
  let s = position();
  const ship = put(s, 'Wurmwall Sweeper'),
    bear = put(s, 'Grizzly Bears');
  s = station(s, ship.id, bear.id);
  resolveEffects(s, {
    ...entry(s.objects[ship.id], [{ op: 'counterAbility' }]),
    target: { kind: 'stack', id: s.stack[0].id },
  });
  assert.equal(s.objects[bear.id].tapped, true);
  assert.equal(s.objects[ship.id].chargeCounters, undefined);
  assert.equal(s.stack.length, 0);
});

test('a payer that remains on the battlefield but stops being a creature contributes zero, not stale power', () => {
  let s = position();
  const ship = put(s, 'Wurmwall Sweeper'),
    bear = put(s, 'Grizzly Bears');
  s = station(s, ship.id, bear.id);
  addModifier(s, {
    objectId: bear.id,
    incarnation: bear.incarnation,
    enchantmentOnly: true,
    expires: s.turn,
  });
  s = settle(s);
  assert.equal(s.objects[ship.id].chargeCounters ?? 0, 0);
});

test('an internal same-resolution remove-then-restore sequence cannot preserve combat membership', () => {
  let s = position();
  const ship = put(s, 'Wurmwall Sweeper'),
    payer = put(s, 'Grizzly Bears');
  ship.chargeCounters = 4;
  s.combat.attackers = [ref(ship)];
  // Authored cards cannot put stationCharge into their effects. This internal
  // continuation fixture proves removal happens before the next instruction,
  // even when that instruction restores creature status before the SBA scan.
  resolveEffects(s, {
    ...entry(ship, [
      { op: 'removeCounterTrigger', selector: 'creature', effects: [{ op: 'draw', count: 1 }] },
      { op: 'stationCharge' },
    ]),
    stationPayer: ref(payer),
    stationPower: 2,
  });
  assert.equal(s.choice.kind, 'removeCounter');
  s = act(s, 'chooseCounter', { counter: 'charge' });
  assert.equal(s.objects[ship.id].chargeCounters, 5);
  assert.equal(definition(s, s.objects[ship.id]).type, 'creature');
  assert.equal(s.combat.attackers.length, 0);
  s = settle(s);
  assert.equal(s.combat.attackers.length, 0);
});
