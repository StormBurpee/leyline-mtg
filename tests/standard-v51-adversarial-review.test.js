import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CARDS, ref, stats, keywords, legalActions } from '../packages/engine/src/index.js';
import { fixture, put, act, resolve } from '../packages/engine/test/helpers.js';
import { enterBattlefieldBatch, stabilize } from '../packages/engine/src/effects.js';
import {
  notifyTriggers,
  move,
  definition,
  captureDepartureContext,
  finishDepartureBatch,
  addModifier,
} from '../packages/engine/src/model.js';

const rich = () => {
  const s = fixture();
  for (const p of s.players) for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) p.mana[c] = 100;
  return s;
};
const enter = (s, name, player = 0) => {
  const object = put(s, name, player, 'hand');
  enterBattlefieldBatch(s, [{ object }]);
  stabilize(s);
  return object;
};
const order = (s) =>
  s.choice?.kind === 'orderTriggers'
    ? act(s, 'orderTriggers', { ids: s.choice.entries.map((e) => e.id) })
    : s;
const drain = (s) => {
  s = order(s);
  while (s.stack.length && !s.choice) s = order(resolve(s));
  return s;
};
const count = (s, name, player = 0) =>
  Object.values(s.objects).filter(
    (o) => o.zone === 'battlefield' && o.name === name && o.controller === player,
  ).length;

