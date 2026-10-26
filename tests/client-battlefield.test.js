import test from 'node:test';
import assert from 'node:assert/strict';
import { game, inspect } from '../apps/web/view.js';
import { fixture, put } from '../packages/engine/test/helpers.js';
const ui = () => ({
  mode: 'bot',
  chosen: [],
  blocks: [],
  activation: null,
  controlMode: 'smart',
  stops: {},
  view: 'play',
  sideTab: 'stack',
});
test('mobile battlefield offers an art crop while the reader keeps the printed card', () => {
  const state = fixture();
  const bear = put(state, 'Grizzly Bears', 0);
  const meta = {
    'Grizzly Bears': { image: 'https://example.com/card.jpg', art: 'https://example.com/art.jpg' },
  };
  const table = game(state, ui(), meta);
  assert.match(
    table,
    /<picture><source media="[^"]+" srcset="https:\/\/example.com\/art.jpg"><img class="battlefield-card-image" src="https:\/\/example.com\/card.jpg"/,
  );
  assert.match(table, /<strong class="pt">2\/2<\/strong>/);
  const reader = inspect(bear.name, meta, state, bear.id);
  assert.match(reader, /https:\/\/example.com\/card.jpg/);
  assert.doesNotMatch(reader, /<source/);
});
test('a printed-only card still renders without a broken mobile artwork source', () => {
  const state = fixture();
  put(state, 'Grizzly Bears', 0);
  const table = game(state, ui(), { 'Grizzly Bears': { image: 'https://example.com/card.jpg' } });
  assert.match(table, /<picture><img class="battlefield-card-image"/);
  assert.doesNotMatch(table, /<source/);
});
test('artwork URL attributes are escaped', () => {
  const state = fixture();
  put(state, 'Grizzly Bears', 0);
  const table = game(state, ui(), {
    'Grizzly Bears': {
      image: 'https://example.com/card.jpg',
      art: 'https://example.com/a" onload="oops',
    },
  });
  assert.match(table, /srcset="https:\/\/example.com\/a&quot; onload=&quot;oops"/);
  assert.doesNotMatch(table, /srcset="[^"\n]*" onload=/);
});
