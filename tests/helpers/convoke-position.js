import {
  createGame,
  legalActions,
  dispatch,
  chooseBotCommand,
  convokeCandidates,
} from '../../packages/engine/src/index.js';
export function convokePosition() {
  let s = createGame({
    seed: 9,
    mulligan: false,
    decks: [
      [
        ...Array(4).fill('Sun-Dappled Celebrant'),
        ...Array(4).fill('Savannah Lions'),
        ...Array(4).fill('Aegis Turtle'),
        ...Array(48).fill('Plains'),
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
      convokeCandidates(s, 0).length &&
      actions.some((a) => a.type === 'cast' && s.objects[a.card].name === 'Sun-Dappled Celebrant')
    )
      return s;
    const command = s.choice
      ? s.choice.kind === 'attackers'
        ? { type: 'attackers', cards: [], player: p }
        : chooseBotCommand(s, p)
      : {
          ...(actions.find((a) => a.type === 'playLand') ??
            actions.find(
              (a) => a.type === 'cast' && s.objects[a.card].name !== 'Sun-Dappled Celebrant',
            ) ?? { type: 'pass' }),
          player: p,
        };
    const r = dispatch(s, command);
    if (!r.ok) throw Error(r.error.message);
    s = r.state;
  }
  throw Error('No convoke position reached');
}
