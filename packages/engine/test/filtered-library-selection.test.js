import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  chooseBotCommand,
  createGame,
  dispatch,
  exportReplay,
  playerView,
  replay,
} from '../src/index.js';
import { move, shuffle } from '../src/model.js';
import { validateDefinition } from '../src/definition-validation.js';
import { compileCard } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';

const creatures = { type: 'creature' };
function inspected(effect = {}, names = ['Island', 'Grizzly Bears', 'Opt', 'Llanowar Elves']) {
  let s = fixture();
  for (const id of [...s.players[0].library]) move(s, s.objects[id], 'exile');
  names.forEach((name) => put(s, name, 0, 'library'));
  const card = put(s, 'Sleight of Hand', 0, 'hand');
  card.definitionOverride = {
    ...CARDS['Sleight of Hand'],
    cost: {},
    effects: [
      { op: 'lookChooseHand', count: 4, where: creatures, optional: true, reveal: true, ...effect },
    ],
  };
  return resolve(act(s, 'cast', { card: card.id }));
}
function select(s, ids = []) {
  return act(s, 'orderLibrary', {
    top: ids,
    rest: s.choice.cards.filter((id) => !ids.includes(id)),
  });
}
test('filtered optional selection rejects ineligible cards and takes 0..maximum without drawing', () => {
  const s = inspected({ selectCount: 2 });
  assert.equal(s.choice.selectCount, 2);
  assert.deepEqual(
    s.choice.eligibleCards.map((id) => s.objects[id].name),
    ['Grizzly Bears', 'Llanowar Elves'],
  );
  const snapshot = structuredClone(s);
  assert.throws(() => select(s, [s.choice.cards[0]]), /eligible/);
  assert.deepEqual(s, snapshot);
  for (const count of [0, 1, 2]) {
    const chosen = s.choice.eligibleCards.slice(0, count),
      result = select(s, chosen);
    assert.equal(result.players[0].hand.length, count);
    assert.ok(chosen.every((id) => result.objects[id].zone === 'hand'));
    assert.deepEqual(result.events.at(-1).type, 'resolved');
    assert.ok(!result.events.slice(s.events.length).some((e) => e.type === 'draw'));
    const event = result.events.findLast((e) => e.type === 'lookChooseHand');
    assert.deepEqual(
      event.revealed,
      chosen.map((id) => s.objects[id].name),
    );
  }
});
test('mandatory filtered inspection is not a quality search and cannot fail to find', () => {
  const s = inspected({ optional: false, selectCount: 3 });
  assert.equal(s.choice.selectCount, 2);
  assert.throws(() => select(s, []), /exactly 2/);
  assert.throws(() => select(s, s.choice.eligibleCards.slice(0, 1)), /exactly 2/);
  assert.equal(select(s, s.choice.eligibleCards).players[0].hand.length, 2);
});
test('all-ineligible, partial and empty inspected sets remain legal and never fail to draw', () => {
  for (const names of [[], ['Island'], ['Island', 'Grizzly Bears']]) {
    let s = inspected({ optional: false, selectCount: 2 }, names);
    if (names.length) {
      assert.equal(s.choice.selectCount, names.length === 2 ? 1 : 0);
      s = select(s, s.choice.eligibleCards);
    }
    assert.equal(s.choice, null);
    assert.equal(s.winner, null);
    assert.equal(s.players[0].failedDraw, false);
  }
});
test('look remains private, selected reveal is public knowledge without hidden-zone IDs', () => {
  const s = inspected(),
    ids = [...s.choice.cards];
  const own = playerView(s, 0),
    other = playerView(s, 1);
  assert.equal(other.choice.kind, 'opponentChoice');
  for (const id of ids) {
    assert.equal(own.objects[id].name, s.objects[id].name);
    assert.equal(other.objects[id], undefined);
  }
  assert.ok(!JSON.stringify(other).includes('eligibleCards'));
  const chosen = s.choice.eligibleCards[0],
    result = select(s, [chosen]);
  const observed = playerView(result, 1);
  assert.deepEqual(observed.events.findLast((e) => e.type === 'lookChooseHand').revealed, [
    'Grizzly Bears',
  ]);
  for (const id of ids) assert.equal(observed.objects[id], undefined);
  assert.ok(observed.players[0].hand.every((id) => id.startsWith('hidden:')));
  assert.ok(observed.players[0].library.every((id) => id.startsWith('hidden:')));
});
test('revealing the whole inspected set shows current identities to both players only while relevant', () => {
  const s = inspected({ revealAll: true }),
    other = playerView(s, 1);
  for (const id of s.choice.cards) assert.equal(other.objects[id].name, s.objects[id].name);
  assert.deepEqual(
    other.events.findLast((e) => e.type === 'libraryRevealed').revealed,
    s.choice.cards.map((id) => s.objects[id].name),
  );
  assert.equal(other.choice.kind, 'opponentChoice');
  const result = playerView(select(s, [s.choice.eligibleCards[0]]), 1);
  for (const id of s.choice.cards) assert.equal(result.objects[id], undefined);
});
test('random remainder canonicalizes submitted order and preserves seeded state', () => {
  const s = inspected({ restOrder: 'random' }),
    top = [s.choice.eligibleCards[0]],
    rest = s.choice.cards.filter((id) => !top.includes(id));
  const a = act(s, 'orderLibrary', { top, rest }),
    b = act(s, 'orderLibrary', { top, rest: [...rest].reverse() });
  const expected = structuredClone(s),
    bottom = shuffle(expected, [...rest]);
  assert.deepEqual(a.players[0].library, bottom);
  assert.deepEqual(a.players[0].library, b.players[0].library);
  assert.equal(a.rng, expected.rng);
});
test('graveyard remainder moves all unselected cards publicly and never bottoms or mills them', () => {
  const s = inspected({ restDestination: 'graveyard', selectCount: 2 });
  const chosen = s.choice.eligibleCards.slice(0, 1),
    result = select(s, chosen);
  assert.deepEqual(result.players[0].library, []);
  assert.equal(result.players[0].hand.length, 1);
  for (const id of s.choice.cards.filter((id) => !chosen.includes(id))) {
    assert.equal(result.objects[id].zone, 'graveyard');
    assert.ok(playerView(result, 1).objects[id]);
  }
  assert.ok(!result.events.slice(s.events.length).some((e) => ['draw', 'mill'].includes(e.type)));
});
test('subtype and numeric filters use library characteristics, including changeling', () => {
  let s = inspected(
    { where: { any: [{ subtype: 'Goblin' }, { subtype: 'Swamp' }, { subtype: 'Mountain' }] } },
    ['Changeling Wayfinder', 'Forest', 'Mountain', 'Grizzly Bears'],
  );
  assert.deepEqual(
    s.choice.eligibleCards.map((id) => s.objects[id].name),
    ['Changeling Wayfinder', 'Mountain'],
  );
  s = inspected({ where: { all: [{ type: 'creature' }, { power: { lte: 1 } }] } });
  assert.deepEqual(
    s.choice.eligibleCards.map((id) => s.objects[id].name),
    ['Llanowar Elves'],
  );
});
test('the deciding recipient and source controller remain separate for relative predicates', () => {
  let s = fixture();
  const card = put(s, 'Sleight of Hand', 0, 'hand');
  card.definitionOverride = {
    ...CARDS['Sleight of Hand'],
    cost: {},
    effects: [
      {
        op: 'lookChooseHand',
        count: 3,
        player: 'opponent',
        where: { owner: 'opponent' },
        optional: true,
      },
    ],
  };
  s = resolve(act(s, 'cast', { card: card.id }));
  assert.equal(s.choice.player, 1);
  assert.deepEqual(s.choice.eligibleCards, s.players[1].library.slice(0, 3));
  s = select(s, s.choice.eligibleCards.slice(0, 1));
  assert.equal(s.players[1].hand.length, 1);
  assert.equal(s.players[0].hand.length, 0);
});
test('no priority or wrong-player choices interrupt resolving inspection; bot respects eligibility', () => {
  const s = inspected(),
    snapshot = structuredClone(s);
  assert.throws(() => act(s, 'pass'));
  assert.throws(() => act(s, 'orderLibrary', { top: [], rest: s.choice.cards }, 1));
  assert.deepEqual(s, snapshot);
  const command = chooseBotCommand(playerView(s, 0), 0);
  assert.equal(command.top.length, 1);
  assert.ok(s.choice.eligibleCards.includes(command.top[0]));
  assert.equal(act(s, command.type, command).choice, null);
});
test('new declaration fields reject malformed policies and roundtrip through source compilation', () => {
  const base = CARDS['Sleight of Hand'];
  for (const extra of [
    { where: { javascript: 'x' } },
    { optional: 'yes' },
    { reveal: 1 },
    { revealAll: [] },
    { restDestination: 'exile' },
    { restDestination: 'graveyard', restOrder: 'random' },
  ])
    assert.ok(
      validateDefinition({ ...base, effects: [{ op: 'lookChooseHand', count: 4, ...extra }] })
        .length,
    );
  const native = {
    ...base,
    effects: [
      {
        op: 'lookChooseHand',
        count: 4,
        selectCount: 2,
        where: creatures,
        optional: true,
        reveal: true,
        revealAll: true,
        restDestination: 'graveyard',
      },
    ],
  };
  const source = sourceFromDefinition(native, { id: 'd853785e-93f8-4ec0-a82d-65437af971dc' });
  const compiled = compileCard(source);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  assert.deepEqual(compiled.definition, native);
});
test('filtered reveal and random-bottom choices reconstruct in deterministic replay', () => {
  const name = 'Sleight of Hand';
  const catalog = {
    ...CARDS,
    [name]: {
      ...CARDS[name],
      cost: {},
      effects: [
        {
          op: 'lookChooseHand',
          count: 5,
          where: { type: 'land' },
          optional: true,
          reveal: true,
          restOrder: 'random',
        },
      ],
    },
  };
  let s = createGame({
    catalog,
    decks: [[...Array(4).fill(name), ...Array(56).fill('Island')], Array(60).fill('Forest')],
    seed: 7,
    mulligan: false,
  });
  for (let i = 0; i < 300 && s.choice?.kind !== 'libraryOrder'; i++) {
    const command = chooseBotCommand(s, s.choice?.player ?? s.priority);
    assert.ok(command);
    const result = dispatch(s, command);
    assert.ok(result.ok, result.error?.message);
    s = result.state;
  }
  assert.equal(s.choice.kind, 'libraryOrder');
  assert.deepEqual(replay(exportReplay(s)), s);
  const command = chooseBotCommand(s, s.choice.player);
  s = act(s, command.type, command);
  assert.deepEqual(replay(exportReplay(s)), s);
});
