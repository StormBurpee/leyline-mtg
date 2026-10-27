import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  createGame,
  dispatch,
  legalActions,
  chooseBotCommand,
  playerView,
  exportReplay,
  replay,
  hasKeyword,
  ref,
  stats,
} from '../src/index.js';
import { move } from '../src/model.js';
import { finishCleanup } from '../src/turn.js';
import { fixture, put, act, resolve } from './helpers.js';
const rich = () => {
  const s = fixture();
  for (const p of s.players) for (const color of ['W', 'U', 'B', 'R', 'G', 'C']) p.mana[color] = 20;
  return s;
};
const tokenCount = (s, name, player = 0) =>
  Object.values(s.objects).filter(
    (o) => o.zone === 'battlefield' && o.name === name && o.controller === player,
  ).length;
const choice = (options, player) => ({
  op: 'chooseEffect',
  ...(player ? { player } : {}),
  options,
});
const option = (label, effects, condition) => ({
  label,
  effects,
  ...(condition ? { condition } : {}),
});
const custom = (s, effects, target) => {
  const name = 'Resolution choice fixture';
  s.catalog = createRegistry({
    ...s.catalog,
    [name]: { name, type: 'sorcery', cost: {}, effects, ...(target ? { target } : {}) },
  });
  return put(s, name, 0, 'hand');
};

test('Ant-Man’s Army announces no mode and chooses exactly one token only during ETB resolution', () => {
  for (const player of [0, 1])
    for (const selected of [0, 1]) {
      let s = rich();
      s.active = player;
      s.priority = player;
      const source = put(s, "Ant-Man's Army", player, 'hand');
      s = act(s, 'cast', { card: source.id });
      s = resolve(s);
      assert.equal(s.choice, null);
      assert.equal(s.stack.length, 1);
      assert.equal(
        tokenCount(s, 'Food Token', player) + tokenCount(s, 'Treasure Token', player),
        0,
      );
      // The trigger controller persists even if the source changes controllers and leaves.
      s.objects[source.id].controller = 1 - player;
      move(s, s.objects[source.id], 'graveyard');
      s = resolve(s);
      assert.equal(s.choice.kind, 'effectChoice');
      assert.equal(s.choice.player, player);
      assert.deepEqual(
        legalActions(s, player).filter((x) => x.type !== 'concede'),
        [
          { type: 'chooseEffect', option: 0 },
          { type: 'chooseEffect', option: 1 },
        ],
      );
      for (const command of [
        { type: 'pass', player },
        { type: 'chooseEffect', player: 1 - player, option: 0 },
        { type: 'chooseEffect', player, option: 2 },
        { type: 'chooseEffect', player, option: '0' },
      ]) {
        const before = structuredClone(s),
          result = dispatch(s, command);
        assert.equal(result.ok, false);
        assert.deepEqual(s, before);
      }
      s = act(s, 'chooseEffect', { option: selected });
      assert.equal(s.choice, null);
      assert.equal(s.resolving, null);
      assert.equal(tokenCount(s, selected === 0 ? 'Food Token' : 'Treasure Token', player), 1);
      assert.equal(tokenCount(s, selected === 0 ? 'Treasure Token' : 'Food Token', player), 0);
    }
});

test('Ezrim investigates twice and pays sacrifice before selecting each temporary keyword', () => {
  for (const [selected, keyword] of ['vigilance', 'lifelink', 'hexproof'].entries()) {
    let s = rich();
    const source = put(s, 'Ezrim, Agency Chief', 0, 'hand');
    s = resolve(act(s, 'cast', { card: source.id }));
    s = resolve(s);
    assert.equal(tokenCount(s, 'Clue Token'), 2);
    const clue = Object.values(s.objects).find(
      (o) => o.name === 'Clue Token' && o.zone === 'battlefield',
    );
    s = act(s, 'activate', { card: source.id, ability: 0, sacrifices: [ref(clue)] });
    assert.notEqual(s.objects[clue.id]?.zone, 'battlefield');
    assert.equal(s.choice, null);
    s = resolve(s);
    assert.equal(s.choice.kind, 'effectChoice');
    s = act(s, 'chooseEffect', { option: selected });
    assert.equal(hasKeyword(s, s.objects[source.id], keyword), true);
    finishCleanup(s);
    assert.equal(hasKeyword(s, s.objects[source.id], keyword), false);
  }
});

