import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  dispatch,
  castingProfile,
  castProblem,
  legalActions,
  manaValue,
  MAX_X,
  ref,
  stats,
  keywords,
  chooseBotCommand,
} from '../src/index.js';
import { legalTarget } from '../src/effects.js';
import { move } from '../src/model.js';
import { planPayment } from '../src/mana.js';
import { fixture, put, lands, act, resolve } from './helpers.js';

test('X is explicit, integral, bounded and cannot be smuggled into fixed-cost casts', () => {
  const s = fixture(),
    spell = put(s, 'Mind Spring', 0, 'hand');
  lands(s, 'Island', 5);
  for (const x of [undefined, -1, 0.5, NaN, Infinity, '2', MAX_X + 1]) {
    const result = dispatch(s, { type: 'cast', player: 0, card: spell.id, x });
    assert.equal(result.ok, false, String(x));
    assert.equal(s.objects[spell.id].zone, 'hand');
  }
  assert.equal(castProblem(s, 0, spell.id, null, { x: 0 }), null);
  assert.deepEqual(
    legalActions(s, 0)
      .filter((a) => a.card === spell.id && a.type === 'cast')
      .map((a) => a.x),
    [0, 1, 2, 3],
  );
  const opt = put(s, 'Opt', 0, 'hand');
  assert.ok(castProblem(s, 0, opt.id, null, { x: 0 }));
  assert.equal(planPayment(s, 0, CARDS['Mind Spring'].cost), null);
});

test('repeated X is paid repeatedly; increases precede reductions; total and X remain locked', () => {
  let s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Double X': {
      name: 'Double X',
      type: 'sorcery',
      cost: { X: 2, U: 1 },
      effects: [{ op: 'draw', count: { kind: 'x' } }],
    },
  });
  const spell = put(s, 'Double X', 0, 'hand');
  lands(s, 'Island', 6);
  put(s, 'Mocking Sprite');
  put(s, 'Mocking Sprite');
  put(s, 'Thalia, the Survivor', 1);
  assert.deepEqual(castingProfile(s, 0, spell, undefined, null, undefined, 3).cost, {
    U: 1,
    generic: 5,
  });
  s = act(s, 'cast', { card: spell.id, x: 3 });
  assert.deepEqual(s.stack.at(-1).castingCost, { U: 1, generic: 5 });
  assert.equal(s.stack.at(-1).x, 3);
  assert.equal(manaValue(s.stack.at(-1).sourceDefinition, s.stack.at(-1).x), 7);
  assert.equal(Object.values(s.objects).filter((o) => o.name === 'Island' && o.tapped).length, 6);
  const count = s.players[0].hand.length;
  s = resolve(s);
  assert.equal(s.players[0].hand.length, count + 3);
  assert.equal(manaValue(CARDS['Mind Spring']), 2);
  assert.equal(s.objects[spell.id].chosenX, undefined);
});

test('stack targeting and cast triggers see chosen X, never paid cost or X as one', () => {
  let s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    Watcher: {
      name: 'Watcher',
      type: 'creature',
      cost: {},
      power: 1,
      toughness: 1,
      triggers: [
        {
          event: { event: 'cast', controller: 'you', filter: { manaValue: { gte: 5 } } },
          effects: [{ op: 'gainLife', amount: 1 }],
        },
      ],
    },
  });
  put(s, 'Watcher');
  put(s, 'Mocking Sprite');
  lands(s, 'Island', 4);
  const spell = put(s, 'Mind Spring', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, x: 3 });
  const entry = s.stack.find((e) => e.kind === 'spell');
  assert.ok(s.stack.some((e) => e.kind === 'ability' && e.name === 'Watcher'));
  assert.equal(
    legalTarget(
      s,
      { scope: 'spell', where: { manaValue: { gte: 5 } } },
      { kind: 'stack', id: entry.id },
      1,
    ),
    true,
  );
  assert.equal(
    legalTarget(
      s,
      { scope: 'spell', where: { manaValue: { lte: 4 } } },
      { kind: 'stack', id: entry.id },
      1,
    ),
    false,
  );
  move(s, s.objects[spell.id], 'graveyard');
  assert.equal(manaValue(CARDS['Mind Spring']), 2);
});

