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
  saddleProblem,
  saddlePlan,
  tapPower,
  crewPlan,
  createRegistry,
} from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { move, notifyTriggers } from '../packages/engine/src/model.js';
import { finishCleanup } from '../packages/engine/src/turn.js';
import { createSession } from '../packages/simulation/session.js';
import { fixture, put, act, resolve } from '../packages/engine/test/helpers.js';
import {
  saddleNames,
  saddleSources,
  saddleDefinitions,
  saddleCatalog,
  saddleIdentities,
  saddlePosition,
} from './helpers/saddle-catalog.js';
function position(extra = {}) {
  const s = fixture();
  s.catalog = createRegistry({ ...saddleCatalog, ...extra });
  return s;
}
function settle(s) {
  for (let i = 0; i < 100 && (s.choice || s.stack.length || s.resolving); i++) {
    const p = s.choice?.player ?? s.priority;
    s = act(
      s,
      s.choice ? chooseBotCommand(s, p).type : 'pass',
      s.choice ? chooseBotCommand(s, p) : {},
    );
  }
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 0);
  assert.equal(s.resolving, null);
  return s;
}
function saddled(s, id, cards = null) {
  return settle(act(s, 'saddle', { card: id, cards: cards ?? saddlePlan(s, 0, id) }));
}
function attack(s, id) {
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: 0 };
  return act(s, 'attackers', { cards: [id] });
}
const validate = new Ajv({ allErrors: true, strict: true }).compile(
  JSON.parse(await readFile(new URL('../packages/cards/schema/card.schema.json', import.meta.url))),
);

test('21 complete Mount sources and four exact tokens validate and round-trip', () => {
  const idsByName = Object.fromEntries(
    Object.entries(saddleIdentities).map(([id, name]) => [name, id]),
  );
  for (const source of saddleSources) {
    assert.equal(validate(source), true, `${source.name}: ${JSON.stringify(validate.errors)}`);
    const compiled = compileCard(source, { identities: saddleIdentities });
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    const round = compileCard(
      sourceFromDefinition(compiled.definition, { id: source.id, idsByName }),
      { identities: saddleIdentities },
    );
    assert.equal(round.ok, true, JSON.stringify(round.diagnostics));
    assert.deepEqual(round.definition, compiled.definition);
  }
});
for (const name of saddleNames)
  test(`${name}: cast, all ETB, saddle and full attack ability execute`, () => {
    let s = position();
    for (const p of s.players) for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) p.mana[c] = 30;
    for (let i = 0; i < 6; i++) put(s, 'Grizzly Bears');
    put(s, 'Grizzly Bears', 1);
    put(s, 'Plains', 0, 'library');
    const mount = put(s, name, 0, 'hand');
    s = settle(act(s, 'cast', { card: mount.id }));
    s = saddled(s, mount.id);
    assert.equal(s.objects[mount.id].saddledTurn, s.turn);
    s.objects[mount.id].controlledSince = 0;
    s = settle(attack(s, mount.id));
    assert.equal(s.objects[mount.id].zone, 'battlefield');
  });

test('saddle costs use other untapped creatures, allow summoning sickness and a tapped Mount, and reject atomically', () => {
  let s = position();
  const mount = put(s, 'Brightfield Glider', 0, 'battlefield', { ready: false }),
    bear = put(s, 'Grizzly Bears', 0, 'battlefield', { ready: false }),
    lion = put(s, 'Savannah Lions', 0, 'battlefield', { ready: false }),
    enemy = put(s, 'Grizzly Bears', 1),
    hand = put(s, 'Grizzly Bears', 0, 'hand');
  mount.tapped = true;
  for (const cards of [
    [],
    [mount.id, bear.id],
    [bear.id, bear.id],
    [enemy.id, bear.id],
    [hand.id, bear.id],
    ['missing'],
    [bear.id],
  ]) {
    const before = structuredClone(s),
      r = dispatch(s, { type: 'saddle', player: 0, card: mount.id, cards });
    assert.equal(r.ok, false, JSON.stringify(cards));
    assert.deepEqual(s, before);
  }
  s = act(s, 'saddle', { card: mount.id, cards: [bear.id, lion.id] });
  assert.equal(s.objects[bear.id].tapped, true);
  assert.equal(s.objects[lion.id].tapped, true);
  assert.equal(s.objects[mount.id].saddledTurn, undefined);
  assert.equal(s.stack.at(-1).effects[0].op, 'becomeSaddled');
  s = settle(s);
  assert.equal(s.objects[mount.id].saddledTurn, s.turn);
  assert.equal(s.objects[mount.id].tapped, true);
  assert.deepEqual(stats(s, s.objects[mount.id]), { power: 1, toughness: 1 });
});