// Independent Oracle characteristics captured from the Standard reference, not a compiler round trip.
const oracleCharacteristics = [
  'Aatchik, Emerald Radian|{3}{B}{B}{G}|BG|Legendary Creature — Insect Druid|3|3',
  'Arcane Amphisbaena|{1}{G}|G|Creature — Snake|1|1',
  'Armored Armadillo|{W}|W|Creature — Armadillo|0|4',
  'Artistic Process|{3}{R}{R}|R|Sorcery||',
  'Azula, On the Hunt|{3}{B}|B|Legendary Creature — Human Noble|4|3',
  'Baxter Stockman|{3}{U}{R}|RU|Legendary Creature — Human Scientist|3|3',
  'Bejeweled Warg|{1}{G}|G|Creature — Wolf|3|2',
  'Black Panther, Vanguard|{2}{G}{W}|GW|Legendary Creature — Human Warrior Hero|4|4',
  'Broadcast Rambler|{4}{W}|W|Artifact — Vehicle|5|4',
  'Campus Crier|{1}{W}|W|Creature — Human Advisor|3|1',
  'Carrot Cake|{1}{W}|W|Artifact — Food||',
  'Cerebral Download|{4}{U}|U|Instant||',
  'Circle of Power|{3}{B}|B|Sorcery||',
  'Cosmogrand Zenith|{2}{W}|W|Creature — Human Soldier|2|4',
  'Daily Bugle Reporters|{3}{W}|W|Creature — Human Citizen|2|3',
  'Dauntless Scrapbot|{3}||Artifact Creature — Robot|3|1',
  'Earth Village Ruffians|{2}{B/G}|BG|Creature — Human Soldier Rogue|3|1',
  'Elven Raft-Steerer|{2}{U}|U|Creature — Elf Pilot|3|2',
  'Elvish Archivist|{1}{G}|G|Creature — Elf Artificer|0|1',
  'Emergency Eject|{2}{W}|W|Instant||',
  'Encroaching Dragonstorm|{3}{G}|G|Enchantment||',
  'Equilibrium Adept|{3}{R}|R|Creature — Dog Monk|2|4',
  'Falcon, Winged Wonder|{4}{U}|U|Legendary Creature — Human Hero|3|4',
  "Fangkeeper's Familiar|{1}{B}{G}{U}|BGU|Creature — Snake|3|3",
  'Fateshaper Aspirant|{4}{W}|W|Creature — Rhino Cleric|3|4',
  'Felidar Retreat|{3}{W}|W|Enchantment||',
  'Ferocification|{2}{R}|R|Enchantment||',
  'Gaius van Baelsar|{2}{B}{B}|B|Legendary Creature — Human Soldier|3|2',
  'Goblin Glasswright // Craft with Pride|{1}{R}|R|Creature — Goblin Sorcerer|2|2',
  'Gurmag Rakshasa|{4}{B}{B}|B|Creature — Demon|5|5',
  'Hakoda, Selfless Commander|{3}{W}|W|Legendary Creature — Human Warrior Ally|3|5',
  'Haru, Hidden Talent|{1}{G}|G|Legendary Creature — Human Peasant Ally|1|1',
  'Keeper of the Quiet Hour|{3}||Artifact Creature — Chimera|3|2',
  'Kiora, the Rising Tide|{2}{U}|U|Legendary Creature — Merfolk Noble|3|2',
  'Madame Web, Clairvoyant|{4}{U}{U}|U|Legendary Creature — Mutant Advisor|4|4',
  'Mindseeker Oculus|{2}{U}|U|Creature — Homunculus|2|1',
  "Mourner's Surprise|{1}{B}|B|Sorcery||",
  "Muse's Encouragement|{4}{U}|U|Instant||",
  'Museum Nightwatch|{3}{W}|W|Creature — Centaur Soldier|3|2',
  'Mutant Chain Reaction|{2}{G}|G|Sorcery||',
  'Northern Air Temple|{B}|B|Legendary Enchantment — Shrine||',
  'Ogre Chitterlord|{4}{R}{R}|R|Creature — Ogre Warrior|6|5',
  'Ooze Patrol|{3}{G}|G|Creature — Ooze|2|2',
  "Outlaws' Fury|{2}{R}|R|Instant||",
  'Pitiless Fists|{3}{G}|G|Enchantment — Aura||',
  'Psychic Whorl|{2}{B}|B|Sorcery||',
  'Regal Caracal|{3}{W}{W}|W|Creature — Cat|3|3',
  'Restless Fortress|||Land||',
  'Restless Prairie|||Land||',
  'Restless Vents|||Land||',
  "Sephiroth, Planet's Heir|{4}{U}{B}|BU|Legendary Creature — Human Avatar Soldier|4|4",
  'Silver Deputy|{2}||Artifact Creature — Mercenary|1|2',
  'Simulacrum Synthesizer|{2}{U}|U|Artifact||',
  'Southern Air Temple|{3}{W}|W|Legendary Enchantment — Shrine||',
  'Totentanz, Swarm Piper|{1}{B}{R}|BR|Legendary Creature — Human Warlock Bard|2|3',
  'Turtle Blimp|{5}||Artifact — Vehicle|3|4',
  'Unfortunate Accident|{B}|B|Instant||',
  'Unwelcome Sprite|{1}{U}|U|Creature — Faerie Rogue|2|1',
  "Ureni's Rebuff|{1}{U}|U|Sorcery||",
  'Vengeful Creeper|{4}{G}|G|Creature — Plant Elemental|5|5',
  'Vindictive Warden|{2}{B/R}|BR|Creature — Human Soldier|2|3',
  'Volatile Fault|||Land — Cave||',
  'Vraska, Soul of Stone|{U}{R}{W}|RUW|Legendary Creature — Gorgon Wizard|3|3',
  'Wispdrinker Vampire|{2}{W}{B}|BW|Creature — Vampire Rogue|2|4',
  'Yoshimaru, Scrappy Stray|{1}{G}|G|Legendary Creature — Dog|1|1',
];
test('all 65 v51 cards preserve their complete printed face characteristics', () => {
  for (const row of oracleCharacteristics) {
    const [name, manaCost, color, typeLine, power, toughness] = row.split('|');
    const path = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const source = JSON.parse(
      readFileSync(new URL(`../packages/cards/cards/${path}.json`, import.meta.url)),
    );
    const c = source.characteristics;
    const [types, subtypes = ''] = typeLine.split(' — ');
    assert.equal(c.manaCost ?? '', manaCost, name);
    assert.equal([...c.colors].sort().join(''), color, name);
    assert.deepEqual(
      [...c.types, ...c.supertypes].sort(),
      types.toLowerCase().split(' ').sort(),
      name,
    );
    assert.deepEqual(c.subtypes, subtypes ? subtypes.split(' ') : [], name);
    assert.equal(String(c.power ?? ''), power, name);
    assert.equal(String(c.toughness ?? ''), toughness, name);
  }
  const spell = CARDS['Goblin Glasswright // Craft with Pride'].prepareSpell;
  assert.deepEqual(spell.color, ['R']);
  assert.equal(spell.type, 'sorcery');
  assert.deepEqual(spell.cost, { R: 1 });
});

test('Totentanz observes every simultaneous nontoken death including itself, but not token deaths', () => {
  let s = rich();
  const victims = [
    put(s, 'Totentanz, Swarm Piper'),
    put(s, 'Grizzly Bears'),
    put(s, 'Grizzly Bears'),
    put(s, 'Mutant Token'),
  ];
  const ctx = captureDepartureContext(s);
  for (const o of victims) move(s, o, 'graveyard', ctx);
  finishDepartureBatch(s, ctx);
  stabilize(s);
  s = drain(s);
  assert.equal(count(s, 'Nonblocking Rat Token'), 3);
});

