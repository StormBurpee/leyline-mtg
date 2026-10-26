import {
  DECKS,
  expandDeck,
  createGame,
  dispatch,
  chooseBotCommand,
  exportReplay,
} from '../packages/engine/src/index.js';
import { writeFile } from 'node:fs/promises';
let record;
for (let seed = 1; seed <= 20 && !record; seed++) {
  let s = createGame({
    seed,
    decks: [expandDeck(DECKS.assault.cards), expandDeck(DECKS.dawn.cards)],
    names: ['First Blood', 'First Light'],
  });
  while (s.status !== 'finished' && s.revision < 1000) {
    const r = dispatch(s, chooseBotCommand(s, s.choice?.player ?? s.priority));
    if (!r.ok) throw Error(r.error.message);
    s = r.state;
    if (s.step === 'attackers' && s.choice?.kind === 'orderTriggers' && s.choice.player === 0) {
      record = exportReplay(s);
      break;
    }
  }
}
if (!record) throw Error('No attack ordering example found');
await writeFile(
  new URL('../apps/web/example-attack-replay.json', import.meta.url),
  JSON.stringify(record, null, 2) + '\n',
);
console.log(`Attack example: seed ${record.config.seed}, ${record.commands.length} commands`);
