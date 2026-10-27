import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import {
  CARDS,
  createGame,
  exportReplay,
  replay,
  legalActions,
  createRegistry,
  definition,
  dispatch,
  ref,
  stats,
  chooseBotCommand,
  playerView,
} from '../src/index.js';
import { move, addModifier, loseLife, counterKinds } from '../src/model.js';
import {
  enterBattlefield,
  enterBattlefieldBatch,
  stabilize,
  resolveEffects,
} from '../src/effects.js';
import { compileCard } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { validateDefinition } from '../src/definition-validation.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
import { createSession } from '../../simulation/session.js';
import { inspect } from '../../../apps/web/view.js';
const name = 'Caradora, Heart of Alacria';
const source = JSON.parse(
  fs.readFileSync(new URL('../../cards/cards/caradora-heart-of-alacria.json', import.meta.url)),
);
const compiled = compileCard(source);
assert.ok(compiled.ok, JSON.stringify(compiled.diagnostics));
const card = compiled.definition;
const extraSlugs = ['michelangelo-weirdness-to-11', 'yoshimaru-beloved-companion'];
const extraSources = extraSlugs.map((slug) =>
  JSON.parse(fs.readFileSync(new URL(`../../cards/cards/${slug}.json`, import.meta.url))),
);
const identities = { 'leyline:token/mutagen-token': 'Mutagen Token' };
const extraCards = extraSources.map((source) => {
  const result = compileCard(source, { identities });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.definition;
});
const catalog = createRegistry({
  ...CARDS,
  [name]: card,
  ...Object.fromEntries(extraCards.map((card) => [card.name, card])),
});
function setup() {
  const s = fixture();
  s.catalog = catalog;
  return s;
}
function effect(s, target, effects, controller = 0, extra = {}) {
  return resolveEffects(s, {
    name: 'Counter instruction',
    kind: 'ability',
    controller,
    source: ref(target),
    target: ref(target),
    effects,
    ...extra,
  });
}
function counters(s, target, amount, controller = 0, extra = {}) {
  effect(s, target, [{ op: 'counterOn', amount, ...extra }], controller);
}
function reject(s, command) {
  const before = JSON.stringify(s);
  assert.equal(dispatch(s, { player: s.choice?.player ?? s.priority, ...command }).ok, false);
  assert.equal(JSON.stringify(s), before);
}

test('Caradora preserves the complete Oracle card and source/schema/native roundtrip', () => {
  const validate = new Ajv({ strict: true }).compile(
    JSON.parse(fs.readFileSync(new URL('../../cards/schema/card.schema.json', import.meta.url))),
  );
  assert.ok(validate(source), JSON.stringify(validate.errors));
  const roundtrip = compileCard(sourceFromDefinition(card, { id: source.id }));
  assert.ok(roundtrip.ok, JSON.stringify(roundtrip.diagnostics));
  assert.deepEqual(roundtrip.definition, card);
  assert.equal(card.text, source.rulesText);
  assert.equal(card.legendary, true);
  assert.deepEqual(card.cost, { generic: 2, G: 1, W: 1 });
  assert.deepEqual([card.power, card.toughness, card.subtypes], [4, 2, ['Human', 'Knight']]);
  assert.deepEqual(card.plusCounterBonus, { amount: 1, scope: 'creatureOrVehicleYouControl' });
  assert.equal(card.triggers.length, 1);
  assert.equal(card.triggers[0].optional, true);
  assert.deepEqual(card.triggers[0].effects, [
    {
      op: 'searchLibrary',
      count: 1,
      destination: 'hand',
      reveal: true,
      where: { any: [{ subtype: 'Mount' }, { subtype: 'Vehicle' }] },
    },
  ]);
});

