import type {
  Effect,
  EffectCondition,
  StateCondition,
  ContinuousCondition,
} from '../../packages/engine/src/index.js';
const primary: EffectCondition = {
  kind: 'targetMatches',
  target: 'target',
  where: { power: { lte: 2 } },
};
const grouped: EffectCondition = { kind: 'targetEnteredThisTurn', targetGroup: 'actor' };
const nested: Effect = {
  op: 'conditional',
  condition: { kind: 'all', conditions: [primary, grouped, { kind: 'controllerTurn' }] },
  then: [],
};
// @ts-expect-error An explicit target binding is required.
const missing: EffectCondition = { kind: 'targetMatches', where: { type: 'creature' } };
const ambiguous: EffectCondition = {
  kind: 'targetEnteredThisTurn',
  target: 'target',
  // @ts-expect-error Primary and group bindings are exclusive.
  targetGroup: 'actor',
};
// @ts-expect-error Target information is not available in state/trigger gates.
const beforeTargets: StateCondition = primary;
// @ts-expect-error Target information is not a continuous condition.
const continuous: ContinuousCondition = { kind: 'all', conditions: [primary] };
void [primary, grouped, nested, missing, ambiguous, beforeTargets, continuous];
