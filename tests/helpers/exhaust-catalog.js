import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CARDS, CARD_IDS, createRegistry } from '../../packages/engine/src/index.js';
import { compileCard } from '../../packages/cards/compiler.js';
import { fixture as baseFixture } from '../../packages/engine/test/helpers.js';
export const oracleIds = {
  'Hazard of the Dunes': '799664fc-279c-40c1-8e40-44a68c38801b',
  'Prowcatcher Specialist': '594132ac-32a7-41d5-b7f0-3692bbed7f6f',
  'Skystreak Engineer': '2f920bf2-6a49-47c2-be3c-9787c377673b',
  'Camera Launcher': 'b46bac37-5b45-4be5-93d0-76e48dbd9f74',
  'Stampeding Scurryfoot': '7b860806-0118-40f8-861b-225a7c1cf151',
  'Pacesetter Paragon': '1acb289f-fb7f-4d83-aaef-4e7b9462c593',
  'Mai, Jaded Edge': 'b5029f21-e0d6-4f22-9afd-79452de26490',
  'Keen Buccaneer': '8cadf9c0-9a63-4cde-a6be-0ae86890c831',
  'Greenbelt Guardian': '2d8aa053-289d-40d9-baa7-9bd1c5b8e957',
  'Draconautics Engineer': '380d8d64-9aec-4656-b5b8-d336ebf803c8',
  'Rebellious Captives': '70401db7-edbc-402f-98ef-be74bd316273',
  'Liliana the Repentant': '5eb4403f-f199-4f75-a7c6-e76783f9b07d',
};
export const names = Object.keys(oracleIds);
export const sources = [...names, 'Dinosaur Dragon Token'].map((name) =>
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
  for (const player of s.players)
    for (const color of ['W', 'U', 'B', 'R', 'G', 'C']) player.mana[color] = 30;
  return s;
}
