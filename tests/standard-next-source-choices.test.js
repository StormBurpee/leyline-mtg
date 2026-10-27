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
  'Abandon Attachments',
  'Benthic Criminologists',
  'Candlestick',
  'Diamond Pick-Axe',
  'Highway Robbery',
  "K'un-Lun Warrior",
  'Melded Moxite',
  'Narset, Jeskai Waymaster',
  'Peer Past the Veil',
  'Pirate Hat',
  'Pursue the Past',
  'Ragged Short Spear',
  'Rook Turret',
  'Stadium Tidalmage',
  'Vision of Love',
  'Witherbloom Charm',
  'Zealous Display',
  "Zuko's Exile",
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
  for (const land of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']) lands(s, land, 5);
}
function enter(s, name, player = 0) {
  const o = put(s, name, player, 'hand');
  enterBattlefieldBatch(s, [{ object: o }]);
  stabilize(s);
  return o;
}
function attack(s, creature) {
  notifyTriggers(s, 'attack', {
    object: s.objects[creature.id],
    controller: s.objects[creature.id].controller,
  });
  stabilize(s);
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
const onBattlefield = (s, name) =>
  Object.values(s.objects).filter((o) => o.name === name && o.zone === 'battlefield');

for (const source of sources)
  test(`${source.name}: schema, full source text and compiler round trip`, () => {
    assert.equal(validate(source), true, source.name);
    assert.equal(definitions[source.name].text, source.rulesText);
    const result = compileCard(
      sourceFromDefinition(definitions[source.name], { id: source.id, idsByName }),
      { identities },
    );
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.definition, definitions[source.name]);
  });

for (const name of ['Abandon Attachments', 'Pursue the Past'])
  test(`${name}: discard is chosen during resolution, then draw two`, () => {
    let s = position();
    mana(s);
    const discarded = put(s, 'Forest', 0, 'hand');
    [s] = cast(s, name);
    assert.equal(s.objects[discarded.id].zone, 'hand');
    s = resolve(s);
    if (name === 'Pursue the Past') {
      assert.equal(s.choice.kind, 'effectChoice');
      assert.equal(s.players[0].life, 22);
      s = act(s, 'chooseEffect', { option: 0 });
      rejectUnchanged(s, { type: 'discardEffect', player: 0, cards: [] });
    } else {
      assert.equal(s.choice.kind, 'discardEffect');
      assert.equal(s.choice.optional, true);
      const declined = act(s, 'discardEffect', { cards: [] });
      assert.equal(declined.choice, null);
      assert.equal(declined.resolving, null);
      assert.equal(declined.objects[discarded.id].zone, 'hand');
      assert.equal(declined.players[0].hand.length, 1);
      assert.equal(declined.players[0].library.length, s.players[0].library.length);
    }
    assert.equal(s.choice.kind, 'discardEffect');
    rejectUnchanged(s, { type: 'discardEffect', player: 0, cards: ['missing'] });
    s = act(s, 'discardEffect', { cards: [discarded.id] });
    assert.equal(s.objects[discarded.id].zone, 'graveyard');
    assert.equal(s.players[0].hand.length, 2);
  });
for (const name of ['Abandon Attachments', 'Pursue the Past'])
  test(`${name}: empty hand cannot obtain a free draw`, () => {
    let s = position();
    mana(s);
    [s] = cast(s, name);
    s = resolve(s);
    if (name === 'Pursue the Past') {
      assert.deepEqual(
        s.choice.options.map((o) => o.index),
        [1],
      );
      rejectUnchanged(s, { type: 'chooseEffect', player: 0, option: 0 });
      s = act(s, 'chooseEffect', { option: 1 });
    } else {
      assert.equal(s.choice, null);
      assert.equal(s.stack.length, 0);
      rejectUnchanged(s, { type: 'discardEffect', player: 0, cards: [] });
    }
    assert.equal(s.players[0].hand.length, 0);
  });
