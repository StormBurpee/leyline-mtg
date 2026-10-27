import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  CARDS,
  createRegistry,
  createGame,
  dispatch,
  legalActions,
  chooseBotCommand,
  exportReplay,
  replay,
  playerView,
  stats,
  hasKeyword,
} from '../packages/engine/src/index.js';
import { move, ref, definition, shuffle } from '../packages/engine/src/model.js';
import {
  resolveEffects,
  resolveTop,
  stabilize,
  enterBattlefield,
} from '../packages/engine/src/effects.js';
import { castingProfile } from '../packages/engine/src/casting-costs.js';
import { compileCard, canonical } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import {
  fixture as baseFixture,
  put,
  lands,
  act,
  resolve,
} from '../packages/engine/test/helpers.js';
import { runEpisode } from '../packages/simulation/run.js';
import { game, eventText } from '../apps/web/view.js';
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const reviewed = read('./fixtures/discover-oracle-reviewed.json');
const sources = reviewed.cards.map(({ name }) =>
  read(`../packages/cards/cards/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`),
);
const definitions = Object.fromEntries(
  sources.map((source) => {
    const result = compileCard(source);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    return [source.name, result.definition];
  }),
);
const catalog = createRegistry({ ...CARDS, ...definitions });
function fixture() {
  const s = baseFixture();
  s.catalog = catalog;
  return s;
}
function library(s, names, p = 0) {
  for (const id of [...s.players[p].library]) move(s, s.objects[id], 'graveyard');
  return names.map((n) => put(s, n, p, 'library'));
}
function begin(s, amount, after = [], controller = 0) {
  const source = put(s, 'Mountain', controller);
  source.tapped = true;
  resolveEffects(s, {
    id: 'discover-fixture',
    kind: 'ability',
    source: ref(source),
    name: 'Discover fixture',
    controller,
    sourceKeywords: [],
    effects: [{ op: 'discover', amount }, ...after],
  });
  stabilize(s);
  return s;
}
function settle(s) {
  resolveTop(s);
  stabilize(s);
  return s;
}
function reject(s, command) {
  const before = structuredClone(s);
  const result = dispatch(s, { player: s.choice?.player ?? s.priority, ...command });
  assert.equal(result.ok, false, JSON.stringify(command));
  assert.equal(result.state, s);
  assert.deepEqual(s, before);
}

test('eleven actual Discover cards match reviewed Oracle, schema and native round trips', () => {
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(
    read('../packages/cards/schema/card.schema.json'),
  );
  assert.equal(sources.length, 11);
  for (const source of sources) {
    const oracle = reviewed.cards.find((c) => c.name === source.name);
    assert.equal(source.id, oracle.oracle_id);
    assert.equal(source.rulesText, oracle.oracle_text);
    assert.equal(source.characteristics.manaCost, oracle.mana_cost || null);
    assert.deepEqual(source.characteristics.colors, oracle.colors);
    assert.equal(validate(source), true, source.name);
    const round = compileCard(sourceFromDefinition(definitions[source.name], { id: source.id }));
    assert.equal(round.ok, true, JSON.stringify(round.diagnostics));
    assert.deepEqual(canonical(round.definition), canonical(definitions[source.name]));
  }
});

test('Discover opcode fails closed for malformed counts and unknown fields in source and registry', () => {
  const validate = new Ajv2020({ strict: true }).compile(
    read('../packages/cards/schema/card.schema.json'),
  );
  for (const effect of [
    { op: 'discover' },
    { op: 'discover', amount: -1 },
    { op: 'discover', amount: 1.5 },
    { op: 'discover', amount: 1001 },
    { op: 'discover', amount: { kind: 'x' } },
    { op: 'discover', amount: 3, player: 'opponent' },
  ]) {
    const source = structuredClone(sources.find((c) => c.name === 'Geological Appraiser'));
    source.abilities[0].effects = [effect];
    assert.equal(validate(source), false);
    assert.equal(compileCard(source).ok, false);
    assert.throws(() =>
      createRegistry([{ name: 'Invalid', type: 'sorcery', cost: {}, effects: [effect] }]),
    );
  }
});

