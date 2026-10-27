import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  CARDS,
  CARD_IDS,
  createGame,
  createRegistry,
  dispatch,
  chooseBotCommand,
  exportReplay,
  replay,
  validateDefinition,
  stats,
  definition,
  hasKeyword,
  ref,
} from '../src/index.js';
import { move } from '../src/model.js';
import {
  enterBattlefield,
  enterBattlefieldBatch,
  resolveEffects,
  stabilize,
} from '../src/effects.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, lands, act, resolve } from './helpers.js';

const slugs = [
  'baron-bertram-graywater',
  'mister-fantastic-reed-richards',
  'valley-questcaller',
  'black-vampire-rogue-token',
  'elvish-archivist',
  'enduring-innocence',
];
const sources = await Promise.all(
  slugs.map(async (slug) =>
    JSON.parse(await readFile(new URL(`../../cards/cards/${slug}.json`, import.meta.url))),
  ),
);
const identities = { ...CARD_IDS, ...Object.fromEntries(sources.map((s) => [s.id, s.name])) };
const compiled = sources.map((source) => {
  const result = compileCard(source, { identities });
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
  return s;
}
function effect(s, effects, extra = {}) {
  return resolveEffects(s, { controller: 0, source: null, effects, ...extra });
}
function tokens(s, count = 3, name = 'Rabbit Token', player = 0) {
  return effect(s, [{ op: 'token', definition: name, count }], { controller: player });
}
function settle(s) {
  stabilize(s);
  for (
    let i = 0;
    i < 100 && (s.choice || s.stack.length || s.resolving || s.pendingTriggers.length);
    i++
  ) {
    const p = s.choice?.player ?? s.priority;
    const r = dispatch(s, s.choice ? chooseBotCommand(s, p) : { type: 'pass', player: p });
    assert.equal(r.ok, true, r.error?.message);
    s = r.state;
  }
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 0);
  assert.equal(s.pendingTriggers.length, 0);
  return s;
}

test('three complete Standard cards, exact token and two migrations validate, compile and roundtrip', async () => {
  const schema = JSON.parse(
    await readFile(new URL('../../cards/schema/card.schema.json', import.meta.url)),
  );
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
  const idsByName = Object.fromEntries(Object.entries(identities).map(([id, name]) => [name, id]));
  for (const [i, source] of sources.entries()) {
    assert.equal(validate(source), true, JSON.stringify(validate.errors));
    assert.deepEqual(validateDefinition(compiled[i]), []);
    assert.equal(compiled[i].text, source.rulesText);
    const result = compileCard(sourceFromDefinition(compiled[i], { id: source.id, idsByName }), {
      identities,
    });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(canonical(result.definition), canonical(compiled[i]));
  }
  for (const name of ['Elvish Archivist', 'Enduring Innocence'])
    assert.ok(catalog[name].triggers.some((t) => t.event.event === 'enterGroup'));
});

test('Baron observes own artifact and creature tokens once, creates exactly one lifelink Vampire Rogue, and refreshes next turn', () => {
  let s = setup();
  const baron = put(s, 'Baron Bertram Graywater');
  tokens(s, 2, 'Rabbit Token', 1);
  enterBattlefield(s, put(s, 'Grizzly Bears', 0, 'hand'));
  assert.equal(s.pendingTriggers.length, 0);
  tokens(s, 3, 'Treasure Token');
  tokens(s, 2);
  assert.equal(s.pendingTriggers.length, 1);
  s = settle(s);
  const vampires = Object.values(s.objects).filter(
    (o) => o.name === 'Black Vampire Rogue Token' && o.zone === 'battlefield',
  );
  assert.equal(vampires.length, 1);
  assert.deepEqual(stats(s, vampires[0]), { power: 1, toughness: 1 });
  assert.deepEqual(definition(s, vampires[0]).subtypes, ['Vampire', 'Rogue']);
  assert.deepEqual(definition(s, vampires[0]).color, ['B']);
  assert.equal(hasKeyword(s, vampires[0], 'lifelink'), true);
  assert.equal(s.objects[baron.id].triggerUses[0], `${s.turn}:${baron.incarnation}`);
  s.turn++;
  tokens(s, 2);
  s = settle(s);
  assert.equal(
    Object.values(s.objects).filter(
      (o) => o.name === 'Black Vampire Rogue Token' && o.zone === 'battlefield',
    ).length,
    2,
  );
});

