import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CARDS, CARD_IDS, createRegistry, dispatch, chooseBotCommand } from '../src/index.js';
import { addModifier, definition, move, ref } from '../src/model.js';
import { compileCard } from '../../cards/compiler.js';
import { fixture, put, act, resolve } from './helpers.js';
import { resolveEffects, enterBattlefield, stabilize } from '../src/effects.js';

const targetCards = JSON.parse(
  await readFile(
    new URL('../../../tests/fixtures/target-conditions-oracle-reviewed.json', import.meta.url),
  ),
).cards;
const names = [
  ...targetCards.map((c) => c.name),
  'Al Bhed Salvagers',
  'City Pigeon',
  'Cryogen Relic',
  'Featherbrained Filcher',
  "Greed's Gambit",
  'Molten Man, Inferno Incarnate',
  'Momo, Playful Pet',
  'Mouser Foundry',
  'Nutrient Block',
  'Suki, Courageous Rescuer',
  'Super Shredder',
  'Three Tree Scribe',
  'Weapons Manufacturing',
  'Zoo Escapees',
  'Munitions Token',
  'Greed Bat Token',
];
const sources = await Promise.all(
  names.map(async (name) =>
    JSON.parse(
      await readFile(
        new URL(
          `../../cards/cards/${name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/-$/, '')}.json`,
          import.meta.url,
        ),
        'utf8',
      ),
    ),
  ),
);
const identities = { ...CARD_IDS, ...Object.fromEntries(sources.map((s) => [s.id, s.name])) };
const mechanics = JSON.parse(
  await readFile(new URL('../../cards/mechanics.json', import.meta.url)),
);
const compiled = sources.map((source) => {
  const result = compileCard(source, { identities, mechanics });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result.definition;
});
const catalog = createRegistry({
  ...CARDS,
  ...Object.fromEntries(compiled.map((d) => [d.name, d])),
});
function setup() {
  const s = fixture();
  s.catalog = catalog;
  for (const player of s.players)
    for (const color of ['W', 'U', 'B', 'R', 'G', 'C']) player.mana[color] = 100;
  return s;
}

test('Three Tree Scribe still identifies itself when its permanent type changes without ability loss', () => {
  for (const destination of ['hand', 'exile', 'library', 'graveyard']) {
    const s = setup();
    const scribe = put(s, 'Three Tree Scribe');
    addModifier(s, {
      objectId: scribe.id,
      incarnation: scribe.incarnation,
      enchantmentOnly: true,
      permanent: true,
    });
    assert.deepEqual(definition(s, scribe).types, ['enchantment']);
    assert.ok(definition(s, scribe).triggers.length);
    move(s, scribe, destination);
    assert.equal(s.pendingTriggers.length, destination === 'graveyard' ? 0 : 1, destination);
  }
});

// CR 700.7 self-identification is separate from the other-creature predicate.
test('Three Tree Scribe self and other branches are disjoint and retain controller/type restrictions', () => {
  for (const [name, owner, expected] of [
    ['Three Tree Scribe', 0, 1],
    ['Grizzly Bears', 0, 1],
    ['Grizzly Bears', 1, 0],
    ['Forest', 0, 0],
  ]) {
    const s = setup();
    const scribe = put(s, 'Three Tree Scribe');
    const departed = name === 'Three Tree Scribe' ? scribe : put(s, name, owner);
    move(s, departed, 'exile');
    assert.equal(s.pendingTriggers.length, expected, name + '/' + owner);
  }
});

test('type-changed Three Tree Scribe sees itself and friendly creatures in either simultaneous departure order', () => {
  for (const reverse of [false, true]) {
    const s = setup();
    const scribe = put(s, 'Three Tree Scribe', 1);
    scribe.controller = 0;
    addModifier(s, {
      objectId: scribe.id,
      incarnation: scribe.incarnation,
      enchantmentOnly: true,
      permanent: true,
    });
    put(s, 'Grizzly Bears');
    put(s, 'Forest');
    put(s, 'Grizzly Bears', 1);
    if (reverse) s.objects = Object.fromEntries(Object.entries(s.objects).reverse());
    resolveEffects(s, {
      controller: 0,
      source: null,
      effects: [
        {
          op: 'bounceAll',
          where: { any: [{ type: 'creature' }, { type: 'enchantment' }, { type: 'land' }] },
        },
      ],
    });
    assert.equal(s.pendingTriggers.length, 2);
    assert.ok(s.pendingTriggers.every((t) => t.name === 'Three Tree Scribe' && t.controller === 0));
  }
});

