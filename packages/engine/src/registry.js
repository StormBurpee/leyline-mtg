import { effectInstructions } from './effect-tree.js';
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
      ...(copy.prepareSpell
        ? {
            // The enclosing registry owns token cross-references. Validating an
            // isolated one-spell registry rejects valid prepared token spells.
            prepareSpell: {
              ...copy.prepareSpell,
              types: copy.prepareSpell.types ?? [copy.prepareSpell.type],
              keywords: copy.prepareSpell.keywords ?? [],
              subtypes: copy.prepareSpell.subtypes ?? [],
              text: copy.prepareSpell.text ?? '',
              color: copy.prepareSpell.color ?? [
                ...new Set(
                  Object.keys(copy.prepareSpell.cost)
                    .flatMap((key) => key.split('/'))
                    .filter((key) => COLORS.has(key)),
                ),
              ],
            },
          }
        : {}),
      ...(copy.backFace
        ? {
            backFace: {
              ...copy.backFace,
              types: copy.backFace.types ?? [copy.backFace.type],
              keywords: copy.backFace.keywords ?? [],
              subtypes: copy.backFace.subtypes ?? [],
              text: copy.backFace.text ?? '',
              color: copy.backFace.color ?? [
                ...new Set(
                  Object.keys(copy.backFace.cost)
                    .flatMap((k) => k.split('/'))
                    .filter((k) => COLORS.has(k)),
                ),
              ],
            },
          }
        : {}),
      ...(copy.adventure
        ? {
            adventure: {
              ...copy.adventure,
              types: copy.adventure.types ?? [copy.adventure.type],
              keywords: copy.adventure.keywords ?? [],
              subtypes: copy.adventure.subtypes ?? [],
              text: copy.adventure.text ?? '',
              color: copy.adventure.color ?? [
                ...new Set(
                  Object.keys(copy.adventure.cost)
                    .flatMap((key) => key.split('/'))
                    .filter((key) => COLORS.has(key)),
                ),
              ],
            },
          }
        : {}),
      types: copy.types ?? [copy.type],
      keywords: copy.keywords ?? [],
      subtypes: copy.subtypes ?? [],
      text: copy.text ?? '',
      color: copy.color ?? [
        ...new Set(
          Object.keys(copy.cost)
            .flatMap((k) => k.split('/'))
            .filter((k) => COLORS.has(k)),
        ),
      ],
    };
  }
  if (errors.length) throw new RegistryError(errors.slice(0, 100));
  for (const card of Object.values(registry))
    for (const e of effectInstructions([
      ...[...(card.classLevels ?? []), ...(card.backFace?.classLevels ?? [])].flatMap(
        ({ abilities }) => [
          ...(abilities.etb ?? []),
          ...(abilities.triggers ?? []).flatMap((t) =>
            t.modes ? t.modes.flatMap((m) => m.effects) : t.effects,
          ),
          ...(abilities.activated ?? []).flatMap((a) => a.effects),
        ],
      ),
      ...(card.effects ?? []),
      ...(card.adventure?.effects ?? []),
      ...(card.prepareSpell?.effects ?? []),
      ...(card.backFace?.effects ?? []),
      ...(card.backFace?.etb ?? []),
      ...(card.backFace?.triggers ?? []).flatMap((t) =>
        t.modes ? t.modes.flatMap((mode) => mode.effects) : t.effects,
      ),
      ...(card.backFace?.activated ?? []).flatMap((a) => a.effects),
      ...(card.kicker?.effects ?? []),
      ...(card.gift
        ? [{ op: 'token', definition: card.gift.definition }, ...card.gift.effects]
        : []),
      ...(card.modes ?? []).flatMap((mode) => mode.effects),
      ...(card.etb ?? []),
      ...(card.triggers ?? []).flatMap((t) =>
        t.modes ? t.modes.flatMap((mode) => mode.effects) : t.effects,
      ),
      ...(card.attachmentTriggers ?? []).flatMap((t) => t.effects),
      ...(card.activated ?? []).flatMap((a) => a.effects),
      ...(card.stationLevels ?? []).flatMap((level) => [
        ...(level.grants.etb ?? []),
        ...(level.grants.triggers ?? []).flatMap((t) =>
          t.modes ? t.modes.flatMap((m) => m.effects) : t.effects,
        ),
        ...(level.grants.activated ?? []).flatMap((a) => a.effects),
      ]),
    ])) {
      if (
        e.attachedToken !== undefined &&
        (!registry[e.attachedToken]?.token || !registry[e.attachedToken]?.aura)
      )
        errors.push(`${card.name}: return attachment requires an Aura token definition.`);

      if (
        e.op === 'empowerJace' &&
        (registry[e.definition]?.type !== 'planeswalker' ||
          !registry[e.definition]?.subtypes.includes('Jace') ||
          registry[e.definition]?.loyalty !== 0 ||
          registry[e.definition]?.chooseCreatureType ||
          registry[e.definition]?.aura)
      )
        errors.push(`${card.name}: Empower requires a zero-loyalty Jace planeswalker token.`);
      if (
        ['token', 'attachedToken', 'mobilize', 'empowerJace'].includes(e.op) &&
        !registry[e.definition]?.token
      )
        errors.push(`${card.name}: missing token definition ${e.definition}.`);
      else if (e.op === 'token' && registry[e.definition]?.aura)
        errors.push(
          `${card.name}: Aura token creation requires an explicit attached-token instruction.`,
        );
      else if (e.op === 'attachedToken' && !registry[e.definition]?.aura)
        errors.push(`${card.name}: attached tokens require an Aura token definition.`);
      else if (
        e.op === 'mobilize' &&
        (registry[e.definition].type !== 'creature' ||
          registry[e.definition].chooseCreatureType ||
          registry[e.definition].aura)
      )
        errors.push(`${card.name}: mobilize requires a creature token without entry choices.`);
    }
  if (errors.length) throw new RegistryError(errors.slice(0, 100));
  const result = frozen(Object.fromEntries(Object.entries(registry)));
  validatedRegistries.add(result);
  if (input === CARDS) defaultRegistry = result;
  return result;
}