test('replacement validation fails closed on generic counters, multipliers, player/placer scope and duplicate declarations', () => {
  const validate = new Ajv({ strict: true }).compile(
    JSON.parse(fs.readFileSync(new URL('../../cards/schema/card.schema.json', import.meta.url))),
  );
  for (const patch of [
    { amount: 0 },
    { amount: -1 },
    { amount: 1.5 },
    { amount: 1001 },
    { scope: 'permanentYouControl' },
    { scope: 'player' },
    { counter: 'charge' },
    { multiplier: 2 },
    { optional: true },
    { placer: 'you' },
    { where: { type: 'creature' } },
  ]) {
    const bad = structuredClone(source);
    Object.assign(bad.abilities[1], patch);
    assert.equal(validate(bad), false, JSON.stringify(patch));
    assert.equal(compileCard(bad).ok, false, JSON.stringify(patch));
    assert.ok(
      validateDefinition({ ...card, plusCounterBonus: { ...card.plusCounterBonus, ...patch } })
        .length,
      JSON.stringify(patch),
    );
  }
  const duplicate = structuredClone(source);
  duplicate.abilities.push(structuredClone(duplicate.abilities[1]));
  assert.equal(compileCard(duplicate).ok, false);
  assert.ok(validateDefinition({ ...card, type: 'instant', types: ['instant'] }).length);
});

test('replacement follows recipient controller, not its owner or the player putting counters', () => {
  const s = setup();
  put(s, name);
  const own = put(s, 'Grizzly Bears'),
    enemy = put(s, 'Grizzly Bears', 1);
  own.plusCounters = 7;
  counters(s, own, 3, 1);
  assert.equal(own.plusCounters, 11, 'only the new three become four');
  counters(s, enemy, 3, 0);
  assert.equal(enemy.plusCounters, 3);
  enemy.controller = 0;
  counters(s, enemy, 1, 1);
  assert.equal(enemy.plusCounters, 5, 'stolen recipient uses current controller');
  own.controller = 1;
  counters(s, own, 1, 0);
  assert.equal(own.plusCounters, 12);
});

test('uncrewed Vehicles qualify, ordinary noncreatures do not, and creature Vehicles get only one bonus', () => {
  const s = setup();
  put(s, name);
  const vehicle = put(s, 'Careening Mine Cart'),
    artifact = put(s, 'Torpor Orb'),
    land = put(s, 'Forest');
  assert.equal(definition(s, vehicle).type, 'artifact');
  counters(s, vehicle, 2);
  counters(s, artifact, 2);
  counters(s, land, 2);
  assert.equal(vehicle.plusCounters, 3);
  assert.equal(artifact.plusCounters, 2);
  assert.equal(land.plusCounters, 2);
  addModifier(s, {
    objectId: vehicle.id,
    incarnation: vehicle.incarnation,
    addTypes: ['creature'],
    expires: s.turn,
  });
  counters(s, vehicle, 1);
  assert.equal(vehicle.plusCounters, 5);
});

test('one application per source per event; repeated instructions are distinct, mixed counters await SBAs', () => {
  const s = setup();
  const first = put(s, name);
  const second = put(s, name);
  const bear = put(s, 'Grizzly Bears');
  // No stabilization: both legendary objects exist until the next SBA.
  counters(s, bear, 3);
  assert.equal(bear.plusCounters, 5);
  effect(s, bear, [
    { op: 'counterOn', amount: 1 },
    { op: 'counterOn', amount: 1 },
  ]);
  assert.equal(bear.plusCounters, 11);
  counters(s, bear, 2, 0, { counter: '-1/-1' });
  assert.equal(bear.minusCounters, 2);
  assert.equal(bear.plusCounters, 11);
  move(s, second, 'graveyard');
  stabilize(s);
  assert.equal(bear.plusCounters, 9);
  assert.equal(bear.minusCounters, 0);
  counters(s, first, 1);
  assert.equal(first.plusCounters, 2, 'Caradora applies to herself once on the battlefield');
});

test('zero and negative placement amounts cannot create a counter event; other counter kinds are not changed', () => {
  const s = setup();
  const caradora = put(s, name);
  const bear = put(s, 'Grizzly Bears');
  counters(s, bear, 0);
  counters(s, bear, -2);
  effect(s, bear, [{ op: 'doubleCounters' }]);
  assert.equal(bear.plusCounters, 0);
  effect(s, bear, [
    { op: 'stunOn', amount: 2 },
    { op: 'keywordCounter', keyword: 'flying', amount: 1 },
  ]);
  counters(s, bear, 2, 0, { counter: '-1/-1' });
  assert.equal(bear.stunCounters, 2);
  assert.equal(bear.keywordCounters.flying, 1);
  assert.equal(bear.minusCounters, 2);
  assert.equal(bear.plusCounters, 0);
  const talent = put(s, "Hunter's Talent");
  talent.classLevel = 3;
  assert.deepEqual(counterKinds(talent), [], 'Class levels remain designations');
  caradora.chargeCounters = 4;
  assert.equal(caradora.chargeCounters, 4);
});

