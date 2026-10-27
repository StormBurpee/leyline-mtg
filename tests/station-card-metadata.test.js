import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CARDS, CARD_IDS } from '../packages/engine/src/index.js';
import { stationNames, stationSources } from './helpers/station-catalog.js';
import { fixture, put } from '../packages/engine/test/helpers.js';
import { inspect } from '../apps/web/view.js';

test('all 17 admitted Station cards retain exact identity, complete Oracle text, costs and threshold P/T metadata', async () => {
  const metadata = JSON.parse(
    await readFile(new URL('../apps/web/card-metadata.json', import.meta.url)),
  );
  const identities = new Set();
  assert.equal(stationNames.length, 17);
  for (const source of stationSources) {
    const display = metadata[source.name],
      card = CARDS[source.name],
      creatureLevels = source.abilities.filter(
        (a) => a.kind === 'stationLevel' && a.power !== undefined,
      );
    assert.equal(CARD_IDS[source.id], source.name);
    assert.ok(card && !card.token && card.station, source.name);
    assert.equal(display.oracle_id, source.id);
    assert.ok(display.image && display.art, `${source.name}: readable imagery`);
    assert.equal(source.rulesText, display.oracle_text, `${source.name}: all Oracle clauses`);
    assert.equal(
      source.characteristics.manaCost ?? '',
      display.mana_cost,
      `${source.name}: mana cost`,
    );
    assert.equal(card.power, undefined, `${source.name}: no unearned creature power`);
    assert.equal(card.toughness, undefined, `${source.name}: no unearned creature toughness`);
    for (const level of creatureLevels)
      for (const stat of ['power', 'toughness'])
        assert.equal(
          String(level[stat]),
          String(display[stat]),
          `${source.name}: threshold ${stat}`,
        );
    identities.add(source.id);
  }
  assert.equal(identities.size, 17);
});

test('Station inspector distinguishes charge counts and locked creature thresholds from printed P/T', () => {
  const s = fixture(),
    ship = put(s, 'Wurmwall Sweeper');
  let html = inspect(ship.name, {}, s, ship.id, 0);
  assert.match(html, /0 charge counters/);
  assert.match(html, /4\+ locked/);
  assert.match(html, /Not a creature/);
  ship.chargeCounters = 4;
  html = inspect(ship.name, {}, s, ship.id, 0);
  assert.match(html, /4 charge counters/);
  assert.match(html, /4\+ active · creature 2\/2/);
  assert.doesNotMatch(html, /Not a creature/);
  ship.chargeCounters = 1;
  html = inspect(ship.name, {}, s, ship.id, 0);
  assert.match(html, /1 charge counter ·/);
  assert.doesNotMatch(html, /1 charge counters/);
  assert.match(html, /4\+ locked/);
  assert.match(html, /Not a creature/);
});
