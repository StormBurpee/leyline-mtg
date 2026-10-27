import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { CARDS, CARD_IDS } from '../packages/engine/src/index.js';
const sources = [
  'bestial-incursion',
  'boomerang-basics',
  'bovine-intervention',
  'cemetery-recruitment',
  'does-machines',
  'gossip-s-talent',
  'hotshot-investigators',
  'leader-s-talent',
  'pia-aether-ascetic',
  'stroke-of-midnight',
  'thwip',
  'vaultguard-trooper',
];
const json = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));
test('v0.60 admissions retain all 12 complete Oracle identities, text, costs and readable art', async () => {
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
  assert.equal(names.size, 12);
});
test('v0.60 coverage admits all 12 complete Standard cards and Arena counterparts', async () => {
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
    assert.equal(admitted, 12);
  }
});

test('v0.60 nested Class and discard continuations appear in the support manifest', async () => {
  const report = await json('../docs/support.json');
  for (const [name, expected] of [
    ["Leader's Talent", ['counterOn', 'counterAll', 'gainLife']],
    ["Gossip's Talent", ['surveil', 'combatRestriction', 'blink']],
    [
      'Does Machines',
      ['mill', 'draw', 'discard', 'moveTarget', 'counterOn', 'conditional', 'animatePermanent'],
    ],
    ['Pia, Aether Ascetic', ['discardThen', 'searchLibrary']],
  ]) {
    const row = report.cards.find((card) => card.name === name);
    for (const op of expected) assert.ok(row.opcodes.includes(op), `${name}: missing ${op}`);
  }
});

test('v0.60 token admissions retain their exact printed colors, types, stats and keywords', () => {
  for (const [name, colors, subtype, power, toughness, keywords] of [
    ['Trampling Beast Token', ['G'], 'Beast', 4, 4, ['trample']],
    ['White Ox Token', ['W'], 'Ox', 2, 2, []],
  ]) {
    const token = CARDS[name];
    assert.equal(token.token, true, name);
    assert.deepEqual(token.color, colors, name);
    assert.equal(token.type, 'creature', name);
    assert.deepEqual(token.subtypes, [subtype], name);
    assert.equal(token.power, power, name);
    assert.equal(token.toughness, toughness, name);
    assert.deepEqual(token.keywords, keywords, name);
  }
});
