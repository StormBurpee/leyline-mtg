import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CARDS, CARD_IDS, createRegistry } from '../../packages/engine/src/index.js';
import { compileCard } from '../../packages/cards/compiler.js';
import { fixture as baseFixture } from '../../packages/engine/test/helpers.js';
export const oracleIds = {
  'Alquist Proft, Master Sleuth': 'dd79a994-7dad-49d4-8d8f-62dbedde4a38',
  'Mindspring Merfolk': '35142b01-4b8d-4335-a943-a3172fa04573',
  'Stature, Size Shifter': 'bd49a05c-ed51-4d69-ab9b-11192442ec17',
};
export const names = Object.keys(oracleIds);
export const sources = names.map((name) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../packages/cards/cards/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`,
        import.meta.url,
      ),
    ),
  ),
);
export const mechanics = JSON.parse(
  readFileSync(new URL('../../packages/cards/mechanics.json', import.meta.url)),
);
export const identities = {
  ...CARD_IDS,
  ...Object.fromEntries(sources.map((s) => [s.id, s.name])),
};
export const idsByName = Object.fromEntries(
  Object.entries(identities).map(([id, name]) => [name, id]),
);
export const definitions = Object.fromEntries(
  sources.map((source) => {
    const result = compileCard(source, { mechanics, identities });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    return [source.name, result.definition];
  }),
);
export const catalog = createRegistry({ ...CARDS, ...definitions });
export function fixture() {
  const s = baseFixture();
  s.catalog = catalog;
  return s;
}