test('Aatchik still drains for other simultaneously dying Insects after Aatchik leaves', () => {
  let s = rich();
  const a = put(s, 'Aatchik, Emerald Radian');
  const victims = [a, put(s, 'Green Insect Token'), put(s, 'Green Insect Token')];
  const ctx = captureDepartureContext(s);
  for (const o of victims) move(s, o, 'graveyard', ctx);
  finishDepartureBatch(s, ctx);
  stabilize(s);
  s = drain(s);
  assert.equal(s.players[1].life, 18);
  assert.equal(s.objects[a.id].zone, 'graveyard');
});

test('Wispdrinker checks effective power only at entry, not again at resolution', () => {
  let s = rich();
  put(s, 'Wispdrinker Vampire');
  const bear = enter(s, 'Grizzly Bears');
  s.objects[bear.id].plusCounters = 3;
  s = resolve(s);
  assert.equal(s.players[0].life, 21);
  s = rich();
  put(s, 'Wispdrinker Vampire');
  put(s, 'Regal Caracal');
  enter(s, 'Lifelink Cat Token');
  assert.equal(s.stack.length, 1); // a 1/1 Cat becomes 2/2
  s = resolve(s);
  put(s, 'Regal Caracal');
  enter(s, 'Lifelink Cat Token');
  assert.equal(s.stack.length, 0); // now a 3/3, despite printed power 1
});

test('Northern Temple counts Shrines at resolution, while later-entry drain remains fixed', () => {
  let s = rich();
  const n = enter(s, 'Northern Air Temple');
  move(s, s.objects[n.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.players[0].life, 20);
  assert.equal(s.players[1].life, 20);
  s = rich();
  put(s, 'Northern Air Temple');
  const other = put(s, 'Southern Air Temple', 0, 'hand');
  enterBattlefieldBatch(s, [{ object: other }]);
  stabilize(s);
  s = order(s);
  move(s, s.objects[other.id], 'graveyard');
  s = drain(s);
  assert.equal(s.players[0].life, 21);
  assert.equal(s.players[1].life, 19);
});

test('Ogre always creates Rats before its conditional bonus and never boosts opposing Rats', () => {
  let s = rich();
  const enemy = put(s, 'Nonblocking Rat Token', 1);
  enter(s, 'Ogre Chitterlord');
  s = resolve(s);
  assert.equal(count(s, 'Nonblocking Rat Token'), 2);
  assert.equal(stats(s, s.objects[enemy.id]).power, 1);
  for (let i = 0; i < 3; i++) put(s, 'Nonblocking Rat Token');
  const ogre = Object.values(s.objects).find((o) => o.name === 'Ogre Chitterlord');
  notifyTriggers(s, 'attack', { object: ogre });
  stabilize(s);
  s = resolve(s);
  assert.equal(count(s, 'Nonblocking Rat Token'), 7);
  assert.equal(stats(s, s.objects[enemy.id]).power, 1);
  for (const o of Object.values(s.objects).filter(
    (o) => o.name === 'Nonblocking Rat Token' && o.controller === 0,
  ))
    assert.equal(stats(s, o).power, 3);
});

test('Mourner Surprise and Mutant Chain Reaction fizzle all effects only when a chosen sole target is illegal', () => {
  for (const [name, targetName, zone, token] of [
    ["Mourner's Surprise", 'Grizzly Bears', 'graveyard', 'Mercenary Token'],
    ['Mutant Chain Reaction', 'Treasure Token', 'battlefield', 'Mutagen Token'],
  ]) {
    let s = rich();
    const target = put(s, targetName, 0, zone);
    const card = put(s, name, 0, 'hand');
    s = act(s, 'cast', { card: card.id, targets: { chosen: [ref(target)] } });
    move(s, s.objects[target.id], 'exile');
    s = resolve(s);
    assert.equal(count(s, token), 0, name);
    s = rich();
    const zero = put(s, name, 0, 'hand');
    s = resolve(act(s, 'cast', { card: zero.id, targets: { chosen: [] } }));
    assert.equal(count(s, token), 1, name);
  }
});

test('Emergency Eject uses the resolving target controller, including an indestructible target', () => {
  let s = rich();
  const target = put(s, 'Grizzly Bears', 1);
  const spell = put(s, 'Emergency Eject', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, target: ref(target) });
  s.objects[target.id].controller = 0;
  addModifier(s, {
    objectId: target.id,
    incarnation: target.incarnation,
    keywords: ['indestructible'],
    expires: s.turn,
  });
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'battlefield');
  assert.equal(count(s, 'Lander Token', 0), 1);
  assert.equal(count(s, 'Lander Token', 1), 0);
});

