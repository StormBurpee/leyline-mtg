import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CARDS, CARD_IDS, createGame, definition, ref } from '../src/index.js';
import { addObject } from '../src/model.js';
import { enterBattlefieldBatch, legalTarget } from '../src/effects.js';
import { compileCard } from '../../cards/compiler.js';

const cases = [
  ['adventurous-eater-have-a-bite', ['B'], ['B']],
  ['bellowing-bruiser-beat-a-path', ['R'], ['R']],
  ['blazing-firesinger-seething-song', ['R'], ['R']],
  ['blossom-blessed-angel-seed-suture', ['W'], ['G', 'W']],
  ['cheerful-osteomancer-raise-dead', ['B'], ['B']],
  ['emergency-phytomedic-seed-suture', ['G', 'W'], ['G', 'W']],
  ['hallway-heckler-vicious-verse', ['R'], ['B', 'R']],
  ['honorbound-page-forum-s-favor', ['W'], ['W']],
  ['landscape-painter-vibrant-idea', ['U'], ['U']],
  ['campus-composer-aqueous-aria', ['U'], ['U']],
  ['fatehold-chronologist-peer-review', ['W', 'U'], ['W', 'U']],
  ['konstrari-improviser-soul-tether', ['R', 'G'], ['R', 'G']],
];
const source = (slug) =>
  JSON.parse(readFileSync(new URL(`../../cards/cards/${slug}.json`, import.meta.url)));
const sources = [
  ...cases.map(([slug]) => source(slug)),
  source('blue-red-flying-elemental-token'),
  source('heartwood'),
];
const identities = { ...CARD_IDS, ...Object.fromEntries(sources.map((s) => [s.id, s.name])) };
const definitions = sources.map((s) => {
  const compiled = compileCard(s, { identities });
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  return compiled.definition;
});
const catalog = { ...CARDS, ...Object.fromEntries(definitions.map((d) => [d.name, d])) };

for (const [index, [slug, mainColors, spellColors]] of cases.entries()) {
  test(`${slug}: both faces retain their printed colors in the runtime`, () => {
    const d = definitions[index];
    assert.deepEqual(d.color, mainColors);
    assert.deepEqual((d.prepareSpell ?? d.adventure).color, spellColors);
    const s = createGame({ catalog, mulligan: false });
    const o = addObject(s, d.name, 0, 'hand');
    enterBattlefieldBatch(s, [{ object: o }]);
    assert.deepEqual(definition(s, o).color, mainColors);
    for (const color of mainColors)
      assert(legalTarget(s, { scope: 'permanent', where: { color } }, ref(o), 0));
    assert(!legalTarget(s, { scope: 'permanent', where: { color: 'colorless' } }, ref(o), 0));
    if (d.prepareSpell) {
      const copy = s.objects[o.preparedCopy.id];
      assert.deepEqual(definition(s, copy).color, spellColors);
      assert.equal(copy.preparedFrom.id, o.id);
    } else {
      const adventure = addObject(s, d.name, 0, 'hand');
      adventure.adventureCast = true;
      assert.deepEqual(definition(s, adventure).color, spellColors);
    }
  });
}
