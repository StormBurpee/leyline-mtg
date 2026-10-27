import { cleanup } from '../src/turn.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { definition, stats, move, copiableDefinition, ref } from '../src/model.js';
import { enterBattlefield } from '../src/effects.js';
import { canAttack } from '../src/combat.js';
import { manaOptions, canTapForMana } from '../src/mana.js';
import { chooseBotCommand } from '../src/bot.js';
import { fixture, put, act, resolve, lands } from './helpers.js';
function setup() {
  const s = fixture(),
    land = put(s, 'Restless Bivouac');
  s.players[0].mana = { W: 10, U: 0, B: 0, R: 10, G: 0, C: 10 };
  return [s, land];
}
function animate(s, land) {
  return resolve(act(s, 'activate', { card: land.id, ability: 0 }));
}
test('Bivouac enters tapped and retains mana abilities while animated', () => {
  let [s, l] = setup();
  move(s, l, 'hand');
  enterBattlefield(s, l, 0);
  assert.equal(l.tapped, true);
  l.tapped = false;
  l.controlledSince = 0;
  s = animate(s, l);
  const d = definition(s, s.objects[l.id]);
  assert.deepEqual(d.types, ['land', 'creature']);
  assert.equal(d.type, 'creature');
  assert.deepEqual(d.color, ['R', 'W']);
  assert.deepEqual(d.subtypes, ['Ox']);
  assert.deepEqual(stats(s, s.objects[l.id]), { power: 2, toughness: 2 });
  assert.deepEqual(manaOptions(s, s.objects[l.id]), ['R', 'W']);
  assert.equal(copiableDefinition(s, s.objects[l.id]).type, 'land');
});
test('base PT animation preserves counters and modifications and repeated activation does not stack', () => {
  let [s, l] = setup();
  l.plusCounters = 2;
  s.modifiers.push({
    objectId: l.id,
    incarnation: l.incarnation,
    power: 3,
    toughness: 1,
    expires: s.turn,
  });
  s = animate(s, l);
  assert.deepEqual(stats(s, s.objects[l.id]), { power: 7, toughness: 5 });
  s = animate(s, l);
  assert.deepEqual(stats(s, s.objects[l.id]), { power: 7, toughness: 5 });
});
test('animation expires and does not follow a new incarnation', () => {
  let [s, l] = setup();
  s = animate(s, l);
  s.turn++;
  assert.equal(definition(s, s.objects[l.id]).type, 'land');
  s.turn--;
  move(s, s.objects[l.id], 'exile');
  enterBattlefield(s, s.objects[l.id], 0);
  assert.equal(definition(s, s.objects[l.id]).type, 'land');
});
test('new land becoming a creature is summoning sick for attacking and mana', () => {
  let [s, l] = setup();
  l.controlledSince = s.turn;
  s = animate(s, l);
  s.step = 'beginCombat';
  assert.equal(canAttack(s, s.objects[l.id], 0), false);
  assert.equal(canTapForMana(s, s.objects[l.id], 0), false);
});
test('attack trigger targets own creature including animated Bivouac', () => {
  let [s, l] = setup();
  s = animate(s, l);
  s.step = 'beginCombat';
  s = act(s, 'pass');
  s = act(s, 'pass');
  assert.equal(s.choice.kind, 'attackers');
  s = act(s, 'attackers', { cards: [l.id] });
  assert.equal(s.choice.kind, 'triggerTarget');
  s = act(s, 'chooseTriggerTarget', { target: ref(s.objects[l.id]) });
  s = resolve(s);
  assert.equal(s.objects[l.id].plusCounters, 1);
});
test('bot animates for combat once rather than wasting repeated activations', () => {
  let [s, l] = setup();
  s.step = 'beginCombat';
  const a = chooseBotCommand(s, 0);
  assert.equal(a.type, 'activate');
  s = animate(s, l);
  assert.notEqual(chooseBotCommand(s, 0)?.type, 'activate');
});
test('normal activation pays mana and may legally tap the land itself', () => {
  let s = fixture();
  const l = put(s, 'Restless Bivouac');
  lands(s, 'Mountain', 1);
  lands(s, 'Plains', 1);
  s = act(s, 'activate', { card: l.id, ability: 0 });
  assert.equal(
    Object.values(s.objects).filter((o) => o.zone === 'battlefield' && o.tapped).length,
    3,
  );
  s = resolve(s);
  assert.equal(s.objects[l.id].tapped, true);
  assert.equal(definition(s, s.objects[l.id]).type, 'creature');
});
test('pending animation cannot affect a returned incarnation', () => {
  let [s, l] = setup();
  s = act(s, 'activate', { card: l.id, ability: 0 });
  move(s, s.objects[l.id], 'exile');
  enterBattlefield(s, s.objects[l.id], 0);
  s = resolve(s);
  assert.equal(definition(s, s.objects[l.id]).type, 'land');
});
test('cleanup removes animation but preserves counters for a later animation', () => {
  let [s, l] = setup();
  l.plusCounters = 2;
  s = animate(s, l);
  cleanup(s);
  assert.equal(definition(s, s.objects[l.id]).type, 'land');
  assert.equal(s.objects[l.id].plusCounters, 2);
  s.step = 'main1';
  s.priority = 0;
  s.players[0].mana = { W: 10, U: 0, B: 0, R: 10, G: 0, C: 10 };
  s = animate(s, l);
  assert.deepEqual(stats(s, s.objects[l.id]), { power: 4, toughness: 4 });
});
