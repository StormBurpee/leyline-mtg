import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CARDS,
  createGame,
  chooseBotCommand,
  playerView,
  exportReplay,
  replay,
  ref,
} from '../src/index.js';
import { move, shuffle } from '../src/model.js';
import { finishCleanup } from '../src/turn.js';
import { validateDefinition } from '../src/definition-validation.js';
import { fixture, put, lands, act, resolve } from './helpers.js';
import { compileCard } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';

function cast(name, setup = () => {}, mode) {
  let s = fixture();
  lands(s, 'Island', 5);
  const card = put(s, name, 0, 'hand');
  setup(s);
  return resolve(act(s, 'cast', { card: card.id, ...(mode === undefined ? {} : { mode }) }));
}
function finish(s, chosen = s.choice.cards.slice(0, s.choice.selectCount)) {
  return act(s, 'orderLibrary', {
    top: chosen,
    rest: s.choice.cards.filter((id) => !chosen.includes(id)),
  });
}
test('Stock Up chooses exactly two, preserves chosen bottom order, and never draws', () => {
  let s = cast('Stock Up');
  const cards = [...s.choice.cards],
    remaining = s.players[0].library.slice(5);
  const events = s.events.length;
  assert.equal(s.choice.selectCount, 2);
  for (const top of [[], cards.slice(0, 1), cards.slice(0, 3)])
    assert.throws(
      () => act(s, 'orderLibrary', { top, rest: cards.filter((id) => !top.includes(id)) }),
      /exactly 2/,
    );
  assert.throws(
    () => act(s, 'orderLibrary', { top: [cards[0], cards[0]], rest: cards.slice(2) }),
    /exactly once/,
  );
  s = act(s, 'orderLibrary', { top: cards.slice(0, 2), rest: cards.slice(2).reverse() });
  assert.deepEqual(s.players[0].library, [...remaining, ...cards.slice(2).reverse()]);
  assert.ok(cards.slice(0, 2).every((id) => s.objects[id].zone === 'hand'));
  assert.ok(!s.events.slice(events).some((e) => e.type === 'draw'));
});
test('Flow State checks both graveyard card types at resolution, not its own spell on stack', () => {
  for (const names of [[], ['Opt'], ['Sleight of Hand'], ['Opt', 'Sleight of Hand']]) {
    const s = cast('Flow State', (s) => names.forEach((n) => put(s, n, 0, 'graveyard')));
    assert.equal(s.choice.selectCount, names.length === 2 ? 2 : 1);
  }
  const s = cast('Flow State', (s) => {
    put(s, 'Opt', 0, 'graveyard');
    put(s, 'Sleight of Hand', 1, 'graveyard');
  });
  assert.equal(s.choice.selectCount, 1);
});
test('Accumulate Wisdom requires three own Lessons and takes all available cards instead', () => {
  for (const n of [2, 3]) {
    const s = cast('Accumulate Wisdom', (s) =>
      Array.from({ length: n }, () => put(s, 'Accumulate Wisdom', 0, 'graveyard')),
    );
    assert.equal(s.choice.selectCount, n === 3 ? 3 : 1);
    assert.equal(finish(s).players[0].hand.length, n === 3 ? 3 : 1);
  }
});
test('mandatory selection shrinks to available library; empty library does not draw or lose', () => {
  for (const n of [0, 1, 2]) {
    let s = cast('Stock Up', (s) =>
      s.players[0].library.slice(n).forEach((id) => move(s, s.objects[id], 'exile')),
    );
    if (n) {
      assert.equal(s.choice.selectCount, n);
      s = finish(s);
    }
    assert.equal(s.choice, null);
    assert.equal(s.winner, null);
    assert.equal(s.players[0].hand.length, n);
  }
});
test('Consult uses current lands, kicker, and seeded random bottom independent of submitted order', () => {
  for (const mode of [0, 1]) {
    const s = cast('Consult the Star Charts', undefined, mode);
    assert.equal(s.choice.cards.length, 5);
    assert.equal(s.choice.selectCount, mode + 1);
    const chosen = s.choice.cards.slice(0, mode + 1),
      rest = s.choice.cards.slice(mode + 1);
    const a = act(s, 'orderLibrary', { top: chosen, rest });
    const b = act(s, 'orderLibrary', { top: chosen, rest: [...rest].reverse() });
    const expected = structuredClone(s),
      shuffled = shuffle(expected, [...rest]);
    assert.deepEqual(a.players[0].library, [...s.players[0].library.slice(5), ...shuffled]);
    assert.deepEqual(a.players[0].library, b.players[0].library);
    assert.equal(a.rng, expected.rng);
  }
});
test('only the deciding player sees inspected identities, and bot chooses the mandatory count', () => {
  let s = cast('Stock Up');
  const ids = [...s.choice.cards];
  const own = playerView(s, 0),
    opponent = playerView(s, 1);
  assert.equal(opponent.choice.kind, 'opponentChoice');
  for (const id of ids) {
    assert.ok(own.objects[id]?.name);
    assert.equal(opponent.objects[id], undefined);
  }
  const command = chooseBotCommand(own, 0);
  assert.equal(command.top.length, 2);
  s = act(s, command.type, command);
  for (const id of command.top) assert.equal(playerView(s, 1).objects[id], undefined);
});
test('non-controller recipient selects from its own library, without source-owner leakage', () => {
  let s = fixture();
  const card = put(s, 'Sleight of Hand', 0, 'hand');
  card.definitionOverride = {
    ...CARDS['Sleight of Hand'],
    cost: {},
    effects: [{ op: 'lookChooseHand', count: 4, selectCount: 2, player: 'opponent' }],
  };
  s = resolve(act(s, 'cast', { card: card.id }));
  assert.equal(s.choice.player, 1);
  assert.deepEqual(s.choice.cards, s.players[1].library.slice(0, 4));
  assert.equal(playerView(s, 0).choice.kind, 'opponentChoice');
  s = finish(s);
  assert.equal(s.players[0].hand.length, 0);
  assert.equal(s.players[1].hand.length, 2);
});
test('Morbius pays exile from graveyard and resolves selection after source changes zone', () => {
  let s = fixture();
  lands(s, 'Island', 1);
  lands(s, 'Swamp', 1);
  const o = put(s, 'Morbius the Living Vampire', 0, 'graveyard');
  s = act(s, 'activate', { card: o.id, ability: 0 });
  assert.equal(s.objects[o.id].zone, 'exile');
  s = resolve(s);
  assert.equal(s.choice.cards.length, 3);
  s = finish(s);
  assert.equal(s.players[0].hand.length, 1);
});
test('Fomori Vault pays discard and tap, counting artifacts at resolution', () => {
  let s = fixture();
  lands(s, 'Island', 3);
  const vault = put(s, 'Fomori Vault'),
    discard = put(s, 'Opt', 0, 'hand');
  put(s, 'Murmuring Volume');
  put(s, 'Murmuring Volume');
  s = act(s, 'activate', { card: vault.id, ability: 0, discardCard: discard.id });
  assert.equal(s.objects[vault.id].tapped, true);
  assert.equal(s.objects[discard.id].zone, 'graveyard');
  s = resolve(s);
  assert.equal(s.choice.cards.length, 2);
  assert.equal(s.choice.restOrder, 'random');
});
test('Pillage retains paid Plot timing and doubles current lands for later free cast', () => {
  let s = fixture();
  lands(s, 'Swamp', 2);
  lands(s, 'Forest', 1);
  const card = put(s, 'Pillage the Bog', 0, 'hand');
  s = act(s, 'plot', { card: card.id });
  assert.throws(() => act(s, 'cast', { card: card.id }));
  finishCleanup(s);
  finishCleanup(s);
  s.step = 'main1';
  s = resolve(act(s, 'cast', { card: card.id }));
  assert.equal(s.choice.cards.length, 6);
  assert.equal(s.choice.restOrder, 'random');
});
test('Stress Dream works with no chosen target; an all-illegal chosen target fizzles everything', () => {
  for (const target of [false, true]) {
    let s = fixture();
    lands(s, 'Island', 4);
    lands(s, 'Mountain', 1);
    const card = put(s, 'Stress Dream', 0, 'hand'),
      creature = put(s, 'Grizzly Bears', 1);
    s = act(s, 'cast', { card: card.id, targets: { chosen: target ? [ref(creature)] : [] } });
    if (target) move(s, s.objects[creature.id], 'graveyard');
    s = resolve(s);
    assert.equal(s.choice?.kind ?? null, target ? null : 'libraryOrder');
  }
});
test('selection counts are bounded closed numeric expressions, and malformed policies fail', () => {
  const base = CARDS['Sleight of Hand'];
  for (const extra of [
    { selectCount: -1 },
    { selectCount: 1001 },
    { selectCount: { kind: 'code' } },
    { restOrder: 'top' },
    { selectCount: 1.5 },
  ])
    assert.ok(
      validateDefinition({ ...base, effects: [{ op: 'lookChooseHand', count: 3, ...extra }] })
        .length,
    );
  assert.deepEqual(
    validateDefinition({
      ...base,
      effects: [
        {
          op: 'lookChooseHand',
          count: 3,
          selectCount: { kind: 'count', zone: 'graveyard', player: 'you' },
        },
      ],
    }),
    [],
  );
});
test('all eight real card definitions roundtrip source and preserve complete Oracle text', async () => {
  for (const slug of [
    'flow-state',
    'stock-up',
    'consult-the-star-charts',
    'accumulate-wisdom',
    'morbius-the-living-vampire',
    'fomori-vault',
    'stress-dream',
    'pillage-the-bog',
  ]) {
    const source = JSON.parse(
      await readFile(new URL(`../../cards/cards/${slug}.json`, import.meta.url)),
    );
    const result = compileCard(source);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const native = CARDS[source.name];
    assert.equal(native.text, source.rulesText);
    const roundtrip = compileCard(sourceFromDefinition(native, { id: source.id }));
    assert.equal(roundtrip.ok, true, JSON.stringify(roundtrip.diagnostics));
    assert.deepEqual(roundtrip.definition, result.definition);
  }
});
test('a real Consult replay reconstructs both paused decision and seeded random result', () => {
  const deck = [...Array(56).fill('Island'), ...Array(4).fill('Consult the Star Charts')];
  let s = createGame({ decks: [deck, deck], seed: 7, mulligan: false });
  for (let i = 0; i < 300 && s.choice?.kind !== 'libraryOrder'; i++) {
    const command = chooseBotCommand(s, s.choice?.player ?? s.priority);
    assert.ok(command);
    s = act(s, command.type, command, command.player);
  }
  assert.equal(s.choice.kind, 'libraryOrder');
  assert.deepEqual(replay(exportReplay(s)), s);
  const command = chooseBotCommand(s, s.choice.player);
  s = act(s, command.type, command, command.player);
  assert.deepEqual(replay(exportReplay(s)), s);
});

test('composable selection count is evaluated at resolution and capped by available inspected cards', () => {
  let s = fixture();
  const card = put(s, 'Sleight of Hand', 0, 'hand');
  card.definitionOverride = {
    ...CARDS['Sleight of Hand'],
    cost: {},
    effects: [
      {
        op: 'lookChooseHand',
        count: 3,
        selectCount: {
          kind: 'count',
          zone: 'graveyard',
          player: 'you',
          where: { type: 'instant' },
        },
      },
    ],
  };
  s = act(s, 'cast', { card: card.id });
  put(s, 'Opt', 0, 'graveyard');
  put(s, 'Opt', 0, 'graveyard');
  s = resolve(s);
  assert.equal(s.choice.selectCount, 2);
  s = finish(s);
  assert.equal(s.players[0].hand.length, 2);
});
test('bot does not spend Fomori Vault discard for an empty inspected set', () => {
  const s = fixture();
  lands(s, 'Island', 3);
  put(s, 'Fomori Vault');
  put(s, 'Opt', 0, 'hand');
  const command = chooseBotCommand(s, 0);
  assert.notEqual(command.type, 'activate');
});