test('Baron pays 1B and another creature/artifact as a cost; invalid sacrifices reject atomically', () => {
  for (const name of ['Grizzly Bears', 'Treasure Token']) {
    let s = setup();
    const b = put(s, 'Baron Bertram Graywater');
    const victim = put(s, name);
    const enemy = put(s, 'Grizzly Bears', 1);
    const swamp = lands(s, 'Swamp', 2)[0];
    for (const invalid of [b, enemy, swamp]) {
      const before = structuredClone(s);
      assert.equal(
        dispatch(s, {
          type: 'activate',
          player: 0,
          card: b.id,
          ability: 0,
          sacrifices: [ref(invalid)],
        }).ok,
        false,
      );
      assert.deepEqual(s, before);
    }
    s = act(s, 'activate', { card: b.id, ability: 0, sacrifices: [ref(victim)] });
    assert.ok(!s.objects[victim.id] || s.objects[victim.id].zone === 'graveyard');
    assert.equal(s.players[0].hand.length, 0);
    s = resolve(s);
    assert.equal(s.players[0].hand.length, 1);
  }
});

test('Baron trigger remains once-per-turn when countered, but a fresh incarnation can trigger again', () => {
  const s = setup();
  const b = put(s, 'Baron Bertram Graywater');
  tokens(s);
  assert.equal(s.pendingTriggers.length, 1);
  s.pendingTriggers = [];
  tokens(s);
  assert.equal(s.pendingTriggers.length, 0);
  move(s, b, 'exile');
  enterBattlefield(s, b);
  tokens(s);
  assert.equal(s.pendingTriggers.length, 1);
});

test('Mister Fantastic draws optionally once per group, not per token or once per turn, and reach is intrinsic', () => {
  for (const accept of [false, true]) {
    let s = setup();
    const mister = put(s, 'Mister Fantastic, Reed Richards');
    assert.equal(hasKeyword(s, mister, 'reach'), true);
    tokens(s, 3, 'Rabbit Token', 1);
    assert.equal(s.pendingTriggers.length, 0);
    tokens(s, 3, 'Treasure Token');
    assert.equal(s.pendingTriggers.length, 1);
    stabilize(s);
    s = resolve(s);
    assert.equal(s.choice.kind, 'optionalEffect');
    assert.equal(s.choice.player, 0);
    s = act(s, 'resolveOptional', { accept });
    assert.equal(s.players[0].hand.length, accept ? 1 : 0);
    tokens(s, 2);
    assert.equal(s.pendingTriggers.length, 1);
    move(s, s.objects[mister.id], 'graveyard');
    stabilize(s);
    s = resolve(s);
    s = act(s, 'resolveOptional', { accept: true });
    assert.equal(
      s.players[0].hand.length,
      accept ? 2 : 1,
      'source leaving does not cancel the optional draw',
    );
  }
});

