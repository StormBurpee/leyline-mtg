import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CARDS,
  createRegistry,
  dispatch,
  ref,
  playerView,
  chooseBotCommand,
} from '../packages/engine/src/index.js';
import { move } from '../packages/engine/src/model.js';
import { actionSafe, drawsFor, resolutionRisk } from '../packages/engine/src/decision-safety.js';
import { compileCard } from '../packages/cards/compiler.js';
import { fixture, put, act, resolve } from '../packages/engine/test/helpers.js';
const names = [
  'Abandon Attachments',
  'Unstable Experiment',
  'Red Room Recruit',
  'Patient Instructor',
];
const identities = { 'leyline:token/human-soldier-token': 'Human Soldier Token' };
const sources = names.map((name) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../packages/cards/cards/${name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')}.json`,
        import.meta.url,
      ),
    ),
  ),
);
const definitions = sources.map((source) => {
  const result = compileCard(source, { identities });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result.definition;
});
const catalog = createRegistry({
  ...CARDS,
  ...Object.fromEntries(definitions.map((d) => [d.name, d])),
});
function position(extra = {}) {
  const s = fixture();
  s.catalog = createRegistry({ ...catalog, ...extra });
  s.players[0].mana = { W: 20, U: 20, B: 20, R: 20, G: 20, C: 20 };
  return s;
}
function trimLibrary(s, count, p = 0) {
  for (const id of s.players[p].library.slice(count)) move(s, s.objects[id], 'exile');
}

test('grouped own draw plus connive is unsafe with one card left, but opponent draw is safe', () => {
  const s = position();
  trimLibrary(s, 1);
  const creature = put(s, 'Grizzly Bears');
  const spell = put(s, 'Unstable Experiment', 0, 'hand');
  const action = {
    type: 'cast',
    player: 0,
    card: spell.id,
    targets: { player: [{ kind: 'player', id: 0 }], creature: [ref(creature)] },
  };
  assert.equal(actionSafe(s, 0, action), false);
  assert.equal(actionSafe(playerView(s, 0), 0, action), false);
  action.targets.player = [{ kind: 'player', id: 1 }];
  assert.equal(actionSafe(s, 0, action), true);
  action.targets.creature = [];
  trimLibrary(s, 0);
  assert.equal(
    actionSafe(s, 0, action),
    true,
    'omitted optional connive must not invent an own draw',
  );
});

test('connive draw-risk follows the actual bound creature controller, not the spell controller', () => {
  const name = 'Review borrowed connive';
  const s = position({
    [name]: { name, type: 'sorcery', cost: {}, target: 'creature', effects: [{ op: 'connive' }] },
  });
  trimLibrary(s, 0);
  const enemy = put(s, 'Grizzly Bears', 1);
  const spell = put(s, name, 0, 'hand');
  assert.equal(
    actionSafe(s, 0, { type: 'cast', player: 0, card: spell.id, target: ref(enemy) }),
    true,
  );
  enemy.controller = 0;
  assert.equal(
    actionSafe(s, 0, { type: 'cast', player: 0, card: spell.id, target: ref(enemy) }),
    false,
  );
});

test('serial connives account for each intervening discard before conditional draw bonuses', () => {
  const name = 'Review draw bonus';
  const s = position({
    [name]: { name, type: 'enchantment', cost: {}, drawBonus: { amount: 1, handAtMost: 1 } },
  });
  put(s, name);
  assert.equal(s.players[0].hand.length, 0);
  trimLibrary(s, 3);
  const effects = [
    { op: 'connive', subject: 'source' },
    { op: 'connive', subject: 'source' },
  ];
  assert.equal(drawsFor(effects, 0, null, 0, s), 4);
  assert.equal(resolutionRisk(s, 0, effects), 'library');
});

