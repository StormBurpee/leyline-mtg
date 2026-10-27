import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, definition, dispatch, hasKeyword, ref, stats, tapPower } from '../src/index.js';
import { enterBattlefield, stabilize } from '../src/effects.js';
import { move } from '../src/model.js';
import { clearMana, finishCleanup, nextTurn } from '../src/turn.js';
import { fixture, put, act, resolve } from './helpers.js';

function rich() {
  const s = fixture();
  for (const p of s.players) for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) p.mana[c] = 100;
  return s;
}
function enter(s, name, player = 0) {
  const o = put(s, name, player, 'hand');
  enterBattlefield(s, o, player);
  stabilize(s);
  return o;
}
function cast(s, name, args = {}) {
  const o = put(s, name, 0, 'hand');
  return { s: resolve(act(s, 'cast', { card: o.id, ...args })), id: o.id };
}
function reject(s, type, args, player = s.choice?.player ?? s.priority) {
  const before = structuredClone(s);
  assert.equal(dispatch(s, { type, player, ...args }).ok, false);
  assert.deepEqual(s, before);
}
const tokens = (s, name) =>
  Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.name === name);
const later = (s) => {
  nextTurn(s);
  nextTurn(s);
  s.step = 'main1';
};

test('v53 exact tokens and Adventure faces preserve characteristic identity', () => {
  for (const [name, types, subtypes, color, power, toughness, keywords] of [
    ['Adventure Vigilant Knight Token', ['creature'], ['Knight'], ['W'], 2, 2, ['vigilance']],
    ['Two Two Knight Token', ['creature'], ['Knight'], ['W'], 2, 2, []],
    ['Landfall Bird Token', ['creature'], ['Bird'], ['G'], 2, 2, []],
    ['Pilot Token', ['creature'], ['Pilot'], [], 1, 1, []],
    ['Mercenary Token', ['creature'], ['Mercenary'], ['R'], 1, 1, []],
    ['Cadet', ['creature'], ['Wizard', 'Soldier'], [], 2, 2, []],
    ['Food Token', ['artifact'], ['Food'], [], undefined, undefined, []],
    ['Lander Token', ['artifact'], ['Lander'], [], undefined, undefined, []],
    ['Mutagen Token', ['artifact'], ['Mutagen'], [], undefined, undefined, []],
    ['Jace Token', ['planeswalker'], ['Jace'], ['U'], undefined, undefined, []],
  ]) {
    const d = CARDS[name];
    assert.deepEqual(
      {
        types: d.types,
        subtypes: d.subtypes,
        color: d.color,
        power: d.power,
        toughness: d.toughness,
        keywords: d.keywords,
        token: d.token,
        cost: d.cost,
        legendary: !!d.legendary,
      },
      {
        types,
        subtypes,
        color,
        power,
        toughness,
        keywords,
        token: true,
        cost: {},
        legendary: false,
      },
      name,
    );
  }
  const d = CARDS['Intrepid Trufflesnout // Go Hog Wild'];
  assert.deepEqual(d.color, ['G']);
  assert.deepEqual(d.adventure.color, ['G']);
  assert.deepEqual(d.adventure.cost, { generic: 1, G: 1 });
  assert.deepEqual(d.adventure.subtypes, ['Adventure']);
});

test('Garruk self-entry rechecks its intervening if, but power-four entry filters do not', () => {
  let s = rich();
  const big = put(s, 'Colossal Dreadmaw');
  enter(s, "Garruk's Uprising");
  assert.equal(s.stack.length, 1);
  move(s, big, 'exile');
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 0);
  const entered = enter(s, 'Colossal Dreadmaw');
  move(s, entered, 'exile');
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 1);
  enter(s, 'Colossal Dreadmaw', 1);
  assert.equal(s.stack.length, 0);
  const own = put(s, 'Grizzly Bears'),
    foe = put(s, 'Grizzly Bears', 1);
  assert(hasKeyword(s, own, 'trample'));
  assert(!hasKeyword(s, foe, 'trample'));
});

