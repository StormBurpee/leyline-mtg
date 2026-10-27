import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { CARDS, CARD_IDS, createRegistry } from '../packages/engine/src/index.js';
const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
const sources = ['goldvein-hydra', 'morlun-devourer-of-spiders', 'pterafractyl'].map((name) =>
  JSON.parse(readFileSync(new URL(`../packages/cards/cards/${name}.json`, import.meta.url))),
);
test('three complete X-entry sources compile and round-trip unchanged', () => {
  for (const source of sources) {
    const first = compileCard(source, { identities: CARD_IDS });
    assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
    assert.deepEqual(first.definition, CARDS[source.name]);
    const second = compileCard(
      sourceFromDefinition(first.definition, { id: source.id, idsByName }),
      { identities: CARD_IDS },
    );
    assert.equal(second.ok, true, JSON.stringify(second.diagnostics));
    assert.deepEqual(second.definition, first.definition);
    assert.equal(first.definition.text, source.rulesText);
  }
});
test('entry-counter amounts are bounded literals or X only; invalid profiles fail closed', () => {
  for (const amount of [
    -1,
    1.5,
    { kind: 'x', extra: 1 },
    { kind: 'sourceStat', stat: 'power' },
    { kind: 'count', zone: 'battlefield', player: 'you' },
    { kind: 'scale', value: { kind: 'x' }, factor: 2 },
  ]) {
    const source = structuredClone(sources[2]);
    source.abilities.find((a) => a.kind === 'entryPlusCounters').amount = amount;
    assert.equal(compileCard(source).ok, false, JSON.stringify(amount));
    assert.throws(() => createRegistry([{ ...CARDS['Pterafractyl'], entryPlusCounters: amount }]));
  }
  const source = structuredClone(sources[2]);
  source.characteristics.manaCost = '{G}{U}';
  assert.equal(compileCard(source).ok, false);
  assert.throws(() => createRegistry([{ ...CARDS['Pterafractyl'], cost: { G: 1, U: 1 } }]));
});
