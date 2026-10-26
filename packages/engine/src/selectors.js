import { CARD_TYPES, hasType } from './types.js';
const plain = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const PRESETS = freeze({
  any: { scope: 'damageable' },
  player: { scope: 'player' },
  opponent: { scope: 'player', where: { controller: 'opponent' } },
  creature: { scope: 'permanent', where: { type: 'creature' } },
  nonblackCreature: {
    scope: 'permanent',
    where: { all: [{ type: 'creature' }, { not: { color: 'B' } }] },
  },
  spell: { scope: 'spell' },
  noncreatureSpell: { scope: 'spell', where: { not: { type: 'creature' } } },
  artifact: { scope: 'permanent', where: { type: 'artifact' } },
  enchantment: { scope: 'permanent', where: { type: 'enchantment' } },
  artifactOrEnchantment: {
    scope: 'permanent',
    where: { any: [{ type: 'artifact' }, { type: 'enchantment' }] },
  },
  permanent: { scope: 'permanent' },
});
const SCOPES = new Set(['permanent', 'spell', 'player', 'damageable', 'graveyard']);
const COMPARISONS = new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte']);
export function targetSpec(value) {
  return typeof value === 'string'
    ? Object.hasOwn(PRESETS, value)
      ? PRESETS[value]
      : null
    : plain(value)
      ? value
      : null;
}
export function validateFilter(filter) {
  const errors = [];
  let nodes = 0;
  function visit(value, path, depth) {
    if (++nodes > 128 || depth > 12) {
      errors.push(`${path}: predicate exceeds the supported complexity budget.`);
      return;
    }
    if (!plain(value) || Object.keys(value).length !== 1) {
      errors.push(`${path}: expected one predicate operator.`);
      return;
    }
    const [key, operand] = Object.entries(value)[0];
    if (key === 'all' || key === 'any') {
      if (!Array.isArray(operand) || operand.length < 1 || operand.length > 32) {
        errors.push(`${path}.${key}: expected 1–32 predicates.`);
        return;
      }
      operand.forEach((child, i) => visit(child, `${path}.${key}[${i}]`, depth + 1));
      return;
    }
    if (key === 'not') {
      visit(operand, `${path}.not`, depth + 1);
      return;
    }
    if (key === 'type') {
      if (!CARD_TYPES.includes(operand)) errors.push(`${path}.type: unsupported card type.`);
      return;
    }
    if (key === 'color') {
      if (!['W', 'U', 'B', 'R', 'G', 'colorless'].includes(operand))
        errors.push(`${path}.color: unsupported color predicate.`);
      return;
    }
    if (key === 'controller' || key === 'owner') {
      if (!['you', 'opponent'].includes(operand))
        errors.push(`${path}.${key}: expected you or opponent.`);
      return;
    }
    if (key === 'subtype') {
      if (typeof operand !== 'string' || !operand.trim() || operand.length > 80)
        errors.push(`${path}.subtype: expected a subtype name.`);
      return;
    }
    if (['tapped', 'token', 'basic', 'legendary', 'attacking'].includes(key)) {
      if (typeof operand !== 'boolean') errors.push(`${path}.${key}: expected a boolean.`);
      return;
    }
    if (['power', 'toughness', 'manaValue'].includes(key)) {
      if (!plain(operand) || Object.keys(operand).length !== 1) {
        errors.push(`${path}.${key}: expected one numeric comparison.`);
        return;
      }
      const [operator, amount] = Object.entries(operand)[0];
      if (!COMPARISONS.has(operator) || !Number.isSafeInteger(amount))
        errors.push(`${path}.${key}: unsupported comparison or non-integer amount.`);
      return;
    }
    errors.push(`${path}: unsupported predicate ${key}.`);
  }
  visit(filter, 'where', 0);
  return errors;
}
export function validateTargetSpec(value) {
  const spec = targetSpec(value);
  if (!spec) return ['Unknown target selector.'];
  const errors = [];
  if (Object.keys(spec).some((key) => !['scope', 'where'].includes(key)))
    errors.push('Unsupported target selector field.');
  if (!SCOPES.has(spec.scope)) errors.push('Unsupported target scope.');
  if (spec.where !== undefined) errors.push(...validateFilter(spec.where));
  return errors;
}
/** Evaluate data predicates over public facts; no callbacks or source-code expressions. */
export function matchesFilter(facts, filter, you) {
  if (filter === undefined) return true;
  const [key, value] = Object.entries(filter)[0] ?? [];
  if (key === 'all') return value.every((child) => matchesFilter(facts, child, you));
  if (key === 'any') return value.some((child) => matchesFilter(facts, child, you));
  if (key === 'not') return !matchesFilter(facts, value, you);
  if (key === 'type') return !!facts.definition && hasType(facts.definition, value);
  if (key === 'color')
    return (
      !!facts.definition &&
      (value === 'colorless'
        ? facts.definition.color.length === 0
        : facts.definition.color.includes(value))
    );
  if (key === 'controller' || key === 'owner')
    return (
      Number.isInteger(facts[key]) && (value === 'you' ? facts[key] === you : facts[key] !== you)
    );
  if (key === 'basic' || key === 'legendary') return !!facts.definition?.[key] === value;
  if (key === 'subtype') return !!facts.definition?.subtypes?.includes(value);
  if (key === 'token' || key === 'tapped' || key === 'attacking') return facts[key] === value;
  if (['power', 'toughness', 'manaValue'].includes(key)) {
    const actual = facts[key];
    if (!Number.isFinite(actual)) return false;
    const [operator, amount] = Object.entries(value)[0];
    switch (operator) {
      case 'eq':
        return actual === amount;
      case 'ne':
        return actual !== amount;
      case 'lt':
        return actual < amount;
      case 'lte':
        return actual <= amount;
      case 'gt':
        return actual > amount;
      case 'gte':
        return actual >= amount;
      default:
        return false;
    }
  }
  return false;
}
function impliesCreature(filter) {
  if (!filter) return false;
  if (filter.type === 'creature') return true;
  if (filter.all) return filter.all.some(impliesCreature);
  if (filter.any) return filter.any.length > 0 && filter.any.every(impliesCreature);
  return false;
}
export function effectTargetCompatible(op, value) {
  const spec = targetSpec(value);
  if (!spec) return false;
  if (op === 'damage')
    return (
      ['damageable', 'player'].includes(spec.scope) ||
      (spec.scope === 'permanent' && impliesCreature(spec.where))
    );
  if (op === 'modify') return spec.scope === 'permanent' && impliesCreature(spec.where);
  if (op === 'untap') return spec.scope === 'permanent';
  if (op === 'counter') return spec.scope === 'spell';
  if (['mill', 'draw', 'discard', 'gainLife', 'loseLife', 'scry', 'surveil'].includes(op))
    return spec.scope === 'player';
  if (op === 'moveTarget') return ['permanent', 'graveyard'].includes(spec.scope);
  if (['destroy', 'bounce'].includes(op)) return spec.scope === 'permanent';
  return true;
}