test('Discover publicly exiles through lands and expensive spells, then hand choice random-bottoms only the remainder', () => {
  let s = fixture();
  const [land, big, found, tail] = library(s, ['Island', 'Serra Angel', 'Shock', 'Forest']);
  begin(s, 2);
  assert.equal(s.choice.card, found.id);
  assert.equal(s.choice.discover, 2);
  for (const o of [land, big, found]) {
    assert.equal(s.objects[o.id].zone, 'exile');
    assert.equal(s.objects[o.id].playPermission, undefined);
    assert.equal(playerView(s, 1).objects[o.id].name, o.name);
  }
  assert.equal(playerView(s, 1).objects[tail.id], undefined);
  assert.deepEqual(s.players[0].library, [tail.id]);
  const expected = structuredClone(s),
    remainder = [ref(s.objects[land.id]), ref(s.objects[big.id])];
  shuffle(expected, remainder);
  reject(s, { type: 'pass' });
  reject(s, { type: 'playLand', card: land.id });
  reject(s, { type: 'cast', card: big.id });
  reject(s, { type: 'cast', card: found.id, target: { kind: 'player', id: 1 }, player: 1 });
  s = act(s, 'declineCastExiled');
  assert.equal(s.objects[found.id].zone, 'hand');
  assert.equal(s.players[1].life, 20);
  assert.deepEqual(s.players[0].library, [tail.id, ...remainder.map((r) => r.id)]);
  assert.equal(s.rng, expected.rng);
  assert.equal(s.resolving, null);
  assert.equal(s.choice, null);
  assert.equal(s.events.filter((e) => e.type === 'discovered').at(-1).amount, 2);
  assert.equal(playerView(s, 1).objects[found.id], undefined);
  assert.equal(playerView(s, 1).objects[land.id], undefined);
});

test('no match and empty library never draw, fail a draw, or leave cards stranded in exile', () => {
  for (const names of [[], ['Island'], ['Mountain', 'Serra Angel', 'Forest']]) {
    const s = fixture(),
      cards = library(s, names),
      life = s.players[0].life;
    const beforeDraw = s.events.filter((e) => e.type === 'draw').length;
    begin(s, 0, [{ op: 'gainLife', amount: 2 }]);
    assert.equal(s.choice, null);
    assert.equal(s.players[0].life, life + 2);
    assert.equal(s.status, 'playing');
    assert.equal(s.events.filter((e) => e.type === 'draw').length, beforeDraw);
    assert.deepEqual([...s.players[0].library].sort(), cards.map((o) => o.id).sort());
    assert.ok(cards.every((o) => s.objects[o.id].zone === 'library'));
    assert.equal(s.events.filter((e) => e.type === 'discovered').at(-1).objectId, null);
  }
});

test('free sorcery is cast during opponent combat; parent finishes before cast triggers and no other priority action slips in', () => {
  let s = fixture();
  s.active = 1;
  s.priority = 1;
  s.step = 'blockers';
  const [land, spell, drawn] = library(s, ['Island', 'Divination', 'Mountain', 'Forest', 'Swamp']);
  put(s, 'Monastery Swiftspear');
  begin(s, 3, [{ op: 'draw', count: 1 }]);
  assert.deepEqual(legalActions(s, 1), [{ type: 'concede' }]);
  assert.ok(legalActions(s, 0).some((a) => a.type === 'cast' && a.card === spell.id));
  const unrelated = put(s, 'Shock', 0, 'hand');
  reject(s, { type: 'cast', card: unrelated.id, target: { kind: 'player', id: 1 } });
  s = act(s, 'cast', { card: spell.id });
  assert.equal(s.resolving, null);
  assert.equal(s.objects[drawn.id].zone, 'hand');
  assert.equal(s.objects[land.id].zone, 'library');
  assert.equal(s.stack[0].source.id, spell.id);
  assert.equal(s.stack.length, 2, 'prowess waits above discovered spell until parent completed');
  assert.equal(s.stack[0].manaSpent, 0);
  assert.deepEqual(s.stack[0].castingCost, {});
  assert.equal(s.events.filter((e) => e.type === 'mana').length, 0);
  assert.ok(
    s.events.findIndex((e) => e.type === 'discovered') <
      s.events.findIndex((e) => e.type === 'draw' && e.objectId === drawn.id),
  );
});

