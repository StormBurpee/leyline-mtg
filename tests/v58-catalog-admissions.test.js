import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { CARDS, CARD_IDS } from '../packages/engine/src/index.js';
const sources = [
  'abandon-attachments',
  'baron-bertram-graywater',
  'benthic-criminologists',
  'builder-s-talent',
  'candlestick',
  'caretaker-s-talent',
  'diamond-pick-axe',
  'highway-robbery',
  'hunter-s-talent',
  'k-un-lun-warrior',
  'melded-moxite',
  'mister-fantastic-reed-richards',
  'narset-jeskai-waymaster',
  'peer-past-the-veil',
  'pirate-hat',
  'pursue-the-past',
  'ragged-short-spear',
  'rook-turret',
  'stadium-tidalmage',
  'stormchaser-s-talent',
  'valley-questcaller',
  'vision-of-love',
  'witherbloom-charm',
  'zealous-display',
  'zuko-s-exile',
];
const json = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));
test('v0.58 admissions retain all 25 complete Oracle identities, text, costs and readable art', async () => {
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
      if (source.characteristics[stat] !== undefined)
        assert.equal(
          String(display[stat]),
          String(source.characteristics[stat]),
          `${source.name}: ${stat}`,
        );
    names.add(source.name);
  }
  assert.equal(names.size, 25);
});
test('v0.58 coverage admits 24 Standard cards and counts banned Stormchaser only in Arena', async () => {
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
      if (pool === 'standard' && source.name === "Stormchaser's Talent")
        assert.equal(row, undefined);
      else {
        assert.equal(row?.status, 'curated', source.name);
        admitted++;
      }
    }
    assert.equal(admitted, pool === 'standard' ? 24 : 25);
  }
});
