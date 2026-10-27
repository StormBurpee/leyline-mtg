import type { Effect, NumericValue, EffectNumericValue } from '../../packages/engine/src/index.js';
const p: EffectNumericValue = { kind: 'sourceStat', stat: 'power' };
const e: Effect = { op: 'gainLife', amount: { kind: 'sum', values: [p, 1] } };
// @ts-expect-error source stats cannot participate in continuous expressions
const continuous: NumericValue = { kind: 'sourceStat', stat: 'power' };
void e;
void continuous;
