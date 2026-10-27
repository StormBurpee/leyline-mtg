import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  definition,
  dispatch,
  hasKeyword,
  hasType,
  ref,
  stats,
} from '../src/index.js';
import { CREATURE_TYPES, hasSubtype } from '../src/creature-types.js';
import { enterBattlefield, stabilize } from '../src/effects.js';
import { move, notifyTriggers } from '../src/model.js';
import { clearMana, finishCleanup } from '../src/turn.js';
import { fixture, put, act, resolve } from './helpers.js';

function rich() {
  const s = fixture();
  for (const color of ['W', 'U', 'B', 'R', 'G', 'C']) s.players[0].mana[color] = 100;
  return s;
}
function enter(s, name, controller = 0) {
  const o = put(s, name, controller, 'hand');
  enterBattlefield(s, o, controller);
  stabilize(s);
  return o;
}
function cast(s, name, args = {}) {
  const o = put(s, name, 0, 'hand');
  return { s: resolve(act(s, 'cast', { card: o.id, ...args })), id: o.id };
}
function reject(s, type, args) {
  const before = structuredClone(s);
  assert.equal(dispatch(s, { type, player: 0, ...args }).ok, false);
  assert.deepEqual(s, before);
}
function tokens(s, name) {
  return Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.name === name);
}

test('v52 token definitions preserve every color, type, subtype, stat and legendary characteristic', () => {
  for (const [name, types, subtypes, color, power, toughness, legendary, keywords] of [
    ['Doombot', ['artifact', 'creature'], ['Robot', 'Villain'], [], 3, 3, false, []],
    ['Zabu', ['creature'], ['Cat'], ['G'], 2, 2, true, []],
    ['Firebending Soldier Token', ['creature'], ['Soldier'], ['R'], 2, 2, false, []],
    ['Five Five Elephant Token', ['creature'], ['Elephant'], ['G'], 5, 5, false, []],
    ['Reach Treefolk Token', ['creature'], ['Treefolk'], ['G'], 3, 4, false, ['reach']],
    ['Green Squirrel Token', ['creature'], ['Squirrel'], ['G'], 1, 1, false, []],
    ['Zombie Druid Token', ['creature'], ['Zombie', 'Druid'], ['B'], 2, 2, false, []],
    ['Mutavault', ['land'], [], [], undefined, undefined, false, []],
  ]) {
    const d = CARDS[name];
    assert.deepEqual(
      {
        types: d.types,
        subtypes: d.subtypes,
        color: d.color,
        power: d.power,
        toughness: d.toughness,
        legendary: !!d.legendary,
        keywords: d.keywords,
        token: d.token,
        cost: d.cost,
      },
      { types, subtypes, color, power, toughness, legendary, keywords, token: true, cost: {} },
      name,
    );
  }
});

test('Mutavault has every creature type only while animated and remains a colorless land', () => {
  let s = rich();
  enter(s, 'Mutable Explorer');
  s = resolve(s);
  const token = tokens(s, 'Mutavault')[0];
  assert(token.token);
  assert(token.tapped);
  assert.equal(hasType(definition(s, token), 'creature'), false);
  s = resolve(act(s, 'activate', { card: token.id, ability: 0 }));
  const d = definition(s, s.objects[token.id]);
  assert.deepEqual(d.color, []);
  assert(hasType(d, 'land') && hasType(d, 'creature'));
  assert.deepEqual(stats(s, s.objects[token.id]), { power: 2, toughness: 2 });
  assert(CREATURE_TYPES.every((subtype) => hasSubtype(d, subtype)));
  assert.equal(hasKeyword(s, s.objects[token.id], 'changeling'), false);
  finishCleanup(s);
  assert.equal(hasType(definition(s, s.objects[token.id]), 'creature'), false);
  assert.equal(hasSubtype(definition(s, s.objects[token.id]), 'Treefolk'), false);
});