test('ability loss, control changes and leaving the battlefield update the replacement immediately', () => {
  const s = setup();
  const caradora = put(s, name);
  const own = put(s, 'Grizzly Bears');
  const enemy = put(s, 'Grizzly Bears', 1);
  addModifier(s, {
    objectId: caradora.id,
    incarnation: caradora.incarnation,
    removeAbilities: true,
    expires: s.turn,
  });
  counters(s, own, 1);
  assert.equal(own.plusCounters, 1);
  s.modifiers = [];
  counters(s, own, 1);
  assert.equal(own.plusCounters, 3);
  caradora.controller = 1;
  counters(s, own, 1);
  counters(s, enemy, 1);
  assert.equal(own.plusCounters, 4);
  assert.equal(enemy.plusCounters, 2);
  move(s, caradora, 'graveyard');
  counters(s, enemy, 1);
  assert.equal(enemy.plusCounters, 3);
});

test('entry with X counters and Gev replacements receives one placement bonus before observers', () => {
  const s = setup();
  put(s, name);
  put(s, 'Gev, Scaled Scorch');
  loseLife(s, 1, 1);
  put(s, 'Torpor Orb');
  const hydra = put(s, 'Goldvein Hydra', 0, 'stack');
  hydra.chosenX = 3;
  enterBattlefield(s, hydra);
  assert.equal(hydra.plusCounters, 5);
  assert.deepEqual(stats(s, hydra), { power: 5, toughness: 5 });
  assert.equal(s.pendingTriggers.length, 0, 'replacement is not an ETB trigger');
  const zero = put(s, 'Goldvein Hydra', 0, 'stack');
  zero.chosenX = 0;
  enterBattlefield(s, zero);
  assert.equal(zero.plusCounters, 2, 'Gev creates a positive placement event even at X=0');
});

test('zero X and noncast reentry receive no bonus; opposing and enchantment-only entrants are excluded', () => {
  const s = setup();
  put(s, name);
  const zero = put(s, 'Goldvein Hydra', 0, 'stack');
  zero.chosenX = 0;
  enterBattlefield(s, zero);
  assert.equal(zero.plusCounters, 0);
  const enemy = put(s, 'Goldvein Hydra', 1, 'stack');
  enemy.chosenX = 2;
  enterBattlefield(s, enemy, 1);
  assert.equal(enemy.plusCounters, 2);
  const returned = put(s, 'Goldvein Hydra', 0, 'exile');
  returned.chosenX = 8;
  returned.plusCounters = 8;
  enterBattlefield(s, returned);
  assert.equal(returned.plusCounters, 0);
  const enchantment = put(s, 'Goldvein Hydra', 0, 'stack');
  enchantment.chosenX = 2;
  enterBattlefieldBatch(s, [{ object: enchantment, enchantmentOnly: true }]);
  assert.equal(enchantment.plusCounters, 2);
  assert.equal(definition(s, enchantment).type, 'enchantment');
});

test('simultaneous entrants cannot supply general counter replacements, in either array order', () => {
  for (const reversed of [false, true]) {
    const s = setup();
    const caradora = put(s, name, 0, 'hand');
    const hydra = put(s, 'Goldvein Hydra', 0, 'stack');
    hydra.chosenX = 3;
    const entries = [{ object: caradora }, { object: hydra }];
    enterBattlefieldBatch(s, reversed ? entries.reverse() : entries);
    assert.equal(hydra.plusCounters, 3);
    counters(s, hydra, 1);
    assert.equal(hydra.plusCounters, 5);
  }
});

