import type { CardDefinition } from '../../packages/engine/src/index.js';
const entry: Pick<CardDefinition, 'entryPlusCounters'> = { entryPlusCounters: { kind: 'x' } };
const literal: Pick<CardDefinition, 'entryPlusCounters'> = { entryPlusCounters: 2 };
const cyclic: Pick<CardDefinition, 'entryPlusCounters'> = {
  // @ts-expect-error computed source statistics are not entry-counter expressions
  entryPlusCounters: { kind: 'sourceStat', stat: 'power' },
};
void entry;
void literal;
void cyclic;