test('Doctor Doom needs your artifact creature or Plan, not an ordinary artifact or opponent artifact creature', () => {
  let s = rich();
  const doom = put(s, 'Doctor Doom');
  put(s, 'Basilisk Collar');
  put(s, 'Doombot', 1);
  assert.equal(hasKeyword(s, doom, 'indestructible'), false);
  const plan = { ...CARDS.Heartwood, name: 'Audit Plan', subtypes: ['Plan'] };
  s.catalog = createRegistry([...Object.values(CARDS), plan]);
  const p = put(s, plan.name);
  assert(hasKeyword(s, doom, 'indestructible'));
  move(s, p, 'graveyard');
  const bot = put(s, 'Doombot');
  assert(hasKeyword(s, doom, 'indestructible'));
  move(s, bot, 'exile');
  assert.equal(hasKeyword(s, doom, 'indestructible'), false);
});

test('Zabu triggers for your land tokens but not opposing lands', () => {
  let s = rich();
  const zabu = put(s, 'Zabu');
  enter(s, 'Forest', 1);
  assert.equal(s.stack.length, 0);
  enter(s, 'Mutable Explorer');
  s = resolve(resolve(s));
  assert.equal(s.objects[zabu.id].plusCounters, 1);
});

test('Fire Nation flashback creates two Soldiers whose attack mana lasts exactly through combat', () => {
  let s = rich();
  const spell = put(s, 'Fire Nation Attacks', 0, 'graveyard');
  s = resolve(act(s, 'cast', { card: spell.id }));
  assert.equal(s.objects[spell.id].zone, 'exile');
  const soldiers = tokens(s, 'Firebending Soldier Token');
  assert.equal(soldiers.length, 2);
  for (const soldier of soldiers) soldier.controlledSince = s.turn - 1;
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: 0 };
  s = act(s, 'attackers', { cards: soldiers.map((o) => o.id) });
  s = act(s, 'orderTriggers', { ids: s.choice.entries.map((entry) => entry.id) });
  while (s.stack.length) s = resolve(s);
  assert.deepEqual(s.players[0].restrictedMana, [
    { color: 'R', duration: 'combat' },
    { color: 'R', duration: 'combat' },
  ]);
  s.step = 'damage';
  clearMana(s);
  assert.equal(s.players[0].restrictedMana.length, 2);
  s.step = 'endCombat';
  clearMana(s);
  assert.equal(s.players[0].restrictedMana.length, 0);
});

test('Archenemy Charm enforces one-or-two graveyard cards and your-creature lifelink restrictions', () => {
  let s = rich();
  const spell = put(s, "Archenemy's Charm", 0, 'hand');
  const own = put(s, 'Grizzly Bears', 0, 'graveyard');
  const enemy = put(s, 'Grizzly Bears', 1, 'graveyard');
  const noncreature = put(s, 'Forest', 0, 'graveyard');
  for (const chosen of [[], [ref(enemy)], [ref(noncreature)]])
    reject(s, 'cast', { card: spell.id, mode: 1, targets: { chosen } });
  const creature = put(s, 'Grizzly Bears');
  const opponent = put(s, 'Grizzly Bears', 1);
  reject(s, 'cast', { card: spell.id, mode: 2, target: ref(opponent) });
  s = resolve(act(s, 'cast', { card: spell.id, mode: 2, target: ref(creature) }));
  assert.equal(s.objects[creature.id].plusCounters, 2);
  assert(hasKeyword(s, s.objects[creature.id], 'lifelink'));
  assert.equal(s.objects[own.id].zone, 'graveyard');
  finishCleanup(s);
  assert.equal(hasKeyword(s, s.objects[creature.id], 'lifelink'), false);
  assert.equal(s.objects[creature.id].plusCounters, 2);
});

test('Disruptor rejects itself and lands but can bounce your other permanent', () => {
  let s = rich();
  const land = put(s, 'Forest');
  const artifact = put(s, 'Basilisk Collar');
  const source = enter(s, 'Disruptor of Currents');
  for (const target of [source, land])
    reject(s, 'chooseTriggerTargets', { targets: { chosen: [ref(target)] } });
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [ref(artifact)] } });
  s = resolve(s);
  assert.equal(s.objects[artifact.id].zone, 'hand');
});

