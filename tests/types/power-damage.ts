import type { Effect } from '../../packages/engine/src/index.js';
const sourceFight: Effect = { op: 'fight', source: 'source', victimGroup: 'victim' };
const sourceBite: Effect = { op: 'bite', source: 'source', victimGroup: 'victim' };
const targetedBite: Effect = { op: 'bite', sourceGroup: 'actor', victimGroup: 'victim' };
const ambiguous: Effect = {
  op: 'fight',
  source: 'source',
  // @ts-expect-error The two source bindings are exclusive.
  sourceGroup: 'actor',
  victimGroup: 'victim',
};
// @ts-expect-error The nontargeted binding must explicitly name source.
const unknown: Effect = { op: 'fight', source: 'attached', victimGroup: 'victim' };
// @ts-expect-error Neither operation infers a missing source binding.
const missing: Effect = { op: 'bite', victimGroup: 'victim' };
void [sourceFight, sourceBite, targetedBite, ambiguous, unknown, missing];