test('saddle only at sorcery timing, with priority and empty stack', () => {
  const base = position(),
    mount = put(base, 'Alacrian Jaguar');
  put(base, 'Grizzly Bears');
  for (const mutate of [
    (s) => (s.step = 'beginCombat'),
    (s) => (s.step = 'attackers'),
    (s) => (s.active = 1),
    (s) => (s.priority = 1),
    (s) => s.stack.push({ id: 'x' }),
    (s) => (s.choice = { kind: 'attackers', player: 0 }),
  ]) {
    const s = structuredClone(base);
    mutate(s);
    assert.equal(saddlePlan(s, 0, mount.id), null);
    assert.ok(saddleProblem(s, 0, mount.id, []));
  }
  base.step = 'main2';
  assert.ok(saddlePlan(base, 0, mount.id));
});

test('actual total power includes negatives, zero-power overpayment and Pilot bonus only for Mounts/Vehicles', () => {
  const s = position(),
    mount = put(s, 'Brightfield Glider'),
    pilot = put(s, 'Pilot Token'),
    bear = put(s, 'Grizzly Bears'),
    wall = put(s, 'Ornithopter');
  assert.equal(stats(s, pilot).power, 1);
  assert.equal(tapPower(s, pilot, mount.id, 'saddle'), 3);
  assert.equal(saddleProblem(s, 0, mount.id, [pilot.id, wall.id]), null);
  s.modifiers.push({
    objectId: bear.id,
    incarnation: bear.incarnation,
    power: -4,
    toughness: 0,
    expires: s.turn,
  });
  assert.ok(saddleProblem(s, 0, mount.id, [pilot.id, bear.id]));
  assert.deepEqual(saddlePlan(s, 0, mount.id), [pilot.id]);
  mount.definitionOverride = { ...definition(s, mount), subtypes: ['Cat'] };
  assert.equal(tapPower(s, pilot, mount.id, 'saddle'), 1);
  assert.equal(saddlePlan(s, 0, mount.id), null);
  const vehicle = put(s, 'Clamorous Ironclad');
  assert.equal(tapPower(s, pilot, vehicle.id, 'crew'), 3);
  assert.ok(crewPlan(s, 0, vehicle.id));
});

test('tap-cost triggers go above the saddle ability and no saddled state exists until resolution', () => {
  const watcher = {
    ...saddleCatalog['Grizzly Bears'],
    name: 'Tap Observer',
    triggers: [
      {
        event: { event: 'tap', controller: 'you', filter: { type: 'creature' } },
        effects: [{ op: 'gainLife', amount: 1 }],
      },
    ],
  };
  let s = position({ 'Tap Observer': watcher }),
    mount = put(s, 'Brightfield Glider'),
    a = put(s, 'Grizzly Bears'),
    b = put(s, 'Savannah Lions');
  put(s, 'Tap Observer');
  s = act(s, 'saddle', { card: mount.id, cards: [a.id, b.id] });
  s = settle(s);
  assert.equal(s.players[0].life, 22);
  assert.equal(s.objects[mount.id].saddledTurn, s.turn);
});

test('designation survives control/ability/type change but not departure, blink or cleanup', () => {
  let s = position(),
    mount = put(s, 'Alacrian Jaguar'),
    pilot = put(s, 'Pilot Token');
  s = act(s, 'saddle', { card: mount.id, cards: [pilot.id] });
  s.objects[mount.id].controller = 1;
  s.modifiers.push({
    objectId: mount.id,
    incarnation: mount.incarnation,
    removeAbilities: true,
    expires: s.turn,
  });
  s = settle(s);
  assert.equal(s.objects[mount.id].saddledTurn, s.turn);
  assert.equal(definition(s, s.objects[mount.id]).saddle, undefined);
  finishCleanup(s);
  assert.equal(s.objects[mount.id].saddledTurn, undefined);
  s = position();
  const m = put(s, 'Alacrian Jaguar'),
    p = put(s, 'Pilot Token');
  s = act(s, 'saddle', { card: m.id, cards: [p.id] });
  move(s, s.objects[m.id], 'exile');
  move(s, s.objects[m.id], 'battlefield');
  s = settle(s);
  assert.equal(s.objects[m.id].saddledTurn, undefined);
  s.objects[p.id].tapped = false;
  s = saddled(s, m.id, [p.id]);
  move(s, s.objects[m.id], 'graveyard');
  assert.equal(s.objects[m.id].saddledTurn, undefined);
});

