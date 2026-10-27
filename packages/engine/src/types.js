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

export const KEYWORD_NAMES = Object.freeze([
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
  'menace',
]);

export const HYBRID_SYMBOLS = Object.freeze(
  ['W', 'U', 'B', 'R', 'G'].flatMap((a) =>
    ['W', 'U', 'B', 'R', 'G'].filter((b) => a !== b).map((b) => `${a}/${b}`),
  ),
);