test('Valley Questcaller sees all four tribes in one group, excludes itself/opponents, and boosts only other friendly tribes', () => {
  let s = setup();
  const valley = put(s, 'Valley Questcaller', 0, 'hand');
  enterBattlefield(s, valley);
  assert.equal(s.pendingTriggers.length, 0);
  const names = ['Rabbit Token', 'Bloodhunter Bat', 'White Flying Bird Token', 'White Mouse Token'];
  const creatures = names.map((name) => put(s, name, 0, 'hand'));
  enterBattlefieldBatch(
    s,
    creatures.map((object) => ({ object })),
  );
  const triggers = s.pendingTriggers.filter((t) => t.source.id === valley.id);
  assert.equal(triggers.length, 1);
  assert.deepEqual(stats(s, valley), { power: 2, toughness: 3 });
  for (const o of creatures) {
    assert.equal(stats(s, o).power, catalog[o.name].power + 1);
    assert.equal(stats(s, o).toughness, catalog[o.name].toughness + 1);
  }
  const enemy = put(s, 'Rabbit Token', 1, 'void');
  enterBattlefield(s, enemy, 1);
  const bear = put(s, 'Grizzly Bears', 0, 'hand');
  enterBattlefield(s, bear);
  assert.deepEqual(stats(s, enemy), { power: 1, toughness: 1 });
  assert.deepEqual(stats(s, bear), { power: 2, toughness: 2 });
  assert.equal(s.pendingTriggers.filter((t) => t.source.id === valley.id).length, 1);
  s.pendingTriggers = triggers;
  stabilize(s);
  s = resolve(s);
  assert.equal(s.choice.kind, 'libraryOrder');
  assert.equal(s.choice.cards.length, 1);
  s = settle(s);
  tokens(s, 2);
  assert.equal(s.pendingTriggers.length, 1);
});

test('Elvish Archivist keeps artifact/enchantment group uses independent, including dual-type entrants', () => {
  let s = setup();
  const archivist = put(s, 'Elvish Archivist');
  const a = put(s, 'Grizzly Bears', 0, 'hand');
  a.definitionOverride = {
    ...CARDS['Grizzly Bears'],
    types: ['artifact', 'enchantment', 'creature'],
  };
  enterBattlefieldBatch(s, [{ object: a }, { object: put(s, 'Treasure Token', 0, 'void') }]);
  assert.equal(s.pendingTriggers.length, 2);
  s = settle(s);
  assert.equal(s.objects[archivist.id].plusCounters, 2);
  assert.equal(s.players[0].hand.length, 1);
  tokens(s, 2, 'Treasure Token');
  enterBattlefield(s, put(s, 'Glorious Anthem', 0, 'hand'));
  assert.equal(s.pendingTriggers.length, 0);
  s.turn++;
  enterBattlefield(s, put(s, 'Glorious Anthem', 0, 'hand'));
  tokens(s, 2, 'Treasure Token');
  assert.equal(s.pendingTriggers.length, 2);
});

test('Enduring Innocence matches postbatch power, excludes itself, and retains death-as-enchantment and lifelink clauses', () => {
  let s = setup();
  const innocence = put(s, 'Enduring Innocence', 0, 'hand');
  enterBattlefield(s, innocence);
  assert.equal(s.pendingTriggers.length, 0);
  assert.equal(hasKeyword(s, innocence, 'lifelink'), true);
  const anthem = put(s, 'Glorious Anthem', 0, 'hand');
  enterBattlefieldBatch(s, [{ object: put(s, 'Grizzly Bears', 0, 'hand') }, { object: anthem }]);
  assert.equal(s.pendingTriggers.length, 0, '3-power entrant does not match');
  tokens(s, 3);
  assert.equal(s.pendingTriggers.length, 1, 'three 2-power Rabbits are one group');
  s = settle(s);
  assert.equal(s.players[0].hand.length, 1);
  move(s, s.objects[innocence.id], 'graveyard');
  s = settle(s);
  assert.equal(s.objects[innocence.id].zone, 'battlefield');
  assert.equal(definition(s, s.objects[innocence.id]).type, 'enchantment');
  assert.equal(hasKeyword(s, s.objects[innocence.id], 'lifelink'), true);
  tokens(s, 2);
  assert.equal(s.pendingTriggers.length, 1, 'returned incarnation has a fresh use');
});

