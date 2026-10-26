import { CARDS } from './cards.js';
import { validateDefinition, RegistryError } from './definition-validation.js';
export { validateDefinition, RegistryError };
const COLORS = new Set(['W', 'U', 'B', 'R', 'G']);
const plain = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const frozen = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
};
const validatedRegistries = new WeakSet();
let defaultRegistry;
/** A registry is immutable, serializable data, never executable callbacks. */
export function createRegistry(input = CARDS) {
  if (input === CARDS && defaultRegistry) return defaultRegistry;
  if (input && typeof input === 'object' && validatedRegistries.has(input)) return input;
  const definitions = Array.isArray(input) ? input : plain(input) ? Object.values(input) : null;
  if (!definitions || definitions.length > 50000)
    throw new RegistryError(['Expected at most 50,000 definitions.']);
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
      types: copy.types ?? [copy.type],
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
      ...(card.kicker?.effects ?? []),
      ...(card.modes ?? []).flatMap((mode) => mode.effects),
      ...(card.etb ?? []),
      ...(card.triggers ?? []).flatMap((t) => t.effects),
      ...(card.activated ?? []).flatMap((a) => a.effects),
    ])
      if (e.op === 'token' && !registry[e.definition]?.token)
        errors.push(`${card.name}: missing token definition ${e.definition}.`);
  if (errors.length) throw new RegistryError(errors.slice(0, 100));
  const result = frozen(Object.fromEntries(Object.entries(registry)));
  validatedRegistries.add(result);
  if (input === CARDS) defaultRegistry = result;
  return result;
}
