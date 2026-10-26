import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseBotCommand, ref } from '../packages/engine/src/index.js';
import { move } from '../packages/engine/src/model.js';
import { canPayTargetWard, resolutionRisk } from '../packages/engine/src/decision-safety.js';
import { fixture, put, lands, act, resolve } from '../packages/engine/test/helpers.js';

test('avoid a voluntary spell that loses the player their remaining life', () => {
  const s = fixture();
  s.players[0].life = 2;
  lands(s, 'Swamp', 3);
  put(s, 'Diresight', 0, 'hand');
  assert.notEqual(chooseBotCommand(s, 0).type, 'cast');
});

test('check life at the end of a resolution, not between its instructions', () => {
  const s = fixture();
  s.players[0].life = 1;
  const effects = [
    { op: 'loseLife', amount: 2 },
    { op: 'gainLife', amount: 2 },
  ];
  assert.equal(resolutionRisk(s, 0, effects), null);
});

test('do not choose to draw more cards than remain in the library', () => {
  const s = fixture();
  for (const id of [...s.players[0].library]) move(s, s.objects[id], 'graveyard');
  put(s, 'Island', 0, 'library');
  lands(s, 'Island', 3);
  put(s, 'Divination', 0, 'hand');
  assert.notEqual(chooseBotCommand(s, 0).type, 'cast');
});

test('ward affordability accounts for mana already spent casting the spell', () => {
  const s = fixture();
  lands(s, 'Mountain', 1);
  lands(s, 'Island', 1);
  const target = put(s, 'Waterfall Aerialist', 1);
  const before = JSON.stringify(s);
  assert.equal(canPayTargetWard(s, 0, ref(target), { mana: { R: 1 } }), false);
  assert.equal(JSON.stringify(s), before);
  lands(s, 'Island', 1);
  assert.equal(canPayTargetWard(s, 0, ref(target), { mana: { R: 1 } }), true);
});

test('do not deliberately cast removal into a lethal ward life payment', () => {
  const s = fixture();
  s.players[0].life = 7;
  lands(s, 'Mountain', 1);
  const sire = put(s, 'Sire of Seven Deaths', 1);
  sire.damage = 5;
  put(s, 'Lightning Bolt', 0, 'hand');
  assert.notEqual(chooseBotCommand(s, 0).target?.id, sire.id);
});

test('take a lethal spell before cashing in a mana rock for a card', () => {
  const s = fixture();
  s.players[1].life = 3;
  lands(s, 'Mountain', 5);
  put(s, 'Mind Stone');
  const bolt = put(s, 'Lightning Bolt', 0, 'hand');
  const command = chooseBotCommand(s, 0);
  assert.equal(command.type, 'cast');
  assert.equal(command.card, bolt.id);
  assert.equal(command.target.id, 1);
});

test('deploy a castable landfall creature before the available land drop', () => {
  const s = fixture();
  lands(s, 'Forest', 3);
  const creature = put(s, 'Territorial Scythecat', 0, 'hand');
  put(s, 'Forest', 0, 'hand');
  assert.equal(chooseBotCommand(s, 0).card, creature.id);
});

test('surveil keeps enough cards for the following draw in the same spell', () => {
  let s = fixture();
  for (const id of [...s.players[0].library]) move(s, s.objects[id], 'graveyard');
  put(s, 'Sire of Seven Deaths', 0, 'library');
  put(s, 'Sire of Seven Deaths', 0, 'library');
  put(s, 'Zombify', 0, 'hand');
  lands(s, 'Swamp', 3);
  const spell = put(s, 'Diresight', 0, 'hand');
  s = resolve(act(s, 'cast', { card: spell.id }));
  assert.equal(s.choice.kind, 'libraryOrder');
  const command = chooseBotCommand(s, 0);
  assert.deepEqual(command.rest, []);
  s = act(s, command.type, command);
  assert.equal(s.players[0].failedDraw, false);
});

test('a targeted draw trigger does not choose its controller at lethal life loss', () => {
  let s = fixture();
  s.players[0].life = 1;
  lands(s, 'Swamp', 3);
  const card = put(s, 'Vault Plunderer', 0, 'hand');
  s = resolve(act(s, 'cast', { card: card.id }));
  assert.equal(s.choice.kind, 'triggerTarget');
  assert.equal(chooseBotCommand(s, 0).target.id, 1);
});