test('Hungering Puppetbeast makes Heartwood, excludes itself from costs, and counters before choice', () => {
  for (const [selected, keyword] of ['trample', 'hexproof', 'haste'].entries()) {
    let s = rich();
    const source = put(s, 'Hungering Puppetbeast', 0, 'hand');
    s = resolve(act(s, 'cast', { card: source.id }));
    s = resolve(s);
    assert.equal(tokenCount(s, 'Heartwood'), 1);
    assert.equal(
      dispatch(s, {
        type: 'activate',
        player: 0,
        card: source.id,
        ability: 0,
        sacrifices: [ref(s.objects[source.id])],
      }).ok,
      false,
    );
    const heartwood = Object.values(s.objects).find(
      (o) => o.name === 'Heartwood' && o.zone === 'battlefield',
    );
    s = resolve(act(s, 'activate', { card: source.id, ability: 0, sacrifices: [ref(heartwood)] }));
    assert.equal(s.choice.kind, 'effectChoice');
    assert.equal(s.objects[source.id].plusCounters, 1);
    assert.deepEqual(stats(s, s.objects[source.id]), { power: 6, toughness: 6 });
    assert.equal(dispatch(s, { type: 'pass', player: 0 }).ok, false);
    s = act(s, 'chooseEffect', { option: selected });
    assert.equal(hasKeyword(s, s.objects[source.id], keyword), true);
  }
});

test('selected source effects never attach to a departed and returned incarnation', () => {
  let s = rich();
  const source = put(s, 'Ezrim, Agency Chief'),
    artifact = put(s, 'Short Bow');
  s = act(s, 'activate', { card: source.id, ability: 0, sacrifices: [ref(artifact)] });
  move(s, s.objects[source.id], 'graveyard');
  move(s, s.objects[source.id], 'battlefield');
  s = resolve(s);
  s = act(s, 'chooseEffect', { option: 2 });
  assert.equal(hasKeyword(s, s.objects[source.id], 'hexproof'), false);
});

test('Sanctuary Wall always taps first, with decline or linked stun placement and same-object double stun', () => {
  for (const self of [false, true])
    for (const selected of [0, 1]) {
      let s = rich();
      const wall = put(s, 'Sanctuary Wall'),
        target = self ? wall : put(s, 'Grizzly Bears', 1);
      s = resolve(act(s, 'activate', { card: wall.id, ability: 0, target: ref(target) }));
      assert.equal(s.objects[target.id].tapped, true);
      assert.equal(s.choice.kind, 'effectChoice');
      s = act(s, 'chooseEffect', { option: selected });
      assert.equal(s.objects[target.id].stunCounters ?? 0, selected * (self ? 2 : 1));
      assert.equal(s.objects[wall.id].stunCounters ?? 0, selected * (self ? 2 : 1));
    }
});

test('Sanctuary Wall fizzles on a lost target but its optional stun still works when only its source leaves', () => {
  for (const lost of ['target', 'source']) {
    let s = rich();
    const wall = put(s, 'Sanctuary Wall'),
      target = put(s, 'Grizzly Bears', 1);
    s = act(s, 'activate', { card: wall.id, ability: 0, target: ref(target) });
    move(s, s.objects[lost === 'target' ? target.id : wall.id], 'graveyard');
    s = resolve(s);
    if (lost === 'target') {
      assert.equal(s.choice, null);
      assert.equal(s.events.at(-1).type, 'fizzled');
    } else {
      s = act(s, 'chooseEffect', { option: 1 });
      assert.equal(s.objects[target.id].stunCounters, 1);
    }
  }
});

test('resolution options are filtered at their instruction after earlier effects, never at announcement', () => {
  let s = rich();
  const source = custom(s, [
    { op: 'gainLife', amount: 1 },
    choice([
      option('Only at 21 life', [{ op: 'gainLife', amount: 3 }], {
        kind: 'compare',
        left: { kind: 'life', player: 'you' },
        right: 21,
        operator: 'gte',
      }),
      option('Cannot choose this', [{ op: 'gainLife', amount: 10 }], {
        kind: 'controlAtLeast',
        where: { type: 'creature' },
        count: 1,
      }),
    ]),
  ]);
  s = act(s, 'cast', { card: source.id });
  s = resolve(s);
  assert.deepEqual(s.choice.options, [{ index: 0, label: 'Only at 21 life' }]);
  assert.equal(dispatch(s, { type: 'chooseEffect', player: 0, option: 1 }).ok, false);
  s = act(s, 'chooseEffect', { option: 0 });
  assert.equal(s.players[0].life, 24);
});

