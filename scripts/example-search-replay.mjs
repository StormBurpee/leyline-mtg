import {
  CARDS,
  DECKS,
  expandDeck,
  createGame,
  dispatch,
  chooseBotCommand,
  exportReplay,
} from '../packages/engine/src/index.js';
import { writeFile } from 'node:fs/promises';
let record;
for (let seed = 1; seed <= 30 && !record; seed++) {
  let state = createGame({
    seed,
    decks: [expandDeck(DECKS.roots.cards), expandDeck(DECKS.ember.cards)],
    catalog: CARDS,
    names: ['Roots & Relics', 'Ember & Echo'],
  });
  while (state.status !== 'finished' && state.revision < 1500) {
    const command = chooseBotCommand(state, state.choice?.player ?? state.priority);
    const result = dispatch(state, command);
    if (!result.ok) throw new Error(result.error.message);
    state = result.state;
    if (state.choice?.kind === 'librarySearch' && state.choice.player === 0) {
      record = exportReplay(state);
      break;
    }
  }
}
if (!record) throw new Error('No library search position found.');
await writeFile(
  new URL('../apps/web/example-search-replay.json', import.meta.url),
  JSON.stringify(record, null, 2) + '\n',
);
console.log(
  `Search example: seed ${record.config.seed}, ${record.commands.length} accepted commands.`,
);
