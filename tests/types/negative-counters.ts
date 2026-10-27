import type { Effect } from '../../packages/engine/src/index.js';
const targeted: Effect = { op: 'counterOn', counter: '-1/-1', amount: 4 };
const group: Effect = {
  op: 'counterAll',
  counter: '-1/-1',
  amount: 2,
  where: { type: 'creature' },
};
const positive: Effect = { op: 'counterOn', amount: 1, subject: 'source' };
// @ts-expect-error arbitrary counter kinds remain unsupported
const poison: Effect = { op: 'counterOn', counter: 'poison', amount: 1 };
void targeted;
void group;
void positive;
void poison;