test('Pursue the Past: graveyard flashback survives a declining choice and exiles', () => {
  let s = position();
  mana(s);
  let card;
  [s, card] = cast(s, 'Pursue the Past', {}, 'graveyard');
  assert.equal(s.stack.at(-1).flashbackPaid, true);
  s = resolve(s);
  s = act(s, 'chooseEffect', { option: 1 });
  assert.equal(s.players[0].life, 22);
  assert.equal(s.objects[card.id].zone, 'exile');
});
for (const name of ['Melded Moxite', 'Ragged Short Spear'])
  test(`${name}: enter choice resolves after the permanent leaves`, () => {
    let s = position();
    const discarded = put(s, 'Forest', 0, 'hand');
    const source = enter(s, name);
    move(s, s.objects[source.id], 'graveyard');
    s = resolve(s);
    s = act(s, 'chooseEffect', { option: 0 });
    s = act(s, 'discardEffect', { cards: [discarded.id] });
    assert.equal(s.players[0].hand.length, 2);
    assert.equal(s.objects[source.id].zone, 'graveyard');
  });
test('Melded Moxite: sacrifices as an activation cost, then creates one tapped 2/2 artifact Robot', () => {
  let s = position();
  lands(s, 'Mountain', 3);
  const source = put(s, 'Melded Moxite');
  s = act(s, 'activate', { card: source.id, ability: 0 });
  assert.equal(s.objects[source.id].zone, 'graveyard');
  assert.equal(onBattlefield(s, 'Robot Token').length, 0);
  s = resolve(s);
  const [robot] = onBattlefield(s, 'Robot Token');
  assert(robot);
  assert.equal(robot.tapped, true);
  assert.equal(stats(s, robot).power, 2);
  assert.equal(stats(s, robot).toughness, 2);
});
test('Ragged Short Spear: equip retains the separate +2/+0 clause', () => {
  let s = position();
  lands(s, 'Mountain', 3);
  const equipment = put(s, 'Ragged Short Spear'),
    bear = put(s, 'Grizzly Bears');
  s = act(s, 'activate', { card: equipment.id, ability: 0, target: ref(bear) });
  s = resolve(s);
  assert.deepEqual(s.objects[equipment.id].attachedTo, ref(s.objects[bear.id]));
  assert.equal(stats(s, s.objects[bear.id]).power, 4);
  assert.equal(stats(s, s.objects[bear.id]).toughness, 2);
});
for (const name of ['Vision of Love', "K'un-Lun Warrior"])
  for (const option of [0, 1, 2])
    test(`${name}: resolution alternative ${option} pays exactly its chosen action`, () => {
      let s = position();
      mana(s);
      const artifact = put(s, 'Food Token'),
        discarded = put(s, 'Forest', 0, 'hand');
      if (name === 'Vision of Love') [s] = cast(s, name);
      else enter(s, name);
      s = resolve(s);
      assert.equal(s.choice.kind, 'effectChoice');
      s = act(s, 'chooseEffect', { option });
      if (option === 0) {
        assert.equal(s.choice.kind, 'sacrifice');
        s = act(s, 'sacrifice', { cards: [artifact.id] });
      }
      if (option === 1) s = act(s, 'discardEffect', { cards: [discarded.id] });
      const draws = name === 'Vision of Love' ? 2 : 1;
      assert.equal(s.players[0].hand.length, option === 0 ? 1 + draws : option === 1 ? draws : 1);
      assert.equal(!!s.objects[artifact.id], option !== 0);
      assert.equal(s.objects[discarded.id].zone, option === 1 ? 'graveyard' : 'hand');
    });
test('Vision of Love: unavailable artifact and hand payments are absent; opponent artifacts cannot pay', () => {
  let s = position();
  lands(s, 'Mountain', 2);
  put(s, 'Food Token', 1);
  [s] = cast(s, 'Vision of Love');
  s = resolve(s);
  assert.deepEqual(
    s.choice.options.map((o) => o.index),
    [2],
  );
  for (const option of [0, 1]) rejectUnchanged(s, { type: 'chooseEffect', player: 0, option });
  s = act(s, 'chooseEffect', { option: 2 });
  assert.equal(s.players[0].hand.length, 0);
});
for (const event of ['enter', 'attack'])
  test(`Benthic Criminologists: ${event} may sacrifice only a controlled artifact and draws once`, () => {
    let s = position();
    const own = put(s, 'Food Token'),
      opposing = put(s, 'Food Token', 1),
      bear = put(s, 'Grizzly Bears');
    const source =
      event === 'enter' ? enter(s, 'Benthic Criminologists') : put(s, 'Benthic Criminologists');
    if (event === 'attack') attack(s, source);
    s = resolve(s);
    s = act(s, 'chooseEffect', { option: 0 });
    for (const bad of [opposing, bear, source])
      rejectUnchanged(s, { type: 'sacrifice', player: 0, cards: [bad.id] });
    s = act(s, 'sacrifice', { cards: [own.id] });
    assert.equal(s.players[0].hand.length, 1);
    assert.equal(s.objects[opposing.id].zone, 'battlefield');
  });
