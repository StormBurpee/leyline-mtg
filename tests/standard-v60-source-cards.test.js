import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import {
  CARDS,
  CARD_IDS,
  createRegistry,
  createGame,
  dispatch,
  legalActions,
  ref,
  stats,
  hasKeyword,
  definition,
  exportReplay,
  replay,
  chooseBotCommand,
} from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { fixture, put, lands, act, resolve } from '../packages/engine/test/helpers.js';
import { enterBattlefieldBatch, stabilize } from '../packages/engine/src/effects.js';
import { move, notifyTriggers } from '../packages/engine/src/model.js';

const names = [
  'Bestial Incursion',
  'Boomerang Basics',
  'Bovine Intervention',
  'Cemetery Recruitment',
  'Hotshot Investigators',
  'Pia, Aether Ascetic',
  'Stroke of Midnight',
  'Thwip!',
  'Vaultguard Trooper',
  'Trampling Beast Token',
  'White Ox Token',
];
const sources = await Promise.all(
  names.map(async (name) =>
    JSON.parse(
      await readFile(
        new URL(
          `../packages/cards/cards/${name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')}.json`,
          import.meta.url,
        ),
      ),
    ),
  ),
);
const identities = { ...CARD_IDS, ...Object.fromEntries(sources.map((s) => [s.id, s.name])) };
const definitions = Object.fromEntries(
  sources.map((source) => {
    const result = compileCard(source, { identities });
    assert.equal(result.ok, true, source.name + JSON.stringify(result.diagnostics));
    return [source.name, result.definition];
  }),
);
const catalog = createRegistry({ ...CARDS, ...definitions });
const schema = JSON.parse(
  await readFile(new URL('../packages/cards/schema/card.schema.json', import.meta.url)),
);
const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);
const idsByName = Object.fromEntries(Object.entries(identities).map(([id, name]) => [name, id]));
function position() {
  const s = fixture();
  s.catalog = catalog;
  return s;
}
function mana(s) {
  for (const land of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']) lands(s, land, 6);
}
function enter(s, name, player = 0) {
  const o = put(s, name, player, 'hand');
  enterBattlefieldBatch(s, [{ object: o }]);
  stabilize(s);
  return o;
}
function cast(s, name, extra = {}, zone = 'hand') {
  const card = put(s, name, 0, zone);
  return [act(s, 'cast', { card: card.id, ...extra }), card];
}
function rejectUnchanged(s, command) {
  const before = structuredClone(s);
  const r = dispatch(s, command);
  assert.equal(r.ok, false);
  assert.deepEqual(s, before);
}
const battlefield = (s, name) =>
  Object.values(s.objects).filter((o) => o.name === name && o.zone === 'battlefield');
const endStep = (s) => {
  notifyTriggers(s, 'step', { player: 0, step: 'end' });
  stabilize(s);
};

for (const source of sources)
  test(`${source.name}: full schema, identity/text and native round trip`, () => {
    assert.equal(validate(source), true, source.name);
    assert.equal(definitions[source.name].text, source.rulesText);
    const result = compileCard(
      sourceFromDefinition(definitions[source.name], { id: source.id, idsByName }),
      { identities },
    );
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.definition, definitions[source.name]);
  });

for (const zone of ['hand', 'graveyard'])
  test(`Bestial Incursion: ${zone} cast creates one exact 4/4 green trampling Beast`, () => {
    let s = position();
    mana(s);
    let spell;
    [s, spell] = cast(s, 'Bestial Incursion', {}, zone);
    s = resolve(s);
    const [token] = battlefield(s, 'Trampling Beast Token');
    assert(token);
    assert.equal(battlefield(s, 'Trampling Beast Token').length, 1);
    assert.equal(stats(s, token).power, 4);
    assert.equal(stats(s, token).toughness, 4);
    assert.deepEqual(definition(s, token).color, ['G']);
    assert.deepEqual(definition(s, token).subtypes, ['Beast']);
    assert(hasKeyword(s, token, 'trample'));
    assert.equal(token.controller, 0);
    assert.equal(token.tapped, false);
    assert.equal(s.objects[spell.id].zone, zone === 'graveyard' ? 'exile' : 'graveyard');
  });
