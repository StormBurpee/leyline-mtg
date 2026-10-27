import {
  activationCost,
  abilityProblem,
  legalActions,
  type Action,
  type CardDefinition,
  type GameState,
  type GameObject,
  type StackEntry,
} from '../../packages/engine/src/index.js';
declare const state: GameState;
declare const source: GameObject;
declare const ability: NonNullable<CardDefinition['activated']>[number];
const command: Action = { type: 'activate', card: source.id, ability: 0, x: 3, autoTap: false };
const cost = activationCost(state, source, ability, command.x);
abilityProblem(state, 0, source.id, 0, undefined, undefined, undefined, undefined, 3, false);
legalActions(state, 0, { x: 3 });
const entry: Pick<StackEntry, 'x' | 'activationCost'> = { x: 3, activationCost: cost };
void entry;
