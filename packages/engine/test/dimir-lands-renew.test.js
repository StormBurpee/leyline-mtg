import test from 'node:test';
import assert from 'node:assert/strict';
import { stats, keywords, ref, dispatch, legalActions } from '../src/index.js';
import { definition, move } from '../src/model.js';
import { finishCleanup } from '../src/turn.js';
import { manaOptions } from '../src/mana.js';
import { fixture, put, lands, act, resolve } from './helpers.js';

test('Hidden Lair grants colored mana only on entry turn or with a basic land', () => {
  const s = fixture(),
    lair = put(s, 'Hidden Lair');
  assert.deepEqual(manaOptions(s, lair), ['C', 'U', 'B']);
  s.turn++;
  assert.deepEqual(manaOptions(s, lair), ['C']);
  put(s, 'Restless Reef');
  assert.deepEqual(manaOptions(s, lair), ['C']);
  const basic = put(s, 'Island');
  assert.deepEqual(manaOptions(s, lair), ['C', 'U', 'B']);
  move(s, basic, 'graveyard');
  assert.deepEqual(manaOptions(s, lair), ['C']);
});

test('Restless Reef animates with deathtouch until cleanup and remains a mana source', () => {
  let s = fixture();
  const reef = put(s, 'Restless Reef');
  lands(s, 'Island', 2);
  lands(s, 'Swamp', 2);
  s = act(s, 'activate', { card: reef.id, ability: 0 });
  s = resolve(s);
  assert.equal(stats(s, s.objects[reef.id]).power, 4);
  assert.ok(keywords(s, s.objects[reef.id]).includes('deathtouch'));
  assert.ok(definition(s, s.objects[reef.id]).types.includes('land'));
  finishCleanup(s);
  assert.equal(definition(s, s.objects[reef.id]).type, 'land');
  assert.equal(keywords(s, s.objects[reef.id]).includes('deathtouch'), false);
});

test('Soulstone Sanctuary animation and all creature types persist, but never survive a zone change', () => {
  let s = fixture();
  const stone = put(s, 'Soulstone Sanctuary');
  lands(s, 'Forest', 4);
  s = act(s, 'activate', { card: stone.id, ability: 0 });
  s = resolve(s);
  s.objects[stone.id].plusCounters = 2;
  finishCleanup(s);
  const object = s.objects[stone.id],
    d = definition(s, object);
  assert.equal(d.type, 'creature');
  assert.equal(stats(s, object).power, 5);
  for (const type of ['Ninja', 'Shark', 'Merfolk', 'Rogue']) assert.ok(d.subtypes.includes(type));
  assert.ok(keywords(s, object).includes('vigilance'));
  move(s, object, 'exile');
  move(s, object, 'battlefield');
  assert.equal(definition(s, object).type, 'land');
  assert.equal(keywords(s, object).includes('vigilance'), false);
});

test('Qarsi Renew exiles its source and grants real lasting keyword counters at sorcery speed', () => {
  let s = fixture();
  const q = put(s, 'Qarsi Revenant', 0, 'graveyard'),
    elf = put(s, 'Llanowar Elves');
  lands(s, 'Swamp', 3);
  s.step = 'upkeep';
  assert.equal(
    dispatch(s, { type: 'activate', player: 0, card: q.id, ability: 0, target: ref(elf) }).ok,
    false,
  );
  s.step = 'main1';
  assert.ok(legalActions(s, 0).some((a) => a.card === q.id));
  s = act(s, 'activate', { card: q.id, ability: 0, target: ref(elf) });
  assert.equal(s.objects[q.id].zone, 'exile');
  s = resolve(s);
  finishCleanup(s);
  const target = s.objects[elf.id];
  assert.deepEqual(target.keywordCounters, { flying: 1, deathtouch: 1, lifelink: 1 });
  for (const key of Object.keys(target.keywordCounters))
    assert.ok(keywords(s, target).includes(key));
  move(s, target, 'hand');
  move(s, target, 'battlefield');
  assert.equal(target.keywordCounters, undefined);
});