test('Outcaster excludes itself, observes its own controller and snapshots power at entry', () => {
  let s = rich();
  enter(s, 'Outcaster Trailblazer');
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  s = act(s, 'chooseManaColor', { color: 'B' });
  assert.equal(s.players[0].hand.length, 0);
  enter(s, 'Colossal Dreadmaw', 1);
  assert.equal(s.stack.length, 0);
  const big = enter(s, 'Colossal Dreadmaw');
  move(s, big, 'exile');
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 1);
});

test('Dragonfly Lesson is an intervening if and its CDA uses the correct graveyard in every zone', () => {
  for (const initiallyPresent of [false, true]) {
    let s = rich();
    const swarm = put(s, 'Dragonfly Swarm');
    const lesson = put(s, 'Firebending Lesson', 0, initiallyPresent ? 'graveyard' : 'exile');
    put(s, 'Opt', 0, 'graveyard');
    put(s, 'Grizzly Bears', 0, 'graveyard');
    put(s, 'Forest', 0, 'graveyard');
    put(s, 'Basilisk Collar', 1, 'graveyard');
    assert.equal(stats(s, swarm).power, initiallyPresent ? 2 : 1);
    move(s, swarm, 'graveyard');
    stabilize(s);
    assert.equal(s.stack.length, initiallyPresent ? 1 : 0);
    move(s, lesson, initiallyPresent ? 'exile' : 'graveyard');
    if (initiallyPresent) s = resolve(s);
    assert.equal(s.players[0].hand.length, 0);
    assert.equal(stats(s, s.objects[swarm.id]).power, initiallyPresent ? 1 : 2);
  }
});

test('Intrepid attacks-alone occurrence survives departure and cannot become true retroactively', () => {
  for (const alone of [false, true]) {
    let s = rich();
    const boar = put(s, 'Intrepid Trufflesnout // Go Hog Wild'),
      bear = put(s, 'Grizzly Bears');
    s.step = 'attackers';
    s.choice = { kind: 'attackers', player: 0 };
    s = act(s, 'attackers', { cards: alone ? [boar.id] : [boar.id, bear.id] });
    move(s, s.objects[alone ? boar.id : bear.id], 'exile');
    stabilize(s);
    assert.equal(s.stack.length, alone ? 1 : 0);
    if (alone) s = resolve(s);
    assert.equal(tokens(s, 'Food Token').length, +alone);
  }
});

test('Crumb gift happens only on resolution, fizzles with its target, and cannot protect an enemy', () => {
  let s = rich();
  const bear = put(s, 'Grizzly Bears'),
    enemy = put(s, 'Grizzly Bears', 1),
    card = put(s, 'Crumb and Get It', 0, 'hand');
  for (const mode of [0, 1]) reject(s, 'cast', { card: card.id, mode, target: ref(enemy) });
  s = act(s, 'cast', { card: card.id, mode: 1, target: ref(bear) });
  assert.equal(tokens(s, 'Food Token').length, 0);
  move(s, s.objects[bear.id], 'exile');
  s = resolve(s);
  assert.equal(tokens(s, 'Food Token').length, 0);
  assert.equal(s.objects[card.id].zone, 'graveyard');
  s = cast(s, 'Crumb and Get It', { mode: 1, target: ref(put(s, 'Grizzly Bears')) }).s;
  const food = tokens(s, 'Food Token')[0];
  assert.equal(food.controller, 1);
  s.priority = 1;
  s = resolve(act(s, 'activate', { card: food.id, ability: 0 }));
  assert.equal(s.players[1].life, 23);
  assert.equal(s.players[0].life, 20);
});

test('Battle Menu Magic rechecks power and Ability can target opposing creatures', () => {
  let s = rich();
  const bear = put(s, 'Grizzly Bears', 1),
    spell = put(s, 'Battle Menu', 0, 'hand');
  reject(s, 'cast', { card: spell.id, mode: 2, target: ref(bear) });
  bear.plusCounters = 2;
  s = act(s, 'cast', { card: spell.id, mode: 2, target: ref(bear) });
  s.objects[bear.id].plusCounters = 0;
  s = resolve(s);
  assert.equal(s.objects[bear.id].zone, 'battlefield');
  s = cast(s, 'Battle Menu', { mode: 1, target: ref(s.objects[bear.id]) }).s;
  assert.deepEqual(stats(s, s.objects[bear.id]), { power: 2, toughness: 6 });
  finishCleanup(s);
  assert.deepEqual(stats(s, s.objects[bear.id]), { power: 2, toughness: 2 });
});

