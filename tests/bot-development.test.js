import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseBotCommand } from '../packages/engine/src/index.js';
import { fixture, put, lands } from '../packages/engine/test/helpers.js';

test('land sequencing chooses the color that unlocks immediate lethal', () => {
  const s = fixture();
  s.players[1].life = 2;
  put(s, 'Island', 0, 'hand');
  const mountain = put(s, 'Mountain', 0, 'hand');
  put(s, 'Shock', 0, 'hand');
  const before = structuredClone(s);
  assert.equal(chooseBotCommand(s, 0).card, mountain.id);
  assert.deepEqual(s, before);
});

test('an untapped land takes precedence over a tapped dual when it enables a play', () => {
  const s = fixture();
  put(s, 'Bloodfell Caves', 0, 'hand');
  const mountain = put(s, 'Mountain', 0, 'hand');
  put(s, 'Monastery Swiftspear', 0, 'hand');
  assert.equal(chooseBotCommand(s, 0).card, mountain.id);
});

test('choose a new color rather than duplicating a source that already works', () => {
  const s = fixture();
  lands(s, 'Forest', 1);
  put(s, 'Forest', 0, 'hand');
  const mountain = put(s, 'Mountain', 0, 'hand');
  put(s, 'Llanowar Elves', 0, 'hand');
  put(s, 'Shock', 0, 'hand');
  assert.equal(chooseBotCommand(s, 0).card, mountain.id);
});

test('when neither land unlocks a play, develop the colors needed by the known hand', () => {
  const s = fixture();
  put(s, 'Mountain', 0, 'hand');
  const swamp = put(s, 'Swamp', 0, 'hand');
  put(s, 'Sign in Blood', 0, 'hand');
  assert.equal(chooseBotCommand(s, 0).card, swamp.id);
});

test('use a tapped dual early if neither land enables an immediate action', () => {
  const s = fixture();
  put(s, 'Mountain', 0, 'hand');
  const caves = put(s, 'Bloodfell Caves', 0, 'hand');
  put(s, 'Sign in Blood', 0, 'hand');
  assert.equal(chooseBotCommand(s, 0).card, caves.id);
});

test('land preference ignores the opposing hand and both library orders', () => {
  const s = fixture();
  put(s, 'Island', 0, 'hand');
  put(s, 'Mountain', 0, 'hand');
  put(s, 'Shock', 0, 'hand');
  const before = chooseBotCommand(s, 0);
  put(s, 'Sire of Seven Deaths', 1, 'hand');
  s.players[0].library.reverse();
  s.players[1].library.reverse();
  assert.deepEqual(chooseBotCommand(s, 0), before);
});

function makeIndestructible(s, object) {
  s.modifiers.push({
    objectId: object.id,
    incarnation: object.incarnation,
    power: 0,
    toughness: 0,
    keywords: ['indestructible'],
    expires: s.turn,
  });
}

test('use nonlethal Boltwave as pressure instead of treating it as unplayable', () => {
  const s = fixture();
  lands(s, 'Mountain', 1);
  const wave = put(s, 'Boltwave', 0, 'hand');
  const command = chooseBotCommand(s, 0);
  assert.equal(command.type, 'cast');
  assert.equal(command.card, wave.id);
});

test('damage removal does not mistake indestructible for a profitable kill', () => {
  const s = fixture();
  lands(s, 'Mountain', 1);
  put(s, 'Shock', 0, 'hand');
  const bears = put(s, 'Grizzly Bears', 1);
  makeIndestructible(s, bears);
  assert.deepEqual(chooseBotCommand(s, 0).target, { kind: 'player', id: 1 });
});

test('hold destroy removal when the only opposing creature is indestructible', () => {
  const s = fixture();
  lands(s, 'Swamp', 2);
  put(s, 'Fell', 0, 'hand');
  const bears = put(s, 'Grizzly Bears', 1);
  makeIndestructible(s, bears);
  assert.equal(chooseBotCommand(s, 0).type, 'pass');
});

test('bounce remains useful against indestructible', () => {
  const s = fixture();
  lands(s, 'Island', 1);
  put(s, 'Unsummon', 0, 'hand');
  const bears = put(s, 'Grizzly Bears', 1);
  makeIndestructible(s, bears);
  assert.equal(chooseBotCommand(s, 0).target.id, bears.id);
});
