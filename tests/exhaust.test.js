import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { parseHTML } from 'linkedom';
import {
  abilityProblem,
  createRegistry,
  dispatch,
  legalActions,
  chooseBotCommand,
  playerView,
  ref,
  definition,
  hasKeyword,
  stats,
  validateDefinition,
  replay,
  exportReplay,
} from '../packages/engine/src/index.js';
import { move } from '../packages/engine/src/model.js';
import {
  enterBattlefieldBatch,
  resolveEffects,
  stabilize,
} from '../packages/engine/src/effects.js';
import { finishCleanup } from '../packages/engine/src/turn.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { put, act, resolve } from '../packages/engine/test/helpers.js';
import { createSession } from '../packages/simulation/session.js';
import { activatedAbilityButtons } from '../apps/web/ability-controls.js';
import {
  catalog,
  definitions,
  fixture,
  identities,
  idsByName,
  mechanics,
  oracleIds,
  names,
  sources,
} from './helpers/exhaust-catalog.js';
const used = (s, o, index = 0) =>
  s.objects[o.id].exhaustUses?.[index] === s.objects[o.id].incarnation;
const available = (s, o, index = 0, player = 0) =>
  legalActions(s, player).some(
    (a) => a.type === 'activate' && a.card === o.id && a.ability === index,
  );
function reject(s, command, pattern) {
  const before = structuredClone(s);
  const r = dispatch(s, { type: 'activate', player: 0, ability: 0, ...command });
  assert.equal(r.ok, false);
  if (pattern) assert.match(r.error.message, pattern);
  assert.deepEqual(s, before, 'failed activation is atomic');
}
function loseAbilities(s, o, source = o) {
  resolveEffects(s, {
    controller: 0,
    source: ref(source),
    target: ref(o),
    effects: [{ op: 'removeAbilities', until: 'endOfTurn' }],
  });
}
const tokens = (s) => Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.token);

test('12 exact Standard Exhaust sources and exact Dinosaur Dragon token validate and round trip', () => {
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
    JSON.parse(readFileSync(new URL('../packages/cards/schema/card.schema.json', import.meta.url))),
  );
  for (const source of sources) {
    assert.equal(validate(source), true, JSON.stringify(validate.errors));
    const d = definitions[source.name];
    assert.equal(d.text, source.rulesText);
    if (!d.token) {
      assert.equal(source.id, oracleIds[source.name]);
      assert.ok(d.activated.some((a) => a.exhaust));
    }
    const round = compileCard(sourceFromDefinition(d, { id: source.id, idsByName }), {
      mechanics,
      identities,
    });
    assert.equal(round.ok, true, JSON.stringify(round.diagnostics));
    assert.deepEqual(round.definition, d);
  }
  assert.equal(names.length, 12);
});

test('native/compiler contracts reject malformed Exhaust flags, mixed usage contracts, and mana production', () => {
  const base = definitions['Hazard of the Dunes'];
  for (const patch of [
    { exhaust: false },
    { exhaust: 1 },
    { exhaust: 'true' },
    { zone: 'graveyard' },
    { powerUp: true },
    { oncePerTurn: true },
    { loyalty: 0 },
  ]) {
    const card = structuredClone(base);
    Object.assign(card.activated[0], patch);
    assert.ok(validateDefinition(card).length, JSON.stringify(patch));
    const source = sourceFromDefinition(card, { id: 'test:invalid' });
    assert.equal(compileCard(source).ok, false);
  }
  for (const effects of [
    [{ op: 'addMana', mana: { G: 3 } }],
    [
      {
        op: 'conditional',
        condition: { kind: 'lifeAtMost', player: 'you', amount: 20 },
        then: [{ op: 'addMana', mana: { G: 3 } }],
      },
    ],
  ]) {
    const card = structuredClone(base);
    card.activated[0].effects = effects;
    assert.ok(validateDefinition(card).some((e) => e.includes('exhaust mana production')));
  }
});

