import { reviewedCreatures } from './reviewed-creatures.js';
/**
 * Hand-authored executable card definitions. Oracle prose is presentation data,
 * never executable code. Only definitions in this registry can enter a match.
 * Adding a card requires a rules regression test and a support-manifest entry.
 */
const land = (name, color) => ({
  name,
  type: 'land',
  subtypes: [name],
  basic: true,
  mana: color,
  cost: {},
  text: `Tap: Add ${color}.`,
});
const creature = (name, cost, power, toughness, keywords = [], extra = {}) => ({
  name,
  type: 'creature',
  cost,
  power,
  toughness,
  keywords,
  ...extra,
});
const spell = (name, type, cost, effects, target, text) => ({
  name,
  type,
  cost,
  effects,
  target,
  text,
});
const defs = [
  ...reviewedCreatures,
  creature('Ornithopter', { generic: 0 }, 0, 2, ['flying'], {
    types: ['artifact', 'creature'],
    subtypes: ['Thopter'],
  }),
  creature('Memnite', { generic: 0 }, 1, 1, [], {
    types: ['artifact', 'creature'],
    subtypes: ['Construct'],
  }),
  creature('Phyrexian Walker', { generic: 0 }, 0, 3, [], {
    types: ['artifact', 'creature'],
    subtypes: ['Phyrexian', 'Construct'],
  }),
  creature('Spirited Companion', { generic: 1, W: 1 }, 1, 1, [], {
    types: ['enchantment', 'creature'],
    subtypes: ['Dog'],
    etb: [{ op: 'draw', count: 1 }],
    text: 'When this creature enters, draw a card.',
  }),
  creature('Patchwork Automaton', { generic: 2 }, 1, 1, [], {
    types: ['artifact', 'creature'],
    subtypes: ['Construct'],
    ward: { mana: { generic: 2 } },
    triggers: [
      {
        event: 'controllerCastsArtifact',
        effects: [{ op: 'counterOn', subject: 'source', amount: 1 }],
      },
    ],
    text: 'Ward {2}. Whenever you cast an artifact spell, put a +1/+1 counter on this creature.',
  }),
  creature('Ornithopter of Paradise', { generic: 2 }, 0, 2, ['flying'], {
    types: ['artifact', 'creature'],
    subtypes: ['Thopter'],
    mana: ['W', 'U', 'B', 'R', 'G'],
    text: 'Flying. Tap: Add one mana of any color.',
  }),
  {
    name: 'Darksteel Ingot',
    type: 'artifact',
    cost: { generic: 3 },
    keywords: ['indestructible'],
    mana: ['W', 'U', 'B', 'R', 'G'],
    text: 'Indestructible. Tap: Add one mana of any color.',
  },
  {
    name: "Enchantress's Presence",
    type: 'enchantment',
    cost: { generic: 2, G: 1 },
    triggers: [{ event: 'controllerCastsEnchantment', effects: [{ op: 'draw', count: 1 }] }],
    text: 'Whenever you cast an enchantment spell, draw a card.',
  },
  creature('Mesa Enchantress', { generic: 1, W: 2 }, 0, 2, [], {
    subtypes: ['Human', 'Druid'],
    triggers: [
      { event: 'controllerCastsEnchantment', optional: true, effects: [{ op: 'draw', count: 1 }] },
    ],
    text: 'Whenever you cast an enchantment spell, you may draw a card.',
  }),
  creature('Beast Whisperer', { generic: 2, G: 2 }, 2, 3, [], {
    subtypes: ['Elf', 'Druid'],
    triggers: [{ event: 'controllerCastsCreature', effects: [{ op: 'draw', count: 1 }] }],
    text: 'Whenever you cast a creature spell, draw a card.',
  }),
  spell(
    'Naturalize',
    'instant',
    { generic: 1, G: 1 },
    [{ op: 'destroy' }],
    'artifactOrEnchantment',
    'Destroy target artifact or enchantment.',
  ),
  spell(
    'Disenchant',
    'instant',
    { generic: 1, W: 1 },
    [{ op: 'destroy' }],
    'artifactOrEnchantment',
    'Destroy target artifact or enchantment.',
  ),
  spell(
    'Shatter',
    'instant',
    { generic: 1, R: 1 },
    [{ op: 'destroy' }],
    'artifact',
    'Destroy target artifact.',
  ),
  spell(
    'Boomerang',
    'instant',
    { U: 2 },
    [{ op: 'bounce' }],
    'permanent',
    "Return target permanent to its owner's hand.",
  ),
  spell(
    'Tome Scour',
    'sorcery',
    { U: 1 },
    [{ op: 'mill', count: 5, player: 'target' }],
    'player',
    'Target player mills five cards.',
  ),
  spell(
    'Mind Sculpt',
    'sorcery',
    { generic: 1, U: 1 },
    [{ op: 'mill', count: 7, player: 'target' }],
    'opponent',
    'Target opponent mills seven cards.',
  ),
  {
    name: 'Millstone',
    type: 'artifact',
    cost: { generic: 2 },
    activated: [
      {
        cost: { mana: { generic: 2 }, tap: true },
        target: 'player',
        effects: [{ op: 'mill', count: 2, player: 'target' }],
        text: '2, Tap: Target player mills two cards.',
      },
    ],
    text: '2, Tap: Target player mills two cards.',
  },
  ...[
    ['Tranquil Cove', 'W', 'U'],
    ['Dismal Backwater', 'U', 'B'],
    ['Bloodfell Caves', 'B', 'R'],
    ['Rugged Highlands', 'R', 'G'],
    ['Blossoming Sands', 'G', 'W'],
    ['Scoured Barrens', 'W', 'B'],
    ['Swiftwater Cliffs', 'U', 'R'],
    ['Thornwood Falls', 'G', 'U'],
    ['Wind-Scarred Crag', 'R', 'W'],
    ['Jungle Hollow', 'B', 'G'],
  ].map(([name, ...colors]) => ({
    name,
    type: 'land',
    cost: {},
    mana: colors,
    entersTapped: true,
    etb: [{ op: 'gainLife', amount: 1 }],
    text: `${name} enters tapped. When it enters, you gain 1 life. Tap: Add ${colors.join(' or ')}.`,
  })),
  creature('Snapping Gnarlid', { generic: 1, G: 1 }, 2, 2, [], {
    triggers: [
      {
        event: 'controllerLandEnters',
        effects: [{ op: 'modify', subject: 'source', power: 1, toughness: 1 }],
      },
    ],
    text: 'Landfall — Whenever a land you control enters, this creature gets +1/+1 until end of turn.',
  }),
  creature('Makindi Sliderunner', { generic: 1, R: 1 }, 2, 1, ['trample'], {
    triggers: [
      {
        event: 'controllerLandEnters',
        effects: [{ op: 'modify', subject: 'source', power: 1, toughness: 1 }],
      },
    ],
    text: 'Trample. Landfall — Whenever a land you control enters, this creature gets +1/+1 until end of turn.',
  }),
  creature('Territorial Scythecat', { generic: 2, G: 1 }, 2, 1, ['trample'], {
    triggers: [
      {
        event: 'controllerLandEnters',
        effects: [{ op: 'counterOn', subject: 'source', amount: 1 }],
      },
    ],
    text: 'Trample. Landfall — Whenever a land you control enters, put a +1/+1 counter on this creature.',
  }),
  creature('Waterfall Aerialist', { generic: 3, U: 1 }, 3, 1, ['flying'], {
    ward: { mana: { generic: 2 } },
    text: 'Flying. Ward {2}.',
  }),
  creature('Rimeshield Frost Giant', { generic: 3, U: 2 }, 4, 5, [], {
    ward: { mana: { generic: 3 } },
    text: 'Ward {3}.',
  }),
  creature('Tomakul Honor Guard', { generic: 1, G: 1 }, 3, 1, [], {
    ward: { mana: { generic: 2 } },
    text: 'Ward {2}.',
  }),
  creature('Owlin Shieldmage', { generic: 3, W: 1, B: 1 }, 3, 3, ['flying'], {
    ward: { life: 3 },
    text: 'Flying. Ward—Pay 3 life.',
  }),
  creature(
    'Sire of Seven Deaths',
    { generic: 7 },
    7,
    7,
    ['first strike', 'vigilance', 'menace', 'trample', 'reach', 'lifelink'],
    {
      ward: { life: 7 },
      text: 'First strike, vigilance, menace, trample, reach, lifelink. Ward—Pay 7 life.',
    },
  ),
  creature('Dwarven Forge-Chanter', { generic: 1, R: 1 }, 1, 3, [], {
    ward: { life: 2 },
    triggers: [
      {
        event: 'controllerCastsNoncreature',
        effects: [{ op: 'modify', subject: 'source', power: 1, toughness: 1 }],
      },
    ],
    text: 'Ward—Pay 2 life. Prowess.',
  }),
  land('Plains', 'W'),
  land('Island', 'U'),
  land('Swamp', 'B'),
  land('Mountain', 'R'),
  land('Forest', 'G'),
  creature('Llanowar Elves', { G: 1 }, 1, 1, [], { mana: 'G', text: 'Tap: Add G.' }),
  creature('Grizzly Bears', { generic: 1, G: 1 }, 2, 2),
  creature('Centaur Courser', { generic: 2, G: 1 }, 3, 3),
  creature('Colossal Dreadmaw', { generic: 4, G: 2 }, 6, 6, ['trample']),
  creature('Giant Spider', { generic: 3, G: 1 }, 2, 4, ['reach']),
  creature('Elvish Visionary', { generic: 1, G: 1 }, 1, 1, [], {
    etb: [{ op: 'draw', count: 1 }],
    text: 'When this creature enters, draw a card.',
  }),
  creature('Savannah Lions', { W: 1 }, 2, 1),
  creature('Silvercoat Lion', { generic: 1, W: 1 }, 2, 2),
  creature('Youthful Knight', { generic: 1, W: 1 }, 2, 1, ['first strike']),
  creature('Serra Angel', { generic: 3, W: 2 }, 4, 4, ['flying', 'vigilance']),
  creature('Soul Warden', { W: 1 }, 1, 1, [], {
    triggers: [{ event: 'otherCreatureEnters', effects: [{ op: 'gainLife', amount: 1 }] }],
    text: 'Whenever another creature enters, you gain 1 life.',
  }),
  creature('Raging Goblin', { R: 1 }, 1, 1, ['haste']),
  creature('Goblin Piker', { generic: 1, R: 1 }, 2, 1),
  creature('Hill Giant', { generic: 3, R: 1 }, 3, 3),
  creature('Goblin Instigator', { generic: 1, R: 1 }, 1, 1, [], {
    etb: [{ op: 'token', definition: 'Goblin Token', count: 1 }],
    text: 'When this creature enters, create a 1/1 red Goblin creature token.',
  }),
  creature('Goblin Token', {}, 1, 1, [], { token: true, color: ['R'] }),
  creature('Wind Drake', { generic: 2, U: 1 }, 2, 2, ['flying']),
  creature('Air Elemental', { generic: 3, U: 2 }, 4, 4, ['flying']),
  creature('Typhoid Rats', { B: 1 }, 1, 1, ['deathtouch']),
  creature('Vampire Nighthawk', { generic: 1, B: 2 }, 2, 3, ['flying', 'deathtouch', 'lifelink']),
  creature('Fencing Ace', { generic: 1, W: 1 }, 1, 1, ['double strike']),
  creature('Monastery Swiftspear', { R: 1 }, 1, 2, ['haste'], {
    triggers: [
      {
        event: 'controllerCastsNoncreature',
        effects: [{ op: 'modify', subject: 'source', power: 1, toughness: 1 }],
      },
    ],
    text: 'Haste. Prowess.',
  }),
  creature('Stormchaser Mage', { U: 1, R: 1 }, 1, 3, ['flying', 'haste'], {
    triggers: [
      {
        event: 'controllerCastsNoncreature',
        effects: [{ op: 'modify', subject: 'source', power: 1, toughness: 1 }],
      },
    ],
    text: 'Flying, haste. Prowess.',
  }),
  creature('Young Pyromancer', { generic: 1, R: 1 }, 2, 1, [], {
    triggers: [
      {
        event: 'controllerCastsInstantOrSorcery',
        effects: [{ op: 'token', definition: 'Elemental Token', count: 1 }],
      },
    ],
    text: 'Whenever you cast an instant or sorcery spell, create a 1/1 red Elemental creature token.',
  }),
  creature('Elemental Token', {}, 1, 1, [], { token: true, color: ['R'] }),
  creature('Sprite Dragon', { U: 1, R: 1 }, 1, 1, ['flying', 'haste'], {
    triggers: [
      {
        event: 'controllerCastsNoncreature',
        effects: [{ op: 'counterOn', subject: 'source', amount: 1 }],
      },
    ],
    text: 'Flying, haste. Whenever you cast a noncreature spell, put a +1/+1 counter on this creature.',
  }),
  creature('Kiln Fiend', { generic: 1, R: 1 }, 1, 2, [], {
    triggers: [
      {
        event: 'controllerCastsInstantOrSorcery',
        effects: [{ op: 'modify', subject: 'source', power: 3, toughness: 0 }],
      },
    ],
    text: 'Whenever you cast an instant or sorcery spell, this creature gets +3/+0 until end of turn.',
  }),
  creature('Festival Crasher', { generic: 1, R: 1 }, 1, 3, [], {
    triggers: [
      {
        event: 'controllerCastsInstantOrSorcery',
        effects: [{ op: 'modify', subject: 'source', power: 2, toughness: 0 }],
      },
    ],
    text: 'Whenever you cast an instant or sorcery spell, this creature gets +2/+0 until end of turn.',
  }),
  creature('Seeker of the Way', { generic: 1, W: 1 }, 2, 2, [], {
    triggers: [
      {
        event: 'controllerCastsNoncreature',
        effects: [{ op: 'modify', subject: 'source', power: 1, toughness: 1 }],
      },
      {
        event: 'controllerCastsNoncreature',
        effects: [
          { op: 'modify', subject: 'source', power: 0, toughness: 0, keywords: ['lifelink'] },
        ],
      },
    ],
    text: 'Prowess. Whenever you cast a noncreature spell, this creature gains lifelink until end of turn.',
  }),
  creature('Electrostatic Field', { generic: 1, R: 1 }, 0, 4, ['defender'], {
    triggers: [
      { event: 'controllerCastsInstantOrSorcery', effects: [{ op: 'damageOpponent', amount: 1 }] },
    ],
    text: 'Defender. Whenever you cast an instant or sorcery spell, this creature deals 1 damage to each opponent.',
  }),
  creature('Thermo-Alchemist', { generic: 1, R: 1 }, 0, 3, ['defender'], {
    activated: [
      {
        cost: { tap: true },
        effects: [{ op: 'damageOpponent', amount: 1 }],
        text: 'Tap: Deal 1 damage to each opponent.',
      },
    ],
    triggers: [
      { event: 'controllerCastsInstantOrSorcery', effects: [{ op: 'untap', subject: 'source' }] },
    ],
    text: 'Defender. Tap: Deal 1 damage to each opponent. Whenever you cast an instant or sorcery spell, untap this creature.',
  }),
  creature('Shivan Dragon', { generic: 4, R: 2 }, 5, 5, ['flying'], {
    activated: [
      {
        cost: { mana: { R: 1 } },
        effects: [{ op: 'modify', subject: 'source', power: 1, toughness: 0 }],
        text: 'R: +1/+0 until end of turn.',
      },
    ],
    text: 'Flying. R: This creature gets +1/+0 until end of turn.',
  }),
  creature('Prodigal Pyromancer', { generic: 2, R: 1 }, 1, 1, [], {
    activated: [
      {
        cost: { tap: true },
        target: 'any',
        effects: [{ op: 'damage', amount: 1 }],
        text: 'Tap: Deal 1 damage to any target.',
      },
    ],
    text: 'Tap: This creature deals 1 damage to any target.',
  }),
  spell(
    'Opt',
    'instant',
    { U: 1 },
    [
      { op: 'scry', count: 1 },
      { op: 'draw', count: 1 },
    ],
    null,
    'Scry 1, then draw a card.',
  ),
  spell(
    'Preordain',
    'sorcery',
    { U: 1 },
    [
      { op: 'scry', count: 2 },
      { op: 'draw', count: 1 },
    ],
    null,
    'Scry 2, then draw a card.',
  ),
  spell(
    'Consider',
    'instant',
    { U: 1 },
    [
      { op: 'surveil', count: 1 },
      { op: 'draw', count: 1 },
    ],
    null,
    'Surveil 1, then draw a card.',
  ),
  spell(
    'Catalog',
    'instant',
    { generic: 2, U: 1 },
    [
      { op: 'draw', count: 2 },
      { op: 'discard', count: 1 },
    ],
    null,
    'Draw two cards, then discard a card.',
  ),
  spell(
    'Careful Study',
    'sorcery',
    { U: 1 },
    [
      { op: 'draw', count: 2 },
      { op: 'discard', count: 2 },
    ],
    null,
    'Draw two cards, then discard two cards.',
  ),
  creature('Merfolk Looter', { generic: 1, U: 1 }, 1, 1, [], {
    activated: [
      {
        cost: { tap: true },
        effects: [
          { op: 'draw', count: 1 },
          { op: 'discard', count: 1 },
        ],
        text: 'Tap: Draw a card, then discard a card.',
      },
    ],
    text: 'Tap: Draw a card, then discard a card.',
  }),
  spell(
    'Lightning Bolt',
    'instant',
    { R: 1 },
    [{ op: 'damage', amount: 3 }],
    'any',
    'Deal 3 damage to any target.',
  ),
  spell(
    'Shock',
    'instant',
    { R: 1 },
    [{ op: 'damage', amount: 2 }],
    'any',
    'Deal 2 damage to any target.',
  ),
  spell('Counterspell', 'instant', { U: 2 }, [{ op: 'counter' }], 'spell', 'Counter target spell.'),
  spell(
    'Negate',
    'instant',
    { generic: 1, U: 1 },
    [{ op: 'counter' }],
    'noncreatureSpell',
    'Counter target noncreature spell.',
  ),
  spell(
    'Unsummon',
    'instant',
    { U: 1 },
    [{ op: 'bounce' }],
    'creature',
    'Return target creature to its owner’s hand.',
  ),
  spell(
    'Giant Growth',
    'instant',
    { G: 1 },
    [{ op: 'modify', power: 3, toughness: 3 }],
    'creature',
    'Target creature gets +3/+3 until end of turn.',
  ),
  spell(
    'Titanic Growth',
    'instant',
    { generic: 1, G: 1 },
    [{ op: 'modify', power: 4, toughness: 4 }],
    'creature',
    'Target creature gets +4/+4 until end of turn.',
  ),
  spell(
    'Murder',
    'instant',
    { generic: 1, B: 2 },
    [{ op: 'destroy' }],
    'creature',
    'Destroy target creature.',
  ),
  spell(
    'Doom Blade',
    'instant',
    { generic: 1, B: 1 },
    [{ op: 'destroy' }],
    'nonblackCreature',
    'Destroy target nonblack creature.',
  ),
  spell(
    'Divination',
    'sorcery',
    { generic: 2, U: 1 },
    [{ op: 'draw', count: 2 }],
    null,
    'Draw two cards.',
  ),
  spell(
    'Lava Axe',
    'sorcery',
    { generic: 4, R: 1 },
    [{ op: 'damage', amount: 5 }],
    'player',
    'Deal 5 damage to target player or planeswalker. (This kernel supports players.)',
  ),
  spell(
    'Raise the Alarm',
    'instant',
    { generic: 1, W: 1 },
    [{ op: 'token', definition: 'Soldier Token', count: 2 }],
    null,
    'Create two 1/1 white Soldier creature tokens.',
  ),
  creature('Soldier Token', {}, 1, 1, [], { token: true, color: ['W'] }),
  {
    name: 'Glorious Anthem',
    type: 'enchantment',
    cost: { generic: 1, W: 2 },
    static: { kind: 'anthem', power: 1, toughness: 1 },
    text: 'Creatures you control get +1/+1.',
  },
  {
    name: 'Pacifism',
    type: 'enchantment',
    subtypes: ['Aura'],
    cost: { generic: 1, W: 1 },
    target: 'creature',
    aura: 'pacifism',
    text: 'Enchant creature. Enchanted creature can’t attack or block.',
  },
];
const deepFreeze = (value) => {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
};
export const CARDS = deepFreeze(
  Object.fromEntries(
    defs.map((d) => [
      d.name,
      Object.freeze({
        ...d,
        types: d.types ?? [d.type],
        keywords: d.keywords ?? [],
        subtypes: d.subtypes ?? [],
        text: d.text ?? (d.keywords?.join(', ') || 'No abilities.'),
        color: d.color ?? Object.keys(d.cost).filter((k) => ['W', 'U', 'B', 'R', 'G'].includes(k)),
      }),
    ]),
  ),
);
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
