import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  DECKS,
  expandDeck,
  validateDeck,
  parseDeck,
  createGame,
} from '../packages/engine/src/index.js';
import { readDeckLibrary, deckEntries, deckRoom, deckBuilder } from '../apps/web/deck-room.js';

test('all fifteen starter decks are executable 60-card lists and independent match opponents', () => {
  assert.equal(Object.keys(DECKS).length, 15);
  const entries = Object.entries(DECKS);
  for (let i = 0; i < entries.length; i++) {
    const [id, deck] = entries[i],
      names = expandDeck(deck.cards);
    assert.equal(names.length, 60, id);
    assert.deepEqual(validateDeck(names), [], id);
    const other = expandDeck(entries[(i + 1) % entries.length][1].cards);
    const game = createGame({ decks: [names, other], seed: 11 });
    assert.equal(game.players[0].hand.length, 7);
  }
});
test('unsupported repeated cards report an error rather than crashing deck import', () => {
  const result = parseDeck('60 Not a supported card');
  assert.ok(result.errors.some((e) => e.startsWith('Unsupported card:')));
});
test('saved deck library rejects corrupt storage and bounded quantities', () => {
  const read = (x) => readDeckLibrary({ getItem: () => x });
  assert.deepEqual(read('oops'), []);
  assert.deepEqual(
    read(JSON.stringify([{ id: 'x', name: 'Bad', cards: { Mountain: 1000000 } }])),
    [],
  );
  assert.equal(
    read(JSON.stringify([{ id: 'x', name: 'Draft', cards: { Mountain: 3 } }])).length,
    1,
  );
});
test('deck room and builder escape custom titles and clearly gate incomplete lists', () => {
  const ui = {
    deck: 'mine',
    opponentDeck: 'grove',
    personalDecks: [{ id: 'mine', name: '<script>alert(1)</script>', cards: { Mountain: 3 } }],
    deckQuery: '',
    deckColor: 'all',
    builderQuery: '',
    builderColor: 'all',
    builderType: 'all',
    mode: 'bot',
    seed: 7,
  };
  assert.equal(deckEntries(ui).length, Object.keys(DECKS).length + 1);
  const room = deckRoom(ui, {});
  assert.ok(room.includes('&lt;script&gt;'));
  assert.ok(room.includes('Needs attention'));
  const builder = deckBuilder({ ...ui, deckDraft: ui.personalDecks[0] }, {});
  assert.ok(builder.includes('Deck needs at least 60 cards'));
  assert.ok(!builder.includes('<script>'));
});

test('mobile builder panel controls retain count and separate reading from addition', () => {
  const ui = {
    deckDraft: { name: 'Four Shocks', cards: { Shock: 4, Mountain: 20 } },
    builderQuery: 'Shock',
    builderColor: 'all',
    builderType: 'all',
    builderPanel: 'list',
  };
  const before = structuredClone(ui.deckDraft);
  const html = deckBuilder(ui, {});
  assert.match(html, /data-builder-panel="list"/);
  assert.match(html, /data-panel="list" aria-pressed="true"/);
  assert.match(html, /My deck <b>24<\/b>/);
  assert.match(
    html,
    /class="builder-card-preview" data-action="inspectDraftCard" data-name="Shock" aria-label="Read Shock">/,
  );
  assert.match(html, /class="builder-card-add"[^>]+aria-label="Add Shock" disabled/);
  assert.match(html, /class="builder-list-name" data-action="inspectDraftCard" data-name="Shock"/);
  assert.deepEqual(ui.deckDraft, before);
});
test('invalid panel values fall back to the collection and a basic land stays addable', () => {
  const html = deckBuilder(
    {
      deckDraft: { name: 'Lands', cards: { Mountain: 20 } },
      builderQuery: 'Mountain',
      builderColor: 'all',
      builderType: 'all',
      builderPanel: 'bad',
    },
    {},
  );
  assert.match(html, /data-builder-panel="pool"/);
  assert.doesNotMatch(html, /class="builder-card-add"[^>]+aria-label="Add Mountain" disabled/);
});