test('damage, draw/discard and negative or positive stats use chosen X', () => {
  let s = fixture();
  lands(s, 'Mountain', 4);
  lands(s, 'Island', 1);
  const spell = put(s, 'Traumatic Critique', 0, 'hand');
  const before = s.players[0].hand.length;
  s = act(s, 'cast', { card: spell.id, x: 3, target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.players[1].life, 17);
  assert.equal(s.choice.kind, 'discardEffect');
  assert.equal(s.players[0].hand.length, before + 1);
  s = fixture();
  lands(s, 'Mountain', 4);
  const pump = put(s, 'Pedal to the Metal', 0, 'hand'),
    bear = put(s, 'Grizzly Bears');
  s = act(s, 'cast', { card: pump.id, x: 3, target: ref(bear) });
  s = resolve(s);
  assert.equal(stats(s, s.objects[bear.id]).power, 5);
  assert.ok(keywords(s, s.objects[bear.id]).includes('first strike'));
  s = fixture();
  lands(s, 'Swamp', 3);
  const removal = put(s, 'Slice from the Shadows', 0, 'hand'),
    victim = put(s, 'Grizzly Bears', 1);
  s = act(s, 'cast', { card: removal.id, x: 2, target: ref(victim) });
  assert.equal(s.stack.at(-1).uncounterable, true);
  s = resolve(s);
  assert.equal(s.objects[victim.id].zone, 'graveyard');
});

test('token counts and all follow-on clauses execute, including X zero', () => {
  for (const [name, token] of [
    ['Form a Posse', 'Mercenary Token'],
    ['Song of Totentanz', 'Nonblocking Rat Token'],
    ['United Front', 'Ally Token'],
  ]) {
    let s = fixture();
    lands(s, 'Mountain', 3);
    lands(s, 'Plains', 3);
    const bear = put(s, 'Grizzly Bears'),
      card = put(s, name, 0, 'hand');
    s = act(s, 'cast', { card: card.id, x: 2 });
    s = resolve(s);
    const tokens = Object.values(s.objects).filter(
      (o) => o.zone === 'battlefield' && o.name === token,
    );
    assert.equal(tokens.length, 2, name);
    if (name === 'Song of Totentanz') {
      assert.ok(keywords(s, s.objects[bear.id]).includes('haste'));
      assert.ok(CARDS[token].cannotBlock);
    }
    if (name === 'United Front') {
      assert.equal(s.objects[bear.id].plusCounters, 1);
      assert.ok(tokens.every((t) => t.plusCounters === 1));
    }
    if (name === 'Form a Posse') {
      assert.equal(CARDS[token].activated[0].timing, 'sorcery');
      const activation = {
        type: 'activate',
        player: 0,
        card: tokens[0].id,
        ability: 0,
        target: ref(s.objects[bear.id]),
      };
      assert.equal(dispatch(s, activation).ok, false); // A new Mercenary is summoning sick.
      s.objects[tokens[0].id].controlledSince = s.turn - 1;
      s = act(s, 'activate', activation);
      s = resolve(s);
      assert.equal(stats(s, s.objects[bear.id]).power, 3);
      assert.equal(s.objects[tokens[0].id].tapped, true);
    }
  }
  let s = fixture();
  lands(s, 'Mountain', 2);
  const card = put(s, 'Choco-Comet', 0, 'hand');
  s = act(s, 'cast', { card: card.id, x: 0, target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.players[1].life, 20);
  const bird = Object.values(s.objects).find((o) => o.name === 'Landfall Bird Token');
  assert.ok(bird);
  const land = put(s, 'Forest', 0, 'hand');
  s = act(s, 'playLand', { card: land.id });
  s = resolve(s);
  assert.equal(stats(s, s.objects[bird.id]).power, 3);
});

test('optional fight uses X pump first, and stun uses twice X', () => {
  let s = fixture();
  lands(s, 'Forest', 4);
  const card = put(s, 'Primal Might', 0, 'hand'),
    bear = put(s, 'Grizzly Bears'),
    victim = put(s, 'Hill Giant', 1);
  s = act(s, 'cast', {
    card: card.id,
    x: 2,
    targets: { actor: [ref(bear)], victim: [ref(victim)] },
  });
  s = resolve(s);
  assert.equal(s.objects[victim.id].zone, 'graveyard');
  assert.equal(stats(s, s.objects[bear.id]).power, 4);
  s = fixture();
  lands(s, 'Island', 4);
  const stun = put(s, 'Procrastinate', 0, 'hand'),
    target = put(s, 'Grizzly Bears', 1);
  s = act(s, 'cast', { card: stun.id, x: 3, target: ref(target) });
  s = resolve(s);
  assert.equal(s.objects[target.id].stunCounters, 6);
  assert.equal(s.objects[target.id].tapped, true);
});

test('bots propose explicit payable useful X without mutation', () => {
  const s = fixture();
  lands(s, 'Island', 5);
  const card = put(s, 'Mind Spring', 0, 'hand');
  const snapshot = structuredClone(s),
    command = chooseBotCommand(s, 0);
  assert.equal(command.type, 'cast');
  assert.equal(command.card, card.id);
  assert.ok(command.x > 0);
  assert.equal(dispatch(s, command).ok, true);
  assert.deepEqual(s, snapshot);
});

test('unsupported X contexts fail closed', () => {
  for (const definition of [
    { name: 'X creature', type: 'creature', cost: { X: 1 }, power: 1, toughness: 1 },
    {
      name: 'X ability',
      type: 'creature',
      cost: {},
      power: 1,
      toughness: 1,
      activated: [{ cost: { mana: { X: 1 } }, effects: [{ op: 'draw', count: 1 }] }],
    },
    {
      name: 'X stat',
      type: 'creature',
      cost: {},
      power: 1,
      toughness: 1,
      selfBonus: { power: { kind: 'x' }, toughness: 0 },
    },
    {
      name: 'X flashback',
      type: 'sorcery',
      cost: { X: 1 },
      flashback: { U: 1 },
      effects: [{ op: 'draw', count: { kind: 'x' } }],
    },
  ])
    assert.throws(() => createRegistry([definition]));
});

test('manual X is legal up to the instruction budget without enumerating every proposal', () => {
  const s = fixture(),
    card = put(s, 'Mind Spring', 0, 'hand');
  s.players[0].mana.U = 1002;
  const proposed = legalActions(s, 0).filter((a) => a.type === 'cast' && a.card === card.id);
  assert.ok(proposed.length < 30);
  assert.ok(!proposed.some((a) => a.x === 777));
  const exact = legalActions(s, 0, { x: 777 }).find((a) => a.type === 'cast' && a.card === card.id);
  assert.equal(exact.x, 777);
  const result = dispatch(s, { ...exact, player: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.state.stack.at(-1).x, 777);
  assert.equal(result.state.stack.at(-1).castingCost.generic, 777);
  assert.equal(result.state.players[0].mana.U, 223);
  assert.equal(castProblem(s, 0, card.id, null, { x: 1000 }), null);
  assert.ok(castProblem(s, 0, card.id, null, { x: 1001 }));
});
