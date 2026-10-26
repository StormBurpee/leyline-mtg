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
const deck = expandDeck(DECKS.grove.cards).map((name) =>
  name === 'Soul Warden'
    ? 'Mesa Enchantress'
    : name === 'Elvish Visionary'
      ? 'Spirited Companion'
      : name,
);
let record;
for (let seed = 1; seed <= 30 && !record; seed++) {
  let s = createGame({
    seed,
    decks: [deck, expandDeck(DECKS.ember.cards)],
    catalog: CARDS,
    names: ['Enchantress practice', 'Ember & Echo'],
  });
  while (s.status !== 'finished' && s.revision < 1500) {
    const r = dispatch(s, chooseBotCommand(s, s.choice?.player ?? s.priority));
    if (!r.ok) throw new Error(r.error.message);
    s = r.state;
    if (s.choice?.kind === 'optionalEffect' && s.choice.player === 0) {
      record = exportReplay(s);
      break;
    }
  }
}
if (!record) throw new Error('No optional draw example found.');
await writeFile(
  new URL('../apps/web/example-optional-replay.json', import.meta.url),
  JSON.stringify(record, null, 2) + '\n',
);
console.log(
  `Optional draw example: seed ${record.config.seed}, ${record.commands.length} accepted commands.`,
);
