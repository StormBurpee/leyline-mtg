import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from '../apps/web/view.js';
import { fixture, put, lands, act, resolve } from '../packages/engine/test/helpers.js';

test('the inspector shows a granted keyword after an ability resolves', () => {
  let state = fixture();
  lands(state, 'Forest', 2);
  const frog = put(state, 'Poison Dart Frog');
  assert.equal(inspect(frog.name, {}, state, frog.id).includes('Gained: deathtouch'), false);
  state = resolve(act(state, 'activate', { card: frog.id, ability: 0 }));
  assert.equal(inspect(frog.name, {}, state, frog.id).includes('Gained: deathtouch'), true);
  state.modifiers = [];
  assert.equal(inspect(frog.name, {}, state, frog.id).includes('Gained: deathtouch'), false);
});