for (const [name, index, amount] of [
  ['Hazard of the Dunes', 0, 3],
  ['Prowcatcher Specialist', 0, 2],
  ['Skystreak Engineer', 0, 2],
  ['Greenbelt Guardian', 1, 3],
])
  test(`${name}: full printed payment, counters, and a spent use with no entry-turn power-up discount`, () => {
    let s = fixture();
    const o = put(s, name, 0, 'hand');
    enterBattlefieldBatch(s, [{ object: o }]);
    const mana = definitions[name].activated[index].cost.mana;
    for (const color of Object.keys(s.players[0].mana)) s.players[0].mana[color] = 0;
    const total = Object.values(mana).reduce((a, b) => a + b, 0);
    const color = mana.G ? 'G' : mana.U ? 'U' : 'R';
    s.players[0].mana[color] = total - 1;
    reject(s, { card: o.id, ability: index }, /mana/i);
    s.players[0].mana[color]++;
    s = act(s, 'activate', { card: o.id, ability: index });
    assert.equal(s.players[0].mana[color], 0);
    assert.equal(s.objects[o.id].plusCounters, 0, 'no effect before resolution');
    assert.ok(used(s, o, index));
    reject(s, { card: o.id, ability: index }, /already been activated/);
    s = resolve(s);
    assert.equal(s.objects[o.id].plusCounters, amount);
    assert.ok(!available(s, o, index));
  });

test('Draconautics uses each distinct Exhaust independently and grants haste to only other controlled creatures', () => {
  let s = fixture();
  const source = put(s, 'Draconautics Engineer'),
    friend = put(s, 'Grizzly Bears'),
    foe = put(s, 'Grizzly Bears', 1);
  s = resolve(act(s, 'activate', { card: source.id, ability: 0 }));
  assert.ok(hasKeyword(s, s.objects[friend.id], 'haste'));
  assert.ok(!hasKeyword(s, s.objects[source.id], 'haste'));
  assert.ok(!hasKeyword(s, s.objects[foe.id], 'haste'));
  assert.equal(s.objects[source.id].plusCounters, 1);
  assert.ok(available(s, source, 1));
  s = resolve(act(s, 'activate', { card: source.id, ability: 1 }));
  const dragon = tokens(s)[0];
  assert.deepEqual(stats(s, dragon), { power: 4, toughness: 4 });
  assert.deepEqual(definition(s, dragon).subtypes, ['Dinosaur', 'Dragon']);
  assert.deepEqual(definition(s, dragon).color, ['R']);
  assert.ok(hasKeyword(s, dragon, 'flying'));
  assert.ok(!hasKeyword(s, dragon, 'haste'), 'later creatures are not retroactively affected');
  assert.ok(used(s, source, 0) && used(s, source, 1));
});

test('usage survives real turn cleanup, control changes, and ability loss/regain', () => {
  let s = fixture();
  const o = put(s, 'Draconautics Engineer');
  s = resolve(act(s, 'activate', { card: o.id, ability: 0 }));
  loseAbilities(s, s.objects[o.id]);
  assert.equal(definition(s, s.objects[o.id]).activated, undefined);
  finishCleanup(s);
  assert.ok(definition(s, s.objects[o.id]).activated);
  s.objects[o.id].controller = 1;
  assert.equal(s.priority, 1);
  reject(s, { card: o.id, ability: 0, player: 1 }, /already been activated/);
  assert.ok(available(s, o, 1, 1));
  s.objects[o.id].controller = 0;
  s.priority = 0;
  reject(s, { card: o.id, ability: 0 }, /already been activated/);
});