test('Restoration Magic pays each tier, can protect enemy permanents, and loses all effects on fizzle', () => {
  for (const mode of [0, 1]) {
    let s = fixture();
    s.players[0].mana.W = 1;
    s.players[0].mana.C = mode;
    const foe = put(s, 'Forest', 1),
      spell = put(s, 'Restoration Magic', 0, 'hand');
    s = resolve(act(s, 'cast', { card: spell.id, mode, target: ref(foe) }));
    assert.equal(s.players[0].mana.W, 0);
    assert.equal(s.players[0].mana.C, 0);
    assert.equal(s.players[0].life, 20 + mode * 3);
    assert(hasKeyword(s, s.objects[foe.id], 'hexproof'));
    assert(hasKeyword(s, s.objects[foe.id], 'indestructible'));
  }
  let s = rich();
  const foe = put(s, 'Forest', 1),
    spell = put(s, 'Restoration Magic', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, mode: 1, target: ref(foe) });
  move(s, s.objects[foe.id], 'exile');
  s = resolve(s);
  assert.equal(s.players[0].life, 20);
});

test('Dai Li and Solve discard only nonland permanents, including artifacts and artifact creatures', () => {
  for (const name of ['Dai Li Indoctrination', 'Solve for Disappointment']) {
    let s = rich();
    const excluded = [
      put(s, 'Forest', 1, 'hand'),
      put(s, 'Opt', 1, 'hand'),
      put(s, 'Gysahl Greens', 1, 'hand'),
    ];
    const artifact = put(s, 'Basilisk Collar', 1, 'hand'),
      creature = put(s, 'Solemn Simulacrum', 1, 'hand');
    const card = put(s, name, 0, 'hand');
    reject(s, 'cast', {
      card: card.id,
      ...(name === 'Dai Li Indoctrination' ? { mode: 0 } : {}),
      target: { kind: 'player', id: 0 },
    });
    s = resolve(
      act(s, 'cast', {
        card: card.id,
        ...(name === 'Dai Li Indoctrination' ? { mode: 0 } : {}),
        target: { kind: 'player', id: 1 },
      }),
    );
    assert.deepEqual(s.choice.eligibleCards, [artifact.id, creature.id]);
    for (const o of excluded) reject(s, 'chooseResolutionCard', { card: o.id });
    s = act(s, 'chooseResolutionCard', { card: artifact.id });
    assert.equal(s.objects[artifact.id].zone, 'graveyard');
    if (name === 'Solve for Disappointment') assert.equal(tokens(s, 'Jace Token')[0].loyalty, 1);
  }
});

test('Vraska invalidated target prevents the life loss; targetless empowerment still loses life', () => {
  let s = rich();
  const bear = put(s, 'Grizzly Bears', 1),
    spell = put(s, "Vraska's Final Mercy", 0, 'hand');
  s = act(s, 'cast', { card: spell.id, mode: 0, target: ref(bear) });
  move(s, s.objects[bear.id], 'exile');
  s = resolve(s);
  assert.equal(s.players[0].life, 20);
  s = cast(s, "Vraska's Final Mercy", { mode: 1 }).s;
  assert.equal(s.players[0].life, 18);
  assert.equal(tokens(s, 'Jace Token')[0].loyalty, 6);
});

test('Rewrite Regrets enforces owner, types and mana value, with no empower on target fizzle', () => {
  let s = rich();
  const spell = put(s, 'Rewrite Regrets', 0, 'hand');
  for (const o of [
    put(s, 'Grizzly Bears', 1, 'graveyard'),
    put(s, 'Glacier Godmaw', 0, 'graveyard'),
    put(s, 'Basilisk Collar', 0, 'graveyard'),
  ])
    reject(s, 'cast', { card: spell.id, target: ref(o) });
  const big = put(s, 'Colossal Dreadmaw', 0, 'graveyard');
  s = act(s, 'cast', { card: spell.id, target: ref(big) });
  move(s, s.objects[big.id], 'exile');
  s = resolve(s);
  assert.equal(tokens(s, 'Jace Token').length, 0);
});

