import type { Effect, Command, Choice } from '../../packages/engine/src/index.js';
const effect: Effect = {
  op: 'chooseEffect',
  player: 'opponent',
  options: [
    { label: 'Decline', effects: [] },
    {
      label: 'Tap target',
      condition: { kind: 'targetMatches', target: 'target', where: { tapped: false } },
      effects: [{ op: 'tap' }],
    },
  ],
};
const command: Command = { type: 'chooseEffect', player: 0, option: 1 };
const choice: Choice = {
  kind: 'effectChoice',
  player: 0,
  name: 'A choice',
  options: [{ index: 0, label: 'Decline' }],
};
const bad: Effect = {
  op: 'chooseEffect',
  options: [
    // @ts-expect-error Resolution alternatives do not announce targets.
    { label: 'New target', target: 'creature', effects: [] },
  ],
};
void [effect, command, choice, bad];