test('Bestial Incursion: printed and flashback costs differ and neither can be underpaid', () => {
  let s = position();
  lands(s, 'Forest', 4);
  const a = put(s, 'Bestial Incursion', 0, 'hand'),
    b = put(s, 'Bestial Incursion', 0, 'graveyard');
  rejectUnchanged(s, { type: 'cast', player: 0, card: b.id });
  s = act(s, 'cast', { card: a.id });
  s = resolve(s);
  assert.equal(battlefield(s, 'Trampling Beast Token').length, 1);
});
for (const controller of [0, 1])
  test(`Boomerang Basics: resolves using target controller ${controller}, not owner`, () => {
    let s = position();
    lands(s, 'Island', 1);
    const target = put(s, 'Grizzly Bears', 1 - controller);
    target.controller = controller;
    [s] = cast(s, 'Boomerang Basics', { target: ref(target) });
    s = resolve(s);
    assert.equal(s.objects[target.id].zone, 'hand');
    assert.equal(s.players[0].hand.length, 1);
    assert.equal(s.players[1].hand.length, controller === 0 ? 1 : 0);
    assert.equal(
      s.players[0].library.length,
      fixture().players[0].library.length - (controller === 0 ? 1 : 0),
    );
  });
test('Boomerang Basics: control is checked at resolution rather than cast time', () => {
  for (const controller of [0, 1]) {
    let s = position();
    lands(s, 'Island', 1);
    const target = put(s, 'Food Token', 1 - controller);
    [s] = cast(s, 'Boomerang Basics', { target: ref(target) });
    s.objects[target.id].controller = controller;
    s = resolve(s);
    assert(!s.objects[target.id]);
    assert.equal(s.players[0].hand.length, controller === 0 ? 1 : 0);
  }
});
test('Boomerang Basics: rejects lands, accepts noncreature permanents, and no draw from an illegal target', () => {
  let s = position();
  lands(s, 'Island', 1);
  const spell = put(s, 'Boomerang Basics', 0, 'hand'),
    land = put(s, 'Forest'),
    artifact = put(s, 'Food Token');
  rejectUnchanged(s, { type: 'cast', player: 0, card: spell.id, target: ref(land) });
  s = act(s, 'cast', { card: spell.id, target: ref(artifact) });
  move(s, s.objects[artifact.id], 'graveyard');
  stabilize(s);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 0);
});
for (const [name, draw] of [
  ['Toxic Abomination', true],
  ['Grizzly Bears', false],
  ['Changeling Wayfinder', true],
])
  test(`Cemetery Recruitment: returns ${name} and ${draw ? 'draws' : 'does not draw'}`, () => {
    let s = position();
    lands(s, 'Swamp', 2);
    const target = put(s, name, 0, 'graveyard');
    [s] = cast(s, 'Cemetery Recruitment', { target: ref(target) });
    s = resolve(s);
    assert.equal(s.objects[target.id].zone, 'hand');
    assert.equal(s.players[0].hand.length, draw ? 2 : 1);
  });
