import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { CARDS, CARD_IDS } from '../packages/engine/src/index.js';
const sources = [
  'a-i-m-scientists',
  'celebrate-the-mountain-king',
  'doc-ock-s-henchmen',
  'esgaroth-garrison',
  'formidable-speaker',
  'great-gilded-boat',
  'kang-temporal-tyrant',
  'lake-town-lookout',
  'long-lake-nuisance',
  'm-o-d-o-k',
  'madame-masque',
  'mechanical-mobster',
  'mob-lookout',
  'patient-instructor',
  'prowler-clawed-thief',
  'red-room-recruit',
  'the-mountain-king-s-return',
  'unstable-experiment',
];
const json = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));
test('v0.59 admissions retain all 18 complete Oracle identities, text, costs and readable art', async () => {
  const metadata = await json('../apps/web/card-metadata.json');
  const names = new Set();
  for (const file of sources) {
    const source = await json(`../packages/cards/cards/${file}.json`);
    const display = metadata[source.name],
      card = CARDS[source.name];
    assert.ok(card && !card.token, source.name);
    assert.equal(CARD_IDS[source.id], source.name);
    assert.equal(display.oracle_id, source.id);
    assert.equal(display.oracle_text, source.rulesText, `${source.name}: full Oracle text`);
    assert.equal(
      display.mana_cost,
      source.characteristics.manaCost,
      `${source.name}: printed cost`,
    );
    assert.ok(
      display.image && display.art && display.artist,
      `${source.name}: readable attributed art`,
    );
    for (const stat of ['power', 'toughness'])
      if (
        source.characteristics[stat] !== undefined &&
        !(stat === 'power' && card.baseStats?.power)
      )
        assert.equal(
          String(display[stat]),
          String(source.characteristics[stat]),
          `${source.name}: ${stat}`,
        );
    names.add(source.name);
  }
  assert.equal(names.size, 18);
});
test('v0.59 coverage admits all 18 complete Standard cards and Arena counterparts', async () => {
  for (const pool of ['standard', 'arena']) {
    const dir = new URL(`../docs/card-pools/${pool}-2026-10-26/`, import.meta.url);
    const rows = [];
    for (const file of await readdir(dir))
      if (file.endsWith('.json') && file !== 'summary.json')
        rows.push(...JSON.parse(await readFile(new URL(file, dir), 'utf8')));
    let admitted = 0;
    for (const file of sources) {
      const source = await json(`../packages/cards/cards/${file}.json`);
      const row = rows.find((r) => r.oracleId === source.id);
      assert.equal(row?.status, 'curated', source.name);
      admitted++;
    }
    assert.equal(admitted, 18);
  }
});
