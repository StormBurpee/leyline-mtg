import {
  createGame,
  legalActions,
  dispatch,
  chooseBotCommand,
} from '../../packages/engine/src/index.js';
/** Real command history, with both bargain options available for the client/replay tests. */
export function bargainPosition() {
  let s = createGame({
    seed: 9,
    mulligan: false,
    decks: [
      [
        ...Array(4).fill('Hamlet Glutton'),
        ...Array(4).fill('Candy Trail'),
        ...Array(52).fill('Forest'),
      ],
      Array(60).fill('Forest'),
    ],
  });
  for (let i = 0; i < 800; i++) {
    const p = s.choice?.player ?? s.priority,
      actions = legalActions(s, p);
    if (
      p === 0 &&
      !s.choice &&
      actions.some((a) => a.type === 'cast' && a.mode === 1 && a.sacrifice) &&
      actions.some((a) => a.type === 'cast' && a.mode === 0)
    )
      return s;
    const command = s.choice
      ? s.choice.kind === 'attackers'
        ? { type: 'attackers', cards: [], player: p }
        : chooseBotCommand(s, p)
      : {
          ...(actions.find((a) => a.type === 'playLand') ??
            actions.find((a) => a.type === 'cast' && s.objects[a.card].name === 'Candy Trail') ?? {
              type: 'pass',
            }),
          player: p,
        };
    const r = dispatch(s, command);
    if (!r.ok) throw Error(r.error.message);
    s = r.state;
  }
  throw Error('No bargain position reached');
}
