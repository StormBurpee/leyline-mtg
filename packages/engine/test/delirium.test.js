import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CARDS,
  createRegistry,
  dispatch,
  legalActions,
  ref,
  stats,
  hasKeyword,
} from '../src/index.js';
import { compileCard } from '../../cards/compiler.js';
import { numericValue } from '../src/numeric-values.js';
import { move, notifyTriggers, addModifier } from '../src/model.js';
import { canAttack, canBlock } from '../src/combat.js';
import { enterBattlefieldBatch, stabilize } from '../src/effects.js';
import { finishCleanup } from '../src/turn.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
const reviewed = JSON.parse(
  readFileSync(new URL('../../../tests/fixtures/delirium-oracle-reviewed.json', import.meta.url)),
);
const definitions = Object.fromEntries(
  reviewed.cards.map(({ name }) => {
    const source = JSON.parse(
      readFileSync(
        new URL(
          `../../cards/cards/${name.toLowerCase().replaceAll(' ', '-')}.json`,
          import.meta.url,
        ),
      ),
    );
    const result = compileCard(source);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    return [name, result.definition];
  }),
);
const catalog = createRegistry({ ...CARDS, ...definitions });
const setup = () => {
  const s = fixture();
  s.catalog = catalog;
  return s;
};
const count = (s, player = 'you', controller = 0, excludedIds = []) =>
  numericValue(s, { kind: 'graveyardCardTypes', player }, { controller, excludedIds });
// Exactly four types from three cards; the artifact creature counts twice.
const delirium = (s, player = 0) =>
  ['Wildfire Wickerfolk', 'Forest', 'Opt'].map((name) => put(s, name, player, 'graveyard'));
const ready = (s) => {
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: s.active };
  return s;
};
const cast = (s, name, target) => act(s, 'cast', { card: put(s, name, 0, 'hand').id, target });

test('graveyard card types form an owner-bound union, excluding cards in other zones and duplicate types', () => {
  const s = setup();
  const artifact = put(s, 'Wildfire Wickerfolk', 0, 'graveyard');
  artifact.controller = 1;
  put(s, 'Patchwork Beastie', 0, 'graveyard');
  put(s, 'Forest', 0, 'graveyard');
  put(s, 'Mountain', 0, 'graveyard');
  put(s, 'Opt', 1, 'graveyard');
  put(s, 'Naturalize', 1, 'graveyard');
  for (const zone of ['hand', 'library', 'exile', 'battlefield']) put(s, 'Pacifism', 0, zone);
  assert.equal(count(s), 3);
  assert.equal(count(s, 'opponent'), 1);
  assert.equal(count(s, 'all'), 4);
  assert.equal(count(s, 'you', 1), 1);
  assert.equal(count(s, 'opponent', 1), 3);
  assert.equal(count(s, 'you', 0, [artifact.id]), 3);
  for (const o of Object.values(s.objects)) if (o.name === 'Patchwork Beastie') move(s, o, 'exile');
  assert.equal(count(s, 'you', 0, [artifact.id]), 1);
});

test('token, spell-copy and hidden records add no types; Adventure graveyard cards use their main face', () => {
  const s = setup();
  put(s, 'Treasure Token', 0, 'graveyard');
  const copy = put(s, 'Opt', 0, 'graveyard');
  copy.spellCopy = true;
  const hidden = put(s, 'Forest', 0, 'graveyard');
  hidden.hidden = true;
  const adventure = put(s, 'Virtue of Persistence // Locthwain Scorn', 0, 'graveyard');
  adventure.adventureCast = true;
  assert.equal(count(s), 1);
  put(s, 'Pacifism', 0, 'graveyard');
  assert.equal(count(s), 1);
  move(s, copy, 'exile');
  move(s, hidden, 'exile');
});

test('Wildfire and Spineseeker bonuses follow current graveyard and source controller immediately', () => {
  const s = setup();
  const wicker = put(s, 'Wildfire Wickerfolk');
  const centipede = put(s, 'Spineseeker Centipede');
  assert.deepEqual(stats(s, wicker), { power: 3, toughness: 2 });
  assert(hasKeyword(s, wicker, 'haste'));
  assert(!hasKeyword(s, wicker, 'trample'));
  const grave = delirium(s);
  assert.deepEqual(stats(s, wicker), { power: 4, toughness: 3 });
  assert.deepEqual(stats(s, centipede), { power: 3, toughness: 3 });
  assert(hasKeyword(s, wicker, 'trample'));
  assert(hasKeyword(s, centipede, 'vigilance'));
  wicker.controller = 1;
  assert.deepEqual(stats(s, wicker), { power: 3, toughness: 2 });
  wicker.controller = 0;
  move(s, grave[2], 'exile');
  assert.deepEqual(stats(s, centipede), { power: 2, toughness: 1 });
  assert(!hasKeyword(s, centipede, 'vigilance'));
});