test('an existing replacement affects all simultaneous entries once; source entry does not affect itself', () => {
  const s = setup();
  put(s, 'Gev, Scaled Scorch');
  loseLife(s, 1, 1);
  const caradora = put(s, name, 0, 'hand');
  enterBattlefield(s, caradora);
  assert.equal(caradora.plusCounters, 1, 'general static ability not active before its own entry');
  const first = put(s, 'Goldvein Hydra', 0, 'stack'),
    second = put(s, 'Goldvein Hydra', 0, 'stack');
  first.chosenX = 2;
  second.chosenX = 4;
  enterBattlefieldBatch(s, [{ object: first }, { object: second }]);
  assert.deepEqual([first.plusCounters, second.plusCounters], [4, 6]);
});

test('tokens and copies retain the replacement but do not copy existing counters', () => {
  const s = setup();
  const caradora = put(s, name);
  caradora.plusCounters = 9;
  effect(s, caradora, [{ op: 'copyToken', count: 1 }]);
  const copy = Object.values(s.objects).find((o) => o.token && o.name === name);
  assert.equal(copy.plusCounters, 0);
  assert.deepEqual(definition(s, copy).plusCounterBonus, card.plusCounterBonus);
  const token = put(s, 'Soldier Token');
  counters(s, token, 1);
  assert.equal(token.plusCounters, 3);
});

test('doubling adds the old number then applies replacement, without doubling old or unrelated counters', () => {
  const s = setup();
  put(s, name);
  const bear = put(s, 'Grizzly Bears');
  bear.plusCounters = 3;
  bear.minusCounters = 1;
  bear.stunCounters = 2;
  effect(s, bear, [{ op: 'doubleCounters' }]);
  assert.deepEqual([bear.plusCounters, bear.minusCounters, bear.stunCounters], [7, 1, 2]);
});

test('grouped and distributed placement apply per recipient while excluding zero allocations', () => {
  const s = setup();
  put(s, name);
  const first = put(s, 'Grizzly Bears'),
    second = put(s, 'Grizzly Bears'),
    enemy = put(s, 'Grizzly Bears', 1);
  effect(s, first, [{ op: 'counterAll', amount: 2, where: { type: 'creature' } }]);
  assert.deepEqual([first.plusCounters, second.plusCounters, enemy.plusCounters], [3, 3, 2]);
  effect(s, first, [{ op: 'distributedCounters' }], 0, {
    distribution: { [first.id]: 2, [second.id]: 0 },
  });
  effect(s, second, [{ op: 'distributedCounters' }], 0, {
    distribution: { [first.id]: 2, [second.id]: 0 },
  });
  assert.deepEqual([first.plusCounters, second.plusCounters], [6, 3]);
});

test('earthbend checks creature status after animation and explore routes its own placement', () => {
  const s = setup();
  put(s, name);
  const land = put(s, 'Forest');
  effect(s, land, [{ op: 'earthbend', amount: 2 }]);
  assert.equal(land.plusCounters, 3);
  assert.deepEqual(stats(s, land), { power: 3, toughness: 3 });
  const bear = put(s, 'Grizzly Bears');
  for (const id of [...s.players[0].library]) move(s, s.objects[id], 'graveyard');
  effect(s, bear, [{ op: 'explore' }]);
  assert.equal(bear.plusCounters, 2);
});

test('connive places its extra counter after a real nonland discard on the same incarnation', () => {
  let s = setup();
  put(s, name);
  const bear = put(s, 'Grizzly Bears');
  const discard = put(s, 'Grizzly Bears', 0, 'hand');
  effect(s, bear, [{ op: 'connive' }]);
  assert.equal(s.choice.kind, 'discardEffect');
  s = act(s, 'discardEffect', { cards: [discard.id] });
  assert.equal(s.objects[bear.id].plusCounters, 2);
});

test('counter placement never revives a stale targeted incarnation', () => {
  const s = setup();
  put(s, name);
  const bear = put(s, 'Grizzly Bears');
  const old = ref(bear);
  move(s, bear, 'exile');
  enterBattlefield(s, bear);
  resolveEffects(s, {
    controller: 0,
    source: old,
    target: old,
    effects: [{ op: 'counterOn', amount: 2 }],
  });
  assert.equal(bear.plusCounters, 0);
});