test('nested alternatives retain parent continuation across scry and opponent choices without changing controller', () => {
  let s = rich();
  const source = custom(s, [
    choice([
      option('Scry then opponent chooses', [
        { op: 'scry', count: 1 },
        choice(
          [
            option('Controller gains 3', [{ op: 'gainLife', amount: 3 }]),
            option('Opponent gains 4', [{ op: 'gainLife', player: 'opponent', amount: 4 }]),
          ],
          'opponent',
        ),
      ]),
      option('Decline', []),
    ]),
    { op: 'gainLife', amount: 2 },
  ]);
  s = resolve(act(s, 'cast', { card: source.id }));
  s = act(s, 'chooseEffect', { option: 0 });
  assert.equal(s.choice.kind, 'libraryOrder');
  s = act(s, 'orderLibrary', { top: [...s.choice.cards], rest: [] });
  assert.equal(s.choice.kind, 'effectChoice');
  assert.equal(s.choice.player, 1);
  assert.equal(dispatch(s, { type: 'chooseEffect', player: 0, option: 0 }).ok, false);
  s = act(s, 'chooseEffect', { option: 0 });
  assert.equal(s.players[0].life, 25);
  assert.equal(s.players[1].life, 20);
  assert.equal(s.objects[source.id].zone, 'graveyard');
});

test('selected branch preserves announced target and pending entry-choice continuation', () => {
  let s = rich();
  const source = custom(
    s,
    [
      choice([
        option('Return land', [
          { op: 'moveTarget', destination: 'battlefield', controller: 'you' },
        ]),
        option('Leave it', []),
      ]),
      { op: 'gainLife', amount: 3 },
    ],
    { scope: 'graveyard', where: { all: [{ owner: 'you' }, { type: 'land' }] } },
  );
  const land = put(s, 'Cavern of Souls', 0, 'graveyard');
  s = resolve(act(s, 'cast', { card: source.id, target: ref(land) }));
  s = act(s, 'chooseEffect', { option: 0 });
  assert.equal(s.choice.kind, 'creatureType');
  assert.equal(s.players[0].life, 20);
  assert.equal(dispatch(s, { type: 'pass', player: 0 }).ok, false);
  s = act(s, 'chooseCreatureType', { creatureType: 'Human' });
  assert.equal(s.players[0].life, 23);
  assert.equal(s.objects[land.id].zone, 'battlefield');
  assert.equal(s.objects[source.id].zone, 'graveyard');
});

test('target controller is locked through nested alternatives before earlier zone movement', () => {
  let s = rich();
  const target = put(s, 'Grizzly Bears', 1);
  const source = custom(
    s,
    [
      { op: 'destroy' },
      choice([
        option('Give target controller a Food', [
          { op: 'token', definition: 'Food Token', count: 1, player: 'targetController' },
        ]),
        option('Do nothing', []),
      ]),
    ],
    'creature',
  );
  s = resolve(act(s, 'cast', { card: source.id, target: ref(target) }));
  s = act(s, 'chooseEffect', { option: 0 });
  assert.equal(tokenCount(s, 'Food Token', 1), 1);
  assert.equal(tokenCount(s, 'Food Token', 0), 0);
});

test('choice commands replay deterministically and bot choices ignore hidden opposing information', () => {
  const name = 'Replay choice fixture';
  const catalog = {
    ...CARDS,
    [name]: {
      name,
      type: 'sorcery',
      cost: {},
      effects: [
        choice([
          option('Gain 2', [{ op: 'gainLife', amount: 2 }]),
          option('Gain 3', [{ op: 'gainLife', amount: 3 }]),
        ]),
      ],
    },
  };
  const deck = [...Array(4).fill(name), ...Array(3).fill('Forest')];
  let s = createGame({ catalog, decks: [deck, deck], minimumDeckSize: 7, mulligan: false });
  while (s.step !== 'main1') s = act(s, 'pass');
  s = resolve(
    act(s, 'cast', { card: s.players[0].hand.find((id) => s.objects[id].name === name) }),
  );
  const bot = chooseBotCommand(playerView(s, 0), 0);
  assert.equal(bot.type, 'chooseEffect');
  const changed = structuredClone(s);
  for (const id of changed.players[1].hand) changed.objects[id].name = 'Island';
  assert.deepEqual(chooseBotCommand(playerView(changed, 0), 0), bot);
  s = act(s, 'chooseEffect', { option: 1 });
  assert.deepEqual(replay(exportReplay(s)), s);
});

test('no eligible alternatives skip the instruction; an empty chosen branch still runs later instructions', () => {
  for (const unavailable of [false, true]) {
    let s = rich();
    const condition = unavailable
      ? { kind: 'controlAtLeast', where: { type: 'creature' }, count: 1 }
      : undefined;
    const source = custom(s, [
      choice([option('Do nothing', [], condition), option('Also nothing', [], condition)]),
      { op: 'gainLife', amount: 2 },
    ]);
    s = resolve(act(s, 'cast', { card: source.id }));
    if (!unavailable) s = act(s, 'chooseEffect', { option: 0 });
    assert.equal(s.choice, null);
    assert.equal(s.players[0].life, 22);
    assert.equal(s.objects[source.id].zone, 'graveyard');
  }
});