test('Annie does not reanimate if not cast, but her cast ETB survives her departure', () => {
  let s = rich();
  const land = put(s, 'Forest', 0, 'graveyard');
  const uncast = enter(s, 'Annie Flash, the Veteran');
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 0);
  move(s, uncast, 'exile');
  const result = cast(s, 'Annie Flash, the Veteran');
  s = result.s;
  s = act(s, 'chooseTriggerTarget', { target: ref(land) });
  move(s, s.objects[result.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[land.id].zone, 'battlefield');
  assert(s.objects[land.id].tapped);
});

test('Tend the Sprigs counts a land Treefolk only once and still checks after failing to find', () => {
  for (const count of [5, 6]) {
    let s = rich();
    for (let i = 0; i < count; i++) put(s, 'Forest');
    const land = put(s, 'Mutavault');
    s = resolve(act(s, 'activate', { card: land.id, ability: 0 }));
    s = cast(s, 'Tend the Sprigs').s;
    s = act(s, 'searchLibrary', { cards: [] });
    assert.equal(tokens(s, 'Reach Treefolk Token').length, count === 6 ? 1 : 0);
  }
});

test('Restless Cottage animation is black and green Horror land; illegal chosen exile target fizzles all effects', () => {
  let s = rich();
  const land = put(s, 'Restless Cottage');
  s = resolve(act(s, 'activate', { card: land.id, ability: 0 }));
  const d = definition(s, s.objects[land.id]);
  assert.deepEqual(d.color, ['B', 'G']);
  assert(hasType(d, 'land') && hasType(d, 'creature') && hasSubtype(d, 'Horror'));
  assert.deepEqual(stats(s, s.objects[land.id]), { power: 4, toughness: 4 });
  const target = put(s, 'Forest', 1, 'graveyard');
  notifyTriggers(s, 'attack', { object: s.objects[land.id] });
  stabilize(s);
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [ref(target)] } });
  move(s, s.objects[target.id], 'hand');
  s = resolve(s);
  assert.equal(tokens(s, 'Food Token').length, 0);
});

test('Offender and Rakish Scoundrel have no entry trigger face down and grant their real face-up effects', () => {
  for (const name of ['Offender at Large', 'Rakish Scoundrel']) {
    let s = rich();
    const target = put(s, 'Grizzly Bears', 1);
    const result = cast(s, name, { mode: 1 });
    s = result.s;
    assert(s.objects[result.id].faceDown);
    assert.deepEqual(definition(s, s.objects[result.id]).color, []);
    assert.equal(s.stack.length, 0);
    assert.equal(s.choice, null);
    s = act(s, 'turnFaceUp', { card: result.id });
    s =
      name === 'Offender at Large'
        ? act(s, 'chooseTriggerTargets', { targets: { chosen: [ref(target)] } })
        : act(s, 'chooseTriggerTarget', { target: ref(target) });
    s = resolve(s);
    if (name === 'Offender at Large') assert.equal(stats(s, s.objects[target.id]).power, 4);
    else assert(hasKeyword(s, s.objects[target.id], 'indestructible'));
  }
});

test('Elemental Mascot uses mana spent including a selected additional tier, not the printed mana value', () => {
  for (const mode of [1, 2]) {
    let s = rich();
    const mascot = put(s, 'Elemental Mascot');
    const target = put(s, 'Colossal Dreadmaw', 1);
    const spell = put(s, 'Thunder Magic', 0, 'hand');
    s = act(s, 'cast', { card: spell.id, mode, target: ref(target) });
    s = resolve(s);
    assert.equal(stats(s, s.objects[mascot.id]).power, 2);
    assert.equal(s.players[0].exile.length, mode === 2 ? 1 : 0);
    if (mode === 2) assert.equal(s.objects[s.players[0].exile[0]].playPermission.untilNextTurn, 0);
  }
});