const tokens = (s, name) =>
  Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.token && o.name === name);
const cast = (s, name, args = {}) => {
  const card = put(s, name, 0, 'hand');
  return resolve(act(s, 'cast', { card: card.id, ...args }));
};
const settle = (s) => {
  stabilize(s);
  for (
    let i = 0;
    i < 100 && (s.choice || s.stack.length || s.resolving || s.pendingTriggers.length);
    i++
  ) {
    const player = s.choice?.player ?? s.priority;
    const command = s.choice ? chooseBotCommand(s, player) : { type: 'pass', player };
    const result = dispatch(s, command);
    assert.equal(result.ok, true, result.error?.message);
    s = result.state;
  }
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 0);
  assert.equal(s.pendingTriggers.length, 0);
  return s;
};

test('v53 target follow-through retains mana value before replacement exile and never rewards a stale target', () => {
  for (const [name, token] of [
    ['Seedship Impact', 'Lander Token'],
    ['Tainted Treats', 'Food Token'],
  ]) {
    for (const stale of [false, true]) {
      let s = setup();
      put(s, 'Rest in Peace');
      const victim = put(s, 'Basilisk Collar', 1);
      const spell = put(s, name, 0, 'hand');
      s = act(s, 'cast', { card: spell.id, target: ref(victim) });
      if (stale) {
        move(s, s.objects[victim.id], 'hand');
        move(s, s.objects[victim.id], 'battlefield');
      }
      s = resolve(s);
      assert.equal(s.objects[victim.id].zone, stale ? 'battlefield' : 'exile');
      assert.equal(tokens(s, token).length, stale ? 0 : 1, name);
    }
  }
});

test('Sunpearl Kirin and Brackish Blunder return stolen objects to their owner, not their controller', () => {
  for (const token of [false, true]) {
    let s = setup();
    const victim = put(s, token ? 'Food Token' : 'Basilisk Collar', 1);
    victim.controller = 0;
    s = cast(s, 'Sunpearl Kirin');
    s = act(s, 'chooseTriggerTargets', { targets: { returned: [ref(victim)] } });
    s = resolve(s);
    assert.equal(s.players[0].hand.length, token ? 1 : 0);
    assert.equal(s.players[1].hand.includes(victim.id), !token);
    assert.equal(s.objects[victim.id]?.zone, token ? undefined : 'hand');
  }
  let s = setup();
  const victim = put(s, 'Grizzly Bears', 1);
  victim.controller = 0;
  victim.tapped = true;
  s = cast(s, 'Brackish Blunder', { target: ref(victim) });
  assert.ok(s.players[1].hand.includes(victim.id));
  assert.equal(s.players[0].hand.length, 0);
  assert.equal(tokens(s, 'Map Token')[0].controller, 0);
});

test('Sunpearl Kirin optional target is not an optional resolution choice and a lost legal target prevents its draw', () => {
  for (const loseTarget of [false, true]) {
    let s = setup();
    const victim = put(s, 'Food Token');
    s = cast(s, 'Sunpearl Kirin');
    s = act(s, 'chooseTriggerTargets', { targets: { returned: [ref(victim)] } });
    if (loseTarget) move(s, s.objects[victim.id], 'exile');
    s = resolve(s);
    assert.equal(s.choice, null);
    assert.equal(s.players[0].hand.length, loseTarget ? 0 : 1);
    assert.equal(s.objects[victim.id], undefined);
  }
});

test('Scavenging Ooze never follows a new source or target incarnation', () => {
  for (const changed of ['source', 'target']) {
    let s = setup();
    const ooze = put(s, 'Scavenging Ooze');
    const victim = put(s, 'Grizzly Bears', 1, 'graveyard');
    s = act(s, 'activate', { card: ooze.id, ability: 0, target: ref(victim) });
    const moved = s.objects[changed === 'source' ? ooze.id : victim.id];
    move(s, moved, 'exile');
    move(s, moved, changed === 'source' ? 'battlefield' : 'graveyard');
    s = resolve(s);
    assert.equal(s.objects[ooze.id].plusCounters, 0);
    assert.equal(s.players[0].life, changed === 'source' ? 21 : 20);
    assert.equal(s.objects[victim.id].zone, changed === 'source' ? 'exile' : 'graveyard');
  }
});

