import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch } from '../packages/engine/src/index.js';
import {
  decisionLease,
  decisionCard,
  decisionReader,
  CARD_DECISIONS,
} from '../apps/web/choice-stage.js';
import { fixture, put } from '../packages/engine/test/helpers.js';

test('decision leases distinguish new games even at the same revision and preserve one pending choice', () => {
  const a = createGame(),
    b = createGame();
  assert.notEqual(decisionLease(a, 0), decisionLease(b, 0));
  assert.equal(decisionLease(a, 0), decisionLease(a, 0));
  assert.equal(decisionLease(a, 1), null);
});
test('card-stage faces have full images, accessible selection, text fallback and explicit reading', () => {
  const s = fixture(),
    card = put(s, 'Binding Negotiation', 0, 'exile');
  const html = decisionCard(
    s,
    card.id,
    { 'Binding Negotiation': { image: 'https://example.com/card.jpg' } },
    { selected: true },
  );
  assert.match(html, /decision-card-fallback/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /<img/);
  assert.match(html, /data-action="readDecisionCard"/);
  assert.match(html, /data-action="selectDecisionCard"/);
  assert.doesNotMatch(html, /chooseResolutionCard/);
});
test('card reading and stage imagery never expose an opposing face-down identity', () => {
  const s = fixture(),
    card = put(s, 'Pyrotechnic Performer', 1);
  card.faceDown = true;
  const meta = {
    'Pyrotechnic Performer': {
      image: 'https://example.com/secret.jpg',
      oracle_text: 'Private identity',
    },
  };
  for (const html of [
    decisionCard(s, card.id, meta, { viewer: 0 }),
    decisionReader(s, card.id, meta, 0),
  ]) {
    assert.doesNotMatch(html, /Pyrotechnic|secret.jpg|Private identity/);
    assert.match(html, /Face-down creature/);
  }
});
test('opening hand, mulligan bottoming, exile and library decisions share automatic presentation', () => {
  for (const kind of [
    'mulligan',
    'bottom',
    'discard',
    'discardEffect',
    'exilePlay',
    'bindingNegotiation',
    'exileToGraveyard',
    'libraryOrder',
    'librarySearch',
    'legendRule',
  ])
    assert.ok(CARD_DECISIONS.has(kind));
});