test('unavailable required targets put the found spell into hand instead of skipping it or granting future exile permission', () => {
  let s = fixture();
  const [spell, next] = library(s, ['Shatter', 'Shock']);
  begin(s, 2);
  assert.deepEqual(legalActions(s, 0), [{ type: 'declineCastExiled' }]);
  reject(s, { type: 'cast', card: spell.id });
  s = act(s, 'declineCastExiled');
  assert.equal(s.objects[spell.id].zone, 'hand');
  assert.equal(s.players[0].library[0], next.id);
});

test('resulting Adventure mana value is checked independently of the exiled main face', () => {
  const name = 'Galvanic Giant // Storm Reading';
  for (const amount of [4, 7]) {
    let s = fixture();
    const [spell] = library(s, [name, 'Island', 'Forest', 'Mountain', 'Swamp']);
    begin(s, amount);
    assert.ok(legalActions(s, 0).some((a) => a.type === 'cast' && a.mode === 0));
    if (amount === 4) {
      assert.equal(
        legalActions(s, 0).some((a) => a.type === 'cast' && a.mode === 1),
        false,
      );
      reject(s, { type: 'cast', card: spell.id, mode: 1 });
    } else {
      assert.ok(legalActions(s, 0).some((a) => a.type === 'cast' && a.mode === 1));
      s = act(s, 'cast', { card: spell.id, mode: 1 });
      assert.equal(s.stack.at(-1).name, 'Storm Reading');
      assert.equal(s.stack.at(-1).manaSpent, 0);
      settle(s);
      assert.equal(s.choice.kind, 'discardEffect');
      s = act(s, 'discardEffect', { cards: s.players[0].hand.slice(0, 2) });
      assert.equal(s.objects[spell.id].zone, 'exile');
      assert.equal(s.objects[spell.id].adventured.player, 0);
    }
  }
  const s = fixture(),
    [big, cheap] = library(s, ['Virtue of Persistence // Locthwain Scorn', 'Shock']);
  begin(s, 3);
  assert.equal(s.choice.card, cheap.id, 'cheap Adventure cannot qualify an expensive main face');
  assert.equal(s.objects[big.id].zone, 'exile');
});

test('free X spells require explicit zero; alternative disguise and warp costs cannot replace Discover', () => {
  let s = fixture();
  const [spell] = library(s, ['Mind Spring']);
  begin(s, 2);
  assert.deepEqual(
    legalActions(s, 0)
      .filter((a) => a.type === 'cast')
      .map((a) => a.x),
    [0],
  );
  reject(s, { type: 'cast', card: spell.id, x: 1 });
  reject(s, { type: 'cast', card: spell.id });
  assert.equal(
    legalActions(s, 0, { x: 1 }).some((a) => a.type === 'cast'),
    false,
  );
  s = act(s, 'cast', { card: spell.id, x: 0 });
  assert.equal(s.stack.at(-1).x, 0);
  assert.equal(s.stack.at(-1).manaSpent, 0);
  for (const name of ['Pyrotechnic Performer', 'All-Fates Stalker']) {
    let v = fixture();
    const [card] = library(v, [name]);
    begin(v, 10);
    assert.ok(legalActions(v, 0).some((a) => a.type === 'cast' && a.mode === 0));
    assert.equal(
      legalActions(v, 0).some((a) => a.type === 'cast' && a.mode === 1),
      false,
    );
    reject(v, { type: 'cast', card: card.id, mode: 1 });
  }
});

