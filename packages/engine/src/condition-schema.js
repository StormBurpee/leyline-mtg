import { CARD_TYPES } from './types.js';
import { validateFilter } from './selectors.js';
import { validateNumericValue } from './value-schema.js';
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const stable = (v) =>
  Object.entries(v).every(([key, value]) =>
    ['all', 'any'].includes(key)
      ? value.every(stable)
      : key === 'not'
        ? stable(value)
        : !['power', 'toughness', 'keyword'].includes(key),
  );
export function validateCondition(value, { continuous = false } = {}) {
  const errors = [];
  let nodes = 0;
  const visit = (v, depth = 0) => {
    if (++nodes > 128 || depth > 8) {
      errors.push('Condition exceeds complexity budget.');
      return;
    }
    if (!plain(v)) {
      errors.push('Expected a condition.');
      return;
    }
    const fields = {
      opponentLostLifeThisTurn: ['kind'],
      additionalCostPaid: ['kind'],
      controllerLostLifeThisTurn: ['kind'],
      controllerTurn: ['kind'],
      sourceType: ['kind', 'type'],
      sourceQuestCountersAtLeast: ['kind', 'count'],
      sourceExiledCardTypesAtLeast: ['kind', 'count'],
      eventManaSpentAtLeast: ['kind', 'count'],
      controllerFirstTurns: ['kind', 'count'],
      opponentTurn: ['kind'],
      sourceAttacking: ['kind'],
      sourceEnteredThisTurn: ['kind'],
      controlAtLeast: ['kind', 'where', 'count'],
      compare: ['kind', 'left', 'right', 'operator'],
      all: ['kind', 'conditions'],
      any: ['kind', 'conditions'],
    }[v.kind];
    if (!fields) {
      errors.push('Unsupported condition.');
      return;
    }
    if (Object.keys(v).some((k) => !fields.includes(k))) errors.push('Unexpected condition field.');
    if (v.kind === 'additionalCostPaid' && continuous)
      errors.push('Additional-cost conditions are resolution-only.');
    if (v.kind === 'sourceAttacking' && !continuous)
      errors.push('Source-state conditions are supported for continuous bonuses only.');
    if (
      v.kind === 'controllerFirstTurns' &&
      (!Number.isSafeInteger(v.count) || v.count < 1 || v.count > 1000)
    )
      errors.push('Invalid first-turn count.');
    if (
      v.kind === 'sourceExiledCardTypesAtLeast' &&
      (!Number.isInteger(v.count) || v.count < 0 || v.count > 9)
    )
      errors.push('Invalid linked card type count.');
    if (
      v.kind === 'eventManaSpentAtLeast' &&
      (!Number.isSafeInteger(v.count) || v.count < 0 || v.count > 1000 || continuous)
    )
      errors.push('Invalid event mana condition.');
    if (
      v.kind === 'sourceQuestCountersAtLeast' &&
      (!Number.isSafeInteger(v.count) || v.count < 1 || v.count > 1000)
    )
      errors.push('Invalid quest counter count.');
    if (v.kind === 'sourceType' && !CARD_TYPES.includes(v.type))
      errors.push('Invalid source type.');
    if (v.kind === 'controlAtLeast') {
      const filterErrors = validateFilter(v.where);
      errors.push(...filterErrors);
      if (!Number.isSafeInteger(v.count) || v.count < 0 || v.count > 1000)
        errors.push('Invalid condition count.');
      if (continuous && !filterErrors.length && !stable(v.where))
        errors.push('Continuous conditions cannot depend on computed statistics or keywords.');
    }
    if (v.kind === 'compare') {
      errors.push(...validateNumericValue(v.left), ...validateNumericValue(v.right));
      if (!['eq', 'ne', 'lt', 'lte', 'gt', 'gte'].includes(v.operator))
        errors.push('Unsupported condition comparison.');
    }
    if (['all', 'any'].includes(v.kind)) {
      if (!Array.isArray(v.conditions) || !v.conditions.length || v.conditions.length > 8)
        errors.push('Expected 1–8 conditions.');
      else v.conditions.forEach((c) => visit(c, depth + 1));
    }
  };
  visit(value);
  return errors;
}
