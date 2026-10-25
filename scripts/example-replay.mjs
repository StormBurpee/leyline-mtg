import {
  createGame,
  chooseBotCommand,
  dispatch,
  exportReplay,
  controlled,
} from '../packages/engine/src/index.js';
import { writeFile } from 'node:fs/promises';
let example;
for (let seed = 1; seed <= 30 && !example; seed++) {
  let state = createGame({ seed, names: ['Ember & Echo', 'The Living Grove'] });
  while (state.status !== 'finished' && state.revision < 1500) {
    const result = dispatch(state, chooseBotCommand(state, state.choice?.player ?? state.priority));
    if (!result.ok) throw new Error(result.error.message);
    state = result.state;
    const creatures = Object.values(state.objects).filter(
      (o) =>
        o.zone === 'battlefield' && !['Mountain', 'Island', 'Forest', 'Plains'].includes(o.name),
    ).length;
    if (
      state.turn >= 5 &&
      state.stack.length >= 2 &&
      creatures >= 3 &&
      state.players[0].hand.length >= 3
    ) {
      example = exportReplay(state);
      break;
    }
  }
}
if (!example) throw new Error('No suitable recorded example found.');
const body = JSON.stringify(example, null, 2) + '\n';
await writeFile(new URL('../apps/web/example-replay.json', import.meta.url), body);
await writeFile(new URL('../docs/examples/cast-trigger-replay.json', import.meta.url), body);
console.log(
  `Recorded example: seed ${example.config.seed}, ${example.commands.length} accepted commands.`,
);