test('Caradora optional tutor offers Mounts/Vehicles only, reveals selection and shuffles after source leaves', () => {
  let s = setup();
  const caradora = put(s, name, 0, 'hand');
  const vehicle = put(s, 'Careening Mine Cart', 0, 'library');
  const mount = put(s, 'Brightfield Glider', 0, 'library');
  const unrelated = put(s, 'Grizzly Bears', 0, 'library');
  enterBattlefield(s, caradora);
  stabilize(s);
  move(s, caradora, 'graveyard');
  s = resolve(s);
  assert.equal(s.choice.kind, 'optionalEffect');
  s = act(s, 'resolveOptional', { accept: true });
  assert.equal(s.choice.kind, 'librarySearch');
  assert.ok(s.choice.cards.includes(vehicle.id));
  assert.ok(s.choice.cards.includes(mount.id));
  assert.ok(!s.choice.cards.includes(unrelated.id));
  reject(s, { type: 'searchLibrary', cards: [unrelated.id] });
  reject(s, { type: 'searchLibrary', cards: [vehicle.id, mount.id] });
  const rng = s.rng;
  s = act(s, 'searchLibrary', { cards: [vehicle.id] });
  assert.equal(s.objects[vehicle.id].zone, 'hand');
  assert.equal(s.choice, null);
  assert.ok(
    s.events.some(
      (event) =>
        event.type === 'librarySearched' && event.revealed?.includes('Careening Mine Cart'),
    ),
  );
  assert.notDeepEqual(s.rng, rng);
});

test('declining Caradora tutor does not search/shuffle; accepting may fail to find', () => {
  for (const accept of [false, true]) {
    let s = setup();
    const caradora = put(s, name, 0, 'hand');
    enterBattlefield(s, caradora);
    stabilize(s);
    s = resolve(s);
    const rng = s.rng,
      library = [...s.players[0].library];
    s = act(s, 'resolveOptional', { accept });
    if (accept) {
      s = act(s, 'searchLibrary', { cards: [] });
      assert.notDeepEqual(s.rng, rng);
    } else {
      assert.deepEqual(s.players[0].library, library);
      assert.deepEqual(s.rng, rng);
    }
    assert.equal(s.choice, null);
  }
});

test('actual cast, bot search choices, public hidden-information boundary and deterministic command copies', () => {
  let s = setup();
  const caradora = put(s, name, 0, 'hand');
  put(s, 'Careening Mine Cart', 0, 'library');
  lands(s, 'Forest', 3);
  lands(s, 'Plains', 1);
  s = act(s, 'cast', { card: caradora.id });
  s = resolve(s);
  s = resolve(s);
  assert.equal(s.choice.kind, 'optionalEffect');
  const command = chooseBotCommand(s, s.choice.player);
  const a = dispatch(s, command),
    b = dispatch(structuredClone(s), command);
  assert.ok(a.ok);
  assert.ok(b.ok);
  assert.deepEqual(a.state, b.state);
  s = a.state;
  assert.equal(s.choice.kind, 'librarySearch');
  assert.ok(
    !Object.values(playerView(s, 1).objects).some((o) => o.name === 'Careening Mine Cart'),
    'opponent cannot inspect private search',
  );
  const search = chooseBotCommand(s, s.choice.player);
  assert.equal(search.type, 'searchLibrary');
  const result = dispatch(s, search);
  assert.ok(result.ok);
  assert.equal(result.state.choice, null);
});

