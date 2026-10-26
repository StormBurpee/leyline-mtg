import { validateFilter } from './selectors.js';
export function validateCondition(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Expected a condition.'];
  if (value.kind === 'opponentLostLifeThisTurn')
    return Object.keys(value).length === 1 ? [] : ['Unexpected condition field.'];
  if (value.kind === 'controlAtLeast') {
    const errors = validateFilter(value.where);
    if (!Number.isSafeInteger(value.count) || value.count < 0 || value.count > 1000)
      errors.push('Invalid condition count.');
    if (Object.keys(value).some((k) => !['kind', 'where', 'count'].includes(k)))
      errors.push('Unexpected condition field.');
    return errors;
  }
  return ['Unsupported condition.'];
}
