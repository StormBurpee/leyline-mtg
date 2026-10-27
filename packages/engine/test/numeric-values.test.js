import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry, ref, stats, chooseBotCommand, dispatch } from '../src/index.js';
import { move } from '../src/model.js';
import { resolveEffects, stabilize } from '../src/effects.js';
import { numericValue } from '../src/numeric-values.js';
import { validateNumericValue } from '../src/value-schema.js';
import { searchableCards } from '../src/library-search.js';
import { fixture, put, lands, act, resolve } from './helpers.js';

test('characteristic power and toughness count live state in every zone and exclude no implicit objects', () => {
  const s = fixture(),
    bear = put(s, 'Grizzly Bears'),
    crusader = put(s, 'Crusader of Odric', 0, 'hand');
  assert.deepEqual(stats(s, crusader), { power: 1, toughness: 1 });
  move(s, crusader, 'battlefield');
  assert.equal(stats(s, crusader).power, 2);
  put(s, 'Grizzly Bears');
  assert.equal(stats(s, crusader).power, 3);
  move(s, bear, 'graveyard');
  assert.equal(stats(s, crusader).power, 2);
});
test('library search uses characteristic-defining power rather than the zero placeholder', () => {
  const s = fixture();
  put(s, 'Grizzly Bears');
  put(s, 'Grizzly Bears');
  const card = put(s, 'Crusader of Odric', 0, 'library');
  assert.ok(searchableCards(s, 0, { power: { eq: 2 } }).includes(card.id));
  assert.ok(!searchableCards(s, 0, { power: { eq: 0 } }).includes(card.id));
});
test('self and Aura scaling bonuses remain live while resolved temporary bonuses are fixed', () => {
  let s = fixture();
  lands(s, 'Forest', 4);
  const bear = put(s, 'Grizzly Bears'),
    aura = put(s, 'Blanchwood Armor', 0, 'hand');
  s = act(s, 'cast', { card: aura.id, target: ref(bear) });
  s = resolve(s);
  assert.equal(stats(s, s.objects[bear.id]).power, 6);
  put(s, 'Forest');
  assert.equal(stats(s, s.objects[bear.id]).power, 7);
  const spell = put(s, 'Get a Leg Up', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, target: ref(s.objects[bear.id]) });
  s = resolve(s);
  assert.equal(stats(s, s.objects[bear.id]).power, 8);
  put(s, 'Grizzly Bears');
  assert.equal(stats(s, s.objects[bear.id]).power, 8);
});
test('damage counts lands at resolution, not casting, and a graveyard count counts only matching cards', () => {
  let s = fixture();
  lands(s, 'Mountain', 4);
  const target = put(s, 'Colossal Dreadmaw', 1),
    spell = put(s, 'Rumbling Rockslide', 0, 'hand');
  s = act(s, 'cast', { card: spell.id, target: ref(target) });
  put(s, 'Mountain');
  s = resolve(s);
  assert.equal(s.objects[target.id].damage, 5);
  const drake = put(s, 'Enigma Drake');
  put(s, 'Opt', 0, 'graveyard');
  put(s, 'Grizzly Bears', 0, 'graveyard');
  assert.equal(stats(s, drake).power, 2);
});
test('other-creature counts and sequential effects evaluate at their own instruction boundaries', () => {
  let s = fixture();
  put(s, 'Colossal Dreadmaw');
  const dino = put(s, 'Earthshaker Dreadmaw');
  const before = s.players[0].hand.length;
  resolveEffects(s, {
    controller: 0,
    source: ref(dino),
    effects: CARDS['Earthshaker Dreadmaw'].etb,
  });
  assert.equal(s.players[0].hand.length, before + 1);
  put(s, 'Grizzly Bears', 1);
  put(s, 'Grizzly Bears', 1);
  const enemyLife = s.players[1].life;
  resolveEffects(s, {
    controller: 0,
    target: { kind: 'player', id: 1 },
    effects: CARDS['Villainous Wrath'].effects,
  });
  assert.equal(s.players[1].life, enemyLife - 2);
});
test('numeric data rejects unknown operators, hidden characteristic queries and recursive characteristic dependencies', () => {
  for (const value of [
    { kind: 'eval', code: '1+1' },
    { kind: 'count', zone: 'hand', player: 'opponent', where: { type: 'creature' } },
    { kind: 'count', zone: 'battlefield', player: 'you', where: { power: { gte: 1 } } },
    { kind: 'scale', factor: 1001, value: 1 },
    { kind: 'sum', values: Array(9).fill(1) },
  ])
    assert.ok(validateNumericValue(value).length);
  const s = fixture();
  assert.equal(
    numericValue(s, { kind: 'count', zone: 'hand', player: 'opponent' }, { controller: 0 }),
    s.players[1].hand.length,
  );
});
test('fixed 1/1 offspring copies omit characteristic-defining power and toughness', () => {
  const s = fixture();
  put(s, 'Grizzly Bears');
  const source = put(s, 'Crusader of Odric');
  resolveEffects(s, { controller: 0, source: ref(source), effects: [{ op: 'offspringCopy' }] });
  const token = Object.values(s.objects).find((o) => o.token && o.name === 'Crusader of Odric');
  assert.deepEqual(stats(s, token), { power: 1, toughness: 1 });
  assert.equal(stats(s, source).power, 3);
});
test('the bot evaluates dynamic damage without mutating the position', () => {
  const s = fixture();
  lands(s, 'Mountain', 4);
  put(s, 'Grizzly Bears', 1);
  const spell = put(s, 'Rumbling Rockslide', 0, 'hand'),
    before = structuredClone(s);
  const command = chooseBotCommand(s, 0);
  assert.deepEqual(s, before);
  assert.equal(command.type, 'cast');
  assert.equal(command.card, spell.id);
  assert.ok(dispatch(s, command).ok);
});

test('large dynamic milling is bounded by the library without rejecting a legal high life total', () => {
  const s = fixture();
  s.players[0].life = 2000;
  resolveEffects(s, {
    controller: 0,
    target: { kind: 'player', id: 1 },
    effects: CARDS['Space-Time Anomaly'].effects,
  });
  assert.equal(s.players[1].library.length, 0);
  assert.equal(s.players[1].failedDraw, false);
});
