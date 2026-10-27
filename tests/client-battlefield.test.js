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

test('legend rule controls distinguish copies with live state and explicit keep buttons', async () => {
  const { stabilize } = await import('../packages/engine/src/effects.js');
  const { legendChoiceBody } = await import('../apps/web/view.js');
  const state = fixture(),
    a = put(state, 'Isamaru, Hound of Konda'),
    b = put(state, 'Isamaru, Hound of Konda');
  a.tapped = true;
  b.plusCounters = 2;
  stabilize(state);
  const html = legendChoiceBody(state, {}),
    table = game(state, ui(), {});
  assert.match(table, /data-action="reviewDecision"/);
  assert.match(html, /Copy 1:/);
  assert.match(html, /Copy 2:/);
  assert.match(html, /4\/4/);
  assert.match(html, /2 \+1\/\+1 counters/);
  assert.match(html, /Tapped/);
  assert.match(html, /Untapped/);
  assert.equal((html.match(/data-action="keepLegend"/g) || []).length, 2);
  assert.equal((html.match(/data-action="readLegend"/g) || []).length, 2);
});

test('planeswalker loyalty and explicit attacker destinations stay visible', async () => {
  const { definition, ref } = await import('../packages/engine/src/model.js');
  const state = fixture(),
    attacker = put(state, 'Grizzly Bears'),
    walker = put(state, 'Grizzly Bears', 1);
  walker.definitionOverride = {
    ...definition(state, walker),
    type: 'planeswalker',
    types: ['planeswalker'],
  };
  walker.loyalty = 4;
  state.choice = { kind: 'attackers', player: 0 };
  const html = game(
    state,
    { ...ui(), chosen: [attacker.id], attackDefenders: { [attacker.id]: ref(walker) } },
    {},
  );
  assert.match(html, /aria-label="4 loyalty"/);
  assert.match(html, /data-action="attackDefenders"/);
  assert.match(html, /class="attack-destination"/);
  state.choice = { kind: 'attackDefenders', player: 0, cards: [attacker.id] };
  assert.match(game(state, ui(), {}), /Choose where your new creatures attack/);
});
