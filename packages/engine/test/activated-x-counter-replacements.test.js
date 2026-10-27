import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CARDS, createRegistry, dispatch, stats } from '../src/index.js';
import { move } from '../src/model.js';
import { compileCard } from '../../cards/compiler.js';
import { fixture, put, lands, act, resolve } from './helpers.js';

const slugs = [
  'caradora-heart-of-alacria',
  'michelangelo-weirdness-to-11',
  'yoshimaru-beloved-companion',
  'stature-size-shifter',
  'mindspring-merfolk',
];
const cards = slugs.map((slug) => {
  const source = JSON.parse(
    fs.readFileSync(new URL(`../../cards/cards/${slug}.json`, import.meta.url)),
  );
  const result = compileCard(source, {
    identities: { 'leyline:token/mutagen-token': 'Mutagen Token' },
  });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.definition;
});
const [caradora, mike, dog, stature, merfolk] = cards.map((card) => card.name);
function setup() {
  const s = fixture();
  s.catalog = createRegistry({ ...CARDS, ...Object.fromEntries(cards.map((d) => [d.name, d])) });
  for (const name of [caradora, mike, dog]) put(s, name);
  return s;
}

test('combined: Stature keeps paid X independent of additive replacements, including zero', () => {
  for (const x of [0, 3]) {
    let s = setup();
    const source = put(s, stature);
    source.enteredTurn = s.turn;
    lands(s, 'Island', x + 1);
    s = act(s, 'activate', { card: source.id, ability: 0, x });
    assert.equal(s.stack.at(-1).x, x);
    assert.deepEqual(s.stack.at(-1).activationCost.mana, { U: 1, generic: x });
    s = resolve(s);
    assert.equal(s.objects[source.id].plusCounters, x === 0 ? 0 : x + 3);
    assert.equal(stats(s, s.objects[source.id]).power, x === 0 ? 1 : x + 4);
    assert.equal(
      dispatch(s, { type: 'activate', player: 0, card: source.id, ability: 0, x: 0 }).ok,
      false,
    );
  }
});

test('combined: Stature activation controller does not select the counter-replacement controller', () => {
  let s = setup();
  put(s, dog, 1);
  const source = put(s, stature);
  lands(s, 'Island', 5);
  s = act(s, 'activate', { card: source.id, ability: 0, x: 2 });
  s.objects[source.id].controller = 1;
  assert.equal(s.stack.at(-1).controller, 0);
  s = resolve(s);
  assert.equal(
    s.objects[source.id].plusCounters,
    3,
    'only opponent Yoshimaru affects the newly stolen recipient',
  );
});

test('combined: Stature X cannot place counters on a returned incarnation', () => {
  let s = setup();
  const source = put(s, stature);
  lands(s, 'Island', 5);
  s = act(s, 'activate', { card: source.id, ability: 0, x: 3 });
  const old = s.stack.at(-1).source.incarnation;
  move(s, s.objects[source.id], 'hand');
  move(s, s.objects[source.id], 'battlefield');
  assert.notEqual(s.objects[source.id].incarnation, old);
  s = resolve(s);
  assert.equal(s.objects[source.id].plusCounters, 0);
});

test('combined: Mindspring draws exactly X but its fixed Merfolk counter event exists at X zero', () => {
  for (const x of [0, 2]) {
    let s = setup();
    const source = put(s, merfolk);
    const other = put(s, merfolk);
    const enemy = put(s, merfolk, 1);
    const bear = put(s, 'Grizzly Bears');
    lands(s, 'Island', x + 2);
    const hand = s.players[0].hand.length;
    s = resolve(act(s, 'activate', { card: source.id, ability: 0, x }));
    assert.equal(s.players[0].hand.length, hand + x);
    for (const own of [source, other]) assert.equal(s.objects[own.id].plusCounters, 4);
    for (const excluded of [enemy, bear]) assert.equal(s.objects[excluded.id].plusCounters, 0);
    assert.equal(
      dispatch(s, { type: 'activate', player: 0, card: source.id, ability: 0, x: 0 }).ok,
      false,
    );
  }
});

test('combined: Mindspring source departure retains X draw and uses only live replacement sources', () => {
  let s = setup();
  const source = put(s, merfolk);
  const other = put(s, merfolk);
  const replacement = Object.values(s.objects).find(
    (o) => o.name === caradora && o.zone === 'battlefield',
  );
  lands(s, 'Island', 4);
  const hand = s.players[0].hand.length;
  s = act(s, 'activate', { card: source.id, ability: 0, x: 2 });
  move(s, s.objects[source.id], 'graveyard');
  move(s, s.objects[replacement.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.players[0].hand.length, hand + 2);
  assert.equal(s.objects[other.id].plusCounters, 3);
  assert.equal(s.objects[source.id].plusCounters, 0);
});