test('attacks while saddled checks occurrence only; source loss does not erase a queued token trigger', () => {
  let s = position(),
    mount = put(s, 'Gilded Ghoda');
  put(s, 'Grizzly Bears');
  s = settle(attack(s, mount.id));
  assert.equal(Object.values(s.objects).filter((o) => o.name === 'Treasure Token').length, 0);
  s.step = 'main1';
  s.objects[mount.id].tapped = false;
  s = saddled(s, mount.id);
  s = attack(s, mount.id);
  assert.equal(s.stack.length, 1);
  move(s, s.objects[mount.id], 'graveyard');
  s = settle(s);
  assert.equal(
    Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.name === 'Treasure Token')
      .length,
    1,
  );
  assert.equal(saddleCatalog['Gilded Ghoda'].mana, undefined);
});

test('a genuine intervening-if saddled condition rechecks unlike occurrence-only triggerCondition', () => {
  const def = {
    ...saddleCatalog['Gilded Ghoda'],
    name: 'Conditional Mount',
    triggers: [
      {
        event: { event: 'attack', object: 'source' },
        condition: { kind: 'sourceSaddled' },
        effects: [{ op: 'gainLife', amount: 3 }],
      },
    ],
  };
  let s = position({ 'Conditional Mount': def }),
    mount = put(s, 'Conditional Mount');
  put(s, 'Grizzly Bears');
  s = saddled(s, mount.id);
  s = attack(s, mount.id);
  move(s, s.objects[mount.id], 'graveyard');
  s = settle(s);
  assert.equal(s.players[0].life, 20);
});

test('Stubborn Burrowfiend mills before counting, triggers once per turn, resets on new incarnation', () => {
  let s = position(),
    mount = put(s, 'Stubborn Burrowfiend'),
    pilot = put(s, 'Pilot Token');
  const a = put(s, 'Grizzly Bears', 0, 'library'),
    b = put(s, 'Savannah Lions', 0, 'library');
  s.players[0].library = s.players[0].library.filter((id) => id !== a.id && id !== b.id);
  s.players[0].library.unshift(a.id, b.id);
  s = saddled(s, mount.id, [pilot.id]);
  assert.equal(s.players[0].graveyard.length, 2);
  assert.deepEqual(stats(s, s.objects[mount.id]), { power: 4, toughness: 4 });
  s.objects[pilot.id].tapped = false;
  s = saddled(s, mount.id, [pilot.id]);
  assert.equal(s.players[0].graveyard.length, 2);
  move(s, s.objects[mount.id], 'exile');
  move(s, s.objects[mount.id], 'battlefield');
  s.objects[pilot.id].tapped = false;
  s = saddled(s, mount.id, [pilot.id]);
  assert.equal(s.players[0].graveyard.length, 4);
});

test('saddle source contract rejects missing, duplicate, fractional and unknown extension fields', () => {
  const source = saddleSources.find((s) => s.name === 'Alacrian Jaguar');
  for (const abilities of [
    [{ kind: 'saddle' }],
    [{ kind: 'saddle', power: 1.5 }],
    [{ kind: 'saddle', power: -1 }],
    [
      { kind: 'saddle', power: 1 },
      { kind: 'saddle', power: 2 },
    ],
    [{ kind: 'saddle', power: 1, animate: true }],
  ])
    assert.equal(compileCard({ ...source, abilities }).ok, false);
});

