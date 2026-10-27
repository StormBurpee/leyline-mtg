import type { Effect, CardPredicate } from '../../packages/engine/src/index.js';
const copy: Effect = { op: 'copyToken', subject: 'source', count: 2 };
const named: CardPredicate = { name: 'Gruff Triplets' };
// @ts-expect-error event copies are not implemented
const eventCopy: Effect = { op: 'copyToken', subject: 'eventSource', count: 1 };
void copy;
void named;
void eventCopy;
