import {
  DECKS,
  expandDeck,
  createGame,
  dispatch,
  chooseBotCommand,
  exportReplay,
  legalActions,
} from '../packages/engine/src/index.js';
import { writeFile } from 'node:fs/promises';
let record;
for (let seed = 1; seed <= 20 && !record; seed++) {
  let s = createGame({
    seed,
    decks: [expandDeck(DECKS.forks.cards), expandDeck(DECKS.relic.cards)],
    names: ['Forked Lightning', 'Relic Engine'],
  });
  while (s.status !== 'finished' && s.revision < 1000) {
    const r = dispatch(s, chooseBotCommand(s, s.choice?.player ?? s.priority));
    if (!r.ok) throw Error(r.error.message);
    s = r.state;
    if (!s.choice && s.priority === 0) {
      const casts = legalActions(s, 0).filter(
        (a) => a.type === 'cast' && s.objects[a.card].name === 'Abrade',
      );
      if (new Set(casts.map((a) => a.mode)).size === 2) {
        record = exportReplay(s);
        break;
      }
    }
  }
}
if (!record) throw Error('No modal example found');
await writeFile(
  new URL('../apps/web/example-modal-replay.json', import.meta.url),
  JSON.stringify(record, null, 2) + '\n',
);
console.log(`Modal example: seed ${record.config.seed}, ${record.commands.length} commands`);