test('kicker and mandatory Spree mana survive free base casting, without changing Discover mana-value eligibility', () => {
  let s = fixture();
  const [spell] = library(s, ['Burst Lightning']);
  begin(s, 1);
  assert.equal(
    legalActions(s, 0).some((a) => a.type === 'cast' && a.mode === 1),
    false,
  );
  lands(s, 'Mountain', 4);
  assert.ok(legalActions(s, 0).some((a) => a.type === 'cast' && a.mode === 1));
  s = act(s, 'cast', { card: spell.id, mode: 1, target: { kind: 'player', id: 1 } });
  assert.equal(s.stack.at(-1).manaSpent, 4);
  settle(s);
  assert.equal(s.players[1].life, 16);
  s = fixture();
  const [spree] = library(s, ['Three Steps Ahead', 'Forest', 'Swamp', 'Island']);
  begin(s, 1);
  assert.equal(
    legalActions(s, 0).some((a) => a.type === 'cast'),
    false,
  );
  lands(s, 'Mountain', 2);
  const draw = legalActions(s, 0).find((a) => a.type === 'cast' && a.mode === 3);
  assert.ok(draw);
  s = act(s, 'cast', draw);
  assert.equal(s.stack.at(-1).manaSpent, 2);
});

test('mandatory sacrifice is paid and its linked-return pause preserves Discover remainder and parent instructions', () => {
  let s = fixture();
  const [land, spell] = library(s, ['Island', 'Final Vengeance']);
  const bear = put(s, 'Grizzly Bears', 1);
  begin(s, 1, [{ op: 'gainLife', amount: 2 }]);
  assert.equal(
    legalActions(s, 0).some((a) => a.type === 'cast'),
    false,
  );
  const light = put(s, 'Banishing Light'),
    aura = put(s, 'Pacifism', 1);
  aura.attachedTo = ref(bear);
  resolveEffects(s, {
    source: ref(light),
    controller: 0,
    target: ref(aura),
    effects: [{ op: 'exileUntilSourceLeaves' }],
  });
  reject(s, { type: 'cast', card: spell.id, target: ref(bear) });
  s = act(s, 'cast', { card: spell.id, target: ref(bear), sacrifice: ref(light) });
  assert.equal(s.choice.kind, 'auraEntry');
  assert.equal(s.objects[land.id].zone, 'exile');
  assert.equal(s.players[0].life, 20);
  assert.ok(s.castingCompletion.parentResolution.discover);
  reject(s, { type: 'pass' });
  s = act(s, 'chooseAuraAttachment', { card: bear.id });
  assert.equal(s.resolving, null);
  assert.equal(s.objects[land.id].zone, 'library');
  assert.equal(s.players[0].life, 22);
  assert.equal(s.events.filter((e) => e.type === 'cast' && e.objectId === spell.id).length, 1);
  settle(s);
  assert.equal(s.objects[bear.id].zone, 'exile');
});

test('Discover remainder and selected card are incarnation-bound and never pull back a different object', () => {
  let s = fixture();
  const [land, spell] = library(s, ['Island', 'Shock']);
  begin(s, 1);
  move(s, s.objects[land.id], 'graveyard');
  move(s, s.objects[land.id], 'exile');
  move(s, s.objects[spell.id], 'hand');
  move(s, s.objects[spell.id], 'exile');
  reject(s, { type: 'cast', card: spell.id, target: { kind: 'player', id: 1 } });
  s = act(s, 'declineCastExiled');
  assert.equal(s.objects[land.id].zone, 'exile');
  assert.equal(s.objects[spell.id].zone, 'exile');
});

test('all five Hidden Caves enter tapped, produce their color, and sacrifice for sorcery-only Discover 4', () => {
  const variants = [
    ['Hidden Cataract', 'Island', 'U'],
    ['Hidden Courtyard', 'Plains', 'W'],
    ['Hidden Necropolis', 'Swamp', 'B'],
    ['Hidden Nursery', 'Forest', 'G'],
    ['Hidden Volcano', 'Mountain', 'R'],
  ];
  for (const [name, basic, color] of variants) {
    let s = fixture();
    const land = put(s, name, 0, 'hand');
    s = act(s, 'playLand', { card: land.id });
    assert.equal(s.objects[land.id].tapped, true);
    s.objects[land.id].tapped = false;
    s = act(s, 'tapMana', { card: land.id, color });
    assert.equal(s.players[0].mana[color], 1);
    s.objects[land.id].tapped = false;
    s.players[0].mana[color] = 0;
    lands(s, basic, 5);
    const [found] = library(s, ['Shock']);
    s.step = 'end';
    reject(s, { type: 'activate', card: land.id, ability: 0 });
    s.step = 'main1';
    s = act(s, 'activate', { card: land.id, ability: 0 });
    assert.equal(s.objects[land.id].zone, 'graveyard');
    settle(s);
    assert.equal(s.choice.discover, 4);
    assert.equal(s.choice.card, found.id);
    s = act(s, 'declineCastExiled');
    assert.equal(s.objects[found.id].zone, 'hand');
  }
});