test('Corroding Dragonstorm observes its controller but returns to its owner', () => {
  let s = rich();
  const storm = put(s, 'Corroding Dragonstorm', 1);
  storm.controller = 0;
  enter(s, 'Five Five Dragon Token', 1);
  assert.equal(s.stack.length, 0);
  enter(s, 'Five Five Dragon Token');
  s = resolve(s);
  assert.equal(s.objects[storm.id].zone, 'hand');
  assert(s.players[1].hand.includes(storm.id));
});

test('Chocobo accepts nonbasic Mountains, must shuffle on failed search, and flashbacks to exile', () => {
  let s = rich();
  const mountain = put(s, 'Stomping Ground', 0, 'library');
  const card = put(s, 'Call the Mountain Chocobo', 0, 'graveyard');
  s = resolve(act(s, 'cast', { card: card.id }));
  assert(s.choice.cards.includes(mountain.id));
  reject(s, 'searchLibrary', { cards: [], decline: true });
  s = act(s, 'searchLibrary', { cards: [] });
  assert(s.events.some((e) => e.type === 'libraryShuffled'));
  assert.equal(s.objects[card.id].zone, 'exile');
  assert.equal(tokens(s, 'Landfall Bird Token').length, 1);
});

test('Roamer harmonizes for one green with a power-four creature and searches a tapped basic', () => {
  let s = fixture();
  s.players[0].mana.G = 1;
  const helper = put(s, 'Outcaster Trailblazer'),
    card = put(s, "Roamer's Routine", 0, 'graveyard'),
    basic = put(s, 'Forest', 0, 'library'),
    dual = put(s, 'Stomping Ground', 0, 'library');
  s = resolve(act(s, 'cast', { card: card.id, harmonize: ref(helper) }));
  assert.equal(s.objects[helper.id].tapped, true);
  assert(!s.choice.cards.includes(dual.id));
  s = act(s, 'searchLibrary', { cards: [basic.id] });
  assert.equal(s.objects[basic.id].zone, 'battlefield');
  assert.equal(s.objects[basic.id].tapped, true);
  assert.equal(s.objects[card.id].zone, 'exile');
});

test('Nervous Gardener actual disguise and turn-up search reveal a typed nonbasic land', () => {
  let s = rich();
  const dual = put(s, 'Stomping Ground', 0, 'library'),
    road = put(s, 'Country Roads', 0, 'library');
  const r = cast(s, 'Nervous Gardener', { mode: 1 });
  s = r.s;
  assert.deepEqual(definition(s, s.objects[r.id]).color, []);
  assert.equal(s.stack.length, 0);
  s = resolve(act(s, 'turnFaceUp', { card: r.id }));
  assert(s.choice.cards.includes(dual.id));
  assert(!s.choice.cards.includes(road.id));
  s = act(s, 'searchLibrary', { cards: [dual.id] });
  assert.deepEqual(s.events.findLast((e) => e.type === 'librarySearched').revealed, [
    'Stomping Ground',
  ]);
});

test('Hexhaven basic-landcycling discards as cost and creates neither Cadets nor Jace', () => {
  let s = rich();
  const basic = put(s, 'Forest', 0, 'library'),
    dual = put(s, 'Stomping Ground', 0, 'library'),
    card = put(s, 'Hexhaven Battalion', 0, 'hand');
  s = act(s, 'cycle', { card: card.id });
  assert.equal(s.objects[card.id].zone, 'graveyard');
  s = resolve(s);
  assert(!s.choice.cards.includes(dual.id));
  s = act(s, 'searchLibrary', { cards: [basic.id] });
  assert.equal(s.objects[basic.id].zone, 'hand');
  assert.equal(tokens(s, 'Cadet').length, 0);
  assert.equal(tokens(s, 'Jace Token').length, 0);
});