test('Spineseeker compulsory search reveals only basic lands, permits fail-to-find and shuffles', () => {
  let s = setup();
  const basic = put(s, 'Forest', 0, 'library');
  const nonbasic = put(s, 'Fabled Passage', 0, 'library');
  const source = put(s, 'Spineseeker Centipede', 0, 'hand');
  enterBattlefieldBatch(s, [{ object: source }]);
  stabilize(s);
  s = resolve(s);
  assert.equal(s.choice.kind, 'librarySearch');
  assert.equal(s.choice.reveal, true);
  assert.equal(s.choice.optional, undefined);
  assert.equal(s.choice.min, 0);
  assert(s.choice.cards.includes(basic.id));
  assert(!s.choice.cards.includes(nonbasic.id));
  s = act(s, 'searchLibrary', { cards: [basic.id] });
  assert.equal(s.objects[basic.id].zone, 'hand');
  assert(s.events.some((e) => e.type === 'libraryShuffled'));
});

test('Patchwork cannot attack or block below threshold, and ability removal removes its restriction', () => {
  let s = setup();
  const beastie = put(s, 'Patchwork Beastie');
  const attacker = put(s, 'Grizzly Bears', 1);
  assert.equal(canAttack(s, beastie, 0), false);
  assert.equal(canBlock(s, beastie, attacker, 0), false);
  ready(s);
  const before = structuredClone(s);
  assert.equal(dispatch(s, { type: 'attackers', player: 0, cards: [beastie.id] }).ok, false);
  assert.deepEqual(s, before);
  const grave = delirium(s);
  assert.equal(canAttack(s, beastie, 0), true);
  assert.equal(canBlock(s, beastie, attacker, 0), true);
  s = act(s, 'attackers', { cards: [beastie.id] });
  move(s, s.objects[grave[2].id], 'exile');
  assert(s.combat.attackers.some((r) => r.id === beastie.id));
  s.objects[beastie.id].tapped = false;
  assert.equal(canAttack(s, s.objects[beastie.id], 0), false);
  addModifier(s, {
    objectId: beastie.id,
    incarnation: beastie.incarnation,
    removeAbilities: true,
    expires: s.turn,
  });
  assert.equal(canAttack(s, s.objects[beastie.id], 0), true);
});

test('Patchwork optional upkeep mill belongs to its controller and does not require delirium', () => {
  for (const accept of [false, true]) {
    let s = setup();
    const beastie = put(s, 'Patchwork Beastie');
    beastie.controller = 1;
    notifyTriggers(s, 'step', { player: 0, step: 'upkeep' });
    stabilize(s);
    assert.equal(s.stack.length, 0);
    const top = s.players[1].library[0];
    notifyTriggers(s, 'step', { player: 1, step: 'upkeep' });
    stabilize(s);
    s = resolve(s);
    assert.equal(s.choice.kind, 'optionalEffect');
    assert.equal(s.choice.player, 1);
    s = act(s, 'resolveOptional', { accept });
    assert.equal(s.objects[top].zone, accept ? 'graveyard' : 'library');
  }
});

test('Violent Urge reads delirium on resolution; its own spell type is not yet in the graveyard', () => {
  for (const change of ['gain', 'lose', 'none']) {
    let s = setup();
    lands(s, 'Mountain', 1);
    const target = put(s, 'Grizzly Bears', 1);
    const grave = delirium(s);
    if (change !== 'lose') move(s, grave[2], 'exile');
    s = cast(s, 'Violent Urge', ref(target));
    if (change === 'gain') move(s, s.objects[grave[2].id], 'graveyard');
    if (change === 'lose') move(s, s.objects[grave[2].id], 'exile');
    s = resolve(s);
    assert.deepEqual(stats(s, s.objects[target.id]), { power: 3, toughness: 2 });
    assert(hasKeyword(s, s.objects[target.id], 'first strike'));
    assert.equal(hasKeyword(s, s.objects[target.id], 'double strike'), change === 'gain');
    for (const o of Object.values(s.objects))
      if (o.owner === 0 && o.zone === 'graveyard') move(s, o, 'exile');
    assert.equal(hasKeyword(s, s.objects[target.id], 'double strike'), change === 'gain');
    finishCleanup(s);
    assert(!hasKeyword(s, s.objects[target.id], 'first strike'));
    assert.deepEqual(stats(s, s.objects[target.id]), { power: 2, toughness: 2 });
  }
});