test('new cards cast, group token entries and return deterministic serialized replays', () => {
  const names = ['Baron Bertram Graywater', 'Valley Questcaller', 'Hop to It'];
  const defs = names.map((name) => ({ ...catalog[name], cost: {} }));
  let s = createGame({
    catalog: createRegistry([
      ...defs,
      CARDS.Forest,
      CARDS['Rabbit Token'],
      catalog['Black Vampire Rogue Token'],
    ]),
    minimumDeckSize: 7,
    mulligan: false,
    decks: [[...names, ...Array(4).fill('Forest')], Array(7).fill('Forest')],
  });
  while (s.step !== 'main1') s = act(s, 'pass');
  const id = (name) => s.players[0].hand.find((id) => s.objects[id].name === name);
  for (const name of names) s = resolve(act(s, 'cast', { card: id(name) }));
  assert.equal(s.choice.kind, 'orderTriggers');
  assert.equal(s.choice.entries.length, 2);
  assert.deepEqual(replay(JSON.parse(JSON.stringify(exportReplay(s)))), s);
  s = settle(s);
  assert.equal(
    Object.values(s.objects).filter((o) => o.name === 'Rabbit Token' && o.zone === 'battlefield')
      .length,
    3,
  );
  assert.equal(
    Object.values(s.objects).filter(
      (o) => o.name === 'Black Vampire Rogue Token' && o.zone === 'battlefield',
    ).length,
    1,
  );
  assert.deepEqual(replay(JSON.parse(JSON.stringify(exportReplay(s)))), s);
});

test('revision 1–3 migrated predicates preserve the old per-entrant watcher order and event/object IDs', () => {
  for (const revision of [1, 2, 3]) {
    const before = setup(),
      after = setup();
    const oldDefinitions = Object.fromEntries(
      Object.entries(catalog).map(([name, d]) => {
        const value = structuredClone(d);
        if (['Elvish Archivist', 'Enduring Innocence'].includes(name))
          for (const trigger of value.triggers)
            if (trigger.event.event === 'enterGroup') trigger.event.event = 'enter';
        return [name, value];
      }),
    );
    const artifactRabbit = { ...CARDS['Rabbit Token'], types: ['artifact', 'creature'] };
    before.catalog = createRegistry({ ...oldDefinitions, 'Rabbit Token': artifactRabbit });
    after.catalog = createRegistry({ ...catalog, 'Rabbit Token': artifactRabbit });
    for (const s of [before, after]) {
      s.rulesRevision = revision;
      put(s, 'Elvish Archivist');
      put(s, 'Wildwood Mentor');
      put(s, 'Enduring Innocence');
      tokens(s, 3);
    }
    const publicTrigger = (t) => ({
      id: t.id,
      source: t.source,
      controller: t.controller,
      effects: t.effects,
      label: t.label,
    });
    assert.deepEqual(
      after.pendingTriggers.map(publicTrigger),
      before.pendingTriggers.map(publicTrigger),
    );
    assert.deepEqual(after.events, before.events);
    assert.equal(after.nextId, before.nextId);
    assert.deepEqual(
      Object.values(after.objects)
        .filter((o) => o.token)
        .map((o) => o.id),
      Object.values(before.objects)
        .filter((o) => o.token)
        .map((o) => o.id),
    );
    assert.equal(after.pendingTriggers.length, 5);
  }
});

test('new card identity and printed metadata match the dated Standard inventory', () => {
  assert.deepEqual(
    sources
      .slice(0, 3)
      .map((c) => [
        c.id,
        c.name,
        c.characteristics.manaCost,
        c.characteristics.supertypes,
        c.characteristics.subtypes,
        c.characteristics.colors,
        c.characteristics.power,
        c.characteristics.toughness,
      ]),
    [
      [
        'e25b516c-bf95-42bc-8b1e-04617a3d28df',
        'Baron Bertram Graywater',
        '{2}{W}{B}',
        ['legendary'],
        ['Vampire', 'Noble'],
        ['B', 'W'],
        3,
        4,
      ],
      [
        '7fa5237e-dd79-4646-b935-cb8c6ee803ab',
        'Mister Fantastic, Reed Richards',
        '{3}{U}',
        ['legendary'],
        ['Human', 'Scientist', 'Hero'],
        ['U'],
        2,
        4,
      ],
      [
        '81c509b2-3164-47e9-94b3-bdba0487d2f1',
        'Valley Questcaller',
        '{1}{W}',
        [],
        ['Rabbit', 'Warrior'],
        ['W'],
        2,
        3,
      ],
    ],
  );
});
