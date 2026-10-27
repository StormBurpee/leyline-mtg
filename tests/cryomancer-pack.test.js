import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CARDS,
  chooseBotCommand,
  dispatch,
  legalActions,
  ref,
  createRegistry,
  createGame,
  exportReplay,
  replay,
} from '../packages/engine/src/index.js';
import { move } from '../packages/engine/src/model.js';
import { fixture, put, lands, act, resolve } from '../packages/engine/test/helpers.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
const name = 'Seasoned Cryomancer';
function enter() {
  let s = fixture();
  lands(s, 'Island', 3);
  const card = put(s, name, 0, 'hand');
  s = act(s, 'cast', { card: card.id });
  s = resolve(s);
  assert.equal(s.stack.at(-1).name, name);
  assert.equal(s.stack.at(-1).targetKind, undefined);
  return [s, card];
}
test('Cryomancer source compiles and round trips both complete abilities', () => {
  const source = JSON.parse(
    readFileSync(new URL('../packages/cards/cards/seasoned-cryomancer.json', import.meta.url)),
  );
  const result = compileCard(source);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const round = compileCard(sourceFromDefinition(CARDS[name], { id: source.id }));
  assert.equal(round.ok, true, JSON.stringify(round.diagnostics));
  assert.deepEqual(round.definition, result.definition);
  assert.equal(CARDS[name].activated[0].zone, 'graveyard');
});
test('draw/discard precedes separate reflexive targets and stack responses; departed source is retained', () => {
  let [s, card] = enter();
  const a = put(s, 'Grizzly Bears', 1),
    b = put(s, 'Grizzly Bears', 1);
  const first = put(s, 'Opt', 0, 'hand'),
    second = put(s, 'Shock', 0, 'hand');
  const sourceRef = structuredClone(s.stack.at(-1).source);
  move(s, s.objects[card.id], 'graveyard');
  const before = s.players[0].hand.length;
  s = resolve(s);
  assert.equal(s.players[0].hand.length, before + 2);
  assert.equal(s.choice.kind, 'discardEffect');
  assert.equal(s.stack.length, 0);
  s = act(s, 'discardEffect', { cards: [first.id, second.id] });
  assert.equal(s.choice.kind, 'triggerTargets');
  assert.equal(s.choice.entry.targetGroups[0].max, 2);
  assert.deepEqual(s.choice.entry.source, sourceRef);
  assert.equal(s.objects[a.id].tapped, false);
  const bot = chooseBotCommand(s, 0);
  assert.equal(bot.type, 'chooseTriggerTargets');
  assert.equal(bot.targets.chosen.length, 2);
  assert.ok(bot.targets.chosen.every((target) => [a.id, b.id].includes(target.id)));
  const illegal = dispatch(s, {
    type: 'chooseTriggerTargets',
    player: 0,
    targets: { chosen: [ref(a), ref(a)] },
  });
  assert.equal(illegal.ok, false);
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [ref(a), ref(b)] } });
  assert.equal(s.stack.length, 1);
  assert.equal(s.objects[a.id].stunCounters, undefined);
  // Opponent can act before this trigger resolves; one departed target doesn't
  // prevent the other legal target receiving its tap and stun counter.
  move(s, s.objects[a.id], 'hand');
  s = resolve(s);
  assert.equal(s.objects[a.id].stunCounters, undefined);
  assert.equal(s.objects[b.id].tapped, true);
  assert.equal(s.objects[b.id].stunCounters, 1);
});
test('only nonland discards count, zero targets is allowed, and land-only discards do not trigger', () => {
  for (const nonlands of [0, 1]) {
    let [s] = enter();
    const a = put(s, nonlands ? 'Opt' : 'Island', 0, 'hand');
    const b = put(s, 'Island', 0, 'hand');
    s = resolve(s);
    s = act(s, 'discardEffect', { cards: [a.id, b.id] });
    if (nonlands) {
      assert.equal(s.choice.kind, 'triggerTargets');
      assert.equal(s.choice.entry.targetGroups[0].max, 1);
      s = act(s, 'chooseTriggerTargets', { targets: { chosen: [] } });
      s = resolve(s);
    }
    assert.equal(s.choice, null);
    assert.equal(s.stack.length, 0);
  }
});
test('graveyard activation is owner-only, instant-speed, exiles as a cost, and draws after source departure', () => {
  let s = fixture();
  lands(s, 'Island', 5);
  const card = put(s, name, 0, 'graveyard');
  s.objects[card.id].controller = 1;
  s.active = 1;
  s.step = 'end';
  const command = legalActions(s, 0).find((a) => a.type === 'activate' && a.card === card.id);
  assert.ok(command);
  assert.equal(chooseBotCommand(s, 0).type, 'activate');
  const before = s.players[0].hand.length;
  s = act(s, 'activate', command);
  assert.equal(s.objects[card.id].zone, 'exile');
  assert.equal(s.stack.at(-1).controller, 0);
  assert.equal(s.players[0].hand.length, before);
  assert.ok(!legalActions(s, 0).some((a) => a.type === 'activate' && a.card === card.id));
  s = resolve(s);
  assert.equal(s.players[0].hand.length, before + 2);
  assert.equal(s.objects[card.id].zone, 'exile');
});
test('graveyard ability cannot activate on battlefield, for opponent, or without paying full cost', () => {
  for (const [zone, owner, count] of [
    ['battlefield', 0, 5],
    ['graveyard', 1, 5],
    ['graveyard', 0, 4],
  ]) {
    const s = fixture();
    lands(s, 'Island', count);
    const card = put(s, name, owner, zone);
    assert.equal(dispatch(s, { type: 'activate', player: 0, card: card.id, ability: 0 }).ok, false);
    assert.equal(s.objects[card.id].zone, zone);
    assert.equal(s.stack.length, 0);
  }
});
test('bounded reflexive instruction and graveyard cost combinations fail closed', () => {
  for (const changes of [
    { activated: [{ ...CARDS[name].activated[0], zone: 'exile' }] },
    { activated: [{ ...CARDS[name].activated[0], cost: { tap: true, exileSelf: true } }] },
    { activated: [{ ...CARDS[name].activated[0], cost: { sacrificeSelf: true } }] },
    {
      etb: [
        {
          op: 'discardTrigger',
          count: 17,
          where: { not: { type: 'land' } },
          selector: 'creature',
          effects: [],
        },
      ],
    },
  ])
    assert.throws(() => createRegistry({ ...CARDS, [name]: { ...CARDS[name], ...changes } }));
});