test('Beastie Beatdown adds counters before damage and preserves legal actor effects if victim disappears', () => {
  for (const lost of [null, 'victim', 'actor']) {
    let s = setup();
    lands(s, 'Forest', 1);
    lands(s, 'Mountain', 1);
    delirium(s);
    const actor = put(s, 'Grizzly Bears');
    const victim = put(s, 'Colossal Dreadmaw', 1);
    const spell = put(s, 'Beastie Beatdown', 0, 'hand');
    s = act(s, 'cast', { card: spell.id, targets: { actor: [ref(actor)], victim: [ref(victim)] } });
    if (lost) move(s, s.objects[lost === 'actor' ? actor.id : victim.id], 'hand');
    s = resolve(s);
    assert.equal(s.objects[actor.id].plusCounters, lost === 'actor' ? 0 : 2);
    assert.equal(s.objects[victim.id].damage, lost ? 0 : 4);
    assert.equal(s.objects[actor.id].damage, 0);
  }
});

test('Hand That Feeds uses an occurrence-only restriction, not an intervening-if', () => {
  for (const activeAtAttack of [false, true]) {
    let s = ready(setup());
    const hand = put(s, 'Hand That Feeds');
    const grave = delirium(s);
    if (!activeAtAttack) move(s, grave[2], 'exile');
    s = act(s, 'attackers', { cards: [hand.id] });
    assert.equal(s.stack.length, activeAtAttack ? 1 : 0);
    if (activeAtAttack) {
      move(s, s.objects[grave[2].id], 'exile');
      s = resolve(s);
    } else move(s, s.objects[grave[2].id], 'graveyard');
    assert.equal(
      stats(s, s.objects[hand.id]).power,
      definitions['Hand That Feeds'].power + (activeAtAttack ? 2 : 0),
    );
    assert.equal(hasKeyword(s, s.objects[hand.id], 'menace'), activeAtAttack);
  }
});

test('true intervening-if conditions recheck the same reusable graveyard expression on resolution', () => {
  let s = ready(setup());
  const definition = structuredClone(definitions['Hand That Feeds']);
  definition.name = 'Intervening Delirium Fixture';
  definition.triggers[0].condition = definition.triggers[0].triggerCondition;
  delete definition.triggers[0].triggerCondition;
  s.catalog = createRegistry({ ...catalog, [definition.name]: definition });
  const hand = put(s, definition.name);
  const grave = delirium(s);
  s = act(s, 'attackers', { cards: [hand.id] });
  assert.equal(s.stack.length, 1);
  move(s, s.objects[grave[2].id], 'exile');
  s = resolve(s);
  assert.equal(stats(s, s.objects[hand.id]).power, definition.power);
  assert(!hasKeyword(s, s.objects[hand.id], 'menace'));
});

test('Drag to the Roots applies its reduction at cost time and cannot count an opponent graveyard', () => {
  let s = setup();
  lands(s, 'Swamp', 1);
  lands(s, 'Forest', 1);
  const target = put(s, 'Pacifism', 1);
  const spell = put(s, 'Drag to the Roots', 0, 'hand');
  delirium(s, 1);
  assert.equal(
    dispatch(s, { type: 'cast', player: 0, card: spell.id, target: ref(target) }).ok,
    false,
  );
  const grave = delirium(s);
  assert(legalActions(s, 0).some((a) => a.type === 'cast' && a.card === spell.id));
  s = act(s, 'cast', { card: spell.id, target: ref(target) });
  move(s, s.objects[grave[2].id], 'exile');
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'graveyard');
});

test('Demonic Counsel replaces its restricted reveal search with an unrestricted mandatory search', () => {
  for (const enabled of [false, true]) {
    let s = setup();
    lands(s, 'Swamp', 2);
    const demon = put(s, 'Rune-Scarred Demon', 0, 'library');
    const other = put(s, 'Forest', 0, 'library');
    s = cast(s, 'Demonic Counsel');
    if (enabled) delirium(s);
    s = resolve(s);
    assert.equal(s.choice.kind, 'librarySearch');
    assert.equal(s.choice.min, enabled ? 1 : 0);
    assert.equal(s.choice.reveal, !enabled);
    assert(s.choice.cards.includes(demon.id));
    assert.equal(s.choice.cards.includes(other.id), enabled);
    if (enabled)
      assert.equal(dispatch(s, { type: 'searchLibrary', player: 0, cards: [] }).ok, false);
    s = act(s, 'searchLibrary', { cards: [enabled ? other.id : demon.id] });
    assert.equal(s.objects[enabled ? other.id : demon.id].zone, 'hand');
    assert.equal(s.choice, null);
  }
});

