import {
  type EventSpec,
  type CardSpec,
  validateEventSpec,
} from '../../packages/engine/src/index.js';
const event: EventSpec = {
  event: 'enterGroup',
  controller: 'you',
  excludeSource: true,
  filter: { token: true },
};
const observer: CardSpec = {
  name: 'Entry observer',
  type: 'enchantment',
  cost: {},
  triggers: [{ event, effects: [{ op: 'draw', count: 1 }], oncePerTurn: true }],
};
void observer;
void validateEventSpec(event);
