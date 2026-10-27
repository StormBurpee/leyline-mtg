import type { Effect, EventSpec } from '../../packages/engine/src/index.js';
const departed: EventSpec = { event: 'leave', controller: 'you', hadCounters: true };
const blink: Effect = { op: 'blink', subject: 'eventSource', controller: 'owner' };
const animation: Effect = { op: 'animatePermanent', power: 0, toughness: 0, subtypes: ['Robot'] };
// @ts-expect-error Blink uses exact source/eventSource or a normal target, not an attachment binding.
const attached: Effect = { op: 'blink', subject: 'attached' };
const colors: Effect = {
  op: 'animatePermanent',
  power: 0,
  toughness: 0,
  subtypes: ['Robot'],
  // @ts-expect-error Permanent animation is additive and does not replace colors.
  colors: ['U'],
};
const temporary: Effect = {
  op: 'animatePermanent',
  power: 0,
  toughness: 0,
  subtypes: ['Robot'],
  // @ts-expect-error This primitive has no temporary-duration form.
  expires: 1,
};
// @ts-expect-error Counter-bearing event facts are boolean, not a threshold.
const counterCount: EventSpec = { event: 'leave', hadCounters: 3 };
void [departed, blink, animation, attached, colors, temporary, counterCount];
