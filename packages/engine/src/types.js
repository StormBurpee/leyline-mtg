/** The scalar type is a compatibility dispatch category; types retains all printed types. */
export const CARD_TYPES = Object.freeze([
  'land',
  'creature',
  'instant',
  'sorcery',
  'artifact',
  'enchantment',
]);
export const typesOf = (card) => card.types ?? [card.type];
export const hasType = (card, type) => typesOf(card).includes(type);
export const primaryType = (types) => CARD_TYPES.find((type) => types.includes(type));