test('Cryogen Relic leave draw remains above its activation even when the chosen tapped target becomes illegal', () => {
  let s = setup();
  const relic = put(s, 'Cryogen Relic');
  const victim = put(s, 'Grizzly Bears');
  victim.tapped = true;
  s = act(s, 'activate', { card: relic.id, ability: 0, targets: { chosen: [ref(victim)] } });
  s.objects[victim.id].tapped = false;
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(s.objects[victim.id].stunCounters ?? 0, 0);
  assert.equal(
    s.events.filter((e) => e.type === 'fizzled' && e.name === 'Cryogen Relic').length,
    1,
  );
});

test('Munitions damage retains departing controller and granted damage keywords after the token ceases to exist', () => {
  let s = setup();
  const munition = put(s, 'Munitions Token', 1);
  munition.controller = 0;
  addModifier(s, {
    objectId: munition.id,
    incarnation: munition.incarnation,
    expires: s.turn,
    keywords: ['deathtouch', 'lifelink'],
  });
  const victim = put(s, 'Colossal Dreadmaw', 1);
  move(s, munition, 'library');
  stabilize(s);
  assert.equal(s.objects[munition.id], undefined);
  s = act(s, 'chooseTriggerTarget', { target: ref(victim) });
  s = resolve(s);
  assert.equal(s.objects[victim.id].zone, 'graveyard');
  assert.equal(s.players[0].life, 22);
  assert.equal(s.players[1].life, 20);
});

test('Suki observes a simultaneous departure once even when she leaves first and the board loses her anthem', () => {
  for (const reverse of [false, true]) {
    let s = setup();
    put(s, 'Suki, Courageous Rescuer');
    put(s, 'Grizzly Bears');
    put(s, 'Forest');
    if (reverse) s.objects = Object.fromEntries(Object.entries(s.objects).reverse());
    resolveEffects(s, {
      controller: 0,
      source: null,
      effects: [{ op: 'exileAll', where: { any: [{ type: 'creature' }, { type: 'land' }] } }],
    });
    assert.equal(s.pendingTriggers.length, 1);
    s = settle(s);
    const ally = tokens(s, 'Ally Token');
    assert.equal(ally.length, 1);
    assert.equal(definition(s, ally[0]).power, 1);
  }
});

test('Driftgloom Coyote departed and returned before its trigger resolves neither exiles nor counters the new source', () => {
  let s = setup();
  const victim = put(s, 'Grizzly Bears', 1);
  const coyote = put(s, 'Driftgloom Coyote', 0, 'hand');
  enterBattlefield(s, coyote);
  stabilize(s);
  s = act(s, 'chooseTriggerTarget', { target: ref(victim) });
  move(s, s.objects[coyote.id], 'hand');
  move(s, s.objects[coyote.id], 'battlefield');
  s = resolve(s);
  assert.equal(s.objects[victim.id].zone, 'battlefield');
  assert.equal(s.objects[coyote.id].plusCounters, 0);
});

test('Molten Man dies before its search without a Mountain but both entry and leave instructions still resolve', () => {
  let s = setup();
  const mountain = put(s, 'Mountain', 0, 'library');
  const molten = put(s, 'Molten Man, Inferno Incarnate', 0, 'hand');
  s = resolve(act(s, 'cast', { card: molten.id }));
  assert.equal(s.objects[molten.id].zone, 'graveyard');
  assert.equal(s.choice.kind, 'orderTriggers');
  const search = s.choice.entries.find((t) => t.effects[0].op === 'searchLibrary');
  const sacrifice = s.choice.entries.find((t) => t.effects[0].op === 'sacrifice');
  assert.ok(search && sacrifice);
  s = act(s, 'orderTriggers', { ids: [sacrifice.id, search.id] });
  s = resolve(s);
  assert.equal(s.choice.kind, 'librarySearch');
  s = act(s, 'searchLibrary', { cards: [mountain.id] });
  assert.equal(s.objects[mountain.id].zone, 'battlefield');
  assert.equal(s.objects[mountain.id].tapped, true);
  assert.equal(s.objects[molten.id].zone, 'graveyard');
  s = resolve(s);
  assert.equal(s.choice.kind, 'sacrifice');
  s = act(s, 'sacrifice', { cards: [mountain.id] });
  assert.equal(s.objects[mountain.id].zone, 'graveyard');
});