test('Cemetery Recruitment: excludes opposing graveyards and noncreatures; stale incarnation cannot yield a card', () => {
  let s = position();
  lands(s, 'Swamp', 2);
  const spell = put(s, 'Cemetery Recruitment', 0, 'hand'),
    opponent = put(s, 'Toxic Abomination', 1, 'graveyard'),
    land = put(s, 'Swamp', 0, 'graveyard'),
    target = put(s, 'Toxic Abomination', 0, 'graveyard');
  for (const bad of [opponent, land])
    rejectUnchanged(s, { type: 'cast', player: 0, card: spell.id, target: ref(bad) });
  s = act(s, 'cast', { card: spell.id, target: ref(target) });
  move(s, s.objects[target.id], 'exile');
  move(s, s.objects[target.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'graveyard');
  assert.equal(s.players[0].hand.length, 0);
});
for (const [name, spider] of [
  ['Giant Spider', true],
  ['Grizzly Bears', false],
  ['Changeling Wayfinder', true],
])
  test(`Thwip!: ${name} gains +2/+2 and flying, Spider condition ${spider}`, () => {
    let s = position();
    lands(s, 'Plains', 1);
    const target = put(s, name, 1);
    const before = stats(s, target);
    [s] = cast(s, 'Thwip!', { target: ref(target) });
    s = resolve(s);
    assert.equal(stats(s, s.objects[target.id]).power, before.power + 2);
    assert.equal(stats(s, s.objects[target.id]).toughness, before.toughness + 2);
    assert(hasKeyword(s, s.objects[target.id], 'flying'));
    assert.equal(s.players[0].life, spider ? 22 : 20);
    assert.equal(s.players[1].life, 20);
  });
test('Thwip!: invalid target prevents both modification and conditional life gain', () => {
  let s = position();
  lands(s, 'Plains', 1);
  const target = put(s, 'Giant Spider');
  [s] = cast(s, 'Thwip!', { target: ref(target) });
  move(s, s.objects[target.id], 'hand');
  s = resolve(s);
  assert.equal(s.players[0].life, 20);
  assert(!hasKeyword(s, s.objects[target.id], 'flying'));
});
for (const [name, token, p, t, subtype] of [
  ['Bovine Intervention', 'White Ox Token', 2, 2, 'Ox'],
  ['Stroke of Midnight', 'White Human Token', 1, 1, 'Human'],
]) {
  for (const targetName of ['Grizzly Bears', 'Food Token', 'Diamond Pick-Axe'])
    test(`${name}: ${targetName} gives its controller the exact replacement token even if indestructible`, () => {
      let s = position();
      mana(s);
      const target = put(s, targetName, 0);
      target.controller = 1;
      [s] = cast(s, name, { target: ref(target) });
      s = resolve(s);
      if (targetName === 'Food Token') assert(!s.objects[target.id]);
      else
        assert.equal(
          s.objects[target.id].zone,
          targetName === 'Diamond Pick-Axe' ? 'battlefield' : 'graveyard',
        );
      const [created] = battlefield(s, token);
      assert(created);
      assert.equal(battlefield(s, token).length, 1);
      assert.equal(created.controller, 1);
      assert.equal(stats(s, created).power, p);
      assert.equal(stats(s, created).toughness, t);
      assert.deepEqual(definition(s, created).subtypes, [subtype]);
      assert.deepEqual(definition(s, created).color, ['W']);
      assert.deepEqual(definition(s, created).keywords, []);
    });
  test(`${name}: land rejection and stale targets do not create compensation tokens`, () => {
    let s = position();
    mana(s);
    const spell = put(s, name, 0, 'hand'),
      land = put(s, 'Forest', 1),
      target = put(s, 'Grizzly Bears', 1);
    rejectUnchanged(s, { type: 'cast', player: 0, card: spell.id, target: ref(land) });
    s = act(s, 'cast', { card: spell.id, target: ref(target) });
    move(s, s.objects[target.id], 'hand');
    s = resolve(s);
    assert.equal(battlefield(s, token).length, 0);
  });
}
test('Bovine Intervention rejects enchantments; Stroke of Midnight destroys them', () => {
  let s = position();
  mana(s);
  const target = put(s, 'Pacifism', 1),
    bovine = put(s, 'Bovine Intervention', 0, 'hand');
  const bear = put(s, 'Grizzly Bears');
  target.attachedTo = ref(bear);
  rejectUnchanged(s, { type: 'cast', player: 0, card: bovine.id, target: ref(target) });
  [s] = cast(s, 'Stroke of Midnight', { target: ref(target) });
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'graveyard');
  assert.equal(battlefield(s, 'White Human Token').length, 1);
});
for (const controller of [0, 1])
  test(`Hotshot Investigators: returns another creature controlled by ${controller}, investigates only for its controller`, () => {
    let s = position();
    const target = put(s, 'Grizzly Bears', 1 - controller);
    target.controller = controller;
    const source = enter(s, 'Hotshot Investigators');
    rejectUnchanged(s, {
      type: 'chooseTriggerTargets',
      player: 0,
      targets: { returned: [ref(source)] },
    });
    s = act(s, 'chooseTriggerTargets', { targets: { returned: [ref(target)] } });
    s = resolve(s);
    assert.equal(s.objects[target.id].zone, 'hand');
    assert.equal(battlefield(s, 'Clue Token').length, controller === 0 ? 1 : 0);
  });