test('all three admissions have exact reviewed Oracle identity/text/art and schema/native roundtrips', () => {
  const metadata = JSON.parse(
    fs.readFileSync(
      new URL('../../../tests/fixtures/counter-replacements-oracle-reviewed.json', import.meta.url),
    ),
  );
  const validate = new Ajv({ strict: true }).compile(
    JSON.parse(fs.readFileSync(new URL('../../cards/schema/card.schema.json', import.meta.url))),
  );
  for (const source of [sourceForCaradora(), ...extraSources]) {
    assert.ok(validate(source), JSON.stringify(validate.errors));
    const original = compileCard(source, { identities });
    assert.ok(original.ok);
    const back = compileCard(
      sourceFromDefinition(original.definition, {
        id: source.id,
        idsByName: { 'Mutagen Token': 'leyline:token/mutagen-token' },
      }),
      { identities },
    );
    assert.ok(back.ok, JSON.stringify(back.diagnostics));
    assert.deepEqual(back.definition, original.definition);
    const oracle = metadata[source.name];
    assert.equal(source.id, oracle.oracle_id);
    assert.equal(source.rulesText, oracle.oracle_text);
    assert.equal(source.characteristics.manaCost, oracle.mana_cost);
    assert.equal(String(source.characteristics.power), oracle.power);
    assert.equal(String(source.characteristics.toughness), oracle.toughness);
    assert.ok(oracle.image && oracle.art && oracle.artist);
    const s = setup(),
      object = put(s, source.name);
    const html = inspect(source.name, metadata, s, object.id, 0);
    assert.ok(html.includes(source.name));
    assert.match(html, /Illustration:/);
    const pool = JSON.parse(
      fs.readFileSync(
        new URL(
          `../../../docs/card-pools/standard-2026-10-26/${source.name[0].toLowerCase()}.json`,
          import.meta.url,
        ),
      ),
    );
    assert.equal(pool.find((row) => row.name === source.name)?.oracleId, source.id);
  }
});
function sourceForCaradora() {
  return source;
}

test('creature-only bonuses coexist additively but do not affect an uncrewed Vehicle', () => {
  const s = setup();
  put(s, name);
  put(s, extraCards[0].name);
  put(s, extraCards[1].name);
  const bear = put(s, 'Grizzly Bears'),
    vehicle = put(s, 'Careening Mine Cart');
  counters(s, bear, 1);
  counters(s, vehicle, 1);
  assert.equal(bear.plusCounters, 4);
  assert.equal(vehicle.plusCounters, 2);
  addModifier(s, {
    objectId: vehicle.id,
    incarnation: vehicle.incarnation,
    addTypes: ['creature'],
    expires: s.turn,
  });
  counters(s, vehicle, 1);
  assert.equal(vehicle.plusCounters, 6);
});

test('Michelangelo creates the exact Mutagen; its sorcery-only activation sacrifices and puts two counters', () => {
  let s = setup();
  const mike = put(s, extraCards[0].name, 0, 'hand');
  enterBattlefield(s, mike);
  stabilize(s);
  s = resolve(s);
  const token = Object.values(s.objects).find((o) => o.name === 'Mutagen Token');
  assert.ok(token?.token);
  const d = definition(s, token);
  assert.equal(d.type, 'artifact');
  assert.deepEqual(d.color, []);
  assert.deepEqual(d.subtypes, ['Mutagen']);
  assert.deepEqual(d.activated[0].cost, { mana: { generic: 1 }, sacrificeSelf: true, tap: true });
  assert.equal(d.activated[0].timing, 'sorcery');
  lands(s, 'Forest', 1);
  s.step = 'beginCombat';
  reject(s, { type: 'activate', card: token.id, ability: 0, target: ref(s.objects[mike.id]) });
  s.step = 'main1';
  s = act(s, 'activate', { card: token.id, ability: 0, target: ref(s.objects[mike.id]) });
  assert.notEqual(s.objects[token.id]?.zone, 'battlefield');
  s = resolve(s);
  assert.equal(s.objects[mike.id].plusCounters, 2);
});

test('Yoshimaru pays six, targets any legendary creature, rejects nonlegendary/noncreature, and replaces only its own recipients', () => {
  let s = setup();
  const dog = put(s, extraCards[1].name),
    opponent = put(s, 'Arcanis the Omnipotent', 1),
    bear = put(s, 'Grizzly Bears'),
    artifact = put(s, 'Mox Jasper');
  lands(s, 'Plains', 5);
  reject(s, { type: 'activate', card: dog.id, ability: 0, target: ref(dog) });
  lands(s, 'Plains', 7);
  reject(s, { type: 'activate', card: dog.id, ability: 0, target: ref(bear) });
  reject(s, { type: 'activate', card: dog.id, ability: 0, target: ref(artifact) });
  s = resolve(act(s, 'activate', { card: dog.id, ability: 0, target: ref(dog) }));
  assert.equal(s.objects[dog.id].plusCounters, 2);
  s = resolve(act(s, 'activate', { card: dog.id, ability: 0, target: ref(opponent) }));
  assert.equal(
    s.objects[opponent.id].plusCounters,
    1,
    'an opposing legendary creature is a legal target without own replacement',
  );
});