test('new incarnations and copy tokens have fresh uses without copying the original exhaustion', () => {
  let s = fixture();
  const o = put(s, 'Prowcatcher Specialist');
  s = resolve(act(s, 'activate', { card: o.id, ability: 0 }));
  resolveEffects(s, {
    controller: 0,
    target: ref(s.objects[o.id]),
    effects: [{ op: 'copyToken', count: 1 }],
  });
  const copy = tokens(s)[0];
  assert.equal(copy.exhaustUses, undefined);
  assert.equal(copy.plusCounters, 0);
  assert.ok(available(s, copy));
  s = resolve(act(s, 'activate', { card: copy.id, ability: 0 }));
  assert.ok(used(s, copy));
  const oldIncarnation = s.objects[o.id].incarnation;
  move(s, s.objects[o.id], 'exile');
  move(s, s.objects[o.id], 'battlefield');
  assert.ok(s.objects[o.id].incarnation > oldIncarnation);
  assert.equal(s.objects[o.id].exhaustUses, undefined);
  assert.ok(available(s, o));
  s = resolve(act(s, 'activate', { card: o.id, ability: 0 }));
  assert.equal(s.objects[o.id].plusCounters, 2);
});

test('a countered activation remains spent, including after the source regains its abilities', () => {
  let s = fixture();
  const o = put(s, 'Draconautics Engineer'),
    tidebinder = put(s, "Tishana's Tidebinder", 1);
  s = act(s, 'activate', { card: o.id, ability: 1 });
  resolveEffects(s, {
    controller: 1,
    source: ref(tidebinder),
    target: { kind: 'stack', id: s.stack.at(-1).id },
    effects: [{ op: 'counterAbility', removeSourceAbilities: true }],
  });
  assert.equal(s.stack.length, 0);
  assert.equal(tokens(s).length, 0);
  assert.equal(definition(s, s.objects[o.id]).activated, undefined);
  move(s, s.objects[tidebinder.id], 'hand');
  reject(s, { card: o.id, ability: 1 }, /already been activated/);
  assert.ok(available(s, o, 0));
});

test('invalid source, index, priority, target, and payment leave no exhausted marker or cost mutation', () => {
  const s = fixture(),
    o = put(s, 'Rebellious Captives'),
    land = put(s, 'Forest'),
    creature = put(s, 'Grizzly Bears'),
    opposing = put(s, 'Forest', 1);
  for (const command of [
    { card: 'missing' },
    { card: o.id, ability: 99 },
    { card: o.id, player: 1, target: ref(land) },
    { card: o.id },
    { card: o.id, target: ref(creature) },
    { card: o.id, target: ref(opposing) },
    { card: o.id, target: { ...ref(land), incarnation: 99 } },
  ])
    reject(s, command);
  for (const color of Object.keys(s.players[0].mana)) s.players[0].mana[color] = 0;
  reject(s, { card: o.id, target: ref(land) }, /mana/i);
  assert.equal(o.exhaustUses, undefined);
});

for (const [name, tokenName, amount] of [
  ['Camera Launcher', 'Flying Thopter Token', 1],
  ['Stampeding Scurryfoot', 'Green Elephant Token', 1],
])
  test(`${name}: exact token creation still resolves after source leaves, without touching its new incarnation`, () => {
    let s = fixture();
    const o = put(s, name);
    s = act(s, 'activate', { card: o.id, ability: 0 });
    const locked = structuredClone(s.stack.at(-1).sourceDefinition);
    assert.equal(locked.name, name);
    move(s, s.objects[o.id], 'hand');
    move(s, s.objects[o.id], 'battlefield');
    s = resolve(s);
    assert.equal(s.objects[o.id].plusCounters, 0);
    assert.equal(tokens(s).length, amount);
    assert.equal(tokens(s)[0].name, tokenName);
    assert.ok(available(s, o));
  });

