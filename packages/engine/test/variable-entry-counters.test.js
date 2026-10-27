import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry, dispatch, manaValue, stats, ref } from '../src/index.js';
import { move, captureDepartureContext, loseLife } from '../src/model.js';
import {
  enterBattlefield,
  enterBattlefieldBatch,
  stabilize,
  resolveEffects,
} from '../src/effects.js';
import { fixture, put, lands, act, resolve } from './helpers.js';

test('X counters exist at entry, without a trigger or priority gap, including under Torpor Orb', () => {
  let s = fixture();
  put(s, 'Torpor Orb');
  const hydra = put(s, 'Goldvein Hydra', 0, 'hand');
  lands(s, 'Forest', 5);
  s = act(s, 'cast', { card: hydra.id, x: 4 });
  assert.equal(manaValue(s.stack.at(-1).sourceDefinition, s.stack.at(-1).x), 5);
  s = resolve(s);
  assert.equal(s.objects[hydra.id].zone, 'battlefield');
  assert.equal(s.objects[hydra.id].plusCounters, 4);
  assert.deepEqual(stats(s, s.objects[hydra.id]), { power: 4, toughness: 4 });
  assert.equal(s.stack.length, 0);
  assert.equal(manaValue(CARDS['Goldvein Hydra']), 1);
});

test('Morlun separately preserves X in entry counters and its lifelink damage trigger', () => {
  let s = fixture();
  const source = put(s, 'Morlun, Devourer of Spiders', 0, 'hand');
  lands(s, 'Swamp', 5);
  s = act(s, 'cast', { card: source.id, x: 3 });
  s = resolve(s);
  assert.equal(s.objects[source.id].plusCounters, 3);
  assert.equal(s.players[1].life, 20);
  s = act(s, 'chooseTriggerTarget', { target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.players[1].life, 17);
  assert.equal(s.players[0].life, 23);
});

test('Pterafractyl zero-X dies before its separate life trigger resolves', () => {
  let s = fixture();
  const source = put(s, 'Pterafractyl', 0, 'hand');
  lands(s, 'Forest', 1);
  lands(s, 'Island', 1);
  s = act(s, 'cast', { card: source.id, x: 0 });
  s = resolve(s);
  assert.equal(s.objects[source.id].zone, 'graveyard');
  assert.equal(s.players[0].life, 20);
  s = resolve(s);
  assert.equal(s.players[0].life, 22);
});

test('noncast reentry uses zero X even when a stale chosenX is present', () => {
  const s = fixture();
  const source = put(s, 'Morlun, Devourer of Spiders', 0, 'exile');
  source.chosenX = 12;
  source.plusCounters = 9;
  enterBattlefield(s, source);
  assert.equal(source.plusCounters, 0);
  assert.equal(s.pendingTriggers[0].x, 0);
});

test('batch entries retain independent X and current existing entry-counter replacement', () => {
  const s = fixture();
  put(s, 'Gev, Scaled Scorch');
  loseLife(s, 1, 1);
  const first = put(s, 'Goldvein Hydra', 0, 'stack');
  const second = put(s, 'Pterafractyl', 0, 'stack');
  first.chosenX = 2;
  second.chosenX = 5;
  enterBattlefieldBatch(s, [{ object: first }, { object: second }]);
  assert.equal(first.plusCounters, 3);
  assert.equal(second.plusCounters, 6);
  assert.equal(s.pendingTriggers.find((t) => t.name === 'Pterafractyl').x, 5);
  stabilize(s);
  assert.equal(first.zone, 'battlefield');
  assert.equal(second.zone, 'battlefield');
});

test('copies preserve entry-counter ability, not chosen X or existing counters', () => {
  const s = fixture();
  put(s, 'Glorious Anthem');
  const source = put(s, 'Goldvein Hydra');
  source.plusCounters = 6;
  source.chosenX = 6;
  resolveEffects(s, {
    controller: 0,
    target: ref(source),
    effects: [{ op: 'copyToken', count: 1 }],
  });
  const token = Object.values(s.objects).find((o) => o.token && o.name === source.name);
  assert.equal(token.plusCounters, 0);
  assert.deepEqual(stats(s, token), { power: 1, toughness: 1 });
});

test('Goldvein death uses prebatch effective power, not counters or a later incarnation', () => {
  let s = fixture();
  const source = put(s, 'Goldvein Hydra');
  const anthem = put(s, 'Glorious Anthem');
  source.plusCounters = 3;
  s.modifiers.push({
    objectId: source.id,
    incarnation: source.incarnation,
    power: 2,
    toughness: 2,
    expires: s.turn,
  });
  const departure = captureDepartureContext(s);
  move(s, anthem, 'graveyard', departure);
  move(s, source, 'graveyard', departure);
  move(s, source, 'battlefield');
  source.plusCounters = 12;
  stabilize(s);
  s = resolve(s);
  const treasure = Object.values(s.objects).filter((o) => o.token && o.name === 'Treasure Token');
  assert.equal(treasure.length, 6);
  assert.ok(treasure.every((o) => o.tapped));
});

test('repeated X charges every printed symbol but creates only X counters', () => {
  let s = fixture();
  s.catalog = createRegistry([
    ...Object.values(CARDS),
    {
      ...CARDS['Goldvein Hydra'],
      name: 'Double X Entry',
      cost: { X: 2, G: 1 },
      triggers: [],
    },
  ]);
  const source = put(s, 'Double X Entry', 0, 'hand');
  lands(s, 'Forest', 4);
  assert.equal(dispatch(s, { type: 'cast', player: 0, card: source.id, x: 2 }).ok, false);
  lands(s, 'Forest', 1);
  s = act(s, 'cast', { card: source.id, x: 2 });
  assert.equal(manaValue(s.stack.at(-1).sourceDefinition, 2), 5);
  s = resolve(s);
  assert.equal(s.objects[source.id].plusCounters, 2);
});

test('entry observers see final X-counter power, not the printed zero power', () => {
  const s = fixture();
  s.catalog = createRegistry([
    ...Object.values(CARDS),
    {
      ...CARDS['Grizzly Bears'],
      name: 'Entry Power Observer',
      triggers: [
        {
          event: { event: 'enter', controller: 'you', filter: { power: { gte: 4 } } },
          effects: [{ op: 'gainLife', amount: 1 }],
        },
      ],
    },
  ]);
  put(s, 'Entry Power Observer');
  const source = put(s, 'Goldvein Hydra', 0, 'stack');
  source.chosenX = 4;
  enterBattlefield(s, source);
  assert.equal(s.pendingTriggers.filter((t) => t.name === 'Entry Power Observer').length, 1);
});
