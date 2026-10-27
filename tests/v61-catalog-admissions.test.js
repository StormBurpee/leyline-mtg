import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { CARDS, CARD_IDS } from '../packages/engine/src/index.js';
const sources = [
  'alquist-proft-master-sleuth',
  'mindspring-merfolk',
  'stature-size-shifter',
  'caradora-heart-of-alacria',
  'michelangelo-weirdness-to-11',
  'yoshimaru-beloved-companion',
];
const json = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));
test('v0.61 admissions retain six complete Oracle identities, printed costs, stats and attributed art', async () => {
  const metadata = await json('../apps/web/card-metadata.json');
  const names = new Set();
  for (const file of sources) {
    const source = await json(`../packages/cards/cards/${file}.json`),
      display = metadata[source.name],
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
    assert.ok(display.image && display.art && display.artist, `${source.name}: attributed art`);
    for (const stat of ['power', 'toughness'])
      assert.equal(
        String(display[stat]),
        String(source.characteristics[stat]),
        `${source.name}: ${stat}`,
      );
    names.add(source.name);
  }
  assert.equal(names.size, 6);
});
test('v0.61 admits exactly its six complete Standard cards into both dated inventories', async () => {
  for (const pool of ['standard', 'arena']) {
    const dir = new URL(`../docs/card-pools/${pool}-2026-10-26/`, import.meta.url),
      rows = [];
    for (const file of await readdir(dir))
      if (file.endsWith('.json') && file !== 'summary.json')
        rows.push(...JSON.parse(await readFile(new URL(file, dir), 'utf8')));
    for (const file of sources) {
      const source = await json(`../packages/cards/cards/${file}.json`);
      assert.equal(rows.find((r) => r.oracleId === source.id)?.status, 'curated', source.name);
    }
  }
});
test('v0.61 generated catalog exposes locked-X costs and bounded replacements without placeholder tokens', async () => {
  const support = await json('../docs/support.json');
  for (const name of [
    'Alquist Proft, Master Sleuth',
    'Mindspring Merfolk',
    'Stature, Size Shifter',
  ]) {
    assert.ok(
      CARDS[name].activated.some((ability) => ability.cost.mana.X === 1),
      name,
    );
    assert.ok(
      support.cards.some((card) => card.name === name && card.activatedAbilities > 0),
      name,
    );
  }
  for (const name of [
    'Caradora, Heart of Alacria',
    'Michelangelo, Weirdness to 11',
    'Yoshimaru, Beloved Companion',
  ])
    assert.equal(CARDS[name].plusCounterBonus.amount, 1, name);
  for (const name of ['Clue Token', 'Mutagen Token']) assert.equal(CARDS[name].token, true, name);
});
