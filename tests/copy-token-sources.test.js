import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CARDS, CARD_IDS } from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
const names = [
  "Relm's Sketching",
  'Rite of Replication',
  'Self-Reflection',
  'Ember Island Production',
  'Gruff Triplets',
  'Sphinx of False Conclusions',
  'Joo Dee, One of Many',
];
const mechanics = JSON.parse(
  await readFile(new URL('../packages/cards/mechanics.json', import.meta.url)),
);
const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
const sources = await Promise.all(
  names.map(async (name) =>
    JSON.parse(
      await readFile(
        new URL(
          `../packages/cards/cards/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`,
          import.meta.url,
        ),
      ),
    ),
  ),
);
test('seven complete copy sources compile and round-trip every mode, kicker, flashback and exception', () => {
  for (const source of sources) {
    const compiled = compileCard(source, { identities: CARD_IDS, mechanics });
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    assert.deepEqual(compiled.definition, CARDS[source.name]);
    assert.equal(compiled.definition.text, source.rulesText);
    const round = compileCard(
      sourceFromDefinition(compiled.definition, { id: source.id, idsByName }),
      { identities: CARD_IDS, mechanics },
    );
    assert.equal(round.ok, true, JSON.stringify(round.diagnostics));
    assert.deepEqual(round.definition, compiled.definition);
  }
  assert.deepEqual(CARDS['Rite of Replication'].effects, [{ op: 'copyToken', count: 1 }]);
  assert.deepEqual(CARDS['Rite of Replication'].kicker, {
    cost: { generic: 5 },
    effects: [{ op: 'copyToken', count: 5 }],
  });
  assert.deepEqual(CARDS['Self-Reflection'].flashback, { generic: 3, U: 1 });
  assert.equal(CARDS['Ember Island Production'].modes.length, 2);
});
test('Unsupported copy bindings, unsupported recipients, delayed instructions and exceptions fail closed', () => {
  const template = sources[0];
  for (const effect of [
    { op: 'copyToken', target: 'eventSource', count: 1 },
    { op: 'copyToken', target: 'target', count: 1, controller: 'opponent' },
    { op: 'copyToken', target: 'target', count: 1, delayedExile: true },
    { op: 'copyToken', target: 'target', count: 1, exceptions: { keywords: ['haste'] } },
    { op: 'copyToken', target: 'target', count: 1, exceptions: { power: 1 } },
    { op: 'copyToken', target: 'target', count: 1, exceptions: { addSubtypes: ['Goblin'] } },
  ]) {
    const source = structuredClone(template);
    source.abilities[0].effects = [effect];
    assert.equal(compileCard(source).ok, false, JSON.stringify(effect));
  }
});
