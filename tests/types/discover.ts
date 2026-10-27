import type { Choice, Effect, GameState } from '../../packages/engine/src/index.js';
const effect: Effect = { op: 'discover', amount: 4 };
const choice: Choice = { kind: 'castExiled', player: 0, card: 'c1', incarnation: 2, discover: 4 };
const chandra: Choice = { kind: 'castExiled', player: 0, card: 'c1', incarnation: 2, amount: 2 };
// @ts-expect-error Discover value is literal, not an unresolved binding.
const dynamic: Effect = { op: 'discover', amount: { kind: 'x' } };
const ambiguous: Choice = {
  kind: 'castExiled',
  player: 0,
  card: 'c1',
  incarnation: 2,
  amount: 2,
  // @ts-expect-error A resolution cast must have exactly one decline outcome.
  discover: 4,
};
declare const state: GameState;
state.resolving?.discover?.exiled satisfies
  | { kind: 'object'; id: string; incarnation: number }[]
  | undefined;
void [effect, choice, chandra, dynamic, ambiguous];
