import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createGame,
  createRegistry,
  dispatch,
  playerView,
  exportReplay,
  replay,
  validateDefinition,
  chooseBotCommand,
} from '../src/index.js';
import { addObject, move } from '../src/model.js';
import { act, resolve, put } from './helpers.js';
const basic = { all: [{ type: 'land' }, { basic: true }] };
function setup(effect, after = [], librarySize = null) {
  const card = {
    name: 'Search fixture',
    type: 'sorcery',
    cost: {},
    color: [],
    keywords: [],
    text: 'Search fixture',
    effects: [effect, ...after],
  };
  const deck = [
    ...Array(40).fill('Forest'),
    ...Array(4).fill(['Forest', 'Plains', 'Grizzly Bears', 'Soul Warden', 'Shock']).flat(),
  ];
  let s = createGame({
    catalog: createRegistry([...Object.values(CARDS), card]),
    decks: [deck, deck],
    mulligan: false,
    seed: 731,
  });
  s.step = 'main1';
  s.turn = 3;
  for (const p of s.players) for (const id of [...p.hand]) move(s, s.objects[id], 'library');
  if (librarySize !== null)
    for (const id of s.players[0].library.slice(librarySize)) move(s, s.objects[id], 'graveyard');
  const spell = addObject(s, card.name, 0, 'hand');
  s = resolve(act(s, 'cast', { card: spell.id }));
  return { s, spell };
}
test('a filtered library search offers only matches and enters the chosen basic tapped', () => {
  let { s, spell } = setup({
    op: 'searchLibrary',
    count: 1,
    where: basic,
    destination: 'battlefield',
    tapped: true,
  });
  assert.equal(s.choice.kind, 'librarySearch');
  assert.equal(s.objects[spell.id].zone, 'stack');
  assert.ok(s.choice.cards.every((id) => s.catalog[s.objects[id].name].basic));
  const id = s.choice.cards[0],
    inc = s.objects[id].incarnation;
  s = act(s, 'searchLibrary', { cards: [id] });
  assert.equal(s.objects[id].zone, 'battlefield');
  assert.equal(s.objects[id].tapped, true);
  assert.equal(s.objects[id].incarnation, inc + 1);
  assert.equal(s.objects[spell.id].zone, 'graveyard');
  assert.equal(s.choice, null);
  assert.equal(s.resolving, null);
});
test('a quality-restricted search may fail to find and still shuffles and continues', () => {
  let { s } = setup(
    { op: 'searchLibrary', count: 2, where: basic, destination: 'hand', reveal: true },
    [{ op: 'gainLife', amount: 3 }],
  );
  const rng = s.rng;
  const size = s.players[0].library.length;
  s = act(s, 'searchLibrary', { cards: [] });
  assert.notEqual(s.rng, rng);
  assert.equal(s.players[0].library.length, size);
  assert.equal(s.players[0].life, 23);
  assert.equal(
    s.events.at(-2)?.type === 'libraryShuffled' ||
      s.events.some((e) => e.type === 'libraryShuffled'),
    true,
  );
});
test('unrestricted quantity search must find the requested quantity', () => {
  let { s } = setup({ op: 'searchLibrary', count: 1, destination: 'hand' });
  const invalid = dispatch(s, { type: 'searchLibrary', player: 0, cards: [] });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.state, s);
  const id = s.choice.cards[0];
  s = act(s, 'searchLibrary', { cards: [id] });
  assert.equal(s.objects[id].zone, 'hand');
  assert.equal(s.events.find((e) => e.type === 'librarySearched').revealed, undefined);
});
test('invalid identities, quantities, duplicates and wrong chooser reject atomically', () => {
  const { s } = setup({ op: 'searchLibrary', count: 2, where: basic, destination: 'hand' });
  const id = s.choice.cards[0],
    bad = s.players[0].library.find((id) => s.objects[id].name === 'Shock');
  for (const command of [
    { cards: [bad] },
    { cards: ['missing'] },
    { cards: [id, id] },
    { cards: s.choice.cards.slice(0, 3) },
    { cards: [id], player: 1 },
    { cards: 'bad' },
    { type: 'pass' },
  ]) {
    const before = JSON.stringify(s);
    const r = dispatch(s, { type: 'searchLibrary', player: 0, ...command });
    assert.equal(r.ok, false, JSON.stringify(command));
    assert.equal(r.state, s);
    assert.equal(JSON.stringify(s), before);
  }
});
test('top search excludes chosen cards from shuffle and subsequent draw follows chosen order', () => {
  let { s } = setup({ op: 'searchLibrary', count: 2, destination: 'top', reveal: true }, [
    { op: 'draw', count: 1 },
  ]);
  const ids = s.choice.cards.slice(0, 2),
    names = ids.map((id) => s.objects[id].name);
  s = act(s, 'searchLibrary', { cards: ids });
  assert.equal(s.players[0].hand[0], ids[0]);
  assert.equal(s.players[0].library[0], ids[1]);
  assert.deepEqual(s.events.find((e) => e.type === 'librarySearched').revealed, names);
});
test('simultaneously searched creatures see each other entering', () => {
  let { s } = setup({
    op: 'searchLibrary',
    count: 2,
    where: { type: 'creature' },
    destination: 'battlefield',
  });
  const ids = s.choice.cards.filter((id) => s.objects[id].name === 'Soul Warden').slice(0, 2);
  s = act(s, 'searchLibrary', { cards: ids });
  assert.equal(s.choice?.kind, 'orderTriggers');
  assert.equal(s.choice.entries.length, 2);
});
test('empty and one-card libraries can be searched and shuffled without drawing', () => {
  for (const size of [0, 1]) {
    let { s } = setup(
      { op: 'searchLibrary', count: 1, where: basic, destination: 'hand' },
      [],
      size,
    );
    s = act(s, 'searchLibrary', { cards: [] });
    assert.equal(s.status, 'playing');
    assert.equal(s.players[0].failedDraw, false);
    assert.ok(s.events.some((e) => e.type === 'libraryShuffled'));
  }
});
test('search visibility is scoped and hidden handles cannot track shuffled identities', () => {
  let { s } = setup({
    op: 'searchLibrary',
    count: 1,
    where: basic,
    destination: 'hand',
    reveal: true,
  });
  const before = playerView(s, 0),
    enemy = playerView(s, 1),
    ids = [...s.players[0].library];
  assert.ok(ids.every((id) => before.objects[id]?.name));
  assert.equal(enemy.choice.kind, 'opponentChoice');
  assert.ok(ids.every((id) => !enemy.objects[id]));
  s = act(s, 'searchLibrary', { cards: [s.choice.cards[0]] });
  const view = playerView(s, 0),
    hidden = s.players[0].library;
  assert.ok(hidden.every((id) => !view.objects[id]));
  assert.ok(view.players[0].library.every((id) => id.startsWith('hidden:')));
  assert.ok(view.players[0].library.every((id) => view.objects[id].hidden));
  assert.ok(s.players[0].hand.every((id) => view.objects[id].name));
  for (const id of hidden) assert.equal(JSON.stringify(view).includes(`"${id}"`), false);
});
test('search definitions reject unsupported fields, filters and unsafe battlefield destinations', () => {
  for (const effect of [
    { op: 'searchLibrary', count: 1, destination: 'battlefield' },
    { op: 'searchLibrary', count: 1, destination: 'battlefield', where: { type: 'instant' } },
    { op: 'searchLibrary', count: 1, destination: 'hand', tapped: true },
    { op: 'searchLibrary', count: 1, destination: 'hand', where: { unknown: true } },
    { op: 'searchLibrary', count: 1, destination: 'hand', player: 'all' },
  ])
    assert.ok(
      validateDefinition({
        name: 'Bad',
        type: 'sorcery',
        cost: {},
        color: [],
        keywords: [],
        text: '',
        effects: [effect],
      }).length,
    );
});

