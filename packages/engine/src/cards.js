import { definitions, cardIds } from './generated-catalog.js';
const deepFreeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};
/** Runtime artifact compiled from versioned card source files. Never hand-edit card behavior here. */
export const CARDS = deepFreeze(Object.fromEntries(definitions.map((card) => [card.name, card])));
export const CARD_IDS = deepFreeze(cardIds);
export function resolveCardName(id) {
  return Object.hasOwn(CARDS, id) ? id : Object.hasOwn(CARD_IDS, id) ? CARD_IDS[id] : null;
}
export function cardDefinition(name, catalog = CARDS) {
  const d = Object.hasOwn(catalog, name) ? catalog[name] : undefined;
  if (!d) throw new Error(`Unsupported card: ${name}`);
  return d;
}
export const DECKS = Object.freeze({
  ember: {
    name: 'Ember & Echo',
    colors: ['R', 'U'],
    description: 'Make them answer the threat. Then answer their answer.',
    cards: {
      Mountain: 12,
      Island: 12,
      'Raging Goblin': 4,
      'Monastery Swiftspear': 4,
      'Young Pyromancer': 4,
      'Sprite Dragon': 3,
      'Stormchaser Mage': 2,
      'Lightning Bolt': 4,
      Shock: 3,
      Counterspell: 4,
      Unsummon: 4,
      Divination: 4,
    },
  },
  grove: {
    name: 'The Living Grove',
    colors: ['G', 'W'],
    description: 'A small beginning. An overwhelming board.',
    cards: {
      Forest: 13,
      Plains: 11,
      'Llanowar Elves': 4,
      'Elvish Visionary': 4,
      'Grizzly Bears': 4,
      'Soul Warden': 3,
      'Youthful Knight': 3,
      'Giant Spider': 2,
      'Serra Angel': 2,
      'Colossal Dreadmaw': 2,
      'Giant Growth': 4,
      'Raise the Alarm': 3,
      'Glorious Anthem': 2,
      Pacifism: 3,
    },
  },
});
export function expandDeck(list) {
  return Object.entries(list).flatMap(([name, count]) => Array.from({ length: count }, () => name));
}
export function validateDeck(names, { minimum = 60, catalog = CARDS } = {}) {
  const errors = [];
  const counts = {};
  if (!Array.isArray(names)) return ['Deck must be an array of card names.'];
  if (names.length < minimum)
    errors.push(`Deck needs at least ${minimum} cards; got ${names.length}.`);
  if (names.length > 250) errors.push('This release caps decks at 250 cards.');
  for (const name of names) {
    const d = Object.hasOwn(catalog, name) ? catalog[name] : undefined;
    if (!d) {
      errors.push(`Unsupported card: ${name}`);
      continue;
    }
    if (d.token) errors.push(`Tokens cannot be in a deck: ${name}`);
    counts[name] = (counts[name] ?? 0) + 1;
  }
  for (const [name, count] of Object.entries(counts))
    if (count > 4 && !catalog[name].basic) errors.push(`More than four copies: ${name}`);
  return [...new Set(errors)];
}
export function parseDeck(text, { catalog = CARDS } = {}) {
  const names = [];
  const errors = [];
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line === 'Deck' || line.startsWith('//')) continue;
    if (/^(Sideboard|Commander|Companion)$/i.test(line)) {
      errors.push(`Line ${i + 1}: only a main deck is supported.`);
      break;
    }
    const match = line.match(/^(\d+)\s+(.+?)(?:\s+\([A-Za-z0-9]+\)\s+\d+)?$/);
    if (!match) {
      errors.push(`Line ${i + 1}: expected quantity and card name.`);
      continue;
    }
    const n = Number(match[1]);
    if (n < 1 || n > 250) {
      errors.push(`Line ${i + 1}: invalid quantity.`);
      continue;
    }
    names.push(...Array(n).fill(match[2]));
  }
  return { names, errors: [...errors, ...validateDeck(names, { catalog })] };
}