test('Keen Buccaneer draws, pauses for an actual discard, then adds its counter only once', () => {
  let s = fixture();
  const o = put(s, 'Keen Buccaneer');
  s = resolve(act(s, 'activate', { card: o.id, ability: 0 }));
  assert.equal(s.choice.kind, 'discardEffect');
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(s.objects[o.id].plusCounters, 0);
  assert.ok(used(s, o));
  s = act(s, 'discardEffect', { cards: [s.players[0].hand[0]] });
  assert.equal(s.objects[o.id].plusCounters, 1);
  assert.equal(s.players[0].hand.length, 0);
  assert.ok(hasKeyword(s, s.objects[o.id], 'vigilance'));
  reject(s, { card: o.id }, /already been activated/);
});

test('Greenbelt ordinary trample activation remains repeatable before and after exhausting', () => {
  let s = fixture();
  const o = put(s, 'Greenbelt Guardian'),
    enemy = put(s, 'Grizzly Bears', 1);
  s = resolve(act(s, 'activate', { card: o.id, ability: 0, target: ref(enemy) }));
  assert.ok(hasKeyword(s, s.objects[enemy.id], 'trample'));
  s = resolve(act(s, 'activate', { card: o.id, ability: 1 }));
  s = resolve(act(s, 'activate', { card: o.id, ability: 0, target: ref(s.objects[o.id]) }));
  assert.ok(hasKeyword(s, s.objects[o.id], 'trample'));
  assert.ok(available(s, o, 0));
  assert.ok(!available(s, o, 1));
});

test('Pacesetter double strike expires, while its counter and exhausted use persist', () => {
  let s = fixture();
  const o = put(s, 'Pacesetter Paragon');
  s = resolve(act(s, 'activate', { card: o.id, ability: 0 }));
  assert.ok(hasKeyword(s, s.objects[o.id], 'double strike'));
  finishCleanup(s);
  assert.ok(!hasKeyword(s, s.objects[o.id], 'double strike'));
  assert.equal(s.objects[o.id].plusCounters, 1);
  assert.ok(used(s, o));
});

test('Mai has real prowess and a persistent double-strike counter obeying ability-loss timestamps', () => {
  let s = fixture();
  const o = put(s, 'Mai, Jaded Edge'),
    shock = put(s, 'Shock', 0, 'hand');
  s = act(s, 'cast', { card: shock.id, target: { kind: 'player', id: 1 } });
  s = resolve(s); // prowess first
  assert.equal(stats(s, s.objects[o.id]).power, 2);
  s = resolve(s);
  s = act(s, 'activate', { card: o.id, ability: 0 });
  loseAbilities(s, s.objects[o.id]);
  s = resolve(s);
  assert.equal(s.objects[o.id].keywordCounters['double strike'], 1);
  assert.ok(
    hasKeyword(s, s.objects[o.id], 'double strike'),
    'later counter grants the ability despite earlier loss',
  );
  loseAbilities(s, s.objects[o.id]);
  assert.ok(!hasKeyword(s, s.objects[o.id], 'double strike'));
  finishCleanup(s);
  assert.ok(hasKeyword(s, s.objects[o.id], 'double strike'));
  assert.equal(stats(s, s.objects[o.id]).power, 1);
  assert.ok(used(s, o));
});

test('Liliana preserves sorcery timing and both creature/planeswalker graveyard selectors', () => {
  for (const name of ['Grizzly Bears', 'Chandra, Torch of Defiance']) {
    let s = fixture();
    const o = put(s, 'Liliana the Repentant'),
      target = put(s, name, 0, 'graveyard'),
      other = put(s, 'Grizzly Bears', 1, 'graveyard'),
      artifact = put(s, 'Soul-Guide Lantern', 0, 'graveyard');
    s.active = 1;
    reject(s, { card: o.id, target: ref(target) }, /sorcery/);
    s.active = 0;
    s.step = 'beginCombat';
    reject(s, { card: o.id, target: ref(target) }, /sorcery/);
    s.step = 'main1';
    reject(s, { card: o.id, target: ref(other) }, /target/);
    reject(s, { card: o.id, target: ref(artifact) }, /target/);
    const spell = put(s, 'Shock', 0, 'hand');
    s = act(s, 'cast', { card: spell.id, target: { kind: 'player', id: 1 } });
    reject(s, { card: o.id, target: ref(target) }, /sorcery/);
    s = resolve(s);
    const before = s.players[0].library.length;
    s = resolve(act(s, 'activate', { card: o.id, ability: 0, target: ref(target) }));
    assert.equal(s.objects[target.id].zone, 'battlefield');
    assert.equal(s.objects[o.id].plusCounters, 1);
    assert.equal(s.stack.length, 1, 'return triggers another-permanent mill');
    s = resolve(s);
    assert.equal(s.players[0].library.length, before - 2);
    assert.equal(s.objects[artifact.id].zone, 'graveyard');
  }
});