test('Eye of Jace continues after a failed sacrifice when its source left before resolution', () => {
  let s = rich();
  const eye = put(s, 'Eye of Jace');
  for (let i = 0; i < 7; i++) put(s, 'Forest', 0, 'graveyard');
  notifyTriggers(s, 'step', { player: 0, step: 'upkeep' });
  stabilize(s);
  move(s, eye, 'exile');
  s = resolve(s);
  s = act(s, 'orderLibrary', { top: [...s.choice.cards], rest: [] });
  assert.equal(s.players[0].life, 22);
  assert.equal(s.players[1].life, 18);
});

test('Hellspur haste excludes itself, opposing outlaws, and your non-outlaws', () => {
  const s = rich();
  const boss = put(s, 'Hellspur Posse Boss');
  const enemy = put(s, 'Mercenary Token', 1);
  const bear = put(s, 'Grizzly Bears');
  const changeling = put(s, 'Mutable Explorer');
  assert.equal(hasKeyword(s, boss, 'haste'), false);
  assert.equal(hasKeyword(s, enemy, 'haste'), false);
  assert.equal(hasKeyword(s, bear, 'haste'), false);
  assert(hasKeyword(s, changeling, 'haste'));
});

test('Hobbit Hole must search and shuffle even when failing to find; only Sazh may decline entirely', () => {
  let s = rich();
  const hole = put(s, 'Hobbit Hole');
  s = resolve(act(s, 'activate', { card: hole.id, ability: 0 }));
  reject(s, 'searchLibrary', { cards: [], decline: true });
  s = act(s, 'searchLibrary', { cards: [] });
  assert(s.events.some((e) => e.type === 'libraryShuffled'));
  s = rich();
  enter(s, 'Sazh Katzroy');
  s = resolve(s);
  const library = [...s.players[0].library];
  s = act(s, 'searchLibrary', { cards: [], decline: true });
  assert.deepEqual(s.players[0].library, library);
  assert(s.events.some((e) => e.type === 'librarySearchDeclined'));
  assert.equal(
    s.events.some((e) => e.type === 'libraryShuffled'),
    false,
  );
});

test('Run Over cannot use an opposing Mount to discount and never accepts an uncrewed Vehicle as its creature', () => {
  let s = fixture();
  s.players[0].mana.G = 1;
  const own = put(s, 'Grizzly Bears');
  const enemy = put(s, 'Sizzling Changeling', 1);
  const vehicle = put(s, 'Rover Blades');
  const spell = put(s, 'Run Over', 0, 'hand');
  reject(s, 'cast', { card: spell.id, targets: { fighter: [ref(own)], victim: [ref(enemy)] } });
  reject(s, 'cast', { card: spell.id, targets: { fighter: [ref(vehicle)], victim: [ref(enemy)] } });
  s.players[0].mana.C = 1;
  s = act(s, 'cast', { card: spell.id, targets: { fighter: [ref(own)], victim: [ref(enemy)] } });
  s.objects[own.id].controller = 1;
  s = resolve(s);
  assert.equal(s.objects[enemy.id].damage, 0);
});

test('Sinuous Benthisaur chooses only available cards and randomizes the remaining bottom independent of submitted order', () => {
  for (const count of [0, 1, 5]) {
    let s = rich();
    for (let i = 0; i < count; i++)
      put(s, 'Volatile Fault', 0, i % 2 ? 'graveyard' : 'battlefield');
    put(s, 'Volatile Fault', 1);
    enter(s, 'Sinuous Benthisaur');
    s = resolve(s);
    if (!count) {
      assert.equal(s.choice, null);
      assert.equal(s.players[0].hand.length, 0);
    } else {
      const cards = [...s.choice.cards];
      assert.equal(cards.length, count);
      assert.equal(s.choice.selectCount, Math.min(count, 2));
      assert.equal(s.choice.restOrder, 'random');
      const top = cards.slice(0, 2),
        rest = cards.slice(2);
      const a = act(s, 'orderLibrary', { top, rest });
      const b = act(s, 'orderLibrary', { top, rest: [...rest].reverse() });
      assert.equal(a.players[0].hand.length, Math.min(count, 2));
      assert.deepEqual(a.players[0].library, b.players[0].library);
      assert.equal(a.rng, b.rng);
    }
  }
});

