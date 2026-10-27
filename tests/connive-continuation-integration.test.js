import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  ref,
  chooseBotCommand,
  playerView,
} from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { validateDefinition } from '../packages/engine/src/definition-validation.js';
import { move } from '../packages/engine/src/model.js';
import { fixture, put, act, resolve } from '../packages/engine/test/helpers.js';
const continuation = (then, optional = false) => ({ op: 'discardThen', count: 1, optional, then });
function setup(definitions) {
  const s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    ...Object.fromEntries(definitions.map((d) => [d.name, d])),
  });
  return s;
}
function trim(s, count) {
  for (const id of s.players[0].library.slice(count)) move(s, s.objects[id], 'exile');
}

test('nested discard continuation retains a departed target controller for private library search', () => {
  const card = {
    name: 'Review nested target search',
    type: 'sorcery',
    cost: {},
    target: 'creature',
    effects: [
      { op: 'destroy' },
      continuation([
        continuation([
          {
            op: 'searchLibrary',
            player: 'targetController',
            count: 1,
            where: { type: 'creature' },
            destination: 'hand',
            reveal: true,
          },
        ]),
      ]),
    ],
  };
  let s = setup([card]);
  const target = put(s, 'Grizzly Bears', 0);
  target.controller = 1;
  const first = put(s, 'Shock', 0, 'hand'),
    second = put(s, 'Shock', 0, 'hand'),
    found = put(s, 'Grizzly Bears', 1, 'library');
  const spell = put(s, card.name, 0, 'hand');
  s = resolve(act(s, 'cast', { card: spell.id, target: ref(target) }));
  s = act(s, 'discardEffect', { cards: [first.id] });
  s = act(s, 'discardEffect', { cards: [second.id] });
  assert.equal(s.choice.kind, 'librarySearch');
  assert.equal(s.choice.player, 1);
  assert.equal(playerView(s, 0).choice.kind, 'opponentChoice');
  assert.equal(playerView(s, 0).objects[found.id], undefined);
  s = act(s, 'searchLibrary', { cards: [found.id] });
  assert.equal(s.objects[found.id].zone, 'hand');
  assert.equal(s.resolving, null);
});

test('grouped target-controller damage inside discardThen retains the pre-move controller', () => {
  const card = {
    name: 'Review nested grouped controller',
    type: 'sorcery',
    cost: {},
    targetGroups: [{ id: 'victim', selector: 'creature', min: 1, max: 1 }],
    effects: [
      { op: 'destroy', targetGroup: 'victim' },
      continuation([{ op: 'damageTargetController', amount: 3, targetGroup: 'victim' }]),
    ],
  };
  let s = setup([card]);
  const target = put(s, 'Grizzly Bears', 0);
  target.controller = 1;
  const payment = put(s, 'Shock', 0, 'hand'),
    spell = put(s, card.name, 0, 'hand');
  s = resolve(act(s, 'cast', { card: spell.id, targets: { victim: [ref(target)] } }));
  s = act(s, 'discardEffect', { cards: [payment.id] });
  assert.equal(s.players[1].life, 17);
  assert.equal(s.players[0].life, 20);
});

test('nested linked-exile continuations cannot bypass permanent-source validation', () => {
  for (const wrappers of [1, 2]) {
    let effects = [{ op: 'exileUntilSourceLeaves' }];
    for (let i = 0; i < wrappers; i++) effects = [continuation(effects)];
    const card = {
      name: 'Review illegal linked continuation',
      type: 'instant',
      cost: {},
      target: 'creature',
      effects,
    };
    assert.ok(validateDefinition(card).some((e) => e.includes('linked exile requires')));
    const compiled = compileCard(
      sourceFromDefinition(
        { keywords: [], subtypes: [], color: [], text: '', ...card },
        { id: 'leyline:review/linked-continuation' },
      ),
    );
    assert.equal(compiled.ok, false);
    assert.ok(compiled.diagnostics.some((d) => d.message.includes('linked exile requires')));
  }
});