test('Liliana entry excludes herself and noncreatures, but includes another artifact creature', () => {
  const s = fixture(),
    o = put(s, 'Liliana the Repentant', 0, 'hand');
  enterBattlefieldBatch(s, [{ object: o }]);
  assert.equal(s.pendingTriggers.length, 0);
  enterBattlefieldBatch(s, [{ object: put(s, 'Forest', 0, 'hand') }]);
  assert.equal(s.pendingTriggers.length, 0);
  enterBattlefieldBatch(s, [{ object: put(s, 'Ornithopter', 0, 'hand') }]);
  assert.equal(s.pendingTriggers.length, 1);
  enterBattlefieldBatch(s, [{ object: put(s, 'Grizzly Bears', 1, 'hand') }]);
  assert.equal(s.pendingTriggers.length, 1);
});

test('Liliana lost target fizzles both return and self counter but still spends Exhaust', () => {
  let s = fixture();
  const o = put(s, 'Liliana the Repentant'),
    target = put(s, 'Grizzly Bears', 0, 'graveyard');
  s = act(s, 'activate', { card: o.id, ability: 0, target: ref(target) });
  move(s, s.objects[target.id], 'exile');
  s = resolve(s);
  assert.equal(s.objects[o.id].plusCounters, 0);
  assert.equal(s.stack.length, 0);
  assert.ok(used(s, o));
});

test('Rebellious Captives earthbends a selected land and its delayed return is not another Exhaust use', () => {
  let s = fixture();
  const o = put(s, 'Rebellious Captives'),
    land = put(s, 'Forest');
  s = resolve(act(s, 'activate', { card: o.id, ability: 0, target: ref(land) }));
  assert.equal(s.objects[o.id].plusCounters, 2);
  assert.deepEqual(stats(s, s.objects[land.id]), { power: 2, toughness: 2 });
  assert.ok(hasKeyword(s, s.objects[land.id], 'haste'));
  move(s, s.objects[land.id], 'graveyard');
  stabilize(s);
  s = resolve(s);
  assert.equal(s.objects[land.id].zone, 'battlefield');
  assert.equal(s.objects[land.id].tapped, true);
  assert.equal(s.objects[land.id].plusCounters, 0);
  assert.ok(used(s, o));
});

test('Rebellious Captives has no partial self-counter effect after its sole target becomes illegal', () => {
  let s = fixture();
  const o = put(s, 'Rebellious Captives'),
    land = put(s, 'Forest');
  s = act(s, 'activate', { card: o.id, ability: 0, target: ref(land) });
  move(s, s.objects[land.id], 'hand');
  s = resolve(s);
  assert.equal(s.objects[o.id].plusCounters, 0);
  assert.ok(used(s, o));
});

