import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry, dispatch, ref, targetsFor, hasKeyword } from '../src/index.js';
import { move } from '../src/model.js';
import { fixture, put, lands, act, resolve } from './helpers.js';

test('Sign in Blood draws and loses life for its selected player', () => {
  let s = fixture();
  lands(s, 'Swamp', 2);
  const card = put(s, 'Sign in Blood', 0, 'hand'),
    before = s.players[1].hand.length;
  s = resolve(act(s, 'cast', { card: card.id, target: { kind: 'player', id: 1 } }));
  assert.equal(s.players[1].hand.length, before + 2);
  assert.equal(s.players[1].life, 18);
  assert.equal(s.players[0].life, 20);
});
test('Burglar Rat pauses resolution for the opponent’s discard without passing priority', () => {
  let s = fixture();
  lands(s, 'Swamp', 2);
  const choiceCard = put(s, 'Forest', 1, 'hand'),
    rat = put(s, 'Burglar Rat', 0, 'hand');
  s = resolve(act(s, 'cast', { card: rat.id }));
  s = resolve(s);
  assert.equal(s.choice.kind, 'discardEffect');
  assert.equal(s.choice.player, 1);
  assert.equal(dispatch(s, { type: 'pass', player: 0 }).ok, false);
  s = act(s, 'discardEffect', { cards: [choiceCard.id] });
  assert.equal(s.objects[choiceCard.id].zone, 'graveyard');
  assert.equal(s.resolving, null);
});
test('life loss is not damage and does not apply the source’s lifelink', () => {
  let s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Drain fixture': {
      name: 'Drain fixture',
      type: 'creature',
      cost: {},
      power: 1,
      toughness: 1,
      keywords: ['lifelink'],
      triggers: [
        { event: 'selfEnters', effects: [{ op: 'loseLife', amount: 2, player: 'opponent' }] },
      ],
    },
  });
  const card = put(s, 'Drain fixture', 0, 'hand');
  s = resolve(act(s, 'cast', { card: card.id }));
  s = resolve(s);
  assert.equal(s.players[1].life, 18);
  assert.equal(s.players[0].life, 20);
  assert.equal(
    s.events.some((e) => e.type === 'damage'),
    false,
  );
});
test('Recover returns an owned graveyard creature and then draws; other owners are not legal', () => {
  let s = fixture();
  lands(s, 'Swamp', 3);
  const own = put(s, 'Raging Goblin', 0, 'graveyard'),
    other = put(s, 'Raging Goblin', 1, 'graveyard'),
    spell = put(s, 'Recover', 0, 'hand');
  assert.equal(
    dispatch(s, { type: 'cast', player: 0, card: spell.id, target: ref(other) }).ok,
    false,
  );
  s = resolve(act(s, 'cast', { card: spell.id, target: ref(own) }));
  assert.equal(s.objects[own.id].zone, 'hand');
  assert.equal(s.players[0].hand.length, 2);
});
test('Zombify creates a new permanent incarnation and queues its enters ability', () => {
  let s = fixture();
  lands(s, 'Swamp', 4);
  const mage = put(s, 'Exclusion Mage', 0, 'graveyard'),
    enemy = put(s, 'Grizzly Bears', 1),
    spell = put(s, 'Zombify', 0, 'hand');
  const incarnation = mage.incarnation;
  s = resolve(act(s, 'cast', { card: spell.id, target: ref(mage) }));
  assert.equal(s.objects[mage.id].zone, 'battlefield');
  assert.equal(s.objects[mage.id].incarnation, incarnation + 1);
  assert.equal(s.choice.kind, 'triggerTarget');
  s = act(s, 'chooseTriggerTarget', { target: ref(enemy) });
  s = resolve(s);
  assert.equal(s.objects[enemy.id].zone, 'hand');
});
test('exiling a graveyard target in response makes recovery fail without drawing', () => {
  let s = fixture();
  lands(s, 'Swamp', 3);
  lands(s, 'Island', 2, 1);
  const target = put(s, 'Raging Goblin', 0, 'graveyard'),
    spell = put(s, 'Recover', 0, 'hand'),
    heirloom = put(s, 'Honored Heirloom', 1);
  s = act(s, 'cast', { card: spell.id, target: ref(target) });
  s = act(s, 'pass');
  s = act(s, 'activate', { card: heirloom.id, ability: 0, target: ref(target) });
  s = resolve(s);
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'exile');
  assert.equal(s.players[0].hand.length, 0);
});
test('exile removes an indestructible permanent without treating it as destruction', () => {
  let s = fixture();
  lands(s, 'Forest', 3);
  const target = put(s, 'Darksteel Ingot', 1),
    spell = put(s, 'Fade into Antiquity', 0, 'hand');
  assert.equal(hasKeyword(s, target, 'indestructible'), true);
  s = resolve(act(s, 'cast', { card: spell.id, target: ref(target) }));
  assert.equal(s.objects[target.id].zone, 'exile');
});
test('hexproof does not restrict selecting creature cards in a graveyard', () => {
  let s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    Shield: {
      name: 'Shield',
      type: 'creature',
      cost: {},
      power: 1,
      toughness: 1,
      keywords: ['hexproof', 'shroud'],
    },
  });
  const target = put(s, 'Shield', 1, 'graveyard');
  assert.deepEqual(targetsFor(s, { scope: 'graveyard', where: { type: 'creature' } }, 0), [
    ref(target),
  ]);
});

test('ward does not trigger for a targeted card in a graveyard', () => {
  let s = fixture();
  lands(s, 'Island', 2);
  const source = put(s, 'Honored Heirloom'),
    target = put(s, 'Sire of Seven Deaths', 1, 'graveyard');
  s = act(s, 'activate', { card: source.id, ability: 0, target: ref(target) });
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'exile');
  assert.equal(s.choice, null);
});
