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
const decks = [
  expandDeck(DECKS.ember.cards),
  expandDeck(DECKS.grove.cards).map((name) =>
    name === 'Grizzly Bears' ? 'Tomakul Honor Guard' : name,
  ),
];
const catalog = CARDS;
let record;
for (let seed = 1; seed <= 100 && !record; seed++) {
  let state = createGame({
    seed,
    decks,
    catalog,
    names: ['Ember & Echo', 'Grove with ward'],
  });
  while (state.status !== 'finished' && state.revision < 1200) {
    const result = dispatch(state, chooseBotCommand(state, state.choice?.player ?? state.priority));
    if (!result.ok) throw new Error(result.error.message);
    state = result.state;
    if (
      state.turn <= 15 &&
      state.choice?.kind === 'payCost' &&
      state.choice.player === 0 &&
      state.choice.payable
    ) {
      record = exportReplay(state);
      break;
    }
  }
}
if (!record) throw new Error('No payable ward example found.');
await writeFile(
  new URL('../apps/web/example-ward-replay.json', import.meta.url),
  JSON.stringify(record, null, 2) + '\n',
);
console.log(
  `Ward example: seed ${record.config.seed}, ${record.commands.length} accepted commands.`,
);
