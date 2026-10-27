import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, ref, stats, keywords, legalActions, chooseBotCommand } from '../src/index.js';
import { move } from '../src/model.js';
import { stabilize } from '../src/effects.js';
import { fixture, put, lands, act, resolve } from './helpers.js';

test('equip uses the stack, grants live bonuses, and re-equipping moves rather than duplicates them', () => {
  let s = fixture();
  lands(s, 'Plains', 3);
  const bow = put(s, 'Short Bow'),
    a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears');
  s = act(s, 'activate', { card: bow.id, ability: 0, target: ref(a) });
  assert.equal(stats(s, s.objects[a.id]).power, 2);
  s = resolve(s);
  assert.deepEqual(stats(s, s.objects[a.id]), { power: 3, toughness: 3 });
  assert.ok(keywords(s, s.objects[a.id]).includes('reach'));
  s = act(s, 'activate', { card: bow.id, ability: 0, target: ref(b) });
  s = resolve(s);
  assert.equal(stats(s, s.objects[a.id]).power, 2);
  assert.equal(stats(s, s.objects[b.id]).power, 3);
  assert.equal(s.objects[bow.id].attachedTo.id, b.id);
});
test('equip cannot target an opponent creature or activate at instant timing', () => {
  const s = fixture();
  lands(s, 'Plains', 3);
  const bow = put(s, 'Short Bow');
  put(s, 'Grizzly Bears');
  const enemy = put(s, 'Grizzly Bears', 1);
  const equips = () => legalActions(s, 0).filter((a) => a.type === 'activate' && a.card === bow.id);
  assert.ok(equips().length);
  assert.ok(equips().every((a) => a.target.id !== enemy.id));
  s.step = 'combat';
  assert.equal(equips().length, 0);
});
test('equipment survives its wearer leaving and cannot follow a new incarnation', () => {
  let s = fixture();
  lands(s, 'Plains', 1);
  const bow = put(s, 'Short Bow'),
    bear = put(s, 'Grizzly Bears');
  s = act(s, 'activate', { card: bow.id, ability: 0, target: ref(bear) });
  s = resolve(s);
  move(s, s.objects[bear.id], 'hand');
  move(s, s.objects[bear.id], 'battlefield');
  stabilize(s);
  assert.equal(s.objects[bow.id].zone, 'battlefield');
  assert.equal(s.objects[bow.id].attachedTo, null);
  assert.equal(stats(s, s.objects[bear.id]).power, 2);
});
test('removing equipment before its equip ability resolves prevents attachment', () => {
  let s = fixture();
  lands(s, 'Plains', 1);
  const bow = put(s, 'Short Bow'),
    bear = put(s, 'Grizzly Bears');
  s = act(s, 'activate', { card: bow.id, ability: 0, target: ref(bear) });
  move(s, s.objects[bow.id], 'hand');
  s = resolve(s);
  assert.equal(stats(s, s.objects[bear.id]).power, 2);
  assert.equal(s.objects[bow.id].attachedTo, null);
});
test('changing wearer controller does not detach equipment or remove its bonus', () => {
  let s = fixture();
  lands(s, 'Plains', 1);
  const bow = put(s, 'Short Bow'),
    bear = put(s, 'Grizzly Bears');
  s = act(s, 'activate', { card: bow.id, ability: 0, target: ref(bear) });
  s = resolve(s);
  s.objects[bear.id].controller = 1;
  stabilize(s);
  assert.equal(s.objects[bow.id].attachedTo.id, bear.id);
  assert.equal(stats(s, s.objects[bear.id]).power, 3);
});
test('typed equip and alternative discard equip retain their separate costs', () => {
  const s = fixture();
  lands(s, 'Plains', 1);
  const cap = put(s, 'Thinking Cap'),
    bear = put(s, 'Grizzly Bears'),
    detective = put(s, 'Novice Inspector'),
    flail = put(s, 'Bloodthorn Flail'),
    fodder = put(s, 'Mountain', 0, 'hand');
  const actions = legalActions(s, 0);
  assert.ok(
    actions.some(
      (a) =>
        a.type === 'activate' &&
        a.card === cap.id &&
        a.ability === 0 &&
        a.target.id === detective.id,
    ),
  );
  assert.ok(
    !actions.some((a) => a.type === 'activate' && a.card === cap.id && a.target.id === bear.id),
  );
  assert.ok(
    actions.some(
      (a) =>
        a.type === 'activate' &&
        a.card === flail.id &&
        a.ability === 1 &&
        a.discardCard === fodder.id,
    ),
  );
});
test('the bot equips a useful item and does not repeatedly pay to equip the same wearer', () => {
  let s = fixture();
  lands(s, 'Plains', 3);
  const bow = put(s, 'Short Bow');
  put(s, 'Grizzly Bears');
  const command = chooseBotCommand(s, 0);
  assert.equal(command.type, 'activate');
  assert.equal(command.card, bow.id);
  s = act(s, command.type, command);
  s = resolve(s);
  assert.notEqual(chooseBotCommand(s, 0)?.type, 'activate');
});
test('equipment ETB attachment resolves with its temporary keyword grant', () => {
  let s = fixture();
  lands(s, 'Plains', 4);
  const armor = put(s, 'Celestial Armor', 0, 'hand'),
    bear = put(s, 'Grizzly Bears');
  s = act(s, 'cast', { card: armor.id });
  s = resolve(s);
  assert.equal(s.choice.kind, 'triggerTarget');
  s = act(s, 'chooseTriggerTarget', { target: ref(s.objects[bear.id]) });
  s = resolve(s);
  assert.equal(s.objects[armor.id].attachedTo.id, bear.id);
  assert.equal(stats(s, s.objects[bear.id]).power, 4);
  assert.ok(keywords(s, s.objects[bear.id]).includes('flying'));
  assert.ok(keywords(s, s.objects[bear.id]).includes('indestructible'));
});