test('Buried Treasure is actual sacrificial colored mana, then a graveyard-only sorcery Discover 5', () => {
  let s = fixture();
  const treasure = put(s, 'Buried Treasure');
  reject(s, { type: 'activate', card: treasure.id, ability: 0 });
  s = act(s, 'tapMana', { card: treasure.id, color: 'U' });
  assert.equal(s.players[0].mana.U, 1);
  assert.equal(s.objects[treasure.id].zone, 'graveyard');
  lands(s, 'Mountain', 4);
  const [found] = library(s, ['Serra Angel']);
  s.step = 'blockers';
  reject(s, { type: 'activate', card: treasure.id, ability: 0 });
  s.step = 'main1';
  s = act(s, 'activate', { card: treasure.id, ability: 0 });
  assert.equal(s.objects[treasure.id].zone, 'exile');
  settle(s);
  assert.equal(s.choice.discover, 5);
  assert.equal(s.choice.card, found.id);
  s = act(s, 'cast', { card: found.id });
  settle(s);
  assert.equal(s.objects[found.id].zone, 'battlefield');
});

test('Appraiser discovers only after a cast entry, retains trigger controller after source removal, and chains from Discover', () => {
  let s = fixture();
  const app = put(s, 'Geological Appraiser', 0, 'hand');
  enterBattlefield(s, app, 0);
  stabilize(s);
  assert.equal(s.stack.length, 0);
  move(s, app, 'hand');
  lands(s, 'Mountain', 4);
  const [found] = library(s, ['Shock']);
  s = act(s, 'cast', { card: app.id });
  settle(s);
  assert.equal(s.stack.length, 1);
  move(s, s.objects[app.id], 'graveyard');
  settle(s);
  assert.equal(s.choice.player, 0);
  assert.equal(s.choice.card, found.id);
  s = act(s, 'declineCastExiled');
  assert.equal(s.objects[found.id].zone, 'hand');
  s = fixture();
  const [first, last] = library(s, ['Geological Appraiser', 'Shock']);
  begin(s, 4);
  s = act(s, 'cast', { card: first.id });
  settle(s);
  assert.equal(s.stack.length, 1);
  settle(s);
  assert.equal(s.choice.discover, 3);
  assert.equal(s.choice.card, last.id);
});

test('Etali Favor requires your creature, grants +1/+1 and trample, and its entry Discover survives Aura removal', () => {
  let s = fixture();
  const own = put(s, 'Grizzly Bears'),
    enemy = put(s, 'Grizzly Bears', 1),
    aura = put(s, "Etali's Favor", 0, 'hand');
  lands(s, 'Mountain', 3);
  library(s, ['Shock']);
  reject(s, { type: 'cast', card: aura.id, target: ref(enemy) });
  s = act(s, 'cast', { card: aura.id, target: ref(own) });
  settle(s);
  assert.deepEqual(stats(s, s.objects[own.id]), { power: 3, toughness: 3 });
  assert.equal(hasKeyword(s, s.objects[own.id], 'trample'), true);
  move(s, s.objects[aura.id], 'graveyard');
  settle(s);
  assert.equal(s.choice.discover, 3);
  s = act(s, 'declineCastExiled');
  assert.deepEqual(stats(s, s.objects[own.id]), { power: 2, toughness: 2 });
});