test('Benthic Criminologists: lost artifact before resolution removes the payment choice', () => {
  let s = position();
  const artifact = put(s, 'Food Token');
  enter(s, 'Benthic Criminologists');
  move(s, artifact, 'graveyard');
  stabilize(s);
  s = resolve(s);
  assert.deepEqual(
    s.choice.options.map((o) => o.index),
    [1],
  );
  s = act(s, 'chooseEffect', { option: 1 });
  assert.equal(s.players[0].hand.length, 0);
});
test('Highway Robbery: plot does not cast; later free cast can sacrifice the tapped land used to plot', () => {
  let s = position();
  const [mountain] = lands(s, 'Mountain', 2);
  const card = put(s, 'Highway Robbery', 0, 'hand');
  s = act(s, 'plot', { card: card.id });
  assert.equal(s.objects[card.id].zone, 'exile');
  rejectUnchanged(s, { type: 'cast', player: 0, card: card.id });
  s.turn += 2;
  s = act(s, 'cast', { card: card.id });
  s = resolve(s);
  s = act(s, 'chooseEffect', { option: 1 });
  assert.equal(s.choice.kind, 'sacrifice');
  s = act(s, 'sacrifice', { cards: [mountain.id] });
  assert.equal(s.players[0].hand.length, 2);
  assert.equal(s.objects[mountain.id].zone, 'graveyard');
});
for (const option of [0, 2])
  test(`Highway Robbery: discard and decline branch ${option}`, () => {
    let s = position();
    mana(s);
    const discarded = put(s, 'Forest', 0, 'hand');
    [s] = cast(s, 'Highway Robbery');
    s = resolve(s);
    s = act(s, 'chooseEffect', { option });
    if (option === 0) s = act(s, 'discardEffect', { cards: [discarded.id] });
    assert.equal(s.players[0].hand.length, option === 0 ? 2 : 1);
  });
for (const mode of [0, 1, 2])
  test(`Witherbloom Charm: mode ${mode} preserves its complete clause`, () => {
    let s = position();
    mana(s);
    const victim = put(s, 'Grizzly Bears', 1);
    let chosen;
    if (mode === 0) chosen = put(s, 'Forest');
    [s] = cast(s, 'Witherbloom Charm', { mode, ...(mode === 2 ? { target: ref(victim) } : {}) });
    s = resolve(s);
    if (mode === 0) {
      s = act(s, 'chooseEffect', { option: 0 });
      s = act(s, 'sacrifice', { cards: [chosen.id] });
      assert.equal(s.players[0].hand.length, 2);
    }
    if (mode === 1) assert.equal(s.players[0].life, 25);
    assert.equal(s.objects[victim.id].zone, mode === 2 ? 'graveyard' : 'battlefield');
  });