test('bot saddles once before combat and replay plus opaque sessions preserve all selected payers', () => {
  let s = saddlePosition();
  const before = exportReplay(s),
    action = legalActions(s, 0).find((a) => a.type === 'saddle');
  // The scripted position can include a fresh Mount; the policy waits until attack-ready.
  const botState = structuredClone(s);
  botState.objects[action.card].controlledSince = 0;
  assert.equal(chooseBotCommand(botState, 0).type, 'saddle');
  s = settle(act(s, 'saddle', action));
  assert.deepEqual(replay(exportReplay(s)), s);
  assert.notEqual(chooseBotCommand(s, 0)?.type, 'saddle');
  const session = createSession(before.config);
  for (const [i, command] of before.commands.entries()) {
    const ctx = session.context(),
      prior = replay({ ...before, commands: before.commands.slice(0, i) });
    const action =
      command.type === 'attackers'
        ? command
        : ctx.actions.find(
            (a) =>
              a.type === command.type &&
              (!command.card ||
                ctx.observation.objects[a.card]?.name === prior.objects[command.card].name),
          );
    assert.ok(action, command.type);
    assert.equal(session.step(action).ok, true);
  }
  const command = session.context().actions.find((a) => a.type === 'saddle');
  assert.match(command.card, /^object:/);
  assert.ok(command.cards.every((id) => id.startsWith('object:')));
  assert.equal(session.step(command).ok, true);
});

test('repeat resolution records history but no fresh becomes event; lost abilities and control do not reset the first event', () => {
  let s = position(),
    mount = put(s, 'Stubborn Burrowfiend'),
    pilot = put(s, 'Pilot Token');
  s = act(s, 'saddle', { card: mount.id, cards: [pilot.id] });
  const removal = {
    objectId: mount.id,
    incarnation: mount.incarnation,
    removeAbilities: true,
    expires: s.turn,
  };
  s.modifiers.push(removal);
  s = settle(s);
  assert.equal(s.players[0].graveyard.length, 0);
  assert.equal(s.objects[mount.id].saddleHistory.count, 1);
  s.modifiers = s.modifiers.filter((m) => !m.removeAbilities);
  s.objects[pilot.id].tapped = false;
  s = saddled(s, mount.id, [pilot.id]);
  assert.equal(s.players[0].graveyard.length, 0);
  assert.equal(s.objects[mount.id].saddleHistory.count, 2);
  assert.equal(s.events.filter((e) => e.type === 'saddled').length, 1);
  assert.equal(s.events.filter((e) => e.type === 'saddleResolved').length, 2);
  s.objects[mount.id].controller = 1;
  s.objects[pilot.id].controller = 1;
  s.objects[pilot.id].tapped = false;
  s.active = 1;
  s.priority = 1;
  s = settle(act(s, 'saddle', { card: mount.id, cards: [pilot.id] }, 1));
  assert.equal(s.players[1].graveyard.length, 0);
  assert.equal(s.objects[mount.id].saddleHistory.count, 3);
});

for (const [name, power, toughness, granted] of [
  ['Alacrian Jaguar', 6, 6, []],
  ['Brightfield Glider', 2, 3, ['flying']],
  ['Quilled Charger', 5, 5, ['menace']],
  ['Venomsac Lagac', 2, 4, []],
  ['Trained Arynx', 3, 1, ['first strike']],
])
  test(`${name}: saddled attack applies exact stats and keywords until cleanup`, () => {
    let s = position(),
      mount = put(s, name);
    put(s, 'Grizzly Bears');
    put(s, 'Grizzly Bears');
    s = saddled(s, mount.id);
    s = settle(attack(s, mount.id));
    assert.deepEqual(stats(s, s.objects[mount.id]), { power, toughness });
    for (const keyword of granted) assert.ok(keywords(s, s.objects[mount.id]).includes(keyword));
    finishCleanup(s);
    assert.deepEqual(stats(s, s.objects[mount.id]), {
      power: saddleCatalog[name].power,
      toughness: saddleCatalog[name].toughness,
    });
    for (const keyword of granted)
      assert.equal(keywords(s, s.objects[mount.id]).includes(keyword), false);
  });

test('token Mounts create the exact full token characteristics; Mammoth also triggers on entering', () => {
  for (const [name, token, count] of [
    ['Autarch Mammoth', 'Green Elephant Token', 2],
    ['Bridled Bighorn', 'White Sheep Token', 1],
    ['Seraphic Steed', 'White Angel Token', 1],
    ['Gilded Ghoda', 'Treasure Token', 1],
  ]) {
    let s = position(),
      mount = put(s, name, 0, 'hand');
    for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[c] = 20;
    for (let i = 0; i < 3; i++) put(s, 'Grizzly Bears');
    s = settle(act(s, 'cast', { card: mount.id }));
    s = saddled(s, mount.id);
    s.objects[mount.id].controlledSince = 0;
    if (name === 'Gilded Ghoda')
      assert.equal(
        legalActions(s, 0).some((a) => a.type === 'tapMana' && a.card === mount.id),
        false,
      );
    s = settle(attack(s, mount.id));
    const created = Object.values(s.objects).filter(
      (o) => o.name === token && o.zone === 'battlefield',
    );
    assert.equal(created.length, count);
    if (token === 'White Angel Token') {
      assert.deepEqual(stats(s, created[0]), { power: 3, toughness: 3 });
      assert.deepEqual(keywords(s, created[0]), ['flying']);
    }
  }
});

