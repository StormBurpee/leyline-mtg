import { CARDS } from './cards.js';

const TYPES = new Set(['land', 'creature', 'instant', 'sorcery', 'enchantment', 'artifact']);
const COLORS = new Set(['W', 'U', 'B', 'R', 'G']);
const MANA = new Set([...COLORS, 'C', 'generic']);
const KEYWORDS = new Set([
  'flying',
  'reach',
  'haste',
  'vigilance',
  'trample',
  'deathtouch',
  'lifelink',
  'defender',
  'first strike',
  'double strike',
  'flash',
  'hexproof',
  'shroud',
  'indestructible',
]);
const TARGETS = new Set([
  'any',
  'player',
  'opponent',
  'creature',
  'nonblackCreature',
  'spell',
  'noncreatureSpell',
]);
const TRIGGERS = new Set([
  'otherCreatureEnters',
  'controllerCastsNoncreature',
  'controllerCastsInstantOrSorcery',
]);
const FIELDS = new Set([
  'name',
  'type',
  'cost',
  'text',
  'color',
  'keywords',
  'subtypes',
  'power',
  'toughness',
  'basic',
  'token',
  'mana',
  'target',
  'effects',
  'etb',
  'aura',
  'static',
  'triggers',
  'activated',
]);
const plain = (v) =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const natural = (v) => Number.isSafeInteger(v) && v >= 0;
const signed = (v) => Number.isSafeInteger(v);
const frozen = (value) => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
};
export class RegistryError extends Error {
  constructor(diagnostics) {
    super(`Invalid card registry:\n${diagnostics.join('\n')}`);
    this.name = 'RegistryError';
    this.diagnostics = diagnostics;
  }
}
function validateCost(cost, path, errors) {
  if (!plain(cost)) {
    errors.push(`${path}: expected a mana-cost object.`);
    return;
  }
  for (const [key, n] of Object.entries(cost))
    if (!MANA.has(key) || !natural(n))
      errors.push(`${path}.${key}: unsupported mana symbol or nonnegative integer amount.`);
}
function validateEffects(effects, path, target, errors) {
  if (!Array.isArray(effects) || effects.length > 64) {
    errors.push(`${path}: expected at most 64 effect instructions.`);
    return;
  }
  for (const [index, e] of effects.entries()) {
    const p = `${path}[${index}]`;
    if (!plain(e)) {
      errors.push(`${p}: expected an effect object.`);
      continue;
    }
    const schema = {
      damage: ['amount'],
      damageOpponent: ['amount'],
      gainLife: ['amount'],
      draw: ['count'],
      scry: ['count'],
      surveil: ['count'],
      discard: ['count'],
      counter: [],
      bounce: [],
      destroy: [],
      modify: ['subject', 'power', 'toughness', 'keywords'],
      token: ['definition', 'count'],
      counterOn: ['subject', 'amount'],
      untap: ['subject'],
    }[e.op];
    if (!schema) {
      errors.push(`${p}: unsupported effect opcode ${String(e.op)}.`);
      continue;
    }
    for (const key of Object.keys(e))
      if (key !== 'op' && !schema.includes(key))
        errors.push(`${p}.${key}: unsupported effect parameter.`);
    if (['damage', 'damageOpponent', 'gainLife', 'counterOn'].includes(e.op) && !natural(e.amount))
      errors.push(`${p}.amount: expected a nonnegative safe integer.`);
    if (
      ['draw', 'token', 'scry', 'surveil', 'discard'].includes(e.op) &&
      (!natural(e.count) || e.count > 1000)
    )
      errors.push(`${p}.count: expected a literal count from 0 to 1000.`);
    if (e.op === 'token' && (typeof e.definition !== 'string' || !e.definition))
      errors.push(`${p}.definition: expected a token definition name.`);
    if (e.op === 'modify') {
      if (!signed(e.power) || !signed(e.toughness))
        errors.push(`${p}: power and toughness changes must be safe integers.`);
      if (e.subject !== undefined && e.subject !== 'source')
        errors.push(`${p}.subject: only source or the chosen target is supported.`);
      if (
        e.keywords !== undefined &&
        (!Array.isArray(e.keywords) || e.keywords.some((k) => !KEYWORDS.has(k)))
      )
        errors.push(`${p}.keywords: unsupported keyword.`);
    }
    if (['counterOn', 'untap'].includes(e.op) && e.subject !== 'source')
      errors.push(`${p}.subject: only source is supported.`);
    const permitted = {
      damage: ['any', 'player', 'opponent', 'creature', 'nonblackCreature'],
      counter: ['spell', 'noncreatureSpell'],
      bounce: ['creature', 'nonblackCreature'],
      destroy: ['creature', 'nonblackCreature'],
      modify: ['creature', 'nonblackCreature'],
    }[e.op];
    if (permitted && e.subject !== 'source' && !permitted.includes(target))
      errors.push(`${p}: effect requires a compatible target predicate.`);
  }
}
/** Validate untrusted JSON definitions before any card is shuffled or resolved. */
export function validateDefinition(card) {
  const errors = [];
  if (!plain(card)) return ['Card definition must be a plain object.'];
  const name = typeof card.name === 'string' ? card.name : '(unnamed)';
  for (const key of Object.keys(card))
    if (!FIELDS.has(key)) errors.push(`${name}.${key}: unsupported definition field.`);
  if (
    typeof card.name !== 'string' ||
    !card.name.trim() ||
    card.name.length > 200 ||
    ['__proto__', 'constructor', 'prototype'].includes(card.name)
  )
    errors.push('Card name must be a nonempty, nonreserved string of at most 200 characters.');
  if (!TYPES.has(card.type)) errors.push(`${name}.type: unsupported card type.`);
  validateCost(card.cost, `${name}.cost`, errors);
  if (card.text !== undefined && typeof card.text !== 'string')
    errors.push(`${name}.text: expected a string.`);
  if (card.type === 'creature' && (!signed(card.power) || !signed(card.toughness)))
    errors.push(`${name}: creatures require literal safe-integer power/toughness.`);
  if (
    card.keywords !== undefined &&
    (!Array.isArray(card.keywords) || card.keywords.some((k) => !KEYWORDS.has(k)))
  )
    errors.push(`${name}.keywords: unsupported keyword.`);
  if (
    card.subtypes !== undefined &&
    (!Array.isArray(card.subtypes) || card.subtypes.some((x) => typeof x !== 'string'))
  )
    errors.push(`${name}.subtypes: expected strings.`);
  if (
    card.color !== undefined &&
    (!Array.isArray(card.color) || card.color.some((x) => !COLORS.has(x)))
  )
    errors.push(`${name}.color: expected Magic colors; colorless is an empty array.`);
  if (card.mana !== undefined && !['W', 'U', 'B', 'R', 'G', 'C'].includes(card.mana))
    errors.push(`${name}.mana: only a single supported mana symbol is supported.`);
  for (const key of ['basic', 'token'])
    if (card[key] !== undefined && typeof card[key] !== 'boolean')
      errors.push(`${name}.${key}: expected a boolean.`);
  if (card.basic && card.type !== 'land') errors.push(`${name}: only lands can be basic.`);
  if (card.target != null && !TARGETS.has(card.target))
    errors.push(`${name}.target: unsupported predicate.`);
  if (
    card.aura !== undefined &&
    (card.aura !== 'pacifism' || card.type !== 'enchantment' || card.target !== 'creature')
  )
    errors.push(`${name}.aura: only the supported Pacifism attachment is implemented.`);
  if (
    card.static !== undefined &&
    (!plain(card.static) ||
      card.static.kind !== 'anthem' ||
      !signed(card.static.power) ||
      !signed(card.static.toughness) ||
      Object.keys(card.static).some((k) => !['kind', 'power', 'toughness'].includes(k)))
  )
    errors.push(`${name}.static: unsupported continuous effect.`);
  for (const key of ['effects', 'etb'])
    if (card[key] !== undefined)
      validateEffects(card[key], `${name}.${key}`, key === 'effects' ? card.target : null, errors);
  if (card.triggers !== undefined) {
    if (!Array.isArray(card.triggers) || card.triggers.length > 32)
      errors.push(`${name}.triggers: expected at most 32 triggers.`);
    else
      for (const [i, t] of card.triggers.entries()) {
        if (
          !plain(t) ||
          !TRIGGERS.has(t.event) ||
          Object.keys(t).some((k) => !['event', 'effects'].includes(k))
        ) {
          errors.push(`${name}.triggers[${i}]: unsupported trigger predicate or field.`);
          continue;
        }
        validateEffects(t.effects, `${name}.triggers[${i}].effects`, null, errors);
      }
  }
  if (card.activated !== undefined) {
    if (!Array.isArray(card.activated) || card.activated.length > 32)
      errors.push(`${name}.activated: expected at most 32 abilities.`);
    else
      for (const [i, a] of card.activated.entries()) {
        const p = `${name}.activated[${i}]`;
        if (!plain(a) || !plain(a.cost)) {
          errors.push(`${p}: expected an ability with costs.`);
          continue;
        }
        if (Object.keys(a).some((k) => !['cost', 'effects', 'target', 'text'].includes(k)))
          errors.push(`${p}: unsupported ability field.`);
        if (Object.keys(a.cost).some((k) => !['mana', 'tap'].includes(k)))
          errors.push(`${p}.cost: unsupported cost.`);
        if (a.cost.mana !== undefined) validateCost(a.cost.mana, `${p}.cost.mana`, errors);
        if (a.cost.tap !== undefined && typeof a.cost.tap !== 'boolean')
          errors.push(`${p}.cost.tap: expected a boolean.`);
        if (a.target != null && !TARGETS.has(a.target))
          errors.push(`${p}.target: unsupported predicate.`);
        if (a.text !== undefined && typeof a.text !== 'string')
          errors.push(`${p}.text: expected a string.`);
        validateEffects(a.effects, `${p}.effects`, a.target, errors);
      }
  }
  return errors;
}
/** A registry is immutable, serializable data, never executable callbacks. */
export function createRegistry(input = CARDS) {
  const definitions = Array.isArray(input) ? input : plain(input) ? Object.values(input) : null;
  if (!definitions || definitions.length > 5000)
    throw new RegistryError(['Expected at most 5,000 definitions.']);
  const errors = [],
    registry = Object.create(null);
  for (const card of definitions) {
    const issues = validateDefinition(card);
    errors.push(...issues);
    if (issues.length) continue;
    if (Object.hasOwn(registry, card.name)) {
      errors.push(`Duplicate card name: ${card.name}`);
      continue;
    }
    const copy = structuredClone(card);
    registry[copy.name] = {
      ...copy,
      keywords: copy.keywords ?? [],
      subtypes: copy.subtypes ?? [],
      text: copy.text ?? '',
      color: copy.color ?? Object.keys(copy.cost).filter((k) => COLORS.has(k)),
    };
  }
  if (errors.length) throw new RegistryError(errors.slice(0, 100));
  for (const card of Object.values(registry))
    for (const e of [
      ...(card.effects ?? []),
      ...(card.etb ?? []),
      ...(card.triggers ?? []).flatMap((t) => t.effects),
      ...(card.activated ?? []).flatMap((a) => a.effects),
    ])
      if (e.op === 'token' && !registry[e.definition]?.token)
        errors.push(`${card.name}: missing token definition ${e.definition}.`);
  if (errors.length) throw new RegistryError(errors.slice(0, 100));
  return frozen(Object.fromEntries(Object.entries(registry)));
}
