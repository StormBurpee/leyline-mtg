import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CARDS, CARD_IDS, definition } from '../packages/engine/src/index.js';
import { inspect, catalog } from '../apps/web/view.js';
import { fixture, put } from '../packages/engine/test/helpers.js';
const cards = ['hunter-s-talent', 'stormchaser-s-talent', 'caretaker-s-talent', 'builder-s-talent'];
test('all four complete Classes preserve exact Oracle identity, full levels, cost, artwork and inspector text', async () => {
  const meta = JSON.parse(
    await readFile(new URL('../apps/web/card-metadata.json', import.meta.url)),
  );
  for (const slug of cards) {
    const source = JSON.parse(
      await readFile(new URL(`../packages/cards/cards/${slug}.json`, import.meta.url)),
    );
    assert.equal(CARD_IDS[source.id], source.name);
    const card = CARDS[source.name];
    assert.ok(card);
    assert.deepEqual(
      card.classLevels.map((l) => l.level),
      [2, 3],
    );
    const display = meta[source.name];
    assert.equal(display.oracle_id, source.id);
    assert.equal(display.oracle_text, source.rulesText);
    assert.equal(display.mana_cost, source.characteristics.manaCost);
    assert.ok(display.image);
    assert.ok(display.artist);
    const s = fixture(),
      object = put(s, source.name);
    object.classLevel = 3;
    const html = inspect(source.name, meta, s, object.id, 0);
    assert.match(html, /Class level 3/);
    assert.match(html, /Level 2/);
    assert.match(html, /Level 3/);
    assert.match(html, /Illustration:/);
    assert.match(catalog({ query: source.name, filter: 'all' }, meta), /catalog-card/);
  }
});
test('Class token definitions have readable fallback inspection and exact characteristics', () => {
  for (const [name, colors, power, toughness] of [
    ['Otter Prowess Token', ['U', 'R'], 1, 1],
    ['White Wall Token', ['W'], 0, 4],
  ]) {
    const s = fixture(),
      object = put(s, name),
      d = definition(s, object);
    assert.equal(d.token, true);
    assert.deepEqual(d.color, colors);
    assert.equal(d.power, power);
    assert.equal(d.toughness, toughness);
    const html = inspect(name, {}, s, object.id, 0);
    assert.match(html, /Supported executable definition · Token/);
    assert.ok(html.includes(`${power}/${toughness} now`));
    assert.ok(html.includes(name));
  }
});
