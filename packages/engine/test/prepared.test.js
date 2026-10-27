import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, put, lands, act, resolve } from './helpers.js';
import { enterBattlefieldBatch, stabilize } from '../src/effects.js';
import { move, definition, playableCards, preparePermanent } from '../src/model.js';
import { legalActions, createGame, dispatch, exportReplay, replay } from '../src/index.js';
const name = 'Carnivorous Cultivator // Enroot';
function enter(s) {
  const o = put(s, name, 0, 'hand');
  enterBattlefieldBatch(s, [{ object: o }]);
  return o;
}
test('enters prepared is replacement not trigger, copy lives in exile and requires normal mana/timing', () => {
  let s = fixture();
  put(s, 'Torpor Orb');
  const o = enter(s),
    copy = s.objects[o.preparedCopy.id];
  assert.equal(copy.name, 'Enroot');
  assert.equal(copy.zone, 'exile');
  assert.equal(definition(s, o).name, 'Carnivorous Cultivator');
  stabilize(s);
  assert.ok(s.objects[copy.id]);
  assert.equal(s.pendingTriggers.length, 0);
  assert.ok(playableCards(s, 0).includes(copy.id));
  assert.ok(!legalActions(s, 0).some((a) => a.type === 'cast' && a.card === copy.id));
  lands(s, 'Forest', 1);
  assert.ok(legalActions(s, 0).some((a) => a.type === 'cast' && a.card === copy.id));
  s = act(s, 'cast', { card: copy.id });
  assert.equal(s.objects[o.id].zone, 'battlefield');
  assert.equal(s.objects[o.id].preparedCopy, undefined);
  assert.equal(s.stack.at(-1).name, 'Enroot');
  s = resolve(s);
  assert.equal(s.choice.kind, 'librarySearch');
  const land = s.choice.cards[0];
  s = act(s, 'searchLibrary', { cards: [land] });
  assert.equal(s.objects[land].zone, 'graveyard');
  assert.equal(s.objects[copy.id], undefined);
});
test('prepared permission follows control and survives source type and copy changes; old incarnation cannot retain it', () => {
  const s = fixture(),
    o = enter(s),
    copy = s.objects[o.preparedCopy.id];
  o.controller = 1;
  assert.ok(!playableCards(s, 0).includes(copy.id));
  assert.ok(playableCards(s, 1).includes(copy.id));
  o.definitionOverride = { ...s.catalog.Forest };
  assert.ok(playableCards(s, 1).includes(copy.id));
  move(s, o, 'hand');
  assert.ok(!playableCards(s, 1).includes(copy.id));
  stabilize(s);
  assert.equal(s.objects[copy.id], undefined);
});
test('becoming prepared twice creates one copy; blink creates a different copy and casting cannot repeat', () => {
  const s = fixture(),
    o = enter(s),
    id = o.preparedCopy.id;
  preparePermanent(s, o);
  assert.equal(o.preparedCopy.id, id);
  move(s, o, 'exile');
  enterBattlefieldBatch(s, [{ object: o }]);
  assert.notEqual(o.preparedCopy.id, id);
  stabilize(s);
  assert.equal(s.objects[id], undefined);
});
