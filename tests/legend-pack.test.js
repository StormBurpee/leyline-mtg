import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CARDS, validateDefinition } from '../packages/engine/src/index.js';
const rows = JSON.parse(
  await readFile(new URL('./fixtures/legend-reviewed-v021.json', import.meta.url), 'utf8'),
);
for (const row of rows)
  test(`${row.name} preserves the reviewed legendary characteristics`, () => {
    const card = CARDS[row.name];
    assert.equal(card.legendary, true);
    assert.deepEqual(validateDefinition(card), []);
    assert.ok(row.released_at <= '2026-10-26');
    assert.ok(row.arena_print);
    assert.ok(row.oracle_id);
  });
test('legendary sorcery restrictions fail closed rather than silently allowing casts', () => {
  const result = validateDefinition({
    name: 'Legendary spell fixture',
    type: 'sorcery',
    legendary: true,
    cost: {},
    effects: [],
  });
  assert.ok(result.some((x) => x.includes('legendary spell casting restrictions')));
});
