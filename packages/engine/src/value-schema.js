import { validateSpellHistoryFilter } from './spell-history.js';
import { validateFilter } from './selectors.js';
const plain = (v) =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const stableFilter = (v) =>
  Object.entries(v).every(([key, value]) =>
    ['all', 'any'].includes(key)
      ? value.every(stableFilter)
      : key === 'not'
        ? stableFilter(value)
        : !['power', 'toughness', 'keyword'].includes(key),
  );
/** Closed, bounded data expressions. No callbacks or code evaluation. */
export function validateNumericValue(value, { effect = false } = {}) {
  const errors = [];
  let nodes = 0;
  const visit = (v, depth = 0) => {
    if (++nodes > 128 || depth > 8) {
      errors.push('Numeric expression exceeds its complexity budget.');
      return;
    }
    if (typeof v === 'number') {
      if (!Number.isSafeInteger(v)) errors.push('Expected a safe integer.');
      return;
    }
    if (!plain(v)) {
      errors.push('Expected a numeric expression.');
      return;
    }
    const allowed = {
      x: ['kind'],
      sourceStat: ['kind', 'stat'],
      maxManaValue: ['kind', 'player', 'where'],
      count: ['kind', 'zone', 'player', 'where', 'excludeSource'],
      life: ['kind', 'player'],
      spellsCast: ['kind', 'player', 'where'],
      sum: ['kind', 'values'],
      scale: ['kind', 'value', 'factor'],
      floorDivide: ['kind', 'value', 'divisor'],
    }[v.kind];
    if (!allowed) {
      errors.push('Unknown numeric expression kind.');
      return;
    }
    if (Object.keys(v).some((k) => !allowed.includes(k)))
      errors.push('Unexpected numeric expression field.');
    if (
      ['count', 'maxManaValue', 'life', 'spellsCast'].includes(v.kind) &&
      !['you', 'opponent', ...(v.kind !== 'life' ? ['all'] : [])].includes(v.player)
    )
      errors.push('Expected a player relation.');
    if (v.kind === 'sourceStat') {
      if (!effect) errors.push('Source statistics are only supported in resolving effects.');
      if (!['power', 'toughness'].includes(v.stat)) errors.push('Expected power or toughness.');
    }
    if (v.kind === 'spellsCast' && v.where !== undefined)
      errors.push(...validateSpellHistoryFilter(v.where));
    if (v.kind === 'maxManaValue' && v.where !== undefined) {
      const invalid = validateFilter(v.where);
      errors.push(...invalid);
      if (!invalid.length && !stableFilter(v.where))
        errors.push('Mana-value filters cannot depend on computed characteristics.');
    }
    if (v.kind === 'count') {
      if (!['battlefield', 'graveyard', 'exile', 'hand', 'library'].includes(v.zone))
        errors.push('Unsupported counted zone.');
      if (v.excludeSource !== undefined && typeof v.excludeSource !== 'boolean')
        errors.push('excludeSource must be boolean.');
      if (v.where !== undefined) {
        const invalid = validateFilter(v.where);
        errors.push(...invalid);
        if (!invalid.length && !stableFilter(v.where))
          errors.push('Count filters cannot depend on computed power, toughness or keywords.');
      }
      if (['hand', 'library'].includes(v.zone) && (v.where !== undefined || v.excludeSource))
        errors.push('Hidden zones support public counts only, not characteristic queries.');
    }
    if (v.kind === 'sum') {
      if (!Array.isArray(v.values) || v.values.length < 1 || v.values.length > 8)
        errors.push('Sum needs 1–8 values.');
      else v.values.forEach((x) => visit(x, depth + 1));
    }
    if (v.kind === 'floorDivide') {
      if (!Number.isSafeInteger(v.divisor) || v.divisor < 1 || v.divisor > 1000)
        errors.push('Divisor must be an integer from 1 to 1000.');
      visit(v.value, depth + 1);
    }
    if (v.kind === 'scale') {
      if (!Number.isSafeInteger(v.factor) || Math.abs(v.factor) > 1000)
        errors.push('Scale factor must be an integer from -1000 to 1000.');
      visit(v.value, depth + 1);
    }
  };
  visit(value);
  return errors;
}
export const validNumericValue = (
  value,
  { nonnegative = false, limit = Number.MAX_SAFE_INTEGER, effect = false } = {},
) =>
  typeof value === 'number'
    ? Number.isSafeInteger(value) && (!nonnegative || value >= 0) && Math.abs(value) <= limit
    : validateNumericValue(value, { effect }).length === 0;
