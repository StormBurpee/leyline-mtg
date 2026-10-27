import { readFile } from 'node:fs/promises';
import {
  CARDS,
  CARD_IDS,
  createGame,
  legalActions,
  dispatch,
  chooseBotCommand,
  stationCandidates,
} from '../../packages/engine/src/index.js';
import { compileCard } from '../../packages/cards/compiler.js';
export const stationNames = [
  'Atmospheric Greenhouse',
  'Dawnsire, Sunstar Dreadnought',
  'Debris Field Crusher',
  'Extinguisher Battleship',
  'Galvanizing Sawship',
  'Infinite Guideline Station',
  'Kavaron, Memorial World',
  'Lumen-Class Frigate',
  'Pinnacle Kill-Ship',
  'Rescue Skiff',
  'Specimen Freighter',
  'Susurian Dirgecraft',
  'The Seriema',
  'Uthros Scanship',
  'Warmaker Gunship',
  'Wedgelight Rammer',
  'Wurmwall Sweeper',
];
export const stationSources = await Promise.all(
  stationNames.map((name) => {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return readFile(new URL(`../../packages/cards/cards/${slug}.json`, import.meta.url)).then(
      JSON.parse,
    );
  }),
);
export const stationIdentities = {
  ...CARD_IDS,
  ...Object.fromEntries(stationSources.map((s) => [s.id, s.name])),
};
export const stationDefinitions = stationSources.map((source) => {
  const result = compileCard(source, { identities: stationIdentities });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.definition;
});
export const stationCatalog = {
  ...CARDS,
  ...Object.fromEntries(stationDefinitions.map((d) => [d.name, d])),
};
export function stationPosition(minimumPayers = 1) {
  let s = createGame({
    seed: 9,
    mulligan: false,
    catalog: stationCatalog,
    decks: [
      [
        ...Array(4).fill('Wurmwall Sweeper'),
        ...Array(4).fill('Savannah Lions'),
        ...Array(4).fill('Grizzly Bears'),
        ...Array(48).fill('Plains'),
      ],
      Array(60).fill('Forest'),
    ],
  });
  for (let i = 0; i < 800; i++) {
    const p = s.choice?.player ?? s.priority,
      actions = legalActions(s, p);
    if (
      p === 0 &&
      actions.some(
        (a) => a.type === 'station' && stationCandidates(s, p, a.card).length >= minimumPayers,
      )
    )
      return s;
    const command = s.choice
      ? s.choice.kind === 'attackers'
        ? { type: 'attackers', cards: [], player: p }
        : chooseBotCommand(s, p)
      : {
          ...(actions.find((a) => a.type === 'playLand') ??
            actions.find((a) => a.type === 'cast') ?? { type: 'pass' }),
          player: p,
        };
    const result = dispatch(s, command);
    if (!result.ok) throw new Error(result.error.message);
    s = result.state;
  }
  throw new Error('No station position reached');
}