test('nonland discard still qualifies when graveyard movement is replaced by exile', () => {
  const name = 'Review graveyard exile';
  for (const cardName of ['Red Room Recruit', 'Patient Instructor']) {
    let s = position({
      [name]: { name, type: 'enchantment', cost: {}, exileGraveyardMoves: true },
    });
    put(s, name);
    const creature = put(s, cardName, 0, 'hand');
    const discard = put(s, 'Shock', 0, 'hand');
    s = resolve(act(s, 'cast', { card: creature.id }));
    s = resolve(s);
    s = act(s, 'discardEffect', { cards: [discard.id] });
    assert.equal(s.objects[discard.id].zone, 'exile');
    if (cardName === 'Red Room Recruit') assert.equal(s.objects[creature.id].plusCounters, 1);
    else
      assert.equal(
        Object.values(s.objects).filter(
          (o) => o.zone === 'battlefield' && o.name === 'Human Soldier Token',
        ).length,
        1,
      );
  }
});

test('mixed land creature definitions remain fail-closed rather than being misclassified', () => {
  const name = 'Review land creature';
  assert.throws(
    () =>
      position({
        [name]: {
          name,
          type: 'land',
          types: ['creature', 'land'],
          cost: {},
          power: 1,
          toughness: 1,
        },
      }),
    /unsupported combination/,
  );
});

test('connive after an in-resolution source departure retains the source last controller', () => {
  const name = 'Review returning conniver';
  let s = position({
    [name]: {
      name,
      type: 'creature',
      cost: {},
      power: 1,
      toughness: 1,
      activated: [
        {
          cost: {},
          effects: [
            { op: 'connive', subject: 'source' },
            { op: 'bounce', subject: 'source' },
            { op: 'connive', subject: 'source' },
          ],
        },
      ],
    },
  });
  const source = put(s, name, 0);
  source.controller = 1;
  s.priority = 1;
  const discard1 = put(s, 'Shock', 1, 'hand'),
    discard2 = put(s, 'Shock', 1, 'hand');
  s = resolve(act(s, 'activate', { card: source.id, ability: 0 }));
  assert.equal(s.choice.player, 1);
  s = act(s, 'discardEffect', { cards: [discard1.id] });
  assert.equal(s.objects[source.id].zone, 'hand');
  assert.equal(s.choice.player, 1);
  s = act(s, 'discardEffect', { cards: [discard2.id] });
  assert.equal(s.objects[source.id].plusCounters, 0);
  assert.equal(s.resolving, null);
});

test('nested continuation compilation fails closed on unknown opcodes, fields and grouped connive breadth', () => {
  const base = sources.find((s) => s.name === 'Abandon Attachments');
  for (const malformed of [
    { op: 'madeUp' },
    { op: 'draw', target: 'controller', amount: 1, secret: true },
    { op: 'createToken', token: 'missing', amount: 1 },
  ]) {
    const source = structuredClone(base);
    source.abilities[0].effects[0].then = [malformed];
    assert.equal(compileCard(source, { identities }).ok, false);
  }
  const source = structuredClone(sources.find((s) => s.name === 'Unstable Experiment'));
  source.abilities[0].targetGroups[1].max = 2;
  assert.equal(compileCard(source, { identities }).ok, false);
});

test('optional continuation safety retains grouped draw bindings while the discard is pending', () => {
  const name = 'Review grouped discard continuation';
  let s = position({
    [name]: {
      name,
      type: 'sorcery',
      cost: {},
      targetGroups: [{ id: 'recipient', selector: 'player', min: 1, max: 1 }],
      effects: [
        {
          op: 'discardThen',
          count: 1,
          optional: true,
          then: [{ op: 'draw', count: 2, player: 'target', targetGroup: 'recipient' }],
        },
      ],
    },
  });
  trimLibrary(s, 1);
  put(s, 'Shock', 0, 'hand');
  const spell = put(s, name, 0, 'hand');
  s = resolve(
    act(s, 'cast', { card: spell.id, targets: { recipient: [{ kind: 'player', id: 0 }] } }),
  );
  assert.equal(s.choice.kind, 'discardEffect');
  assert.deepEqual(chooseBotCommand(s, 0).cards, []);
  assert.deepEqual(chooseBotCommand(playerView(s, 0), 0).cards, []);
});
