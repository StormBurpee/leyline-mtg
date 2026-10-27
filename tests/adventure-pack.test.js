import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  chooseBotCommand,
  dispatch,
  createRegistry,
  definition,
  manaValue,
  castingProfile,
  castProblem,
  legalActions,
  ref,
  CARDS,
  replay,
  exportReplay,
  parseDeck,
} from '../packages/engine/src/index.js';
import { move, playableZone } from '../packages/engine/src/model.js';
import { fixture, put, lands, act, resolve } from '../packages/engine/test/helpers.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
const name = 'Test Giant // Tiny Spark';
const giant = {
  name,
  mainName: 'Test Giant',
  type: 'creature',
  cost: { generic: 5, R: 1 },
  color: ['R'],
  keywords: ['flash'],
  subtypes: ['Giant'],
  power: 5,
  toughness: 5,
  text: 'Flash',
  adventure: {
    name: 'Tiny Spark',
    type: 'sorcery',
    cost: { U: 1 },
    color: ['U'],
    keywords: [],
    subtypes: ['Adventure'],
    text: 'Draw a card.',
    effects: [{ op: 'draw', count: 1 }],
  },
};
function setup(card = giant) {
  let s = fixture();
  s.catalog = createRegistry({ ...s.catalog, [card.name]: card });
  lands(s, 'Island', 3);
  lands(s, 'Mountain', 7);
  const o = put(s, card.name, 0, 'hand');
  return [s, o.id];
}
test('Adventure uses only alternative characteristics on stack and main characteristics in other zones', () => {
  let [s, id] = setup();
  assert.equal(definition(s, s.objects[id]).name, 'Test Giant');
  assert.equal(manaValue(definition(s, s.objects[id])), 6);
  assert.equal(castingProfile(s, 0, s.objects[id], 1).type, 'sorcery');
  s = act(s, 'cast', { card: id, mode: 1 });
  assert.equal(definition(s, s.objects[id]).name, 'Tiny Spark');
  assert.equal(definition(s, s.objects[id]).type, 'sorcery');
  assert.equal(manaValue(definition(s, s.objects[id])), 1);
  assert.equal(s.stack.at(-1).name, 'Tiny Spark');
  assert.equal(s.players[0].spellsCast.profiles.at(-1).definition.type, 'sorcery');
  s = resolve(s);
  assert.equal(s.objects[id].zone, 'exile');
  assert.equal(definition(s, s.objects[id]).name, 'Test Giant');
  assert.equal(playableZone(s, s.objects[id], 0), true);
  assert.ok(castProblem(s, 0, id, null, { mode: 1 }));
  assert.equal(castProblem(s, 0, id, null, { mode: 0 }), null);
  s = act(s, 'cast', { card: id, mode: 0 });
  s = resolve(s);
  assert.equal(s.objects[id].zone, 'battlefield');
  assert.equal(s.objects[id].adventured, undefined);
});
test('main-face flash does not grant flash to a sorcery Adventure', () => {
  const [s, id] = setup();
  s.step = 'upkeep';
  assert.equal(castProblem(s, 0, id, null, { mode: 0 }), null);
  assert.match(castProblem(s, 0, id, null, { mode: 1 }), /main phase/);
});
test('countered and all-illegal Adventures do not grant exile permission', () => {
  let [s, id] = setup({
    ...giant,
    adventure: { ...giant.adventure, target: 'creature', effects: [{ op: 'damage', amount: 1 }] },
  });
  const target = put(s, 'Grizzly Bears', 1);
  s = act(s, 'cast', { card: id, mode: 1, target: ref(target) });
  move(s, s.objects[target.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.objects[id].zone, 'graveyard');
  assert.equal(s.objects[id].adventured, undefined);
  [s, id] = setup();
  s = act(s, 'cast', { card: id, mode: 1 });
  move(s, s.objects[id], 'graveyard');
  s.stack = [];
  assert.equal(s.objects[id].adventured, undefined);
});
test('Adventure exile permission belongs to resolving controller and is incarnation-bound', () => {
  let [s, id] = setup();
  const o = s.objects[id];
  move(s, o, 'exile');
  o.playPermission = { player: 1, turn: s.turn, incarnation: o.incarnation };
  lands(s, 'Island', 1, 1);
  s.active = 1;
  s.priority = 1;
  s = act(s, 'cast', { card: id, mode: 1 }, 1);
  s = resolve(s);
  assert.equal(s.objects[id].owner, 0);
  assert.equal(s.objects[id].adventured.player, 1);
  assert.equal(playableZone(s, s.objects[id], 1), true);
  assert.equal(playableZone(s, s.objects[id], 0), false);
  move(s, s.objects[id], 'hand');
  move(s, s.objects[id], 'exile');
  assert.equal(s.objects[id].adventured, undefined);
  assert.equal(playableZone(s, s.objects[id], 1), false);
});
test('an independent play permission still permits Adventure from exile', () => {
  let [s, id] = setup();
  s = act(s, 'cast', { card: id, mode: 1 });
  s = resolve(s);
  const o = s.objects[id];
  o.playPermission = { player: 0, turn: s.turn, incarnation: o.incarnation };
  assert.equal(castProblem(s, 0, id, null, { mode: 1 }), null);
});
test('Adventure cost modifiers use alternative type, color and mana value', () => {
  let [s, id] = setup();
  s.catalog = createRegistry({
    ...s.catalog,
    Reducer: {
      name: 'Reducer',
      type: 'creature',
      cost: { R: 1 },
      power: 1,
      toughness: 1,
      costModifiers: [{ scope: 'you', where: { type: 'sorcery' }, change: 'reduce', amount: 1 }],
    },
  });
  put(s, 'Reducer');
  assert.equal(castingProfile(s, 0, s.objects[id], 1).cost.U, 1);
  assert.equal(castingProfile(s, 0, s.objects[id], 0).cost.generic, 5);
});
test('Adventure native definitions round trip and reject nested or unsupported alternatives', () => {
  const source = sourceFromDefinition(giant, { id: 'test:giant' });
  const result = compileCard(source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.definition.adventure.effects, giant.adventure.effects);
  assert.throws(() =>
    createRegistry([{ ...giant, adventure: { ...giant.adventure, adventure: giant.adventure } }]),
  );
  assert.throws(() => createRegistry([{ ...giant, warp: { R: 1 } }]));
  assert.throws(() =>
    createRegistry([{ ...giant, adventure: { ...giant.adventure, cost: { X: 1, U: 1 } } }]),
  );
});
test('Hearth Elemental counts each qualifying graveyard card once and Stoke Genius discards then draws', () => {
  const n = 'Hearth Elemental // Stoke Genius';
  let s = fixture();
  lands(s, 'Mountain', 4);
  const o = put(s, n, 0, 'hand');
  put(s, 'Shock', 0, 'graveyard');
  put(s, 'Divination', 0, 'graveyard');
  put(s, 'Minecart Daredevil // Ride the Rails', 0, 'graveyard');
  put(s, 'Forest', 0, 'graveyard');
  assert.equal(castingProfile(s, 0, o, 0).cost.generic, 2);
  assert.equal(castingProfile(s, 0, o, 1).cost.generic, 1);
  const a = put(s, 'Forest', 0, 'hand'),
    b = put(s, 'Mountain', 0, 'hand');
  s = act(s, 'cast', { card: o.id, mode: 1 });
  s = resolve(s);
  if (s.choice) {
    assert.equal(s.choice.kind, 'discardEffect');
    s = act(s, 'discardEffect', { cards: [a.id, b.id] });
  }
  assert.equal(s.objects[o.id].zone, 'exile');
  assert.equal(s.objects[a.id].zone, 'graveyard');
  assert.equal(s.objects[b.id].zone, 'graveyard');
  assert.equal(s.players[0].hand.length, 2);
});
test('Adventure pausing resolution and permanent permission replay deterministically', () => {
  const n = 'Bilbo Baggins, Burglar // Take a Glance';
  let s, id;
  for (let seed = 1; seed < 40; seed++) {
    s = createGame({
      decks: [[...Array(4).fill(n), ...Array(56).fill('Island')], Array(60).fill('Forest')],
      mulligan: false,
      seed,
    });
    id = s.players[0].hand.find((id) => s.objects[id].name === n);
    if (id) break;
  }
  assert.ok(id);
  while (s.step !== 'main1') s = act(s, 'pass');
  s = act(s, 'playLand', { card: s.players[0].hand.find((id) => s.objects[id].name === 'Island') });
  s = act(s, 'cast', { card: id, mode: 1 });
  s = resolve(s);
  assert.equal(s.choice.kind, 'libraryOrder');
  assert.equal(s.objects[id].zone, 'stack');
  assert.deepEqual(replay(exportReplay(s)), s);
  s = act(s, 'orderLibrary', { top: s.choice.cards, rest: [] });
  assert.equal(s.objects[id].zone, 'exile');
  assert.deepEqual(replay(exportReplay(s)), s);
  assert.ok(legalActions(s, 0).every((a) => a.card !== id || a.mode !== 1));
});
test('Arena-style main face deck names canonicalize to the combined Adventure identity', () => {
  const parsed = parseDeck('4 Hearth Elemental\n56 Mountain');
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.names[0], 'Hearth Elemental // Stoke Genius');
});
test('a counterspell sends an Adventure to graveyard without giving the later-play permission', () => {
  let [s, id] = setup();
  lands(s, 'Island', 2, 1);
  const counter = put(s, 'Counterspell', 1, 'hand');
  s = act(s, 'cast', { card: id, mode: 1 });
  const spell = s.stack.at(-1);
  s = act(s, 'pass');
  s = act(s, 'cast', { card: counter.id, target: { kind: 'stack', id: spell.id } }, 1);
  s = resolve(s);
  assert.equal(s.objects[id].zone, 'graveyard');
  assert.equal(s.objects[id].adventured, undefined);
  assert.equal(definition(s, s.objects[id]).type, 'creature');
});
test('every authored Adventure pair round trips complete main and spell definitions', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  const byName = Object.fromEntries(Object.entries(CARDS).map(([name]) => [name, null]));
  const sources = [];
  for (const file of await readdir(new URL('../packages/cards/cards/', import.meta.url))) {
    if (!file.endsWith('.json')) continue;
    const source = JSON.parse(
      await readFile(new URL('../packages/cards/cards/' + file, import.meta.url), 'utf8'),
    );
    byName[source.name] = source.id;
    sources.push(source);
  }
  const mechanics = JSON.parse(
    await readFile(new URL('../packages/cards/mechanics.json', import.meta.url), 'utf8'),
  );
  const identities = Object.fromEntries(sources.map((s) => [s.id, s.name]));
  const pairs = sources.filter((s) => s.abilities.some((a) => a.kind === 'adventure'));
  assert.equal(pairs.length, 24);
  for (const source of pairs) {
    const result = compileCard(source, { identities, mechanics });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.definition, CARDS[source.name]);
    const back = compileCard(
      sourceFromDefinition(result.definition, { id: source.id, idsByName: byName }),
      { identities, mechanics },
    );
    assert.equal(back.ok, true, JSON.stringify(back.diagnostics));
    assert.deepEqual(back.definition, result.definition);
  }
});
