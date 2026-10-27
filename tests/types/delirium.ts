import type {
  NumericValue,
  EffectNumericValue,
  CardDefinition,
} from '../../packages/engine/src/index.js';
const graveyard: NumericValue = { kind: 'graveyardCardTypes', player: 'you' };
const union: EffectNumericValue = { kind: 'graveyardCardTypes', player: 'all' };
const restriction: Pick<CardDefinition, 'conditionalCombatRestrictions'> = {
  conditionalCombatRestrictions: [
    {
      restriction: 'cannotAttack',
      condition: { kind: 'compare', left: graveyard, operator: 'lt', right: 4 },
    },
  ],
};
// @ts-expect-error This expression cannot inspect hidden zones.
const hidden: NumericValue = { kind: 'graveyardCardTypes', player: 'you', zone: 'hand' };
// @ts-expect-error Player relations are explicit and closed.
const unknown: NumericValue = { kind: 'graveyardCardTypes', player: 'target' };
void [graveyard, union, restriction, hidden, unknown];