test('Witherbloom Charm: destruction rejects land and mana value 3+, and resolves only on a still-legal target', () => {
  const s = position();
  mana(s);
  const card = put(s, 'Witherbloom Charm', 0, 'hand');
  for (const name of ['Forest', 'Centaur Courser']) {
    const bad = put(s, name, 1);
    rejectUnchanged(s, { type: 'cast', player: 0, card: card.id, mode: 2, target: ref(bad) });
  }
  const target = put(s, 'Grizzly Bears', 1);
  let t = act(s, 'cast', { card: card.id, mode: 2, target: ref(target) });
  move(t, t.objects[target.id], 'hand');
  t = resolve(t);
  assert.equal(t.objects[target.id].zone, 'hand');
});
for (const name of ['Candlestick', 'Diamond Pick-Axe', 'Pirate Hat'])
  test(`${name}: attack grant belongs to the equipped creature, survives source removal`, () => {
    let s = position();
    const equipment = put(s, name, 0),
      recipient = put(s, 'Grizzly Bears', 1);
    equipment.attachedTo = ref(recipient);
    assert.equal(stats(s, recipient).power, 3);
    attack(s, recipient);
    assert.equal(s.stack.length, 1);
    assert.equal(s.stack[0].controller, 1);
    move(s, s.objects[equipment.id], 'graveyard');
    s = resolve(s);
    if (name === 'Candlestick') {
      assert.equal(s.choice.kind, 'libraryOrder');
      assert.equal(s.choice.player, 1);
      const cards = s.choice.cards;
      s = act(s, 'orderLibrary', { top: [], rest: cards });
      assert.equal(s.players[1].graveyard.length, 2);
    }
    if (name === 'Diamond Pick-Axe') {
      const [treasure] = onBattlefield(s, 'Treasure Token');
      assert(treasure);
      assert.equal(treasure.controller, 1);
    }
    if (name === 'Pirate Hat') {
      assert.equal(s.choice.player, 1);
      const [card] = s.players[1].hand;
      s = act(s, 'discardEffect', { cards: [card] });
      assert.equal(s.players[1].hand.length, 0);
    }
    assert.equal(s.players[0].hand.length, 0);
    assert.equal(stats(s, s.objects[recipient.id]).power, 2);
  });
test('Equipment attack grants do not fire while unattached and transfer with reattachment', () => {
  let s = position();
  const equipment = put(s, 'Diamond Pick-Axe'),
    first = put(s, 'Grizzly Bears'),
    second = put(s, 'Grizzly Bears');
  attack(s, first);
  assert.equal(s.stack.length, 0);
  equipment.attachedTo = ref(first);
  equipment.attachedTo = ref(second);
  attack(s, first);
  assert.equal(s.stack.length, 0);
  attack(s, second);
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(onBattlefield(s, 'Treasure Token').length, 1);
});
test('Candlestick: sacrifice-draw does not require tapping, and removes its grant', () => {
  let s = position();
  lands(s, 'Island', 2);
  const c = put(s, 'Candlestick'),
    bear = put(s, 'Grizzly Bears');
  c.tapped = true;
  c.attachedTo = ref(bear);
  s = act(s, 'activate', { card: c.id, ability: 0 });
  assert.equal(s.objects[c.id].zone, 'graveyard');
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 1);
  attack(s, bear);
  assert.equal(s.stack.length, 0);
});
test('Diamond Pick-Axe: indestructible belongs to the Equipment, not its recipient', () => {
  const s = position();
  const e = put(s, 'Diamond Pick-Axe'),
    bear = put(s, 'Grizzly Bears');
  e.attachedTo = ref(bear);
  assert(hasKeyword(s, e, 'indestructible'));
  assert(!hasKeyword(s, bear, 'indestructible'));
});
test('Pirate Hat: cheaper equip needs Pirate, ordinary equip accepts another creature', () => {
  let s = position();
  lands(s, 'Island', 3);
  const e = put(s, 'Pirate Hat'),
    bear = put(s, 'Grizzly Bears'),
    pirate = put(s, 'Changeling Wayfinder');
  rejectUnchanged(s, { type: 'activate', player: 0, card: e.id, ability: 0, target: ref(bear) });
  s = act(s, 'activate', { card: e.id, ability: 0, target: ref(pirate) });
  s = resolve(s);
  assert.deepEqual(s.objects[e.id].attachedTo, ref(s.objects[pirate.id]));
  s = act(s, 'activate', { card: e.id, ability: 1, target: ref(bear) });
  s = resolve(s);
  assert.deepEqual(s.objects[e.id].attachedTo, ref(s.objects[bear.id]));
});
for (const accept of [true, false])
  for (const name of ['Rook Turret', 'Stadium Tidalmage'])
    test(`${name}: optional looting ${accept ? 'accepts and discards' : 'declines both actions'}`, () => {
      let s = position();
      if (name === 'Rook Turret') {
        put(s, name);
        enter(s, 'Food Token');
      } else enter(s, name);
      s = resolve(s);
      assert.equal(s.choice.kind, 'optionalEffect');
      s = act(s, 'resolveOptional', { accept });
      if (accept) {
        assert.equal(s.players[0].hand.length, 1);
        const [card] = s.players[0].hand;
        s = act(s, 'discardEffect', { cards: [card] });
      }
      assert.equal(s.players[0].hand.length, 0);
      assert.equal(s.players[0].graveyard.length, accept ? 1 : 0);
    });