test('discard choice, reflexive targets and graveyard activation replay deterministically', () => {
  // A cost-free fixture isolates replay plumbing without synthesizing mutations.
  const catalog = {
    ...CARDS,
    [name]: {
      ...CARDS[name],
      cost: {},
      activated: [{ ...CARDS[name].activated[0], cost: { exileSelf: true } }],
    },
  };
  let s, copies;
  for (let seed = 1; seed < 200; seed++) {
    s = createGame({
      catalog,
      mulligan: false,
      seed,
      decks: [[...Array(4).fill(name), ...Array(56).fill('Island')], Array(60).fill('Forest')],
    });
    copies = s.players[0].hand.filter((id) => s.objects[id].name === name);
    if (copies.length >= 2) break;
  }
  assert.ok(copies.length >= 2);
  while (s.step !== 'main1') s = act(s, 'pass');
  s = act(s, 'cast', { card: copies[0] });
  s = resolve(s);
  s = resolve(s);
  assert.equal(s.choice.kind, 'discardEffect');
  assert.deepEqual(replay(exportReplay(s)), s);
  s = act(s, 'discardEffect', {
    cards: [copies[1], s.players[0].hand.find((id) => s.objects[id].name === 'Island')],
  });
  assert.equal(s.choice.kind, 'triggerTargets');
  assert.deepEqual(replay(exportReplay(s)), s);
  s = act(s, 'chooseTriggerTargets', { targets: { chosen: [] } });
  s = resolve(s);
  s = act(s, 'activate', { card: copies[1], ability: 0 });
  assert.equal(s.objects[copies[1]].zone, 'exile');
  assert.deepEqual(replay(exportReplay(s)), s);
  s = resolve(s);
  assert.deepEqual(replay(exportReplay(s)), s);
});
