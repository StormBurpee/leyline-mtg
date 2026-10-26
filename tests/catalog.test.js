import test from 'node:test';
import assert from 'node:assert/strict';
import { QUERIES, searchURL, normalizeCard, validatePage } from '../packages/catalog/scryfall.js';
test('pool queries distinguish Alchemy exclusion from format legality', () => {
  assert.equal(QUERIES.standard, 'legal:standard');
  assert.equal(QUERIES.arena, 'game:arena -is:alchemy -is:rebalanced');
  const u = new URL(searchURL(QUERIES.arena, '2026-10-26'));
  assert.equal(u.searchParams.get('include_extras'), 'false');
  assert.equal(u.searchParams.get('unique'), 'cards');
  assert.ok(u.searchParams.get('q').endsWith('date<=2026-10-26'));
  assert.throws(() => searchURL(QUERIES.arena));
});
test('catalog normalization preserves identity, faces and separate legalities', () => {
  const c = normalizeCard({
    oracle_id: 'oracle',
    id: 'printing',
    name: 'Front // Back',
    layout: 'transform',
    games: ['arena'],
    digital: false,
    legalities: { standard: 'legal', historic: 'banned' },
    card_faces: [
      { name: 'Front', type_line: 'Creature', mana_cost: '{U}' },
      { name: 'Back', type_line: 'Creature' },
    ],
  });
  assert.equal(c.oracleId, 'oracle');
  assert.equal(c.faces.length, 2);
  assert.equal(c.legalities.historic, 'banned');
  assert.equal(Object.hasOwn(c, 'effects'), false);
  assert.throws(() => normalizeCard({ name: 'No identity' }));
});
test('snapshot ingestion rejects warnings and foreign pagination destinations', () => {
  const p = { object: 'list', data: [], total_cards: 0, has_more: false };
  assert.equal(validatePage(p), p);
  assert.throws(() => validatePage({ ...p, warnings: ['Unrecognized query'] }));
  for (const next_page of ['https://example.org/cards/search', 'https://api.scryfall.com/other'])
    assert.throws(() => validatePage({ ...p, has_more: true, next_page }));
});

import { classifyInventoryCard, cardCoverage } from '../packages/catalog/coverage.js';
test('Alchemy tags are excluded even when a search result slips through the query', () => {
  const ordinary = {
    name: 'Hallowed Priest',
    layout: 'normal',
    digital: true,
    set: 'anb',
    setType: 'starter',
    releasedAt: '2020-08-13',
  };
  assert.equal(classifyInventoryCard(ordinary, '2026-10-26'), 'in_scope');
  assert.equal(
    classifyInventoryCard({ ...ordinary, promoTypes: ['alchemy'] }, '2026-10-26'),
    'excluded_alchemy',
  );
  assert.equal(classifyInventoryCard({ ...ordinary, layout: 'token' }, '2026-10-26'), 'auxiliary');
  assert.equal(
    classifyInventoryCard({ ...ordinary, releasedAt: '2026-11-13' }, '2026-10-26'),
    'future_printing_review',
  );
});
test('coverage never promotes compiler candidates or ambiguous names to supported cards', () => {
  const card = { name: 'Example' };
  const scripts = new Map([['Example', [{ status: 'candidate' }]]]);
  assert.equal(cardCoverage(card, {}, scripts).status, 'compiler_candidate');
  scripts.get('Example').push({ status: 'candidate' });
  assert.equal(cardCoverage(card, {}, scripts).status, 'ambiguous_forge_match');
  assert.equal(cardCoverage(card, { Example: {} }, scripts).status, 'curated');
});