test('Glacier landfall snapshots friendly creatures at resolution and lasts only this turn', () => {
  let s = rich();
  put(s, 'Glacier Godmaw');
  const bear = put(s, 'Grizzly Bears'),
    foe = put(s, 'Grizzly Bears', 1);
  enter(s, 'Forest', 1);
  assert.equal(s.stack.length, 0);
  enter(s, 'Forest');
  s = resolve(s);
  const laterBear = put(s, 'Grizzly Bears');
  assert.equal(stats(s, s.objects[bear.id]).power, 3);
  assert.equal(stats(s, foe).power, 2);
  assert.equal(stats(s, laterBear).power, 2);
  assert(hasKeyword(s, s.objects[bear.id], 'haste'));
  assert(!hasKeyword(s, laterBear, 'haste'));
  finishCleanup(s);
  assert.equal(stats(s, s.objects[bear.id]).power, 2);
  assert(!hasKeyword(s, s.objects[bear.id], 'vigilance'));
});

test('Mightform warp exiles at next end step, then allows a later normal cast', () => {
  let s = rich();
  const r = cast(s, 'Mightform Harmonizer', { mode: 1 });
  s = r.s;
  s.step = 'main2';
  s = resolve(s);
  assert.equal(s.objects[r.id].zone, 'battlefield');
  s = resolve(s);
  assert.equal(s.objects[r.id].zone, 'exile');
  reject(s, 'cast', { card: r.id });
  later(s);
  s.players[0].mana.G = 4;
  s = resolve(act(s, 'cast', { card: r.id }));
  assert.equal(s.objects[r.id].zone, 'battlefield');
  assert.equal(s.delayedTriggers, undefined);
});

test('Brimstone triggers only for the second spell each turn, not once per game', () => {
  let s = rich();
  put(s, 'Brimstone Roundup');
  for (let turn = 0; turn < 2; turn++) {
    if (turn) {
      later(s);
      s.players[0].mana.G = 10;
    }
    for (let n = 1; n <= 3; n++) {
      const c = put(s, 'Grizzly Bears', 0, 'hand');
      s = act(s, 'cast', { card: c.id });
      if (n === 2) s = resolve(s);
      s = resolve(s);
      assert.equal(tokens(s, 'Mercenary Token').length, turn + +(n >= 2));
    }
  }
});

test('Plan the Heist and Deluge use resolution hand size and actual paid mana, not printed mana value', () => {
  let s = rich();
  const virtuoso = put(s, 'Deluge Virtuoso'),
    card = put(s, 'Plan the Heist', 0, 'hand');
  s = act(s, 'plot', { card: card.id });
  later(s);
  s = act(s, 'cast', { card: card.id });
  s = resolve(s);
  assert.equal(stats(s, s.objects[virtuoso.id]).power, 3);
  put(s, 'Forest', 0, 'hand');
  s = resolve(s);
  assert.equal(s.choice, null);
  assert.equal(s.players[0].hand.length, 4);
});

for (const [name, color] of [
  ['Country Roads', 'W'],
  ['Foul Roads', 'B'],
  ['Reef Roads', 'U'],
  ['Rocky Roads', 'R'],
  ['Wild Roads', 'G'],
]) {
  test(`${name} taps for its color and cannot sacrifice outside a sorcery window`, () => {
    let s = rich();
    put(s, 'Bounding Felidar', 1);
    const road = enter(s, name);
    assert.equal(road.tapped, true);
    road.tapped = false;
    const before = s.players[0].mana[color];
    s = act(s, 'tapMana', { card: road.id });
    assert.equal(s.players[0].mana[color], before + 1);
    s.objects[road.id].tapped = false;
    s.step = 'upkeep';
    reject(s, 'activate', { card: road.id, ability: 0 });
    s.step = 'main1';
    s = resolve(act(s, 'activate', { card: road.id, ability: 0 }));
    const pilot = tokens(s, 'Pilot Token')[0],
      mount = put(s, 'Bounding Felidar'),
      tank = put(s, 'Tundra Tank');
    assert.equal(tapPower(s, pilot, mount.id, 'saddle'), 3);
    assert.equal(tapPower(s, pilot, tank.id, 'crew'), 3);
    assert.equal(stats(s, pilot).power, 1);
  });
}

