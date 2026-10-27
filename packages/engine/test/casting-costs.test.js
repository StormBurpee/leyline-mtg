import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  castingProfile,
  legalActions,
  ref,
  chooseBotCommand,
} from '../src/index.js';
import { fixture, put, lands, act, resolve } from './helpers.js';

test('target-dependent discounts affect affordability and are locked before resolution', () => {
  let s = fixture();
  lands(s, 'Plains', 2);
  const spell = put(s, 'Luminous Rebuke', 0, 'hand'),
    tapped = put(s, 'Grizzly Bears', 1),
    awake = put(s, 'Grizzly Bears', 1);
  tapped.tapped = true;
  const before = structuredClone(s);
  assert.deepEqual(castingProfile(s, 0, spell, undefined, ref(tapped)).cost, { generic: 1, W: 1 });
  assert.deepEqual(castingProfile(s, 0, spell, undefined, ref(awake)).cost, { generic: 4, W: 1 });
  assert.deepEqual(s, before);
  const casts = legalActions(s, 0).filter((a) => a.type === 'cast' && a.card === spell.id);
  assert.ok(casts.some((a) => a.target.id === tapped.id));
  assert.ok(!casts.some((a) => a.target.id === awake.id));
  s = act(s, 'cast', { card: spell.id, target: ref(tapped) });
  s.objects[tapped.id].tapped = false;
  s = resolve(s);
  assert.equal(s.objects[tapped.id].zone, 'graveyard');
});
test('global taxes and reductions combine without reducing colored requirements', () => {
  const s = fixture();
  put(s, 'Thalia, the Survivor', 1);
  put(s, 'Mocking Sprite');
  put(s, 'Mocking Sprite');
  const spell = put(s, "Dragon's Prey", 0, 'hand'),
    dragon = put(s, 'Shivan Dragon', 1);
  assert.deepEqual(castingProfile(s, 0, spell, undefined, ref(dragon)).cost, { generic: 3, B: 1 });
  const opt = put(s, 'Opt', 0, 'hand');
  assert.deepEqual(castingProfile(s, 0, opt).cost, { U: 1 });
});
test('one tribal reducer applies once to a spell matching both of its alternatives', () => {
  const s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Dual tribe fixture': {
      name: 'Dual tribe fixture',
      type: 'creature',
      cost: { generic: 3, W: 1 },
      power: 1,
      toughness: 1,
      subtypes: ['Kithkin', 'Soldier'],
    },
  });
  put(s, 'Ballyrush Banneret');
  const spell = put(s, 'Dual tribe fixture', 0, 'hand');
  assert.deepEqual(castingProfile(s, 0, spell).cost, { generic: 2, W: 1 });
});
test('affinity is locked before sacrificing a Treasure for mana and does not count the proposed spell', () => {
  let s = fixture();
  lands(s, 'Island', 1);
  put(s, 'Treasure Token');
  put(s, 'Treasure Token');
  put(s, 'Short Bow');
  const spell = put(s, 'Memory Guardian', 0, 'hand');
  assert.deepEqual(castingProfile(s, 0, spell).cost, { generic: 1, U: 1 });
  s = act(s, 'cast', { card: spell.id });
  assert.equal(s.objects[spell.id].zone, 'stack');
  assert.equal(
    Object.values(s.objects).filter((o) => o.name === 'Treasure Token' && o.zone === 'battlefield')
      .length,
    1,
  );
});
test('cost determination removes the proposed card from hand without mutating the real hand', () => {
  const s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Hand discount fixture': {
      name: 'Hand discount fixture',
      type: 'sorcery',
      cost: { generic: 5 },
      effects: [],
      costModifiers: [
        { scope: 'self', change: 'reduce', amount: { kind: 'count', zone: 'hand', player: 'you' } },
      ],
    },
  });
  const spell = put(s, 'Hand discount fixture', 0, 'hand');
  put(s, 'Forest', 0, 'hand');
  put(s, 'Forest', 0, 'hand');
  assert.deepEqual(castingProfile(s, 0, spell).cost, { generic: 3 });
  assert.equal(s.players[0].hand.length, 3);
});
test('additional costs are added before reductions, while cast triggers see printed mana value', () => {
  let s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Mana value witness': {
      name: 'Mana value witness',
      type: 'creature',
      cost: {},
      power: 1,
      toughness: 1,
      triggers: [
        {
          event: { event: 'cast', controller: 'you', filter: { manaValue: { gte: 4 } } },
          effects: [{ op: 'gainLife', amount: 1 }],
        },
      ],
    },
  });
  lands(s, 'Mountain', 4);
  put(s, 'Mana value witness');
  put(s, 'Mocking Sprite');
  const spell = put(s, 'Burst Lightning', 0, 'hand');
  assert.deepEqual(castingProfile(s, 0, spell, 1, { kind: 'player', id: 1 }).cost, {
    R: 1,
    generic: 3,
  });
  s = act(s, 'cast', { card: spell.id, mode: 1, target: { kind: 'player', id: 1 } });
  assert.equal(s.stack.length, 1);
});
test('a heavily discounted spell still triggers its printed-mana-value watcher', () => {
  let s = fixture();
  s.catalog = createRegistry({
    ...CARDS,
    'Cheap large spell': {
      name: 'Cheap large spell',
      type: 'sorcery',
      cost: { generic: 4 },
      effects: [],
      costModifiers: [{ scope: 'self', change: 'reduce', amount: 3 }],
    },
    Witness: {
      name: 'Witness',
      type: 'creature',
      cost: {},
      power: 1,
      toughness: 1,
      triggers: [
        {
          event: { event: 'cast', controller: 'you', filter: { manaValue: { gte: 4 } } },
          effects: [{ op: 'gainLife', amount: 1 }],
        },
      ],
    },
  });
  lands(s, 'Forest', 1);
  put(s, 'Witness');
  const spell = put(s, 'Cheap large spell', 0, 'hand');
  s = act(s, 'cast', { card: spell.id });
  assert.equal(s.stack.length, 2);
  assert.equal(s.stack.at(-1).name, 'Witness');
});
test('opponent-turn discounts do not grant casting permission', () => {
  const s = fixture();
  put(s, 'Geyser Drake');
  const spell = put(s, 'Divination', 0, 'hand');
  assert.deepEqual(castingProfile(s, 0, spell).cost, { generic: 2, U: 1 });
  s.active = 1;
  assert.deepEqual(castingProfile(s, 0, spell).cost, { generic: 1, U: 1 });
  lands(s, 'Island', 4);
  assert.ok(!legalActions(s, 0).some((a) => a.type === 'cast' && a.card === spell.id));
});
test('a creature-spell target makes Out of Air payable at its reduced cost', () => {
  let s = fixture();
  s.active = 1;
  s.priority = 1;
  lands(s, 'Forest', 2, 1);
  lands(s, 'Island', 2);
  const target = put(s, 'Grizzly Bears', 1, 'hand'),
    counter = put(s, 'Out of Air', 0, 'hand');
  s = act(s, 'cast', { card: target.id });
  s = act(s, 'pass');
  const targetRef = { kind: 'stack', id: s.stack[0].id };
  assert.deepEqual(castingProfile(s, 0, s.objects[counter.id], undefined, targetRef).cost, {
    generic: 0,
    U: 2,
  });
  s = act(s, 'cast', { card: counter.id, target: targetRef });
  s = resolve(s);
  assert.equal(s.objects[target.id].zone, 'graveyard');
});
test('a permitted spell owned by the opponent is controlled by its caster on the stack', () => {
  let s = fixture();
  lands(s, 'Forest', 2);
  const spell = put(s, 'Grizzly Bears', 1, 'exile');
  spell.playPermission = { player: 0, turn: s.turn, incarnation: spell.incarnation };
  s = act(s, 'cast', { card: spell.id });
  assert.equal(s.objects[spell.id].owner, 1);
  assert.equal(s.objects[spell.id].controller, 0);
  s = resolve(s);
  assert.equal(s.objects[spell.id].controller, 0);
});
