import test from 'node:test';
import assert from 'node:assert/strict';
import { game, inspect } from '../apps/web/view.js';
import { fixture, put } from '../packages/engine/test/helpers.js';
import { addLoreCounters } from '../packages/engine/src/model.js';
import { stabilize } from '../packages/engine/src/effects.js';
test('Saga battlefield, stack and card reader expose readable chapter/lore progress', () => {
  const s = fixture(),
    saga = put(s, 'Summon: Choco/Mog');
  addLoreCounters(s, saga);
  stabilize(s);
  const html = game(
    s,
    {
      mode: 'bot',
      chosen: [],
      blocks: [],
      activation: null,
      controlMode: 'smart',
      stops: {},
      view: 'play',
      sideTab: 'stack',
    },
    {},
  );
  assert.match(html, /Chapter 1\/4/);
  assert.match(html, /Saga chapter 1 of 4/);
  assert.match(html, /Summon: Choco\/Mog · Chapter 1/);
  assert.match(inspect(saga.name, {}, s, saga.id), /1 lore counter/);
});