test('Mustang untaps and grows, Sloth untaps every friendly creature and only grants itself indestructible', () => {
  for (const name of ['Brightfield Mustang', 'Unswerving Sloth']) {
    let s = position(),
      mount = put(s, name),
      a = put(s, 'Grizzly Bears'),
      b = put(s, 'Grizzly Bears'),
      enemy = put(s, 'Grizzly Bears', 1);
    enemy.tapped = true;
    s = saddled(s, mount.id, [a.id, b.id]);
    s = settle(attack(s, mount.id));
    assert.equal(s.objects[mount.id].tapped, false);
    if (name === 'Brightfield Mustang') {
      assert.equal(s.objects[mount.id].plusCounters, 1);
      assert.equal(s.objects[a.id].tapped, true);
    } else {
      assert.equal(s.objects[a.id].tapped, false);
      assert.equal(s.objects[b.id].tapped, false);
      assert.ok(keywords(s, s.objects[mount.id]).includes('indestructible'));
      assert.equal(keywords(s, s.objects[a.id]).includes('indestructible'), false);
    }
    assert.equal(s.objects[enemy.id].tapped, true);
  }
});

test('Bounding counts only other friendly creatures; Congregation counts all friendly Mounts at resolution; Drover grants team trample', () => {
  let s = position(),
    mount = put(s, 'Bounding Felidar'),
    a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears'),
    enemy = put(s, 'Grizzly Bears', 1);
  s = saddled(s, mount.id);
  s = settle(attack(s, mount.id));
  assert.equal(s.players[0].life, 22);
  assert.equal(s.objects[mount.id].plusCounters, 0);
  assert.equal(s.objects[a.id].plusCounters, 1);
  assert.equal(s.objects[b.id].plusCounters, 1);
  assert.equal(s.objects[enemy.id].plusCounters, 0);
  s = position();
  mount = put(s, 'Congregation Gryff');
  put(s, 'Alacrian Jaguar');
  put(s, 'Alacrian Jaguar', 1);
  put(s, 'Grizzly Bears');
  s = saddled(s, mount.id);
  s = attack(s, mount.id);
  put(s, 'Venomsac Lagac');
  s = settle(s);
  assert.deepEqual(stats(s, s.objects[mount.id]), { power: 4, toughness: 7 });
  s = position();
  mount = put(s, 'Drover Grizzly');
  a = put(s, 'Grizzly Bears');
  enemy = put(s, 'Grizzly Bears', 1);
  s = saddled(s, mount.id);
  s = settle(attack(s, mount.id));
  for (const id of [mount.id, a.id]) assert.ok(keywords(s, s.objects[id]).includes('trample'));
  assert.equal(keywords(s, s.objects[enemy.id]).includes('trample'), false);
});

test('Dracosaur can hit a player, Ornery has both combat-counter clauses and Lagorin targets up to two Mounts or Vehicles', () => {
  let s = position(),
    mount = put(s, 'Dracosaur Auxiliary');
  put(s, 'Alacrian Jaguar');
  s = saddled(s, mount.id);
  s = attack(s, mount.id);
  s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
  s = settle(s);
  assert.equal(s.players[1].life, 18);
  s = position();
  mount = put(s, 'Ornery Tumblewagg');
  const bear = put(s, 'Grizzly Bears');
  notifyTriggers(s, 'step', { step: 'beginCombat', player: 0 });
  s = act(s, 'pass');
  s = act(s, 'chooseTriggerTarget', { target: ref(bear) });
  s = settle(s);
  assert.equal(s.objects[bear.id].plusCounters, 1);
  s.priority = 0;
  s = saddled(s, mount.id);
  s = attack(s, mount.id);
  s = act(s, 'chooseTriggerTarget', { target: ref(s.objects[bear.id]) });
  s = settle(s);
  assert.equal(s.objects[bear.id].plusCounters, 2);
  s = position();
  mount = put(s, 'Lagorin, Soul of Alacria');
  const vehicle = put(s, 'Clamorous Ironclad', 1);
  put(s, 'Grizzly Bears');
  s = saddled(s, mount.id);
  s = attack(s, mount.id);
  s = act(s, 'chooseTriggerTargets', {
    targets: { mounts: [ref(s.objects[mount.id]), ref(vehicle)] },
  });
  s = settle(s);
  assert.equal(s.objects[mount.id].plusCounters, 1);
  assert.equal(s.objects[vehicle.id].plusCounters, 1);
});