test('Daring Discovery and Walk with Ancestors preserve zero-target Discover and all-target fizzle rules', () => {
  for (const name of ['Daring Discovery', 'Walk with the Ancestors']) {
    const group = name === 'Daring Discovery' ? 'creatures' : 'permanent';
    let s = fixture(),
      spell = put(s, name, 0, 'hand');
    lands(s, name === 'Daring Discovery' ? 'Mountain' : 'Forest', 5);
    library(s, ['Shock']);
    s = act(s, 'cast', { card: spell.id, targets: { [group]: [] } });
    settle(s);
    assert.equal(s.choice.discover, 4, name);
    s = fixture();
    spell = put(s, name, 0, 'hand');
    lands(s, name === 'Daring Discovery' ? 'Mountain' : 'Forest', 5);
    library(s, ['Shock']);
    const target = put(
      s,
      'Grizzly Bears',
      0,
      name === 'Daring Discovery' ? 'battlefield' : 'graveyard',
    );
    s = act(s, 'cast', { card: spell.id, targets: { [group]: [ref(target)] } });
    move(s, s.objects[target.id], 'exile');
    settle(s);
    assert.equal(s.choice, null, name);
    assert.equal(
      s.events.some((e) => e.type === 'discovered'),
      false,
      name,
    );
  }
});

test('Daring applies every surviving cannot-block target, while Walk returns its permanent before discovering', () => {
  let s = fixture();
  const spell = put(s, 'Daring Discovery', 0, 'hand'),
    creatures = [put(s, 'Grizzly Bears'), put(s, 'Serra Angel', 1), put(s, 'Llanowar Elves', 1)];
  lands(s, 'Mountain', 5);
  library(s, ['Shock']);
  s = act(s, 'cast', { card: spell.id, targets: { creatures: creatures.map(ref) } });
  move(s, s.objects[creatures[0].id], 'exile');
  settle(s);
  assert.equal(s.choice.discover, 4);
  assert.ok(s.modifiers.filter((m) => m.combatRestriction === 'cannotBlock').length === 2);
  s = fixture();
  const walk = put(s, 'Walk with the Ancestors', 0, 'hand'),
    land = put(s, 'Mountain', 0, 'graveyard');
  lands(s, 'Forest', 5);
  library(s, ['Shock']);
  s = act(s, 'cast', { card: walk.id, targets: { permanent: [ref(land)] } });
  settle(s);
  assert.equal(s.objects[land.id].zone, 'hand');
  assert.equal(s.choice.discover, 4);
});

test('Primordial Gnawer death discovery belongs to its last controller, not owner, and survives type changes', () => {
  let s = fixture();
  const gnawer = put(s, 'Primordial Gnawer');
  gnawer.controller = 1;
  gnawer.definitionOverride = {
    ...definitions['Primordial Gnawer'],
    type: 'artifact',
    types: ['artifact'],
  };
  const [found] = library(s, ['Shock'], 1);
  move(s, gnawer, 'graveyard');
  stabilize(s);
  settle(s);
  assert.equal(s.choice.player, 1);
  assert.equal(s.choice.card, found.id);
  s = act(s, 'declineCastExiled');
  assert.equal(s.objects[found.id].zone, 'hand');
  assert.equal(s.objects[found.id].owner, 1);
});