test('Tundra Tank really crews and firebends when attacking, with mana expiring at combat end', () => {
  let s = rich();
  const bear = put(s, 'Grizzly Bears'),
    tank = enter(s, 'Tundra Tank');
  reject(s, 'chooseTriggerTarget', { target: ref(put(s, 'Grizzly Bears', 1)) });
  s = resolve(act(s, 'chooseTriggerTarget', { target: ref(bear) }));
  s.objects[tank.id].controlledSince = s.turn - 2;
  s = resolve(act(s, 'crew', { card: tank.id, cards: [bear.id] }));
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: 0 };
  s = act(s, 'attackers', { cards: [tank.id] });
  s = resolve(s);
  assert.equal(
    s.players[0].restrictedMana.filter((m) => m.color === 'R' && m.duration === 'combat').length,
    1,
  );
  s.step = 'damage';
  clearMana(s);
  assert.equal(s.players[0].restrictedMana.length, 1);
  s.step = 'endCombat';
  clearMana(s);
  assert.equal(s.players[0].restrictedMana.length, 0);
});

test('Constrictor and Rubblebelt graveyard costs exile immediately and renew stays sorcery-only', () => {
  for (const name of ['Constrictor Sage', 'Rubblebelt Maverick']) {
    let s = rich();
    const source = put(s, name, 0, 'graveyard'),
      own = put(s, 'Grizzly Bears'),
      foe = put(s, 'Grizzly Bears', 1);
    s.step = 'upkeep';
    reject(s, 'activate', { card: source.id, ability: 0, target: ref(foe) });
    s.step = 'main1';
    if (name === 'Constrictor Sage')
      reject(s, 'activate', { card: source.id, ability: 0, target: ref(own) });
    s = act(s, 'activate', { card: source.id, ability: 0, target: ref(foe) });
    assert.equal(s.objects[source.id].zone, 'exile');
    s = resolve(s);
    if (name === 'Constrictor Sage') {
      assert.equal(s.objects[foe.id].tapped, true);
      assert.equal(s.objects[foe.id].stunCounters, 1);
      nextTurn(s);
      assert.equal(s.objects[foe.id].tapped, true);
      assert.equal(s.objects[foe.id].stunCounters, 0);
    } else assert.equal(s.objects[foe.id].plusCounters, 1);
  }
});

test('Hopeful Vigil triggers for battlefield-to-graveyard only, without a creature-type requirement', () => {
  for (const destination of ['hand', 'exile', 'graveyard']) {
    let s = rich();
    const source = put(s, 'Hopeful Vigil');
    move(s, source, destination);
    stabilize(s);
    assert.equal(s.stack.length, destination === 'graveyard' ? 1 : 0);
    if (destination === 'graveyard') {
      s = resolve(s);
      assert.equal(s.choice.action, 'scry');
      assert.equal(s.choice.cards.length, 2);
    }
  }
});

test('Genghis has no once-per-turn cap and its Mutagen can put a counter on an opposing creature', () => {
  let s = rich();
  const frog = enter(s, 'Genghis Frog');
  s = resolve(s);
  assert.equal(tokens(s, 'Mutagen Token').length, 1);
  // This Mutant has no entry trigger of its own.
  const mutant = CARDS['High-Flying Ace'];
  for (let i = 0; i < 2; i++) {
    enter(s, mutant.name);
    s = resolve(s);
    assert.equal(tokens(s, 'Mutagen Token').length, i + 2);
  }
  enter(s, mutant.name, 1);
  assert.equal(s.stack.length, 0);
  const token = tokens(s, 'Mutagen Token')[0],
    foe = put(s, 'Grizzly Bears', 1);
  s.step = 'upkeep';
  reject(s, 'activate', { card: token.id, ability: 0, target: ref(foe) });
  s.step = 'main1';
  s = resolve(act(s, 'activate', { card: token.id, ability: 0, target: ref(foe) }));
  assert.equal(s.objects[foe.id].plusCounters, 1);
  assert(hasKeyword(s, s.objects[frog.id], 'trample'));
});

