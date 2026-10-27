import {
  createGame,
  legalActions,
  dispatch,
  chooseBotCommand,
} from '../../packages/engine/src/index.js';
export function kaitoPosition() {
  const kaito = 'Kaito, Bane of Nightmares';
  let s = createGame({
    seed: 7,
    mulligan: false,
    decks: [
      [
        ...Array(4).fill(kaito),
        ...Array(4).fill('Spectral Sailor'),
        ...Array(4).fill('Typhoid Rats'),
        ...Array(24).fill('Island'),
        ...Array(24).fill('Swamp'),
      ],
      Array(60).fill('Forest'),
    ],
  });
  for (let i = 0; i < 900; i++) {
    const p = s.choice?.player ?? s.priority,
      actions = legalActions(s, p);
    if (p === 0 && actions.some((a) => a.type === 'ninjutsu')) return s;
    const command = s.choice
      ? chooseBotCommand(s, p)
      : {
          ...(actions.find((a) => a.type === 'playLand') ??
            actions.find((a) => a.type === 'cast' && s.objects[a.card].name !== kaito) ?? {
              type: 'pass',
            }),
          player: p,
        };
    const result = dispatch(s, command);
    if (!result.ok) throw Error(result.error.message);
    s = result.state;
  }
  throw Error('No ninjutsu position reached');
}
