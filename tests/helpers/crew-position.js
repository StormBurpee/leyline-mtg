import {
  createGame,
  legalActions,
  dispatch,
  chooseBotCommand,
} from '../../packages/engine/src/index.js';
export function crewPosition() {
  let s = createGame({
    seed: 9,
    mulligan: false,
    decks: [
      [
        ...Array(4).fill('Air Response Unit'),
        ...Array(4).fill('Savannah Lions'),
        ...Array(52).fill('Plains'),
      ],
      Array(60).fill('Forest'),
    ],
  });
  for (let i = 0; i < 800; i++) {
    const p = s.choice?.player ?? s.priority;
    const actions = legalActions(s, p);
    if (p === 0 && actions.some((a) => a.type === 'crew')) return s;
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
  throw new Error('No crew position reached');
}