test('real Yoshimaru ability survives departure of its source but does not keep its vanished replacement', () => {
  let s = setup();
  const dog = put(s, extraCards[1].name),
    target = put(s, 'Gev, Scaled Scorch');
  lands(s, 'Plains', 6);
  s = act(s, 'activate', { card: dog.id, ability: 0, target: ref(target) });
  move(s, s.objects[dog.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[target.id].plusCounters, 1);
});

test('counter replacement replay and opaque session actions preserve exact deterministic placement', () => {
  const probe = {
    name: 'Replacement replay probe',
    type: 'land',
    cost: {},
    plusCounterBonus: { amount: 1, scope: 'creatureYouControl' },
    activated: [{ cost: {}, target: 'creature', effects: [{ op: 'counterOn', amount: 2 }] }],
  };
  const creature = {
    name: 'Replacement replay recipient',
    type: 'creature',
    cost: {},
    power: 1,
    toughness: 1,
  };
  const replayCatalog = createRegistry({
    ...catalog,
    [probe.name]: probe,
    [creature.name]: creature,
  });
  let s = createGame({
    catalog: replayCatalog,
    mulligan: false,
    minimumDeckSize: 0,
    seed: 3,
    decks: [
      [...Array(4).fill(probe.name), ...Array(4).fill(creature.name), ...Array(4).fill('Forest')],
      Array(12).fill('Island'),
    ],
  });
  while (s.step !== 'main1') s = resolve(s);
  const land = s.players[0].hand.map((id) => s.objects[id]).find((o) => o.name === probe.name),
    target = s.players[0].hand.map((id) => s.objects[id]).find((o) => o.name === creature.name);
  assert.ok(land && target);
  s = act(s, 'playLand', { card: land.id });
  s = resolve(act(s, 'cast', { card: target.id }));
  const before = exportReplay(s);
  const action = legalActions(s, 0).find((a) => a.type === 'activate' && a.card === land.id);
  assert.ok(action);
  s = resolve(act(s, 'activate', action));
  assert.equal(s.objects[target.id].plusCounters, 3);
  assert.deepEqual(replay(exportReplay(s)), s);
  const session = createSession(before.config);
  for (const command of before.commands) {
    const ctx = session.context();
    const translated = command.card
      ? ctx.actions.find(
          (a) =>
            a.type === command.type &&
            ctx.observation.objects[a.card]?.name ===
              (command.card === land.id ? probe.name : creature.name),
        )
      : command;
    assert.ok(translated);
    assert.equal(session.step(translated).ok, true);
  }
  const ctx = session.context(),
    activation = ctx.actions.find((a) => a.type === 'activate');
  assert.match(activation.card, /^object:/);
  assert.match(activation.target.id, /^object:/);
  assert.equal(session.step(activation).ok, true);
  for (let i = 0; i < 2; i++) {
    const ctx = session.context();
    assert.equal(session.step({ type: 'pass', player: ctx.player }).ok, true);
  }
  assert.equal(
    Object.values(session.context().observation.objects).find((o) => o.name === creature.name)
      .plusCounters,
    3,
  );
});

test('overflow during a replacement rejects atomically at the command boundary', () => {
  let s = setup();
  const dog = put(s, extraCards[1].name);
  lands(s, 'Plains', 6);
  dog.plusCounters = Number.MAX_SAFE_INTEGER;
  s = act(s, 'activate', { card: dog.id, ability: 0, target: ref(dog) });
  s = act(s, 'pass');
  const before = JSON.stringify(s),
    result = dispatch(s, { type: 'pass', player: s.priority });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'COUNTER_RANGE');
  assert.equal(JSON.stringify(s), before);
});