test('Spider-Ham boosts every listed animal exactly once, even if it has several listed subtypes', () => {
  const s = rich();
  const ham = put(s, 'Spider-Ham, Peter Porker');
  for (const subtype of [
    'Spider',
    'Boar',
    'Bat',
    'Bear',
    'Bird',
    'Cat',
    'Dog',
    'Frog',
    'Jackal',
    'Lizard',
    'Mouse',
    'Otter',
    'Rabbit',
    'Raccoon',
    'Rat',
    'Squirrel',
    'Turtle',
    'Wolf',
  ]) {
    const animal = put(s, 'Grizzly Bears');
    animal.definitionOverride = { ...CARDS['Grizzly Bears'], subtypes: [subtype] };
    assert.equal(stats(s, animal).power, 3, subtype);
  }
  const multiple = put(s, 'Grizzly Bears');
  multiple.definitionOverride = { ...CARDS['Grizzly Bears'], subtypes: ['Boar', 'Spider', 'Frog'] };
  assert.equal(stats(s, multiple).power, 3);
  assert.equal(stats(s, ham).power, 2);
  assert.equal(stats(s, put(s, 'Llanowar Elves')).power, 1);
});

test('Dragonfly ward permits targeting and charges exactly one generic mana', () => {
  let s = fixture();
  s.players[0].mana.W = 1;
  s.players[0].mana.C = 1;
  const swarm = put(s, 'Dragonfly Swarm', 1),
    card = put(s, 'Restoration Magic', 0, 'hand');
  s = act(s, 'cast', { card: card.id, mode: 0, target: ref(swarm) });
  assert.equal(s.stack.length, 2);
  s = resolve(s);
  assert.equal(s.choice.kind, 'payCost');
  assert.equal(s.choice.payable, true);
  s = act(s, 'payCost', { pay: true });
  assert.equal(s.players[0].mana.C, 0);
  s = resolve(s);
  assert(hasKeyword(s, s.objects[swarm.id], 'indestructible'));
});

test('Defend the Rider restricts protection to your permanent but needs no target for its Pilot', () => {
  let s = rich();
  const card = put(s, 'Defend the Rider', 0, 'hand'),
    foe = put(s, 'Forest', 1);
  reject(s, 'cast', { card: card.id, mode: 0, target: ref(foe) });
  s = resolve(act(s, 'cast', { card: card.id, mode: 1 }));
  assert.equal(tokens(s, 'Pilot Token').length, 1);
  assert.equal(tokens(s, 'Pilot Token')[0].controller, 0);
});

test('Gysahl flashback gives a green Bird whose landfall is friendly and temporary', () => {
  let s = rich();
  const card = put(s, 'Gysahl Greens', 0, 'graveyard');
  s = resolve(act(s, 'cast', { card: card.id }));
  assert.equal(s.objects[card.id].zone, 'exile');
  const bird = tokens(s, 'Landfall Bird Token')[0];
  enter(s, 'Forest', 1);
  assert.equal(s.stack.length, 0);
  enter(s, 'Forest');
  s = resolve(s);
  assert.deepEqual(stats(s, s.objects[bird.id]), { power: 3, toughness: 2 });
  finishCleanup(s);
  assert.deepEqual(stats(s, s.objects[bird.id]), { power: 2, toughness: 2 });
});

test('Plan the Heist surveils before drawing when a previously nonempty hand becomes empty', () => {
  let s = rich();
  const extra = put(s, 'Forest', 0, 'hand'),
    card = put(s, 'Plan the Heist', 0, 'hand');
  s = act(s, 'cast', { card: card.id });
  move(s, s.objects[extra.id], 'exile');
  s = resolve(s);
  assert.equal(s.choice.action, 'surveil');
  assert.equal(s.choice.cards.length, 3);
  const top = [...s.choice.cards].reverse();
  s = act(s, 'orderLibrary', { top, rest: [] });
  assert.deepEqual(s.players[0].hand, top);
});
