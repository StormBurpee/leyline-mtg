import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, put, act, lands } from './helpers.js';
import { enterBattlefieldBatch } from '../src/effects.js';
import { playableCards, playerView, move, preparePermanent } from '../src/model.js';
import { legalActions } from '../src/index.js';
import { inspectableCard } from '../../../apps/web/card-inspection.js';
function top(s, name) {
  const o = put(s, name, 0, 'library');
  s.players[0].library = s.players[0].library.filter((id) => id !== o.id);
  s.players[0].library.unshift(o.id);
  return o;
}
test('Chocobo permits top land and Bird casting only, reveals every top card only to its controller', () => {
  let s = fixture();
  const bird = put(s, 'Traveling Chocobo');
  const land = top(s, 'Forest');
  assert.ok(playableCards(s, 0).includes(land.id));
  assert.ok(legalActions(s, 0).some((a) => a.type === 'playLand' && a.card === land.id));
  assert.ok(playerView(s, 0).objects[land.id]);
  assert.equal(playerView(s, 1).objects[land.id], undefined);
  s = act(s, 'playLand', { card: land.id });
  const shock = top(s, 'Shock');
  assert.ok(!playableCards(s, 0).includes(shock.id));
  assert.equal(inspectableCard(s, shock.id, 0).id, shock.id);
  assert.equal(inspectableCard(s, shock.id, 1), null);
  const next = top(s, 'Traveling Chocobo');
  lands(s, 'Forest', 2);
  assert.ok(legalActions(s, 0).some((a) => a.type === 'cast' && a.card === next.id));
  s = act(s, 'cast', { card: next.id });
  assert.equal(s.objects[next.id].zone, 'stack');
  assert.ok(playerView(s, 0).objects[shock.id]);
});
test('additional entry triggers are additive across Chocobos and never override Torpor', () => {
  const s = fixture();
  put(s, 'Traveling Chocobo');
  put(s, 'Traveling Chocobo');
  put(s, 'Mossborn Hydra');
  const land = put(s, 'Forest', 0, 'hand');
  enterBattlefieldBatch(s, [{ object: land }]);
  assert.equal(s.pendingTriggers.length, 3);
  s.pendingTriggers = [];
  put(s, 'Torpor Orb');
  const bird = put(s, 'Traveling Chocobo', 0, 'hand');
  bird.definitionOverride = {
    ...s.catalog['Traveling Chocobo'],
    triggers: [
      { event: { event: 'enter', object: 'source' }, effects: [{ op: 'draw', count: 1 }] },
    ],
  };
  enterBattlefieldBatch(s, [{ object: bird }]);
  assert.equal(s.pendingTriggers.length, 0);
});
test('Chocobo does not duplicate opposing watchers or once-per-turn triggers and top visibility ends immediately', () => {
  const s = fixture(),
    bird = put(s, 'Traveling Chocobo'),
    watch = put(s, 'Mossborn Hydra');
  watch.definitionOverride = {
    ...s.catalog['Mossborn Hydra'],
    triggers: [
      {
        event: { event: 'enter', filter: { type: 'land' } },
        oncePerTurn: true,
        effects: [{ op: 'draw', count: 1 }],
      },
    ],
  };
  const enemy = put(s, 'Mossborn Hydra', 1);
  enemy.definitionOverride = {
    ...watch.definitionOverride,
    triggers: [
      { event: { event: 'enter', filter: { type: 'land' } }, effects: [{ op: 'draw', count: 1 }] },
    ],
  };
  const land = put(s, 'Forest', 0, 'hand');
  enterBattlefieldBatch(s, [{ object: land }]);
  assert.equal(s.pendingTriggers.length, 2);
  const topcard = top(s, 'Shock');
  move(s, bird, 'graveyard');
  assert.equal(playerView(s, 0).objects[topcard.id], undefined);
  assert.equal(inspectableCard(s, topcard.id, 0), null);
});

test('top-library Bird permission does not authorize non-Bird alternate spell characteristics', () => {
  const s = fixture();
  put(s, 'Traveling Chocobo');
  const object = top(s, 'Traveling Chocobo');
  object.definitionOverride = {
    ...s.catalog['Traveling Chocobo'],
    mainName: 'Test Bird',
    adventure: {
      name: 'Not a Bird',
      type: 'instant',
      types: ['instant'],
      cost: { G: 1 },
      keywords: [],
      subtypes: [],
      color: ['G'],
      effects: [],
    },
  };
  lands(s, 'Forest', 5);
  const casts = legalActions(s, 0).filter((a) => a.type === 'cast' && a.card === object.id);
  assert.ok(casts.length);
  assert.ok(casts.every((a) => (a.mode ?? 0) === 0));
  s.castingCompletion = {};
  assert.equal(playerView(s, 0).objects[object.id], undefined);
});