test('Silver Deputy can decline without searching/shuffling and its tap ability is sorcery only', () => {
  let s = rich();
  const c = enter(s, 'Silver Deputy');
  s = resolve(s);
  const before = [...s.players[0].library];
  s = act(s, 'searchLibrary', { cards: [], decline: true });
  assert.deepEqual(s.players[0].library, before);
  s.objects[c.id].controlledSince = s.turn - 1;
  s.active = 1;
  s.priority = 0;
  assert.equal(
    legalActions(s, 0).some((a) => a.type === 'activate' && a.card === c.id),
    false,
  );
});

test('Azula attack produces two independent triggers, not one combined ability', () => {
  let s = rich();
  const a = put(s, 'Azula, On the Hunt');
  notifyTriggers(s, 'attack', { object: a });
  stabilize(s);
  assert.equal(s.choice.kind, 'orderTriggers');
  assert.equal(s.choice.entries.length, 2);
  s = order(s);
  s = drain(s);
  assert.equal(s.players[0].life, 19);
  assert.equal(count(s, 'Clue Token'), 1);
  assert.deepEqual(s.players[0].restrictedMana, [
    { color: 'R', duration: 'combat' },
    { color: 'R', duration: 'combat' },
  ]);
});

test('Carrot Cake does not treat destruction as sacrifice', () => {
  let s = rich();
  const cake = put(s, 'Carrot Cake');
  move(s, cake, 'graveyard');
  stabilize(s);
  assert.equal(s.stack.length, 0);
  assert.equal(count(s, 'Rabbit Token'), 0);
});

test('Construct is printed 0/0 plus a battlefield-only artifact bonus, including itself and ordinary counters', () => {
  let s = rich();
  put(s, 'Simulacrum Synthesizer');
  put(s, 'Treasure Token');
  put(s, 'Treasure Token', 1);
  const token = put(s, 'Scaling Construct Token');
  token.plusCounters = 2;
  assert.equal(CARDS[token.name].power, 0);
  assert.equal(CARDS[token.name].toughness, 0);
  assert.equal(CARDS[token.name].baseStats, undefined);
  assert.deepEqual(stats(s, token), { power: 5, toughness: 5 });
  const copy = put(s, token.name, 0, 'hand');
  enterBattlefieldBatch(s, [{ object: copy }]);
  assert.deepEqual(stats(s, token), { power: 6, toughness: 6 });
  assert.deepEqual(stats(s, copy), { power: 4, toughness: 4 });
  move(s, token, 'graveyard');
  assert.deepEqual(stats(s, token), { power: 0, toughness: 0 });
  assert.deepEqual(stats(s, copy), { power: 3, toughness: 3 });
});

test('Synthesizer ignores opponent artifacts and its tokens but sees another entering Synthesizer', () => {
  let s = rich();
  put(s, 'Simulacrum Synthesizer');
  const other = put(s, 'Simulacrum Synthesizer', 0, 'hand');
  enterBattlefieldBatch(s, [{ object: other }]);
  stabilize(s);
  s = order(s);
  assert.equal(s.stack.length, 2); // own scry plus prior Synthesizer's Construct trigger
  s = drain(s);
  if (s.choice?.kind === 'libraryOrder')
    s = act(s, 'orderLibrary', { top: s.choice.cards, rest: [] });
  s = drain(s);
  assert.equal(count(s, 'Scaling Construct Token'), 1);
  const enemy = put(s, 'Magitek Armor', 1, 'hand');
  enterBattlefieldBatch(s, [{ object: enemy }]);
  stabilize(s);
  assert.equal(count(s, 'Scaling Construct Token'), 1);
  assert.equal(s.pendingTriggers.filter((t) => t.name === 'Simulacrum Synthesizer').length, 0);
  assert.equal(s.stack.filter((t) => t.name === 'Simulacrum Synthesizer').length, 0);
});

test('Gurmag resolves a still-legal target group when its other target becomes illegal', () => {
  let s = rich();
  const own = put(s, 'Grizzly Bears');
  const enemy = put(s, 'Grizzly Bears', 1);
  enter(s, 'Gurmag Rakshasa');
  s = act(s, 'chooseTriggerTargets', { targets: { enemy: [ref(enemy)], friendly: [ref(own)] } });
  move(s, s.objects[enemy.id], 'graveyard');
  s = resolve(s);
  assert.equal(stats(s, s.objects[own.id]).power, 4);
});