test('UI explains a spent Exhaust independently, while bot and public-view legality cannot propose it twice', () => {
  let s = fixture();
  const o = put(s, 'Draconautics Engineer');
  const first = chooseBotCommand(playerView(s, 0), 0);
  assert.equal(first.type, 'activate');
  s = resolve(act(s, 'activate', { card: o.id, ability: 0 }));
  const view = playerView(s, 0);
  assert.ok(!available(view, o, 0));
  const next = chooseBotCommand(view, 0);
  assert.ok(!(next.type === 'activate' && next.card === o.id && next.ability === 0));
  const html = activatedAbilityButtons(s, 0, s.objects[o.id], legalActions(s, 0));
  assert.match(html, /data-ability="0" disabled aria-describedby="ability-problem-0"/);
  assert.match(html, /This exhaust ability has already been activated\./);
  const { document } = parseHTML(`<div>${html}</div>`);
  const disabled = document.querySelector('[data-ability="0"]');
  assert.ok(disabled.hasAttribute('disabled'));
  assert.equal(
    document.getElementById(disabled.getAttribute('aria-describedby')).textContent,
    'This exhaust ability has already been activated.',
  );
  assert.ok(!document.querySelector('[data-ability="1"]').hasAttribute('disabled'));
  assert.doesNotMatch(html, /data-ability="1" disabled/);
  assert.equal(abilityProblem(s, 0, o.id, 0), 'This exhaust ability has already been activated.');
});

test('opaque session actions consume Exhaust once, and deterministic replay keeps it spent across turns', () => {
  const session = createSession({
    catalog,
    seed: 19,
    mulligan: false,
    decks: [
      [...Array(4).fill('Prowcatcher Specialist'), ...Array(56).fill('Mountain')],
      Array(60).fill('Forest'),
    ],
  });
  let activated = null,
    turn = null,
    reachedLaterTurn = false;
  for (let n = 0; n < 700; n++) {
    const ctx = session.context(),
      obs = ctx.observation;
    const spent = Object.values(obs.objects).find(
      (o) =>
        o.zone === 'battlefield' &&
        o.name === 'Prowcatcher Specialist' &&
        o.exhaustUses?.[0] === o.incarnation,
    );
    if (spent) {
      assert.ok(!ctx.actions.some((a) => a.type === 'activate' && a.card === spent.id));
      if (obs.turn > turn + 1) {
        reachedLaterTurn = true;
        break;
      }
    }
    const exhaust = !activated && ctx.actions.find((a) => a.type === 'activate');
    let action;
    if (exhaust) {
      assert.match(exhaust.card, /^object:/);
      activated = exhaust;
      turn = obs.turn;
      action = exhaust;
    } else if (obs.choice?.kind === 'attackers')
      action = { type: 'attackers', cards: [], player: ctx.player };
    else if (obs.choice) action = chooseBotCommand(obs, ctx.player);
    else
      action = ctx.actions.find((a) => a.type === 'playLand') ??
        (!activated ? ctx.actions.find((a) => a.type === 'cast') : null) ?? {
          type: 'pass',
          player: ctx.player,
        };
    const result = session.step({ ...action, player: ctx.player });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (exhaust) {
      const again = session.step(exhaust);
      assert.equal(again.ok, false);
      assert.match(again.error.message, /already been activated/);
      assert.ok(session.context().observation.objects[exhaust.card].exhaustUses);
    }
  }
  assert.ok(activated);
  assert.ok(reachedLaterTurn);
  const record = session.exportReplay();
  const restored = replay(record);
  assert.deepEqual(exportReplay(restored), record);
  assert.ok(Object.values(restored.objects).some((o) => o.exhaustUses?.[0] === o.incarnation));
});

for (const [name, tokenName, power, toughness, types, color, keywords] of [
  ['Camera Launcher', 'Flying Thopter Token', 1, 1, ['artifact', 'creature'], [], ['flying']],
  ['Stampeding Scurryfoot', 'Green Elephant Token', 3, 3, ['creature'], ['G'], []],
])
  test(`${name}: normal resolution grows the source and creates only its exact token`, () => {
    let s = fixture();
    const source = put(s, name);
    s = resolve(act(s, 'activate', { card: source.id, ability: 0 }));
    assert.equal(s.objects[source.id].plusCounters, 1);
    assert.equal(tokens(s).length, 1);
    const token = tokens(s)[0],
      d = definition(s, token);
    assert.equal(token.name, tokenName);
    assert.deepEqual(stats(s, token), { power, toughness });
    assert.deepEqual(d.types ?? [d.type], types);
    assert.deepEqual(d.color, color);
    assert.deepEqual(d.keywords, keywords);
    assert.ok(used(s, source));
  });

