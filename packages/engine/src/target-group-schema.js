import { validateTargetSpec } from './selectors.js';
const plain = (x) =>
  x !== null &&
  typeof x === 'object' &&
  !Array.isArray(x) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(x));
/** Ordered target declarations: distinct within each declaration, not across declarations. */
export function validateTargetGroups(groups) {
  if (!Array.isArray(groups) || groups.length < 1 || groups.length > 8)
    return ['Expected 1–8 target groups.'];
  const errors = [],
    ids = new Set();
  let total = 0;
  for (const g of groups) {
    if (!plain(g)) {
      errors.push('Expected a target group object.');
      continue;
    }
    if (
      Object.keys(g).some(
        (k) => !['id', 'label', 'selector', 'min', 'max', 'excludeFrom'].includes(k),
      )
    )
      errors.push('Unsupported target group field.');
    if (
      typeof g.id !== 'string' ||
      !/^[a-z][a-zA-Z0-9_]{0,39}$/.test(g.id) ||
      ['constructor', 'prototype', '__proto__'].includes(g.id) ||
      ids.has(g.id)
    )
      errors.push('Target group IDs must be unique safe identifiers.');
    if (
      g.label !== undefined &&
      (typeof g.label !== 'string' || !g.label.trim() || g.label.length > 120)
    )
      errors.push('Invalid target group label.');
    errors.push(...validateTargetSpec(g.selector));
    if (
      !Number.isSafeInteger(g.min) ||
      !Number.isSafeInteger(g.max) ||
      g.min < 0 ||
      g.max < 1 ||
      g.max > 8 ||
      g.min > g.max
    )
      errors.push('Invalid target group cardinality.');
    else total += g.max;
    if (
      g.excludeFrom !== undefined &&
      (!Array.isArray(g.excludeFrom) ||
        g.excludeFrom.length > 7 ||
        new Set(g.excludeFrom).size !== g.excludeFrom.length ||
        g.excludeFrom.some((id) => !ids.has(id)))
    )
      errors.push('Target exclusions must reference distinct earlier groups.');
    ids.add(g.id);
  }
  if (total > 16) errors.push('Too many target slots.');
  return errors;
}
