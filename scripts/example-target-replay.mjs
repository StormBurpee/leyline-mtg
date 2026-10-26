import {
  createGame,
  DECKS,
  expandDeck,
  chooseBotCommand,
  dispatch,
  exportReplay,
} from '../packages/engine/src/index.js';
import { writeFile } from 'node:fs/promises';
let found = false;
for (let seed = 1; seed <= 50 && !found; seed++) {
  let state = createGame({
    seed,
    names: ['Echo', 'Grove'],
    decks: [
      expandDeck(DECKS.ember.cards).map((name) =>
        name === 'Young Pyromancer' ? 'Exclusion Mage' : name,
      ),
      expandDeck(DECKS.grove.cards),
    ],
  });
  for (let decisions = 0; decisions < 1200 && state.status !== 'finished'; decisions++) {
    if (state.choice?.kind === 'triggerTarget' && state.choice.entry.name === 'Exclusion Mage') {
      await writeFile(
        new URL('../apps/web/example-target-replay.json', import.meta.url),
        JSON.stringify(exportReplay(state), null, 2) + '\n',
      );
      console.log(
        `Target-choice replay: seed ${seed}, turn ${state.turn}, ${decisions} accepted commands.`,
      );
      found = true;
      break;
    }
    const command = chooseBotCommand(state, state.choice?.player ?? state.priority);
    if (!command) throw new Error('Policy stopped before a terminal state.');
    const result = dispatch(state, command);
    if (!result.ok) throw new Error(result.error.message);
    state = result.state;
  }
}
if (!found) throw new Error('No target-choice position found.');