test('Pitiless Fists fight uses last known attachment when Aura is removed before trigger resolution', () => {
  let s = rich();
  const own = put(s, 'Grizzly Bears');
  const enemy = put(s, 'Grizzly Bears', 1);
  const aura = put(s, 'Pitiless Fists', 0, 'hand');
  s = resolve(act(s, 'cast', { card: aura.id, target: ref(own) }));
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [ref(enemy)] } });
  move(s, s.objects[aura.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[own.id].zone, 'graveyard');
  assert.equal(s.objects[enemy.id].zone, 'graveyard');
});

test('Unwelcome Sprite encodes opponent turn as a trigger-time restriction, not an intervening if', () => {
  const trigger = CARDS['Unwelcome Sprite'].triggers[0];
  assert.deepEqual(trigger.triggerCondition, { kind: 'opponentTurn' });
  assert.equal(trigger.condition, undefined);
  let s = rich();
  s.active = 1;
  s.priority = 0;
  const sprite = put(s, 'Unwelcome Sprite');
  const opt = put(s, 'Opt', 0, 'hand');
  s = act(s, 'cast', { card: opt.id });
  move(s, s.objects[sprite.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.choice.kind, 'libraryOrder');
  assert.equal(s.choice.cards.length, 2);
});

test('Elvish Archivist combines each batch once, keeps artifact and enchantment uses separate, and refreshes next turn', () => {
  let s = rich();
  const archivist = put(s, 'Elvish Archivist');
  const artifact = () => put(s, 'Treasure Token', 0, 'hand');
  const enchantment = () => put(s, 'Felidar Retreat', 0, 'hand');
  const enemy = put(s, 'Treasure Token', 1, 'hand');
  enterBattlefieldBatch(s, [{ object: enemy }]);
  stabilize(s);
  assert.equal(s.stack.length, 0);
  enterBattlefieldBatch(s, [
    { object: artifact() },
    { object: artifact() },
    { object: enchantment() },
    { object: enchantment() },
  ]);
  stabilize(s);
  s = order(s);
  assert.equal(s.stack.length, 2);
  s = drain(s);
  assert.equal(s.objects[archivist.id].plusCounters, 2);
  assert.equal(s.players[0].hand.length, 1);
  enterBattlefieldBatch(s, [{ object: artifact() }, { object: enchantment() }]);
  stabilize(s);
  assert.equal(s.stack.length, 0);
  s.turn++;
  enterBattlefieldBatch(s, [{ object: artifact() }, { object: enchantment() }]);
  stabilize(s);
  s = drain(s);
  assert.equal(s.objects[archivist.id].plusCounters, 4);
  assert.equal(s.players[0].hand.length, 2);
});

test('Falcon makes exactly Redwing; Redwing surveils for itself attacking, not for another attacker', () => {
  let s = rich();
  enter(s, 'Falcon, Winged Wonder');
  s = resolve(s);
  const bird = Object.values(s.objects).find((o) => o.name === 'Redwing');
  assert(bird);
  const d = definition(s, bird);
  assert.equal(d.legendary, true);
  assert.equal(bird.token, true);
  assert.deepEqual(d.subtypes, ['Bird', 'Scout']);
  assert.deepEqual(d.color, ['U']);
  assert.deepEqual(stats(s, bird), { power: 1, toughness: 1 });
  assert.deepEqual(keywords(s, bird), ['flying']);
  const other = put(s, 'Grizzly Bears');
  notifyTriggers(s, 'attack', { object: other });
  stabilize(s);
  assert.equal(s.stack.length, 0);
  notifyTriggers(s, 'attack', { object: bird });
  stabilize(s);
  move(s, bird, 'graveyard');
  s = resolve(s);
  assert.equal(s.choice.kind, 'libraryOrder');
  assert.equal(s.choice.cards.length, 1);
  const top = s.choice.cards[0];
  s = act(s, 'orderLibrary', { top: [], rest: [top] });
  assert.equal(s.objects[top].zone, 'graveyard');
});

test('Cerebral Download with no artifacts still draws three cards', () => {
  let s = rich();
  const card = put(s, 'Cerebral Download', 0, 'hand');
  s = resolve(act(s, 'cast', { card: card.id }));
  assert.equal(s.choice, null);
  assert.equal(s.players[0].hand.length, 3);
});

test('Restless Vents does not draw when its optional discard is declined', () => {
  let s = rich();
  const land = put(s, 'Restless Vents');
  const card = put(s, 'Grizzly Bears', 0, 'hand');
  notifyTriggers(s, 'attack', { object: land });
  stabilize(s);
  s = resolve(s);
  assert.equal(s.choice.kind, 'discardEffect');
  assert.equal(s.choice.optional, true);
  s = act(s, 'discardEffect', { cards: [] });
  assert.deepEqual(s.players[0].hand, [card.id]);
});