test('Gloryheath searches only basic Plains and Sunmare only nonland permanents of mana value at most three', () => {
  for (const name of ['Gloryheath Lynx', 'Guardian Sunmare']) {
    let s = position(),
      mount = put(s, name);
    put(s, 'Alacrian Jaguar');
    const plains = put(s, 'Plains', 0, 'library'),
      forest = put(s, 'Forest', 0, 'library'),
      bear = put(s, 'Grizzly Bears', 0, 'library'),
      expensive = put(s, 'Alacrian Jaguar', 0, 'library'),
      instant = put(s, 'Giant Growth', 0, 'library');
    s = saddled(s, mount.id);
    s = attack(s, mount.id);
    s = resolve(s);
    assert.equal(s.choice.kind, 'librarySearch');
    const ids = s.choice.cards;
    if (name === 'Gloryheath Lynx') {
      assert.ok(ids.includes(plains.id));
      for (const o of [forest, bear, expensive, instant]) assert.equal(ids.includes(o.id), false);
    } else {
      assert.ok(ids.includes(bear.id));
      for (const o of [plains, forest, expensive, instant]) assert.equal(ids.includes(o.id), false);
      assert.deepEqual(saddleCatalog[name].ward, { mana: { generic: 2 } });
    }
  }
});

test('Gila exile permission lasts through the next controller turn, preserving normal land timing', () => {
  let s = position(),
    mount = put(s, 'Gila Courser');
  put(s, 'Grizzly Bears');
  const land = put(s, 'Plains', 0, 'library');
  s.players[0].library = s.players[0].library.filter((id) => id !== land.id);
  s.players[0].library.unshift(land.id);
  s = saddled(s, mount.id);
  s = settle(attack(s, mount.id));
  assert.equal(s.objects[land.id].zone, 'exile');
  assert.equal(s.objects[land.id].playPermission.untilNextTurn, 0);
  assert.equal(
    legalActions(s, 0).some((a) => a.type === 'playLand' && a.card === land.id),
    false,
  );
  finishCleanup(s);
  assert.ok(s.objects[land.id].playPermission);
  finishCleanup(s);
  assert.ok(s.objects[land.id].playPermission);
  finishCleanup(s);
  assert.equal(s.objects[land.id].playPermission, undefined);
});

test('countering saddle keeps tap costs paid and creates neither designation nor first-resolution history', () => {
  let s = position(),
    mount = put(s, 'Stubborn Burrowfiend'),
    pilot = put(s, 'Pilot Token'),
    tidebinder = put(s, "Tishana's Tidebinder", 1, 'hand');
  s.players[1].mana.U = 3;
  s = act(s, 'saddle', { card: mount.id, cards: [pilot.id] });
  const ability = s.stack.at(-1).id;
  s = act(s, 'pass');
  s = act(s, 'cast', { card: tidebinder.id });
  s = resolve(s);
  assert.equal(s.choice.kind, 'triggerTargets');
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [{ kind: 'stack', id: ability }] } });
  s = settle(s);
  assert.equal(s.objects[pilot.id].tapped, true);
  assert.equal(s.objects[mount.id].saddledTurn, undefined);
  assert.equal(s.objects[mount.id].saddleHistory, undefined);
  assert.equal(s.players[0].graveyard.length, 0);
  move(s, s.objects[tidebinder.id], 'graveyard');
  s.objects[pilot.id].tapped = false;
  s = saddled(s, mount.id, [pilot.id]);
  assert.equal(s.players[0].graveyard.length, 2);
  assert.equal(s.objects[mount.id].saddleHistory.count, 1);
});
