import {
  createGame,
  legalActions,
  dispatch,
  chooseBotCommand,
} from '../../packages/engine/src/index.js';
export function castingSacrificePosition() {
  let s = createGame({
    seed: 9,
    mulligan: false,
    decks: [
      [
        ...Array(4).fill('Corrupted Conviction'),
        ...Array(4).fill('Llanowar Elves'),
        ...Array(26).fill('Forest'),
        ...Array(26).fill('Swamp'),
      ],
      Array(60).fill('Forest'),
    ],
  });
  for (let i = 0; i < 800; i++) {
    const p = s.choice?.player ?? s.priority,
      actions = legalActions(s, p);
    if (p === 0 && !s.choice && actions.some((a) => a.type === 'cast' && a.sacrifice)) return s;
    const command = s.choice
      ? s.choice.kind === 'attackers'
        ? { type: 'attackers', cards: [], player: p }
        : chooseBotCommand(s, p)
      : {
          ...(actions.find((a) => a.type === 'playLand') ??
            actions.find((a) => a.type === 'cast' && !a.sacrifice) ?? { type: 'pass' }),
          player: p,
        };
    const r = dispatch(s, command);
    if (!r.ok) throw Error(r.error.message);
    s = r.state;
  }
  throw Error('No additional-sacrifice position reached');
}