test('Rook Turret: excludes itself, opponent artifacts and own nonartifacts', () => {
  let s = position();
  enter(s, 'Rook Turret');
  assert.equal(s.stack.length, 0);
  enter(s, 'Food Token', 1);
  enter(s, 'Grizzly Bears');
  assert.equal(s.stack.length, 0);
});
test('Stadium Tidalmage: attack loots even if the source leaves before resolution', () => {
  let s = position();
  const o = put(s, 'Stadium Tidalmage');
  attack(s, o);
  move(s, o, 'graveyard');
  s = resolve(s);
  s = act(s, 'resolveOptional', { accept: true });
  s = act(s, 'discardEffect', { cards: [s.players[0].hand[0]] });
  assert.equal(s.players[0].graveyard.length, 2);
});
for (const empty of [false, true])
  test(`Narset: discard ${empty ? 'empty' : 'entire'} hand then count all spells cast this turn`, () => {
    let s = position();
    mana(s);
    put(s, 'Narset, Jeskai Waymaster');
    [s] = cast(s, 'Zealous Display');
    s = resolve(s);
    [s] = cast(s, 'Zealous Display');
    s = resolve(s);
    const a = empty ? null : put(s, 'Forest', 0, 'hand'),
      b = empty ? null : put(s, 'Grizzly Bears', 0, 'hand');
    notifyTriggers(s, 'step', { player: 0, step: 'end' });
    stabilize(s);
    s = resolve(s);
    s = act(s, 'resolveOptional', { accept: true });
    if (!empty) {
      assert.equal(s.choice.count, 2);
      s = act(s, 'discardEffect', { cards: [a.id, b.id] });
    }
    assert.equal(s.players[0].hand.length, 2);
  });
test('Narset: opponent end step does not trigger; own optional decline preserves the hand', () => {
  let s = position();
  put(s, 'Narset, Jeskai Waymaster');
  const card = put(s, 'Forest', 0, 'hand');
  notifyTriggers(s, 'step', { player: 1, step: 'end' });
  stabilize(s);
  assert.equal(s.stack.length, 0);
  notifyTriggers(s, 'step', { player: 0, step: 'end' });
  stabilize(s);
  s = resolve(s);
  s = act(s, 'resolveOptional', { accept: false });
  assert.equal(s.objects[card.id].zone, 'hand');
});
test('Peer Past the Veil: graveyard types are counted after discarding and do not include the resolving spell', () => {
  let s = position();
  mana(s);
  const a = put(s, 'Forest', 0, 'hand'),
    b = put(s, 'Ornithopter', 0, 'hand');
  let spell;
  [s, spell] = cast(s, 'Peer Past the Veil');
  s = resolve(s);
  assert.equal(s.choice.count, 2);
  s = act(s, 'discardEffect', { cards: [a.id, b.id] });
  assert.equal(s.players[0].hand.length, 3);
  assert.equal(s.objects[spell.id].zone, 'graveyard');
});
test('Peer Past the Veil: empty hand still draws from preexisting graveyard types', () => {
  let s = position();
  mana(s);
  put(s, 'Forest', 0, 'graveyard');
  put(s, 'Ornithopter', 0, 'graveyard');
  [s] = cast(s, 'Peer Past the Veil');
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 3);
});
for (const active of [0, 1])
  test(`Zealous Display: own creatures gain power; untap only during ${active ? 'opponent' : 'own'} turn`, () => {
    let s = position();
    mana(s);
    s.active = active;
    const own = put(s, 'Grizzly Bears'),
      other = put(s, 'Grizzly Bears', 1),
      noncreature = put(s, 'Food Token');
    own.tapped = other.tapped = noncreature.tapped = true;
    [s] = cast(s, 'Zealous Display');
    s = resolve(s);
    assert.equal(stats(s, s.objects[own.id]).power, 4);
    assert.equal(stats(s, s.objects[other.id]).power, 2);
    assert.equal(s.objects[own.id].tapped, active === 0);
    assert.equal(s.objects[other.id].tapped, true);
    assert.equal(s.objects[noncreature.id].tapped, true);
  });
