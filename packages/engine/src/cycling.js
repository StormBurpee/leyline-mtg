import { CARD_TYPES } from './types.js';

/** Typecycling searches printed types, not just basic lands (CR 702.29e). */
export function cyclingFilter(type) {
  if (type === 'Basic land') return { all: [{ type: 'land' }, { basic: true }] };
  if (CARD_TYPES.includes(type.toLowerCase())) return { type: type.toLowerCase() };
  return { subtype: type };
}