test('power-up abilities with one chosen target fizzle their counters when that target becomes illegal', () => {
  for (const [name, targetName, zone] of [
    ['She-Hulk, Jade Defender', 'Basilisk Collar', 'battlefield'],
    ['Unliving Legionnaire', 'Grizzly Bears', 'graveyard'],
  ]) {
    let s = rich();
    const source = enter(s, name);
    const target = put(s, targetName, 0, zone);
    s = act(s, 'activate', { card: source.id, ability: 0, targets: { chosen: [ref(target)] } });
    move(s, s.objects[target.id], 'exile');
    s = resolve(s);
    assert.equal(s.objects[source.id].plusCounters, 0);
    reject(s, 'activate', { card: source.id, ability: 0, targets: { chosen: [] } });
  }
});

test('Enduring Innocence does not recur as a noncreature enchantment or when its departed card changed zones', () => {
  for (const changedZone of [false, true]) {
    let s = rich();
    const source = put(s, 'Enduring Innocence');
    move(s, source, 'graveyard');
    stabilize(s);
    if (changedZone) move(s, source, 'exile');
    s = resolve(s);
    if (changedZone) assert.equal(s.objects[source.id].zone, 'exile');
    else {
      assert.deepEqual(definition(s, s.objects[source.id]).types, ['enchantment']);
      assert.deepEqual(definition(s, s.objects[source.id]).subtypes, []);
      move(s, s.objects[source.id], 'graveyard');
      stabilize(s);
      assert.equal(s.stack.length, 0);
      assert.equal(s.objects[source.id].zone, 'graveyard');
    }
  }
});

test('Forum Familiar requires another permanent and receives no counter when its target leaves', () => {
  let s = rich();
  const land = put(s, 'Forest');
  const result = cast(s, 'Forum Familiar', { mode: 1 });
  s = act(result.s, 'turnFaceUp', { card: result.id });
  reject(s, 'chooseTriggerTarget', { target: ref(s.objects[result.id]) });
  s = act(s, 'chooseTriggerTarget', { target: ref(land) });
  move(s, s.objects[land.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[result.id].plusCounters, 0);
});

test('Crescent Island Temple distinguishes other controlled Shrines and its red Monks have prowess', () => {
  let s = rich();
  const temple = enter(s, 'Crescent Island Temple');
  s = resolve(s);
  assert.equal(tokens(s, 'Red Prowess Monk Token').length, 1);
  const other = { ...CARDS['Crescent Island Temple'], name: 'Audit Shrine', etb: [], triggers: [] };
  delete other.etb;
  s.catalog = createRegistry([...Object.values(CARDS), other]);
  enter(s, other.name, 1);
  assert.equal(s.stack.length, 0);
  enter(s, other.name);
  s = resolve(s);
  const monk = tokens(s, 'Red Prowess Monk Token')[0];
  assert.equal(tokens(s, 'Red Prowess Monk Token').length, 2);
  assert.deepEqual(definition(s, monk).color, ['R']);
  assert.deepEqual(definition(s, monk).subtypes, ['Monk']);
  assert.deepEqual(stats(s, monk), { power: 1, toughness: 1 });
  assert.equal(s.objects[temple.id].zone, 'battlefield');
});

test('Restless Ridgeline targets another attacker, not itself or an idle creature, and untapping does not remove it from combat', () => {
  let s = rich();
  const ridge = put(s, 'Restless Ridgeline');
  const attacker = put(s, 'Grizzly Bears');
  const idle = put(s, 'Grizzly Bears');
  s = resolve(act(s, 'activate', { card: ridge.id, ability: 0 }));
  assert.deepEqual(definition(s, s.objects[ridge.id]).color, ['R', 'G']);
  assert(hasSubtype(definition(s, s.objects[ridge.id]), 'Dinosaur'));
  assert.deepEqual(stats(s, s.objects[ridge.id]), { power: 3, toughness: 4 });
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: 0 };
  s = act(s, 'attackers', { cards: [ridge.id, attacker.id] });
  reject(s, 'chooseTriggerTarget', { target: ref(s.objects[ridge.id]) });
  reject(s, 'chooseTriggerTarget', { target: ref(idle) });
  s = act(s, 'chooseTriggerTarget', { target: ref(attacker) });
  s = resolve(s);
  assert.equal(s.objects[attacker.id].tapped, false);
  assert.equal(stats(s, s.objects[attacker.id]).power, 4);
  assert(s.combat.attackers.some((object) => object.id === attacker.id));
});

