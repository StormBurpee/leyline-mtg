import {
  type EventSpec,
  type CardSpec,
  validateEventSpec,
} from '../../packages/engine/src/index.js';

const creatures: EventSpec = {
  event: 'diesGroup',
  controller: 'you',
  excludeSource: true,
  filter: { token: false },
};
const permanents: EventSpec = {
  event: 'battlefieldToGraveyardGroup',
  filter: { any: [{ type: 'creature' }, { type: 'artifact' }] },
};
const observer: CardSpec = {
  name: 'Aggregate observer',
  type: 'enchantment',
  cost: {},
  triggers: [{ event: creatures, effects: [{ op: 'draw', count: 1 }], oncePerTurn: true }],
};
void observer;
void validateEventSpec(permanents);
// @ts-expect-error This implementation does not provide generic sacrifice aggregation.
const unsupported: EventSpec = { event: 'sacrificeGroup' };
void unsupported;