test('Hotshot Investigators: optional target can be omitted, or become illegal without producing a Clue', () => {
  for (const omit of [true, false]) {
    let s = position();
    const target = put(s, 'Grizzly Bears');
    enter(s, 'Hotshot Investigators');
    s = act(s, 'chooseTriggerTargets', { targets: { returned: omit ? [] : [ref(target)] } });
    if (!omit) move(s, s.objects[target.id], 'graveyard');
    s = resolve(s);
    assert.equal(battlefield(s, 'Clue Token').length, 0);
  }
});
test('Hotshot Investigators: pre-bounce control uses resolution state after its source leaves', () => {
  let s = position();
  const creature = put(s, 'White Human Token', 1);
  const source = enter(s, 'Hotshot Investigators');
  s = act(s, 'chooseTriggerTargets', { targets: { returned: [ref(creature)] } });
  s.objects[creature.id].controller = 0;
  move(s, s.objects[source.id], 'graveyard');
  s = resolve(s);
  assert(!s.objects[creature.id]);
  assert.equal(battlefield(s, 'Clue Token').length, 1);
});
test('Pia: actual optional discard leads to an enchantment-only revealed search and shuffle', () => {
  let s = position();
  const discarded = put(s, 'Forest', 0, 'hand'),
    enchantment = put(s, 'Pacifism', 0, 'library'),
    wrong = put(s, 'Grizzly Bears', 0, 'library');
  enter(s, 'Pia, Aether Ascetic');
  s = resolve(s);
  assert.equal(s.choice.kind, 'discardEffect');
  assert.equal(s.choice.optional, true);
  s = act(s, 'discardEffect', { cards: [discarded.id] });
  assert.equal(s.choice.kind, 'librarySearch');
  assert.equal(s.choice.reveal, true);
  rejectUnchanged(s, { type: 'searchLibrary', player: 0, cards: [wrong.id] });
  s = act(s, 'searchLibrary', { cards: [enchantment.id] });
  assert.equal(s.objects[enchantment.id].zone, 'hand');
  assert.equal(s.objects[discarded.id].zone, 'graveyard');
  assert(s.events.some((e) => e.type === 'libraryShuffled'));
});
for (const empty of [false, true])
  test(`Pia: ${empty ? 'empty hand' : 'declined discard'} does not search or shuffle`, () => {
    let s = position();
    if (!empty) put(s, 'Forest', 0, 'hand');
    enter(s, 'Pia, Aether Ascetic');
    s = resolve(s);
    if (!empty) s = act(s, 'discardEffect', { cards: [] });
    assert.equal(s.choice, null);
    assert(!s.events.some((e) => e.type === 'libraryShuffled'));
    assert.equal(s.players[0].hand.length, empty ? 0 : 1);
  });
test('Pia: departed source still searches, including legal failure to find', () => {
  let s = position();
  const discarded = put(s, 'Forest', 0, 'hand'),
    source = enter(s, 'Pia, Aether Ascetic');
  move(s, source, 'graveyard');
  s = resolve(s);
  s = act(s, 'discardEffect', { cards: [discarded.id] });
  s = act(s, 'searchLibrary', { cards: [] });
  assert.equal(s.objects[source.id].zone, 'graveyard');
  assert(s.events.some((e) => e.type === 'libraryShuffled'));
});
for (const empty of [false, true])
  test(`Vaultguard Trooper: may discard ${empty ? 'empty' : 'entire'} hand and draw exactly two`, () => {
    let s = position();
    put(s, 'Vaultguard Trooper');
    for (let i = 0; i < 2; i++) put(s, 'Grizzly Bears').tapped = true;
    const cards = empty
      ? []
      : [put(s, 'Forest', 0, 'hand').id, put(s, 'Grizzly Bears', 0, 'hand').id];
    endStep(s);
    s = resolve(s);
    assert.equal(s.choice.kind, 'optionalEffect');
    s = act(s, 'resolveOptional', { accept: true });
    if (!empty) {
      assert.equal(s.choice.count, 2);
      s = act(s, 'discardEffect', { cards });
    }
    assert.equal(s.players[0].hand.length, 2);
    for (const id of cards) assert.equal(s.objects[id].zone, 'graveyard');
  });
