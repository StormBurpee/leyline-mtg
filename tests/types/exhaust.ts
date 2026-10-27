import type { CardSpec, Effect, GameObject } from '../../packages/engine/src/index.js';
const card: CardSpec = {
  name: 'Exhaust type probe',
  type: 'creature',
  cost: { G: 1 },
  power: 1,
  toughness: 1,
  activated: [
    {
      exhaust: true,
      cost: { mana: { G: 1 } },
      effects: [{ op: 'counterOn', subject: 'source', amount: 1 }],
      text: 'Exhaust',
    },
  ],
};
const object: Pick<GameObject, 'exhaustUses'> = { exhaustUses: { 0: 3, 1: 3 } };
const counter: Effect = {
  op: 'keywordCounter',
  subject: 'source',
  keyword: 'double strike',
  amount: 1,
};
const invalid: NonNullable<CardSpec['activated']>[number] = {
  // @ts-expect-error Exhaust is an affirmative keyword, not an optional mode.
  exhaust: false,
  cost: {},
  effects: [],
  text: '',
};
void [card, object, counter, invalid];