test('Tam Resistance does not empower Jace if its one chosen creature target becomes illegal', () => {
  let s = rich();
  const target = put(s, 'Grizzly Bears', 1);
  const spell = put(s, "Tam's Resistance", 0, 'hand');
  s = act(s, 'cast', { card: spell.id, targets: { chosen: [ref(target)] } });
  move(s, s.objects[target.id], 'exile');
  s = resolve(s);
  assert.equal(tokens(s, 'Jace Token').length, 0);
});

test('Dawnhand checks your graveyard after milling and can count its own departed card at resolution', () => {
  let s = rich();
  put(s, 'Llanowar Elves', 1, 'graveyard');
  // A known non-Elf top three prevents the fixture deck from affecting the condition.
  const top = Array.from({ length: 3 }, () => put(s, 'Forest', 0, 'library').id);
  s.players[0].library = [...top, ...s.players[0].library.filter((id) => !top.includes(id))];
  const eulogist = enter(s, 'Dawnhand Eulogist');
  move(s, eulogist, 'graveyard');
  s = resolve(s);
  assert.equal(s.players[0].life, 22);
  assert.equal(s.players[1].life, 18);
});

test('enchantment-departure watchers ignore opposing enchantments and auras draw when their target dies', () => {
  let s = rich();
  put(s, "Ashiok's Reaper");
  put(s, 'Knight of Doves');
  const enemyEnchantment = put(s, 'Felidar Retreat', 1);
  move(s, enemyEnchantment, 'graveyard');
  stabilize(s);
  assert.equal(s.stack.length, 0);
  const target = put(s, 'Grizzly Bears', 1);
  const result = cast(s, 'Demonic Ruckus', { target: ref(target) });
  s = result.s;
  move(s, s.objects[target.id], 'graveyard');
  stabilize(s);
  assert.equal(s.objects[result.id].zone, 'graveyard');
  s = act(s, 'orderTriggers', { ids: s.choice.entries.map((entry) => entry.id) });
  while (s.stack.length) s = resolve(s);
  assert.equal(s.players[0].hand.length, 2);
  assert.equal(tokens(s, 'White Flying Bird Token').length, 1);
});

test('Repulsor rejects insufficient teamwork and its entire effect fizzles when the target leaves', () => {
  let s = rich();
  const small = put(s, 'Llanowar Elves');
  const team = put(s, 'Grizzly Bears');
  const target = put(s, 'Serra Angel', 1);
  const spell = put(s, 'Repulsor Blast', 0, 'hand');
  reject(s, 'cast', {
    card: spell.id,
    target: ref(target),
    additionalCost: { teamwork: [ref(small)] },
  });
  s = act(s, 'cast', {
    card: spell.id,
    target: ref(target),
    additionalCost: { teamwork: [ref(team)] },
  });
  move(s, s.objects[target.id], 'exile');
  s = resolve(s);
  assert(s.objects[team.id].tapped);
  assert.equal(s.players[1].life, 20);
});
