import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { META_DECKS } from '../apps/web/meta-decks.js';
import { REQUESTED_DECKS } from '../apps/web/requested-decks.js';
import { deckEntries, deckRoom, deckProblems, missingDeckCards } from '../apps/web/deck-room.js';
import { CARDS, createGame } from '../packages/engine/src/index.js';

const ui = {
  personalDecks: [],
  deckQuery: '',
  deckColor: 'all',
  opponentDeck: 'grove',
  mode: 'bot',
  seed: 7,
};
test('eight source-exact tournament presets preserve 60 main and 15 sideboard cards with dated provenance', () => {
  assert.equal(Object.keys(META_DECKS).length, 8);
  for (const deck of Object.values(META_DECKS)) {
    assert.equal(
      Object.values(deck.cards).reduce((a, b) => a + b, 0),
      60,
    );
    assert.equal(
      Object.values(deck.sideboard).reduce((a, b) => a + b, 0),
      15,
    );
    assert.equal(deck.source.format, 'Standard');
    assert.equal(deck.source.checkedAt, '2026-10-27');
    assert.match(deck.source.date, /^2026-10-\d\d$/);
    assert.ok(deck.source.date <= deck.source.checkedAt);
    assert.match(deck.source.url, /^https:\/\/www\.mtggoldfish\.com\/deck\/\d+$/);
    assert.ok(deck.source.pilot && deck.source.event && deck.source.result);
    for (const [name, n] of Object.entries(deck.cards))
      assert.ok(
        Number.isInteger(n) &&
          n > 0 &&
          (n <= 4 || /^(Plains|Island|Swamp|Mountain|Forest)$/.test(name)),
      );
  }
  assert.equal(META_DECKS['meta-izzet-spellementals'].cards['Hearth Elemental // Stoke Genius'], 4);
});
test('meta presets do not displace the requested default or silently replace unsupported cards', () => {
  const entries = deckEntries(ui);
  assert.equal(entries[0][0], Object.keys(REQUESTED_DECKS)[0]);
  for (const [id, deck] of Object.entries(META_DECKS)) {
    assert.equal(entries.find(([key]) => key === id)[1], deck);
    const before = JSON.stringify(deck);
    const { document } = parseHTML(deckRoom({ ...ui, deck: id }, {}));
    const blocked = deckProblems(deck).length > 0;
    assert.equal(document.querySelector('[data-action="start"]').hasAttribute('disabled'), blocked);
    assert.equal(!!document.querySelector(`#opponent-deck option[value="${id}"]`), !blocked);
    const missing = missingDeckCards(deck);
    assert.deepEqual(
      missing.map((c) => c.name),
      Object.keys(deck.cards).filter((name) => !CARDS[name]),
    );
    for (const { name, count } of missing)
      assert.ok(
        document.querySelector('.meta-deck-blockers').textContent.includes(`${count} × ${name}`),
      );
    assert.match(
      document.querySelector('.meta-deck-sideboard').textContent,
      /Sideboarding is not implemented/,
    );
    assert.equal(
      document.querySelector('.meta-deck-source a').getAttribute('href'),
      deck.source.url,
    );
    assert.equal(JSON.stringify(deck), before);
  }
});

test('the exact tournament Rakdos main deck is fully executable after its blockers are implemented', () => {
  const deck = META_DECKS['meta-rakdos-lizards'];
  assert.deepEqual(deckProblems(deck), []);
  assert.deepEqual(missingDeckCards(deck), []);
  const cards = Object.entries(deck.cards).flatMap(([name, count]) => Array(count).fill(name));
  const state = createGame({ decks: [cards, cards], seed: 7 });
  assert.equal(state.players.length, 2);
  const { document } = parseHTML(deckRoom({ ...ui, deck: 'meta-rakdos-lizards' }, {}));
  assert.equal(document.querySelector('[data-action="start"]').hasAttribute('disabled'), false);
});