test('Discover UI says free cast or hand rather than Chandra damage and keeps the normal target flow', () => {
  const s = fixture();
  library(s, ['Shock']);
  begin(s, 3);
  const ui = {
    mode: 'hotseat',
    seat: 0,
    activation: null,
    selected: null,
    spellMode: null,
    targeting: false,
    selectedAttackers: [],
    selectedBlocker: null,
    hovered: null,
    zoom: 1,
    chosen: [],
    blocks: {},
    stops: {},
  };
  const html = game(s, ui, {});
  assert.match(html, /Discover 3/);
  assert.match(html, /put it into your hand/);
  assert.match(html, /Additional costs still apply; X must be 0/);
  assert.doesNotMatch(html, /decline to deal|Don't cast · deal|undefined damage/);
});

test('actual Appraiser games replay mid-Discover and opaque bot simulation finishes without hidden-zone reads', async () => {
  const deck = [
    ...Array(20).fill('Mountain'),
    ...Array(4).fill('Geological Appraiser'),
    ...Array(4).fill('Shock'),
  ];
  const config = { catalog, decks: [deck, deck], seed: 42, mulligan: false, minimumDeckSize: 28 };
  let s = createGame(config),
    witnessed = false;
  for (let i = 0; i < 650 && s.status === 'playing'; i++) {
    if (s.choice?.discover !== undefined && !witnessed) {
      assert.deepEqual(replay(exportReplay(s)), s);
      witnessed = true;
    }
    const cmd = chooseBotCommand(s, s.choice?.player ?? s.priority),
      r = dispatch(s, cmd);
    assert.equal(r.ok, true, JSON.stringify(r.error));
    s = r.state;
  }
  assert.equal(witnessed, true);
  assert.deepEqual(replay(exportReplay(s)), s);
  const episode = await runEpisode({ config, includeReplay: true });
  assert.equal(episode.termination, 'finished', JSON.stringify(episode.error));
  assert.ok(episode.replay.commands.some((c) => c.type === 'cast'));
  assert.equal(replay(episode.replay).winner, episode.winner);
});

test('mandatory discard-or-life, optional bargain and cost increases all survive Discover', () => {
  let s = fixture();
  const [spell] = library(s, ['Bitter Triumph']);
  const victim = put(s, 'Grizzly Bears', 1);
  begin(s, 2);
  reject(s, { type: 'cast', card: spell.id, target: ref(victim) });
  s = act(s, 'cast', { card: spell.id, target: ref(victim), additionalCost: { life: true } });
  assert.equal(s.players[0].life, 17);
  assert.equal(s.stack.at(-1).manaSpent, 0);
  settle(s);
  assert.equal(s.objects[victim.id].zone, 'graveyard');
  s = fixture();
  s.players[0].life = 2;
  library(s, ['Bitter Triumph']);
  put(s, 'Grizzly Bears', 1);
  begin(s, 2);
  assert.equal(
    legalActions(s, 0).some((a) => a.type === 'cast'),
    false,
  );
  s = fixture();
  const [bargain] = library(s, ['Candy Grapple']),
    angel = put(s, 'Serra Angel', 1),
    treasure = put(s, 'Treasure Token');
  begin(s, 2);
  assert.ok(legalActions(s, 0).some((a) => a.type === 'cast' && a.mode === 0));
  s = act(s, 'cast', { card: bargain.id, mode: 1, target: ref(angel), sacrifice: ref(treasure) });
  assert.equal(s.stack.at(-1).bargained, true);
  settle(s);
  assert.equal(s.objects[angel.id].zone, 'graveyard');
  s = fixture();
  const [shock] = library(s, ['Shock']);
  put(s, 'Thalia, the Survivor', 1);
  begin(s, 1);
  assert.equal(
    legalActions(s, 0).some((a) => a.type === 'cast'),
    false,
  );
  lands(s, 'Forest', 1);
  assert.deepEqual(castingProfile(s, 0, s.objects[shock.id]).cost, { generic: 1 });
  s = act(s, 'cast', { card: shock.id, target: { kind: 'player', id: 1 } });
  assert.equal(s.stack.at(-1).manaSpent, 1);
});

test('two Discover instructions stay within one parent resolution even after the first spell is cast', () => {
  let s = fixture();
  const [a, first, b, second] = library(s, ['Island', 'Shock', 'Forest', 'Llanowar Elves']);
  begin(s, 1, [
    { op: 'discover', amount: 1 },
    { op: 'gainLife', amount: 2 },
  ]);
  s = act(s, 'cast', { card: first.id, target: { kind: 'player', id: 1 } });
  assert.equal(s.choice.card, second.id);
  assert.equal(s.players[0].life, 20);
  assert.equal(s.players[1].life, 20);
  assert.equal(s.objects[a.id].zone, 'library');
  assert.equal(s.objects[b.id].zone, 'exile');
  reject(s, { type: 'pass' });
  s = act(s, 'declineCastExiled');
  assert.equal(s.players[0].life, 22);
  assert.equal(s.objects[b.id].zone, 'library');
  assert.equal(s.objects[second.id].zone, 'hand');
  assert.equal(s.stack.length, 1);
  settle(s);
  assert.equal(s.players[1].life, 18);
});

test('transforming cards are discovered and cast by their front face, not their creature reverse face', () => {
  const name = 'The Legend of Roku // Avatar Roku';
  let s = fixture();
  const [saga, spell] = library(s, [name, 'Shock']);
  begin(s, 3);
  assert.equal(s.choice.card, spell.id);
  assert.equal(s.objects[saga.id].zone, 'exile');
  s = fixture();
  const [front] = library(s, [name]);
  begin(s, 4);
  reject(s, { type: 'cast', card: front.id, mode: 1 });
  s = act(s, 'cast', { card: front.id });
  assert.equal(definition(s, s.objects[front.id]).type, 'enchantment');
  assert.equal(s.objects[front.id].transformed, undefined);
});

test('a stolen Hidden Cave discovers from its activator library while the sacrificed source returns to its owner graveyard', () => {
  let s = fixture();
  s.active = 1;
  s.priority = 1;
  const cave = put(s, 'Hidden Volcano');
  cave.controller = 1;
  lands(s, 'Mountain', 5, 1);
  const [mine] = library(s, ['Serra Angel'], 0),
    [theirs] = library(s, ['Shock'], 1);
  s = act(s, 'activate', { card: cave.id, ability: 0 }, 1);
  assert.equal(s.objects[cave.id].zone, 'graveyard');
  assert.ok(s.players[0].graveyard.includes(cave.id));
  settle(s);
  assert.equal(s.choice.player, 1);
  assert.equal(s.choice.card, theirs.id);
  assert.equal(s.objects[mine.id].zone, 'library');
  s = act(s, 'cast', { card: theirs.id, target: { kind: 'player', id: 0 } });
  assert.equal(s.stack.at(-1).controller, 1);
  settle(s);
  assert.equal(s.players[0].life, 18);
});

test('Discover 0 skips zero-value lands but can freely cast a zero-mana nonland card', () => {
  let s = fixture();
  const [land, found] = library(s, ['Island', 'Ornithopter']);
  begin(s, 0);
  assert.equal(s.choice.discover, 0);
  assert.equal(eventText({ type: 'discovered', player: 0, amount: 0 }, s), 'You discovered 0.');
  assert.equal(s.choice.card, found.id);
  s = act(s, 'cast', { card: found.id });
  assert.equal(s.stack.at(-1).manaSpent, 0);
  assert.equal(s.objects[land.id].zone, 'library');
  settle(s);
  assert.equal(s.objects[found.id].zone, 'battlefield');
});

test('Discover Adventure taxes use the printed spell-face mana value, not its free payment cost', () => {
  let s = fixture();
  const tax = {
    name: 'Printed Mana Value Tax',
    type: 'artifact',
    cost: {},
    costModifiers: [
      { scope: 'opponent', change: 'increase', amount: 2, where: { manaValue: { gte: 7 } } },
    ],
  };
  s.catalog = createRegistry({ ...catalog, [tax.name]: tax });
  put(s, tax.name, 1);
  const [spell] = library(s, ['Galvanic Giant // Storm Reading']);
  begin(s, 7);
  // The creature has mana value 4; Storm Reading has mana value 7.
  assert.deepEqual(castingProfile(s, 0, s.objects[spell.id], 0).cost, {});
  assert.deepEqual(castingProfile(s, 0, s.objects[spell.id], 1).cost, { generic: 2 });
  assert.equal(
    legalActions(s, 0).some((a) => a.type === 'cast' && a.mode === 1),
    false,
  );
  reject(s, { type: 'cast', card: spell.id, mode: 1 });
  lands(s, 'Forest', 2);
  assert.ok(legalActions(s, 0).some((a) => a.type === 'cast' && a.mode === 1));
  s = act(s, 'cast', { card: spell.id, mode: 1 });
  assert.equal(s.stack.at(-1).manaSpent, 2);
  assert.deepEqual(s.stack.at(-1).sourceDefinition.cost, { generic: 5, U: 2 });
});