test('Impossible Inferno gives next-turn play permission only when delirium holds at resolution', () => {
  for (const enabled of [false, true]) {
    let s = setup();
    lands(s, 'Mountain', 5);
    const target = put(s, 'Colossal Dreadmaw', 1);
    const top = s.players[0].library[0];
    s = cast(s, 'Impossible Inferno', ref(target));
    if (enabled) delirium(s);
    s = resolve(s);
    assert.equal(s.objects[target.id].zone, 'graveyard');
    assert.equal(s.objects[top].zone, enabled ? 'exile' : 'library');
    if (enabled) assert.equal(s.objects[top].playPermission.untilNextTurn, 0);
  }
});

test('all seven admitted card types count distinctly, never subtypes or supertypes', () => {
  const s = setup();
  for (const name of [
    'Wildfire Wickerfolk',
    'Forest',
    'Opt',
    'Demonic Counsel',
    'Pacifism',
    'Chandra, Torch of Defiance',
  ])
    put(s, name, 0, 'graveyard');
  assert.equal(count(s), 7);
  put(s, 'Rune-Scarred Demon', 0, 'graveyard');
  put(s, 'Chandra, Torch of Defiance', 1, 'graveyard');
  assert.equal(count(s, 'all'), 7);
});

test('graveyard checks ignore battlefield-only type changes after a card changes zones', () => {
  const s = setup();
  const wicker = put(s, 'Wildfire Wickerfolk');
  addModifier(s, {
    objectId: wicker.id,
    incarnation: wicker.incarnation,
    enchantmentOnly: true,
    expires: s.turn,
  });
  assert.equal(count(s), 0);
  move(s, wicker, 'graveyard');
  assert.equal(count(s), 2);
});

test('Patchwork declaration checks change controllers but cannot undo an established block', () => {
  let s = setup();
  s.active = 1;
  s.priority = 1;
  const beastie = put(s, 'Patchwork Beastie');
  const attacker = put(s, 'Grizzly Bears', 1);
  const grave = delirium(s);
  beastie.controller = 1;
  assert.equal(canAttack(s, beastie, 1), false);
  beastie.controller = 0;
  s.combat.attackers = [ref(attacker)];
  s.step = 'blockers';
  s.choice = { kind: 'blockers', player: 0 };
  s = act(s, 'blockers', { pairs: [{ blocker: beastie.id, attacker: attacker.id }] });
  move(s, s.objects[grave[2].id], 'exile');
  assert.equal(canBlock(s, s.objects[beastie.id], s.objects[attacker.id], 0), false);
  assert.deepEqual(s.combat.blocks[attacker.id], [ref(s.objects[beastie.id])]);
});

test('intervening-if graveyard checks retain trigger controller binding after source control changes', () => {
  let s = ready(setup());
  const definition = structuredClone(definitions['Hand That Feeds']);
  definition.name = 'Bound Delirium Fixture';
  definition.triggers[0].condition = definition.triggers[0].triggerCondition;
  delete definition.triggers[0].triggerCondition;
  definition.triggers[0].effects = [{ op: 'gainLife', amount: 1 }];
  s.catalog = createRegistry({ ...catalog, [definition.name]: definition });
  const hand = put(s, definition.name);
  delirium(s);
  s = act(s, 'attackers', { cards: [hand.id] });
  assert.equal(s.stack.length, 1);
  s.objects[hand.id].controller = 1;
  const before = s.players[0].life;
  s = resolve(s);
  assert.equal(s.players[0].life, before + 1);
});

test('graveyard activation checks delirium before exile-self payment and does not recheck afterward', () => {
  let s = setup();
  lands(s, 'Forest', 1);
  const condition = definitions['Hand That Feeds'].triggers[0].triggerCondition;
  const definition = {
    ...CARDS['Grizzly Bears'],
    name: 'Delirium Activation Fixture',
    activated: [
      {
        zone: 'graveyard',
        timing: 'sorcery',
        condition,
        cost: { mana: { G: 1 }, exileSelf: true },
        effects: [{ op: 'gainLife', amount: 1 }],
      },
    ],
  };
  s.catalog = createRegistry({ ...catalog, [definition.name]: definition });
  const source = put(s, definition.name, 0, 'graveyard');
  for (const name of ['Forest', 'Opt']) put(s, name, 0, 'graveyard');
  const command = { type: 'activate', player: 0, card: source.id, ability: 0 };
  assert.equal(dispatch(s, command).ok, false);
  put(s, 'Short Bow', 0, 'graveyard');
  assert.equal(count(s), 4);
  s = act(s, 'activate', { card: source.id, ability: 0 });
  assert.equal(count(s), 3);
  assert.equal(s.objects[source.id].zone, 'exile');
  const before = s.players[0].life;
  s = resolve(s);
  assert.equal(s.players[0].life, before + 1);
});