test('library-to-graveyard search makes the chosen card public', () => {
  let { s } = setup({ op: 'searchLibrary', count: 1, destination: 'graveyard' });
  const id = s.choice.cards.find((id) => s.objects[id].name === 'Grizzly Bears');
  s = act(s, 'searchLibrary', { cards: [id] });
  assert.equal(s.objects[id].zone, 'graveyard');
  assert.equal(playerView(s, 1).objects[id].name, 'Grizzly Bears');
});

test('a real card replay paused at search reconstructs identically', () => {
  const deck = [...Array(56).fill('Forest'), ...Array(4).fill('Shared Roots')];
  let s = createGame({ decks: [deck, deck], seed: 7, mulligan: false });
  for (let i = 0; i < 200 && s.choice?.kind !== 'librarySearch'; i++) {
    const p = s.choice?.player ?? s.priority;
    const command = chooseBotCommand(s, p);
    assert.ok(command);
    s = act(s, command.type, command, p);
  }
  assert.equal(s.choice.kind, 'librarySearch');
  assert.deepEqual(replay(exportReplay(s)), s);
  const command = chooseBotCommand(s, s.choice.player);
  s = act(s, command.type, command, command.player);
  assert.deepEqual(replay(exportReplay(s)), s);
});

test('search decisions use only the permitted observation and prefer missing colors', () => {
  let { s } = setup({
    op: 'searchLibrary',
    count: 1,
    where: basic,
    destination: 'battlefield',
    tapped: true,
  });
  put(s, 'Forest', 0);
  put(s, 'Soul Warden', 0, 'hand');
  const command = chooseBotCommand(s, 0);
  assert.equal(s.objects[command.cards[0]].name, 'Plains');
  assert.deepEqual(command, chooseBotCommand(playerView(s, 0), 0));
  assert.equal(dispatch(s, command).ok, true);
});

test('fetch lands are activated rather than left idle by the practice bot', () => {
  const s = createGame({ mulligan: false });
  s.step = 'main1';
  s.players[0].landsPlayed = 1;
  for (const id of [...s.players[0].hand]) move(s, s.objects[id], 'library');
  const land = put(s, 'Evolving Wilds', 0);
  const command = chooseBotCommand(s, 0);
  assert.equal(command.type, 'activate');
  assert.equal(command.card, land.id);
});

test('enchantment battlefield searches are accepted with the explicit Aura-entry choice system', () => {
  assert.deepEqual(
    validateDefinition({
      name: 'Aura search',
      type: 'sorcery',
      cost: {},
      color: [],
      keywords: [],
      text: '',
      effects: [
        {
          op: 'searchLibrary',
          count: 1,
          destination: 'battlefield',
          where: { type: 'enchantment' },
        },
      ],
    }),
    [],
  );
});