test('nested land-form continuations cannot bypass sacrifice-mana validation, including Class fragments', () => {
  const abilities = {
    activated: [
      { cost: {}, effects: [continuation([continuation([{ op: 'becomeLand', mana: ['G'] }])])] },
    ],
  };
  const base = {
    name: 'Review illegal land continuation',
    type: 'artifact',
    cost: {},
    mana: ['C'],
    manaSacrifice: true,
    ...abilities,
  };
  assert.ok(validateDefinition(base).some((e) => e.includes('temporary mana grants')));
  const level = {
    ...base,
    type: 'enchantment',
    subtypes: ['Class'],
    activated: undefined,
    classLevels: [
      { level: 2, cost: {}, abilities },
      { level: 3, cost: {}, abilities: { keywords: ['vigilance'] } },
    ],
  };
  delete level.activated;
  assert.ok(validateDefinition(level).some((e) => e.includes('temporary mana grants')));
});

test('optional discard preview applies payment before checking conditional draw bonuses', () => {
  const card = {
    name: 'Review payment bonus',
    type: 'sorcery',
    cost: {},
    effects: [continuation([{ op: 'draw', count: 1 }], true)],
  };
  const bonus = {
    name: 'Review bonus',
    type: 'enchantment',
    cost: {},
    drawBonus: { amount: 1, handAtMost: 0 },
  };
  let s = setup([card, bonus]);
  put(s, bonus.name);
  trim(s, 1);
  put(s, 'Shock', 0, 'hand');
  const spell = put(s, card.name, 0, 'hand');
  s = resolve(act(s, 'cast', { card: spell.id }));
  assert.equal(s.players[0].hand.length, 1);
  assert.deepEqual(chooseBotCommand(s, 0).cards, []);
  assert.deepEqual(chooseBotCommand(playerView(s, 0), 0).cards, []);
});

test('outer optional payment previews mandatory nested continuation draws and life loss', () => {
  for (const effect of [
    { op: 'draw', count: 2 },
    { op: 'loseLife', amount: 20 },
  ]) {
    const card = {
      name: 'Review nested risk',
      type: 'sorcery',
      cost: {},
      effects: [continuation([continuation([effect])], true)],
    };
    let s = setup([card]);
    trim(s, 1);
    put(s, 'Shock', 0, 'hand');
    put(s, 'Shock', 0, 'hand');
    const spell = put(s, card.name, 0, 'hand');
    s = resolve(act(s, 'cast', { card: spell.id }));
    assert.deepEqual(chooseBotCommand(s, 0).cards, []);
  }
});

test('impossible mandatory discard does not invent its nested draw, and optional inner payment can be declined later', () => {
  for (const inner of [
    continuation([{ op: 'draw', count: 2 }]),
    continuation([{ op: 'draw', count: 2 }], true),
  ]) {
    const card = {
      name: 'Review impossible nested risk',
      type: 'sorcery',
      cost: {},
      effects: [continuation([inner], true)],
    };
    let s = setup([card]);
    trim(s, 0);
    put(s, 'Shock', 0, 'hand');
    const spell = put(s, card.name, 0, 'hand');
    s = resolve(act(s, 'cast', { card: spell.id }));
    const command = chooseBotCommand(s, 0);
    assert.equal(command.cards.length, 1);
    s = act(s, 'discardEffect', command);
    assert.equal(s.status, 'playing');
    assert.equal(s.choice, null);
  }
});

test('an optional inner discard remains a separate safe choice rather than a promised continuation', () => {
  const inner = continuation([{ op: 'draw', count: 2 }], true);
  const card = {
    name: 'Review separate inner choice',
    type: 'sorcery',
    cost: {},
    effects: [continuation([inner], true)],
  };
  let s = setup([card]);
  trim(s, 0);
  put(s, 'Shock', 0, 'hand');
  put(s, 'Shock', 0, 'hand');
  const spell = put(s, card.name, 0, 'hand');
  s = resolve(act(s, 'cast', { card: spell.id }));
  const outer = chooseBotCommand(s, 0);
  assert.equal(outer.cards.length, 1);
  s = act(s, 'discardEffect', outer);
  assert.equal(s.choice.kind, 'discardEffect');
  const next = chooseBotCommand(s, 0);
  assert.deepEqual(next.cards, []);
  s = act(s, 'discardEffect', next);
  assert.equal(s.status, 'playing');
  assert.equal(s.choice, null);
});
