import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, playerView, chooseBotCommand, CARDS, createRegistry } from '../src/index.js';
import { fixture, put, act, resolve } from './helpers.js';
import { loseLife } from '../src/model.js';
const castVitriol = (s) => {
  put(s, 'Swamp');
  put(s, 'Mountain');
  const spell = put(s, 'Stinging Vitriol', 0, 'hand');
  return resolve(act(s, 'cast', { card: spell.id, target: { kind: 'player', id: 1 } }));
};
test('Vitriol deals damage then reveals hand and forces a nonland choice', () => {
  let s = fixture();
  const card = put(s, 'Hired Claw', 1, 'hand'),
    land = put(s, 'Mountain', 1, 'hand');
  assert.equal(playerView(s, 0).objects[card.id], undefined);
  s = castVitriol(s);
  assert.equal(s.players[1].life, 18);
  assert.equal(s.choice.kind, 'revealDiscard');
  assert.equal(playerView(s, 0).objects[card.id].name, 'Hired Claw');
  assert.equal(playerView(s, 0).objects[land.id].name, 'Mountain');
  for (const choice of [null, land.id, 'missing'])
    assert.equal(dispatch(s, { type: 'chooseResolutionCard', player: 0, card: choice }).ok, false);
  assert.equal(chooseBotCommand(s, 0).card, card.id);
  s = act(s, 'chooseResolutionCard', { card: card.id });
  assert.equal(s.objects[card.id].zone, 'graveyard');
  assert.equal(s.choice, null);
  assert.equal(playerView(s, 0).objects[land.id], undefined);
});
test('all-land and empty hands allow only a no-card confirmation, without exile fallback', () => {
  for (const lands of [0, 2]) {
    let s = fixture();
    for (let i = 0; i < lands; i++) put(s, 'Forest', 1, 'hand');
    s = castVitriol(s);
    assert.deepEqual(s.choice.eligibleCards, []);
    assert.equal(chooseBotCommand(s, 0).card, null);
    s = act(s, 'chooseResolutionCard', { card: null });
    assert.equal(s.choice, null);
    assert.equal(s.players[1].hand.length, lands);
  }
});
const warlockTrigger = (s) => {
  for (let i = 0; i < 3; i++) put(s, 'Swamp');
  const card = put(s, 'Thought-Stalker Warlock', 0, 'hand');
  s = resolve(act(s, 'cast', { card: card.id }));
  assert.equal(s.choice.kind, 'triggerTarget');
  return act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
};
test('Warlock chooses its branch during resolution and retains the opponent target', () => {
  let s = fixture();
  const enemy = put(s, 'Hired Claw', 1, 'hand');
  s = warlockTrigger(s);
  loseLife(s, 1, 1);
  s = resolve(s);
  assert.equal(s.choice.kind, 'revealDiscard');
  assert.equal(s.choice.player, 0);
  s = act(s, 'chooseResolutionCard', { card: enemy.id });
  assert.equal(s.objects[enemy.id].zone, 'graveyard');
});
test('Warlock without lost life lets the opponent choose their discard, including a land', () => {
  let s = fixture();
  const land = put(s, 'Forest', 1, 'hand');
  put(s, 'Hired Claw', 1, 'hand');
  s = resolve(warlockTrigger(s));
  assert.equal(s.choice.kind, 'discardEffect');
  assert.equal(s.choice.player, 1);
  assert.equal(playerView(s, 0).objects[land.id], undefined);
  s = act(s, 'discardEffect', { cards: [land.id] });
  assert.equal(s.objects[land.id].zone, 'graveyard');
});
test('reveal discard rejects non-player targeting definitions', () => {
  assert.throws(
    () =>
      createRegistry({
        ...CARDS,
        Broken: {
          name: 'Broken',
          type: 'sorcery',
          cost: {},
          target: 'creature',
          effects: [{ op: 'revealDiscard' }],
        },
      }),
    /player target/,
  );
});