test('Exhaust without a printed restriction is instant-speed, including on an opponent turn', () => {
  let s = fixture();
  const source = put(s, 'Hazard of the Dunes');
  s.active = 1;
  s.step = 'beginCombat';
  s = resolve(act(s, 'activate', { card: source.id, ability: 0 }));
  assert.equal(s.objects[source.id].plusCounters, 3);
});

test('identically worded distinct Exhaust abilities each have their own use', () => {
  let s = fixture();
  const d = structuredClone(definitions['Prowcatcher Specialist']);
  d.name = 'Duplicate Exhaust Probe';
  d.activated.push(structuredClone(d.activated[0]));
  s.catalog = createRegistry({ ...catalog, [d.name]: d });
  const source = put(s, d.name);
  s = resolve(act(s, 'activate', { card: source.id, ability: 0 }));
  assert.ok(available(s, source, 1));
  s = resolve(act(s, 'activate', { card: source.id, ability: 1 }));
  assert.equal(s.objects[source.id].plusCounters, 4);
  assert.ok(used(s, source, 0) && used(s, source, 1));
});

test('Exhaust reuses actual tap/discard/life cost validation and pays before effect resolution', () => {
  let s = fixture();
  const d = structuredClone(definitions['Hazard of the Dunes']);
  d.name = 'Exhaust Cost Probe';
  d.activated[0].cost = { mana: { G: 1 }, tap: true, discard: 1, life: 2 };
  s.catalog = createRegistry({ ...catalog, [d.name]: d });
  const source = put(s, d.name, 0, 'battlefield', { ready: false }),
    discard = put(s, 'Forest', 0, 'hand');
  reject(s, { card: source.id, discardCard: discard.id }, /tap cost/i);
  s.objects[source.id].controlledSince = s.turn - 1;
  reject(s, { card: source.id, discardCard: 'missing' }, /discard/i);
  const life = s.players[0].life,
    mana = s.players[0].mana.G;
  s = act(s, 'activate', { card: source.id, ability: 0, discardCard: discard.id });
  assert.ok(s.objects[source.id].tapped);
  assert.equal(s.players[0].life, life - 2);
  assert.equal(s.players[0].mana.G, mana - 1);
  assert.equal(s.objects[discard.id].zone, 'graveyard');
  assert.ok(used(s, source));
  assert.equal(s.objects[source.id].plusCounters, 0);
  s = resolve(s);
  assert.equal(s.objects[source.id].plusCounters, 3);
});

test('Liliana source departure leaves its return on the stack but cannot grow a new incarnation', () => {
  let s = fixture();
  const source = put(s, 'Liliana the Repentant'),
    target = put(s, 'Grizzly Bears', 0, 'graveyard');
  s = act(s, 'activate', { card: source.id, ability: 0, target: ref(target) });
  move(s, s.objects[source.id], 'hand');
  move(s, s.objects[source.id], 'battlefield');
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'battlefield');
  assert.equal(s.objects[source.id].plusCounters, 0);
  assert.equal(s.objects[source.id].exhaustUses, undefined);
});

test('Draconautics haste excludes only the activating incarnation, not a blinked replacement', () => {
  let s = fixture();
  const source = put(s, 'Draconautics Engineer');
  s = act(s, 'activate', { card: source.id, ability: 0 });
  move(s, s.objects[source.id], 'hand');
  move(s, s.objects[source.id], 'battlefield');
  s = resolve(s);
  assert.ok(hasKeyword(s, s.objects[source.id], 'haste'));
  assert.equal(s.objects[source.id].plusCounters, 0);
  assert.equal(s.objects[source.id].exhaustUses, undefined);
});