test('Vaultguard Trooper: opponent end step and fewer than two own tapped creatures never trigger', () => {
  const s = position();
  put(s, 'Vaultguard Trooper');
  put(s, 'Grizzly Bears').tapped = true;
  put(s, 'Grizzly Bears', 1).tapped = true;
  put(s, 'Food Token').tapped = true;
  endStep(s);
  assert.equal(s.stack.length, 0);
  put(s, 'Grizzly Bears').tapped = true;
  notifyTriggers(s, 'step', { player: 1, step: 'end' });
  stabilize(s);
  assert.equal(s.stack.length, 0);
});
test('Vaultguard Trooper: intervening condition rechecks at resolution; declining preserves hand', () => {
  for (const keep of [false, true]) {
    let s = position();
    put(s, 'Vaultguard Trooper');
    const a = put(s, 'Grizzly Bears'),
      b = put(s, 'Grizzly Bears'),
      hand = put(s, 'Forest', 0, 'hand');
    a.tapped = b.tapped = true;
    endStep(s);
    if (!keep) s.objects[b.id].tapped = false;
    s = resolve(s);
    if (keep) s = act(s, 'resolveOptional', { accept: false });
    assert.equal(s.choice, null);
    assert.deepEqual(s.players[0].hand, [hand.id]);
  }
});
test('Pia: recorded optional discard and search continuations replay identically', () => {
  let s = createGame({
    seed: 81,
    mulligan: false,
    minimumDeckSize: 24,
    catalog,
    decks: [
      [
        ...Array(16).fill('Forest'),
        ...Array(4).fill('Pia, Aether Ascetic'),
        ...Array(4).fill('Pacifism'),
      ],
      Array(24).fill('Plains'),
    ],
  });
  let castAction;
  for (let i = 0; i < 350 && !castAction; i++) {
    const player = s.choice?.player ?? s.priority;
    const actions = legalActions(s, player);
    castAction =
      player === 0 &&
      !s.choice &&
      actions.find((a) => a.type === 'cast' && s.objects[a.card]?.name === 'Pia, Aether Ascetic');
    if (castAction) break;
    const command = s.choice
      ? chooseBotCommand(s, player)
      : (actions.find((a) => a.type === 'playLand') ?? { type: 'pass' });
    s = act(s, command.type, command, player);
  }
  assert(castAction);
  s = act(s, 'cast', castAction, 0);
  s = resolve(s);
  s = resolve(s);
  assert.equal(s.choice.kind, 'discardEffect');
  assert.deepEqual(replay(exportReplay(s)), s);
  s = act(s, 'discardEffect', { cards: [s.players[0].hand[0]] });
  assert.equal(s.choice.kind, 'librarySearch');
  assert.deepEqual(replay(exportReplay(s)), s);
  s = act(s, 'searchLibrary', { cards: [] });
  assert.equal(s.choice, null);
  assert.deepEqual(replay(exportReplay(s)), s);
});

for (const [name, token] of [
  ['Bovine Intervention', 'White Ox Token'],
  ['Stroke of Midnight', 'White Human Token'],
]) {
  for (const controller of [0, 1])
    test(`${name}: controller changing to ${controller} after casting receives the token`, () => {
      let s = position();
      mana(s);
      const target = put(s, 'Grizzly Bears', 1 - controller);
      [s] = cast(s, name, { target: ref(target) });
      s.objects[target.id].controller = controller;
      s = resolve(s);
      assert.equal(s.objects[target.id].zone, 'graveyard');
      const [created] = battlefield(s, token);
      assert.equal(created.controller, controller);
    });
}
test('Thwip!: both +2/+2 and flying expire at cleanup while printed reach remains', () => {
  let s = position();
  lands(s, 'Plains', 1);
  const target = put(s, 'Giant Spider');
  [s] = cast(s, 'Thwip!', { target: ref(target) });
  s = resolve(s);
  const turn = s.turn;
  for (let i = 0; i < 40 && s.turn === turn; i++) {
    const player = s.choice?.player ?? s.priority;
    const command = s.choice ? chooseBotCommand(s, player) : { type: 'pass' };
    s = act(s, command.type, command, player);
  }
  assert(s.turn > turn);
  assert.equal(stats(s, s.objects[target.id]).power, 2);
  assert.equal(stats(s, s.objects[target.id]).toughness, 4);
  assert(!hasKeyword(s, s.objects[target.id], 'flying'));
  assert(hasKeyword(s, s.objects[target.id], 'reach'));
});