test("a stolen Greed's Gambit departure still loses life and sacrifices when its controller has nothing to discard", () => {
  let s = setup();
  const gambit = put(s, "Greed's Gambit", 1);
  gambit.controller = 0;
  const first = put(s, 'Grizzly Bears');
  const second = put(s, 'Hill Giant');
  move(s, gambit, 'exile');
  s = settle(s);
  assert.equal(s.players[0].life, 14);
  assert.equal(s.players[1].life, 20);
  assert.equal(s.objects[first.id].zone, 'graveyard');
  assert.equal(s.objects[second.id].zone, 'graveyard');
});

test('Budding Insurgent draws for a currently legendary enchantment even if destruction cannot succeed', () => {
  let s = setup();
  const insurgent = put(s, 'Budding Insurgent');
  const victim = put(s, 'Glorious Anthem', 1);
  victim.definitionOverride = { ...CARDS['Glorious Anthem'], legendary: true };
  addModifier(s, {
    objectId: victim.id,
    incarnation: victim.incarnation,
    expires: s.turn,
    keywords: ['indestructible'],
  });
  s = act(s, 'activate', { card: insurgent.id, ability: 0, target: ref(victim) });
  s = resolve(s);
  assert.equal(s.objects[insurgent.id].zone, 'graveyard');
  assert.equal(s.objects[victim.id].zone, 'battlefield');
  assert.equal(s.players[0].hand.length, 1);
});

test('Al Bhed Salvagers self-identity survives type-only changes but not ability loss', () => {
  for (const removed of [false, true]) {
    let s = setup();
    const salvagers = put(s, 'Al Bhed Salvagers', 1);
    salvagers.controller = 0;
    addModifier(s, {
      objectId: salvagers.id,
      incarnation: salvagers.incarnation,
      enchantmentOnly: true,
      permanent: true,
      ...(removed ? { removeAbilities: true } : {}),
    });
    assert.deepEqual(definition(s, salvagers).types, ['enchantment']);
    move(s, salvagers, 'graveyard');
    assert.equal(s.pendingTriggers.length, removed ? 0 : 1);
    if (!removed) {
      stabilize(s);
      s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
      s = resolve(s);
      assert.equal(s.players[0].life, 21);
      assert.equal(s.players[1].life, 19);
    }
  }
});

test('Al Bhed Salvagers self and other creature-or-artifact branches count each departure once', () => {
  for (const [name, owner, expected] of [
    ['Al Bhed Salvagers', 0, 1],
    ['Grizzly Bears', 0, 1],
    ['Basilisk Collar', 0, 1],
    ['Ornithopter', 0, 1],
    ['Small Robot Token', 0, 1],
    ['Grizzly Bears', 1, 0],
    ['Ornithopter', 1, 0],
    ['Glorious Anthem', 0, 0],
    ['Forest', 0, 0],
  ]) {
    const s = setup();
    const salvagers = put(s, 'Al Bhed Salvagers');
    const departed = name === 'Al Bhed Salvagers' ? salvagers : put(s, name, owner);
    if (departed === salvagers)
      addModifier(s, {
        objectId: salvagers.id,
        incarnation: salvagers.incarnation,
        addTypes: ['artifact'],
        permanent: true,
      });
    move(s, departed, 'graveyard');
    assert.equal(s.pendingTriggers.length, expected, name + '/' + owner);
  }
});

test('Al Bhed Salvagers retains simultaneous observers and actual graveyard destination filtering', () => {
  for (const replacement of [false, true])
    for (const reverse of [false, true]) {
      let s = setup();
      const salvagers = put(s, 'Al Bhed Salvagers');
      addModifier(s, {
        objectId: salvagers.id,
        incarnation: salvagers.incarnation,
        enchantmentOnly: true,
        permanent: true,
      });
      put(s, 'Grizzly Bears');
      put(s, 'Ornithopter');
      put(s, 'Basilisk Collar');
      put(s, 'Ornithopter', 1);
      if (replacement) put(s, 'Rest in Peace');
      if (reverse) s.objects = Object.fromEntries(Object.entries(s.objects).reverse());
      resolveEffects(s, {
        controller: 0,
        source: null,
        effects: [
          {
            op: 'destroyAll',
            where: { any: [{ type: 'creature' }, { type: 'enchantment' }, { type: 'artifact' }] },
          },
        ],
      });
      assert.equal(s.pendingTriggers.length, replacement ? 0 : 4);
      s = settle(s);
      assert.equal(s.players[0].life, replacement ? 20 : 24);
      assert.equal(s.players[1].life, replacement ? 20 : 16);
    }
});
