import type { CardDefinition } from '../../packages/engine/src/index.js';
const ownCreatures: NonNullable<CardDefinition['plusCounterBonus']> = {
  amount: 1,
  scope: 'creatureYouControl',
};
const ownCreaturesAndVehicles: NonNullable<CardDefinition['plusCounterBonus']> = {
  amount: 1,
  scope: 'creatureOrVehicleYouControl',
};
const multiplier: NonNullable<CardDefinition['plusCounterBonus']> = {
  amount: 1,
  scope: 'creatureYouControl',
  // @ts-expect-error noncommuting multiplication requires a replacement-order contract
  multiplier: 2,
};
const players: NonNullable<CardDefinition['plusCounterBonus']> = {
  amount: 1,
  // @ts-expect-error this is not an all-counter/player/placing-player replacement
  scope: 'player',
};
void ownCreatures;
void ownCreaturesAndVehicles;
void multiplier;
void players;