for (const token of [false, true])
  test(`Zuko's Exile: ${token ? 'token' : 'nontoken'} leaves, controller creates a Clue from the pre-move binding`, () => {
    let s = position();
    mana(s);
    const target = put(s, token ? 'Food Token' : 'Grizzly Bears', 1);
    [s] = cast(s, "Zuko's Exile", { target: ref(target) });
    s = resolve(s);
    if (token) assert(!s.objects[target.id]);
    else assert.equal(s.objects[target.id].zone, 'exile');
    const [clue] = onBattlefield(s, 'Clue Token');
    assert(clue);
    assert.equal(clue.controller, 1);
  });
test("Zuko's Exile: target loss prevents the Clue and rejects land targets", () => {
  let s = position();
  mana(s);
  const card = put(s, "Zuko's Exile", 0, 'hand'),
    land = put(s, 'Forest', 1),
    target = put(s, 'Grizzly Bears', 1);
  rejectUnchanged(s, { type: 'cast', player: 0, card: card.id, target: ref(land) });
  s = act(s, 'cast', { card: card.id, target: ref(target) });
  move(s, s.objects[target.id], 'hand');
  s = resolve(s);
  assert.equal(onBattlefield(s, 'Clue Token').length, 0);
});

test('Abandon Attachments: optional payment, discard continuation and full outcome replay deterministically', () => {
  let s = createGame({
    seed: 81,
    mulligan: false,
    minimumDeckSize: 20,
    catalog,
    decks: [
      [...Array(16).fill('Island'), ...Array(4).fill('Abandon Attachments')],
      Array(20).fill('Forest'),
    ],
  });
  let castAction;
  for (let i = 0; i < 250 && !castAction; i++) {
    const player = s.choice?.player ?? s.priority;
    const actions = legalActions(s, player);
    castAction =
      player === 0 &&
      !s.choice &&
      actions.find((a) => a.type === 'cast' && s.objects[a.card]?.name === 'Abandon Attachments');
    if (castAction) break;
    const command = s.choice
      ? chooseBotCommand(s, player)
      : (actions.find((a) => a.type === 'playLand') ?? { type: 'pass' });
    s = act(s, command.type, command, player);
  }
  assert(castAction, 'Reached an actual legal cast through recorded commands');
  s = act(s, 'cast', castAction, 0);
  s = resolve(s);
  assert.equal(s.choice.kind, 'discardEffect');
  assert.equal(s.choice.optional, true);
  assert.deepEqual(replay(exportReplay(s)), s);
  const declined = act(s, 'discardEffect', { cards: [] });
  assert.equal(declined.choice, null);
  assert.equal(declined.resolving, null);
  assert.equal(declined.players[0].hand.length, s.players[0].hand.length);
  assert.equal(declined.players[0].library.length, s.players[0].library.length);
  assert.deepEqual(replay(exportReplay(declined)), declined);
  s = act(s, 'discardEffect', { cards: [s.players[0].hand[0]] });
  assert.equal(s.choice, null);
  assert.deepEqual(replay(exportReplay(s)), s);
});

test("Zuko's Exile: pre-move controller rather than owner receives the Clue", () => {
  let s = position();
  mana(s);
  const target = put(s, 'Grizzly Bears', 0);
  target.controller = 1;
  [s] = cast(s, "Zuko's Exile", { target: ref(target) });
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'exile');
  assert.equal(s.objects[target.id].owner, 0);
  const [clue] = onBattlefield(s, 'Clue Token');
  assert.equal(clue.controller, 1);
});
