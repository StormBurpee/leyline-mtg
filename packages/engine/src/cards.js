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
    art: 'Lightning Bolt',
    thumbnail: 'Raging Goblin',
    archetype: 'Tempo / spells',
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
    art: 'Serra Angel',
    thumbnail: 'Elvish Visionary',
    archetype: 'Creatures / growth',
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
  cinder: {
    name: 'Cinder Circuit',
    colors: ['R'],
    art: 'Young Pyromancer',
    thumbnail: 'Young Pyromancer',
    archetype: 'Burn / spell chains',
    description: 'Turn every spell into another point of pressure.',
    cards: {
      Mountain: 20,
      'Monastery Swiftspear': 4,
      'Young Pyromancer': 4,
      'Thermo-Alchemist': 4,
      'Electrostatic Field': 4,
      'Lightning Bolt': 4,
      Shock: 4,
      Boltwave: 4,
      'Playful Shove': 4,
      'Festival Crasher': 4,
      'Dwarven Forge-Chanter': 4,
    },
  },
  canopy: {
    name: 'Ancient Canopy',
    colors: ['G'],
    art: 'Colossal Dreadmaw',
    thumbnail: 'Colossal Dreadmaw',
    archetype: 'Ramp / creatures',
    description: 'Build your mana, draw through your creatures, and go over the top.',
    cards: {
      Forest: 24,
      'Llanowar Elves': 4,
      'Elvish Visionary': 4,
      'Beast Whisperer': 4,
      'Colossal Dreadmaw': 4,
      'Reclamation Sage': 4,
      'Druid of the Cowl': 4,
      'Blossoming Defense': 4,
      'Giant Growth': 4,
      'Wildheart Invoker': 4,
    },
  },
  tide: {
    name: 'Quiet Tides',
    colors: ['U'],
    art: 'Archive Dragon',
    thumbnail: 'Archive Dragon',
    archetype: 'Control / flying',
    description: 'Keep mana open. Trade patiently. Win above the board.',
    cards: {
      Island: 24,
      Opt: 4,
      Consider: 4,
      Counterspell: 4,
      Unsummon: 4,
      'Exclusion Mage': 4,
      'Wind Drake': 4,
      'Archive Dragon': 4,
      'Quick Study': 4,
      'Plumecreed Escort': 4,
    },
  },
  dawn: {
    name: 'First Light',
    colors: ['W'],
    art: 'Serra Angel',
    thumbnail: 'Serra Angel',
    archetype: 'Tokens / anthem',
    description: 'A wide battlefield, a shared anthem, and a clean attack.',
    cards: {
      Plains: 24,
      'Savannah Lions': 4,
      'Soul Warden': 4,
      'Youthful Knight': 4,
      'Fencing Ace': 4,
      'Raise the Alarm': 4,
      'Glorious Anthem': 4,
      Pacifism: 4,
      'Spirited Companion': 4,
      'Serra Angel': 4,
    },
  },
  nightfall: {
    name: 'Nightfall',
    colors: ['B'],
    art: 'Vampire Nighthawk',
    thumbnail: 'Vampire Nighthawk',
    archetype: 'Drain / disruption',
    description: 'Chip away at their hand and life total while rebuilding your own.',
    cards: {
      Swamp: 24,
      'Burglar Rat': 4,
      'Vampire Nighthawk': 4,
      'Vampire Spawn': 4,
      'Vampire Sovereign': 4,
      'Sign in Blood': 4,
      Fell: 4,
      "Sovereign's Bite": 4,
      'Dusk Legion Zealot': 4,
      'Ravenous Chupacabra': 4,
    },
  },
  relic: {
    name: 'Relic Engine',
    colors: [],
    art: 'Patchwork Automaton',
    thumbnail: 'Patchwork Automaton',
    archetype: 'Artifacts / counters',
    description: 'Cheap artifacts grow a warded threat. Mana stones power the finish.',
    cards: {
      Island: 20,
      'Patchwork Automaton': 4,
      Ornithopter: 4,
      'Phyrexian Walker': 4,
      'Ornithopter of Paradise': 4,
      'Darksteel Ingot': 4,
      'Meteor Golem': 4,
      'Sire of Seven Deaths': 4,
      Archaeomender: 4,
      Counterspell: 4,
      'Sanitation Automaton': 4,
    },
  },
  oath: {
    name: 'The Old Oath',
    colors: ['W', 'B', 'G'],
    art: 'Siege Rhino',
    thumbnail: 'Siege Rhino',
    archetype: 'Midrange / recursion',
    description: 'Drain on arrival, trade creatures, and bring your best cards back.',
    cards: {
      'Sandsteppe Citadel': 4,
      'Blossoming Sands': 4,
      'Jungle Hollow': 4,
      Forest: 6,
      Swamp: 3,
      Plains: 3,
      'Siege Rhino': 4,
      'Skirmish Rhino': 4,
      'Poison Dart Frog': 4,
      'Eternal Witness': 4,
      'Elvish Visionary': 4,
      'Ravenous Chupacabra': 4,
      Fell: 4,
      Regrowth: 4,
      'Vampire Nighthawk': 4,
    },
  },
  spark: {
    name: 'Steel & Spark',
    colors: ['R', 'W'],
    art: 'Swiftblade Vindicator',
    thumbnail: 'Swiftblade Vindicator',
    archetype: 'Double strike / tricks',
    description: 'Make small attackers dangerous. Choose the moment to commit.',
    cards: {
      'Wind-Scarred Crag': 4,
      Mountain: 10,
      Plains: 10,
      'Swiftblade Vindicator': 4,
      'Fencing Ace': 4,
      'Monastery Swiftspear': 4,
      'Seeker of the Way': 4,
      'Lightning Bolt': 4,
      'Sure Strike': 4,
      'Adamant Will': 4,
      'Rebellious Strike': 4,
      'Raise the Alarm': 4,
    },
  },
  undertow: {
    name: 'Undertow',
    colors: ['U', 'B'],
    art: 'Sire of Seven Deaths',
    thumbnail: 'Sire of Seven Deaths',
    archetype: 'Surveil / reanimation',
    description: 'Sculpt your hand and graveyard before bringing back a finishing threat.',
    cards: {
      'Dismal Backwater': 4,
      Island: 10,
      Swamp: 10,
      'Careful Study': 4,
      Consider: 4,
      Diresight: 4,
      Zombify: 4,
      'Sire of Seven Deaths': 4,
      'Meteor Golem': 4,
      Counterspell: 4,
      Fell: 4,
      'Wreckage Wickerfolk': 4,
    },
  },
  rites: {
    name: 'Last Rites',
    colors: ['B', 'R'],
    art: 'Blood Artist',
    thumbnail: 'Zulaport Cutthroat',
    archetype: 'Death triggers / sacrifice',
    description:
      'Every creature has a final act. Turn trades and self-sacrifice into damage and life drain.',
    cards: {
      'Bloodfell Caves': 4,
      Swamp: 10,
      Mountain: 10,
      'Blood Artist': 4,
      'Zulaport Cutthroat': 4,
      'Vengeful Bloodwitch': 4,
      'Fear of Lost Teeth': 4,
      'Ember Hauler': 4,
      'Fanatical Firebrand': 4,
      'Perilous Myr': 4,
      'Sign in Blood': 4,
      'Lightning Bolt': 4,
    },
  },
  burial: {
    name: 'Second Burial',
    colors: ['B'],
    art: 'Sire of Seven Deaths',
    thumbnail: 'Zombify',
    archetype: 'Reanimation / attrition',
    description: 'Surveil large threats into your graveyard, then bring them back with Zombify.',
    cards: {
      Swamp: 24,
      Zombify: 4,
      Diresight: 4,
      'Burglar Rat': 4,
      'Vampire Spawn': 4,
      'Sire of Seven Deaths': 4,
      'Meteor Golem': 4,
      'Vault Plunderer': 4,
      'Corrupt Court Official': 4,
      'Diregraf Ghoul': 4,
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
    if (count > 4 && !catalog[name]?.basic) errors.push(`More than four copies: ${name}`);
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
