import { CREATURE_TYPES } from './creature-types.js';
import { spellsCastCount } from './spell-history.js';
import { manaValue } from './mana-value.js';
import { numericValue } from './numeric-values.js';
import { FACE_DOWN } from './disguise.js';
import { meetsCondition } from './conditions.js';
import { matchesFilter, targetSpec } from './selectors.js';
import { matchesEvent, eventSpec } from './events.js';
import { hasType, typesOf, primaryType, LAND_TYPES } from './types.js';
import { cardDefinition, CARDS, DECKS, expandDeck, validateDeck } from './cards.js';
import { createRegistry } from './registry.js';
export const VERSION = '0.53.0';
export const REPLAY_SCHEMA_VERSION = 1;
export const COLORS = ['W', 'U', 'B', 'R', 'G', 'C'];
export const STEPS = [
  'upkeep',
  'draw',
  'main1',
  'beginCombat',
  'attackers',
  'blockers',
  'firstDamage',
  'damage',
  'endCombat',
  'main2',
  'end',
  'cleanup',
];
export class RuleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RuleError';
    this.code = code;
  }
}
export function requireRule(ok, code, message) {
  if (!ok) throw new RuleError(code, message);
}
export const opponent = (p) => 1 - p;
export function preparedSource(s, copy) {
  const source = s.objects[copy.preparedFrom?.id];
  return source?.zone === 'battlefield' &&
    source.incarnation === copy.preparedFrom.incarnation &&
    source.preparedCopy?.id === copy.id &&
    source.preparedCopy.incarnation === copy.incarnation
    ? source
    : null;
}
export function preparePermanent(s, object) {
  if (object.zone !== 'battlefield' || object.preparedCopy) return;
  const spell = definition(s, object).prepareSpell;
  if (!spell || !hasType(definition(s, object), 'creature')) return;
  const copy = addObject(s, spell.name, object.controller, 'exile', spell);
  copy.spellCopy = true;
  copy.preparedFrom = ref(object);
  object.preparedCopy = ref(copy);
  emit(s, 'prepared', { objectId: object.id, copyId: copy.id, player: object.controller });
}
/** CR 722: preparation is a designation, independent of the permanent's abilities. */
export function unpreparePermanent(s, object) {
  if (object.zone !== 'battlefield' || !object.preparedCopy) return;
  const prepared = object.preparedCopy;
  const copy = s.objects[prepared.id];
  delete object.preparedCopy;
  if (copy?.zone === 'exile' && copy.incarnation === prepared.incarnation) move(s, copy, 'void');
  emit(s, 'unprepared', { objectId: object.id, player: object.controller });
}
export function topLibraryVisible(s, player) {
  if (s.castingCompletion) return false;
  return battlefield(s).some((o) => o.controller === player && definition(s, o).libraryTopAccess);
}
export function topLibraryPlayable(s, object, player, card = null) {
  if (object?.zone !== 'library' || object.owner !== player) return false;
  const permissions = battlefield(s).filter(
    (o) => o.controller === player && definition(s, o).libraryTopAccess,
  );
  if (!permissions.length || s.players[player].library[0] !== object.id) return false;
  const facts = { definition: card ?? definition(s, object) };
  return permissions.some((o) =>
    matchesFilter(facts, definition(s, o).libraryTopAccess.play, player),
  );
}
export function playableZone(s, o, p) {
  return (
    !!o &&
    (topLibraryPlayable(s, o, p) ||
      (o.zone === 'exile' && preparedSource(s, o)?.controller === p) ||
      (s.choice?.kind === 'castExiled' &&
        s.choice.player === p &&
        s.choice.card === o.id &&
        s.choice.incarnation === o.incarnation &&
        o.zone === 'exile') ||
      (o.zone === 'hand' && o.owner === p) ||
      (o.zone === 'exile' &&
        o.adventured?.player === p &&
        o.adventured.incarnation === o.incarnation) ||
      (o.zone === 'graveyard' &&
        o.owner === p &&
        !!(definition(s, o).flashback || definition(s, o).harmonize)) ||
      (o.zone === 'exile' && o.owner === p && o.plotted?.incarnation === o.incarnation) ||
      (o.zone === 'exile' && o.owner === p && o.warped?.incarnation === o.incarnation) ||
      (o.zone === 'exile' &&
        o.playPermission?.player === p &&
        (o.playPermission.turn === s.turn ||
          (o.playPermission.untilNextTurn !== undefined &&
            o.playPermission.nextTurnStarted !== true)) &&
        o.playPermission.incarnation === o.incarnation))
  );
}
export function playableCards(s, p) {
  return [
    ...s.players[p].hand,
    ...(topLibraryVisible(s, p) && topLibraryPlayable(s, s.objects[s.players[p].library[0]], p)
      ? [s.players[p].library[0]]
      : []),
    ...Object.values(s.objects)
      .filter((o) => ['exile', 'graveyard'].includes(o.zone) && playableZone(s, o, p))
      .map((o) => o.id),
  ];
}

export const emptyMana = () => Object.fromEntries(COLORS.map((c) => [c, 0]));
/** CR 707.2: layer-1 copy values, never counters, choices or temporary layers. */
function printedFace(card, object) {
  if (card.prepareSpell) return { ...card, name: card.mainName };
  if (card.backFace)
    return object.transformed
      ? { ...card.backFace, frontFaceCost: card.cost }
      : { ...card, name: card.frontName };
  if (!card.adventure) return card;
  if (object.zone === 'stack' && object.adventureCast)
    return { ...card.adventure, adventureCast: true };
  return { ...card, name: card.mainName };
}
export function copiableDefinition(s, object) {
  return object.faceDown
    ? FACE_DOWN
    : printedFace(object.definitionOverride ?? cardDefinition(object.name, s.catalog), object);
}
export function maximumBlockers(s, object) {
  return Math.min(
    Infinity,
    ...battlefield(s)
      .filter(
        (source) =>
          definition(s, source).attachmentBonus?.maxBlockers !== undefined &&
          attachmentApplies(s, source, object),
      )
      .map((source) => definition(s, source).attachmentBonus.maxBlockers),
  );
}
export function counterKinds(object) {
  const kinds = [];
  for (const [name, field] of Object.entries({
    '+1/+1': 'plusCounters',
    '-1/-1': 'minusCounters',
    stun: 'stunCounters',
    lore: 'loreCounters',
    loyalty: 'loyalty',
    quest: 'questCounters',
  }))
    if ((object[field] ?? 0) > 0) kinds.push(name);
  kinds.push(
    ...Object.keys(object.keywordCounters ?? {}).filter((k) => object.keywordCounters[k] > 0),
  );
  return kinds;
}
export function removeOneCounter(object, kind) {
  const field = {
    '+1/+1': 'plusCounters',
    '-1/-1': 'minusCounters',
    stun: 'stunCounters',
    lore: 'loreCounters',
    loyalty: 'loyalty',
    quest: 'questCounters',
  }[kind];
  if (field) object[field]--;
  else object.keywordCounters[kind]--;
}
export function trackedExileCards(s, source) {
  if (!source) return [];
  const current = s.objects[source.id];
  if (current?.zone !== 'battlefield' || current.incarnation !== source.incarnation) return [];
  return (current.trackedExile ?? [])
    .map((r) => s.objects[r.id])
    .filter(
      (o, i) =>
        o?.zone === 'exile' &&
        o.incarnation === current.trackedExile[i].incarnation &&
        !o.token &&
        !o.spellCopy,
    );
}
export function trackExiledCard(s, source, card) {
  const current = s.objects[source?.id];
  if (
    current?.zone === 'battlefield' &&
    current.incarnation === source.incarnation &&
    card.zone === 'exile'
  )
    (current.trackedExile ??= []).push(ref(card));
}
export function layerTimestamp(s) {
  return (s.layerClock = (s.layerClock ?? 0) + 1);
}
export function addModifier(s, modifier) {
  s.modifiers.push({ ...modifier, timestamp: layerTimestamp(s) });
}
export function modifierActive(s, m) {
  if (m.untilSourceLeaves) {
    const source = s.objects[m.untilSourceLeaves.id];
    return source?.zone === 'battlefield' && source.incarnation === m.untilSourceLeaves.incarnation;
  }
  return m.permanent || m.untilNextTurn !== undefined || m.expires === s.turn;
}
export function abilityLossTimestamp(s, o) {
  return Math.max(
    -1,
    ...s.modifiers
      .filter(
        (m) =>
          m.removeAbilities &&
          m.objectId === o.id &&
          m.incarnation === o.incarnation &&
          modifierActive(s, m),
      )
      .map((m) => m.timestamp ?? 0),
  );
}
export function definition(stateOrObject, object, { skipNamedLandGrants = false } = {}) {
  const d = (object ?? stateOrObject).faceDown
    ? FACE_DOWN
    : printedFace(
        object
          ? (object.definitionOverride ?? cardDefinition(object.name, stateOrObject.catalog))
          : (stateOrObject.definitionOverride ?? cardDefinition(stateOrObject.name)),
        object ?? stateOrObject,
      );
  // Layer-4 changes apply in timestamp order; none are copy values. Durations
  // tied to a player expire at turn start, independently of current controller.
  if (!object || object.zone !== 'battlefield') return d;
  const modifiers = (stateOrObject.modifiers ?? []).filter(
    (m) =>
      m.objectId === object.id &&
      m.incarnation === object.incarnation &&
      modifierActive(stateOrObject, m),
  );
  const loyaltyForm =
    d.turnLoyaltyCreature &&
    stateOrObject.active === object.controller &&
    (object.loyalty ?? 0) > 0;
  // CR 613: this intrinsic type-changing effect begins in layer 4 and continues
  // through layer 7 even when a later layer-6 effect removes its ability.
  let result = loyaltyForm
    ? {
        ...d,
        type: 'creature',
        types: ['creature'],
        subtypes: [...d.turnLoyaltyCreature.subtypes],
        baseStats: {
          power: d.turnLoyaltyCreature.power,
          toughness: d.turnLoyaltyCreature.toughness,
        },
        keywords: [...d.keywords, ...d.turnLoyaltyCreature.keywords],
      }
    : d;
  if (d.chooseBasicLandType && object.chosenBasicLandType) {
    const landType = object.chosenBasicLandType;
    result = {
      ...result,
      subtypes: [...result.subtypes.filter((t) => !LAND_TYPES.includes(t)), landType],
      mana: { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' }[landType],
    };
  }
  if (d.manaFromTrackedExile)
    result = {
      ...d,
      mana: [
        ...new Set([
          ...(Array.isArray(d.mana) ? d.mana : d.mana ? [d.mana] : []),
          ...trackedExileCards(stateOrObject, object).flatMap(
            (card) => copiableDefinition(stateOrObject, card).color ?? [],
          ),
        ]),
      ],
    };
  for (const m of modifiers) {
    if (m.enchantmentOnly) {
      result = {
        ...result,
        type: 'enchantment',
        types: ['enchantment'],
        subtypes: result.subtypes.filter((t) => !CREATURE_TYPES.includes(t)),
      };
    }
    if (m.landForm) {
      result = {
        ...result,
        type: 'land',
        types: ['land'],
        subtypes: result.subtypes.filter((t) => LAND_TYPES.includes(t)),
      };
    }
    if (m.addTypes?.length) {
      const types = [...new Set([...typesOf(result), ...m.addTypes])];
      result = {
        ...result,
        types,
        type: types.includes('creature') ? 'creature' : primaryType(types),
      };
    }
    if (m.creatureForm) {
      result = {
        ...result,
        subtypes: [
          ...result.subtypes.filter((t) => !CREATURE_TYPES.includes(t)),
          ...m.creatureForm.subtypes,
        ],
        baseStats: { power: m.creatureForm.power, toughness: m.creatureForm.toughness },
      };
    }
    if (m.animation) {
      result = {
        ...result,
        ...(m.animation.colors !== undefined ? { color: m.animation.colors } : {}),
        subtypes: [
          ...result.subtypes.filter(
            (t) => m.animation.preserveSubtypes || !CREATURE_TYPES.includes(t),
          ),
          ...m.animation.subtypes,
        ],
        baseStats: { power: m.animation.power, toughness: m.animation.toughness },
      };
    }
    if (m.landForm) {
      // A new unrestricted tap ability is another option, not an additional
      // restriction or life cost on the original ability of that color.
      const colors = m.landForm.mana;
      const withoutGranted = (values) =>
        Object.fromEntries(
          Object.entries(values ?? {}).filter(([color]) => !colors.includes(color)),
        );
      result = {
        ...result,
        mana: [
          ...new Set([
            ...(Array.isArray(result.mana) ? result.mana : result.mana ? [result.mana] : []),
            ...colors,
          ]),
        ],
        manaConditions: withoutGranted(result.manaConditions),
        manaLifeCosts: withoutGranted(result.manaLifeCosts),
        manaRestrictions: withoutGranted(result.manaRestrictions),
      };
    }
  }
  if (hasType(result, 'creature') && object.controller !== object.owner) {
    const extra = battlefield(stateOrObject)
      .filter((o) => o.controller === object.controller)
      .map((o) => copiableDefinition(stateOrObject, o).foreignCreatureSubtype)
      .filter(Boolean);
    if (extra.length)
      result = { ...result, subtypes: [...new Set([...result.subtypes, ...extra])] };
  }
  if (modifiers.some((m) => m.removeAbilities)) {
    // Keep characteristics, not abilities. Layer-4 animations/changeling already applied;
    // layer-7a characteristic-defining P/T is removed before layer-7b animation P/T.
    const keep = [
      'name',
      'type',
      'types',
      'cost',
      'text',
      'color',
      'subtypes',
      'power',
      'toughness',
      'loyalty',
      'basic',
      'legendary',
      'token',
      // Alternative prepared-spell characteristics are not abilities (SOS release notes).
      'prepareSpell',
    ];
    const stripped = Object.fromEntries(
      keep.filter((k) => result[k] !== undefined).map((k) => [k, result[k]]),
    );
    stripped.keywords = [];
    stripped.abilitiesRemoved = true;
    if (d.keywords?.includes('changeling'))
      stripped.subtypes = [...new Set([...result.subtypes, ...CREATURE_TYPES])];
    if (loyaltyForm || modifiers.some((m) => m.animation)) stripped.baseStats = result.baseStats;
    result = stripped;
  }
  if (
    !skipNamedLandGrants &&
    hasType(result, 'land') &&
    battlefield(stateOrObject).some(
      (source) =>
        source.chosenLandName === result.name &&
        definition(stateOrObject, source, { skipNamedLandGrants: true }).landNameLock,
    )
  ) {
    result = {
      ...result,
      mana: [
        ...new Set([
          ...(Array.isArray(result.mana) ? result.mana : result.mana ? [result.mana] : []),
          'C',
        ]),
      ],
    };
    for (const field of ['manaConditions', 'manaLifeCosts', 'manaRestrictions'])
      if (result[field]?.C !== undefined) {
        result[field] = { ...result[field] };
        delete result[field].C;
      }
  }
  return result;
}
export const battlefield = (s) => Object.values(s.objects).filter((o) => o.zone === 'battlefield');
export const creatures = (s) => battlefield(s).filter((o) => definition(s, o).type === 'creature');
export const controlled = (s, p) => battlefield(s).filter((o) => o.controller === p);
function staticApplies(s, source, object, effect, powerToughnessLayer = false) {
  if (object.zone !== 'battlefield') return false;
  if (effect.excludeSource && source.id === object.id && source.incarnation === object.incarnation)
    return false;
  const d = definition(s, object);
  if (!effect.where) return source.controller === object.controller && hasType(d, 'creature');
  return matchesFilter(
    {
      definition: d,
      controller: object.controller,
      owner: object.owner,
      token: object.token,
      tapped: object.tapped,
      stunCounters: object.stunCounters ?? 0,
      attacking: isAttacking(s, object),
      blocking: isBlocking(s, object),
      manaValue: manaValue(d),
      // CR 613.1f–g, 613.4c: P/T filters see completed ability grants.
      // Lazy evaluation avoids querying abilities for characteristic-only filters.
      get keywords() {
        return powerToughnessLayer ? keywords(s, object) : d.keywords;
      },
    },
    effect.where,
    source.controller,
  );
}
export function legalEquipmentAttachment(s, equipment, target) {
  if (
    !equipment ||
    !target ||
    equipment.id === target.id ||
    equipment.zone !== 'battlefield' ||
    target.zone !== 'battlefield'
  )
    return false;
  const d = definition(s, equipment);
  return (
    d.subtypes.includes('Equipment') &&
    !hasType(d, 'creature') &&
    hasType(definition(s, target), 'creature')
  );
}
export function legalAuraAttachment(s, aura, target, controller = aura?.controller) {
  if (!aura || !target || aura.id === target.id || target.zone !== 'battlefield') return false;
  const d = definition(s, aura),
    t = definition(s, target);
  if (!d.aura || hasType(d, 'creature') || !hasType(t, 'creature')) return false;
  return matchesFilter(
    {
      definition: t,
      controller: target.controller,
      owner: target.owner,
      token: target.token,
      tapped: target.tapped,
      stunCounters: target.stunCounters ?? 0,
      attacking: isAttacking(s, target),
      blocking: isBlocking(s, target),
      manaValue: manaValue(t),
    },
    targetSpec(d.target)?.where,
    controller,
  );
}
function attachmentApplies(s, equipment, target) {
  return (
    equipment.attachedTo?.id === target.id &&
    equipment.attachedTo.incarnation === target.incarnation &&
    equipment.zone === 'battlefield' &&
    (definition(s, equipment).aura
      ? legalAuraAttachment(s, equipment, target)
      : legalEquipmentAttachment(s, equipment, target))
  );
}
function conditionalApplies(s, source, target, bonus) {
  return (
    target.zone === 'battlefield' &&
    (bonus.affects === 'self'
      ? source.id === target.id && source.incarnation === target.incarnation
      : attachmentApplies(s, source, target)) &&
    meetsCondition(s, source.controller, bonus.condition, [], source)
  );
}
export function skipsUntap(s, object) {
  return battlefield(s).some(
    (source) =>
      definition(s, source).attachmentBonus?.noUntap && attachmentApplies(s, source, object),
  );
}
export function keywords(s, o) {
  const lostAt = o.zone === 'battlefield' ? abilityLossTimestamp(s, o) : -1;
  return [
    ...new Set([
      ...definition(s, o).keywords,
      ...Object.keys(o.keywordCounters ?? {}).filter(
        (k) => o.keywordCounters[k] > 0 && (o.keywordCounterTimestamps?.[k] ?? 0) > lostAt,
      ),
      ...(s.players[o.controller].speed === 4 ? (definition(s, o).maxSpeedKeywords ?? []) : []),
      ...battlefield(s).flatMap((source) => {
        if ((source.layerTimestamp ?? 0) <= lostAt) return [];
        const d = definition(s, source);
        const e = d.static;
        return [
          ...(d.attachmentBonus && attachmentApplies(s, source, o)
            ? (d.attachmentBonus.keywords ?? [])
            : []),
          // P/T-only anthems never participate in layer 6 (or recurse into it).
          ...(e?.kind === 'anthem' && e.keywords?.length && staticApplies(s, source, o, e)
            ? e.keywords
            : []),
          ...(d.conditionalBonuses ?? []).flatMap((bonus) =>
            conditionalApplies(s, source, o, bonus) ? (bonus.keywords ?? []) : [],
          ),
        ];
      }),
      ...s.modifiers
        .filter(
          (m) =>
            m.objectId === o.id &&
            m.incarnation === o.incarnation &&
            modifierActive(s, m) &&
            (m.timestamp ?? 0) > lostAt,
        )
        .flatMap((m) => m.keywords ?? []),
    ]),
  ];
}
export const hasKeyword = (s, o, k) => keywords(s, o).includes(k);
export function stats(s, o) {
  const d = definition(s, o);
  // CR 208.3/301.7: battlefield Vehicles need animation; printed P/T remains outside it.
  if (o.zone === 'battlefield' && !hasType(d, 'creature')) return { power: 0, toughness: 0 };
  const context = { controller: o.controller, source: ref(o) };
  let power =
      numericValue(s, d.baseStats?.power ?? d.power ?? 0, context) +
      ((o.plusCounters ?? 0) - (o.minusCounters ?? 0)),
    toughness =
      numericValue(s, d.baseStats?.toughness ?? d.toughness ?? 0, context) +
      ((o.plusCounters ?? 0) - (o.minusCounters ?? 0));
  if (o.zone === 'battlefield' && d.selfBonus) {
    power += numericValue(s, d.selfBonus.power, context);
    toughness += numericValue(s, d.selfBonus.toughness, context);
  }
  for (const m of s.modifiers)
    if (m.objectId === o.id && m.incarnation === o.incarnation) {
      power += m.power ?? 0;
      toughness += m.toughness ?? 0;
    }
  if (d.type === 'creature' && o.zone === 'battlefield')
    for (const a of battlefield(s)) {
      const d = definition(s, a);
      if (d.attachmentBonus && attachmentApplies(s, a, o)) {
        power += numericValue(s, d.attachmentBonus.power, {
          controller: a.controller,
          source: ref(a),
        });
        toughness += numericValue(s, d.attachmentBonus.toughness, {
          controller: a.controller,
          source: ref(a),
        });
      }
      for (const bonus of d.conditionalBonuses ?? [])
        if (conditionalApplies(s, a, o, bonus)) {
          power += numericValue(s, bonus.power, { controller: a.controller, source: ref(a) });
          toughness += numericValue(s, bonus.toughness, {
            controller: a.controller,
            source: ref(a),
          });
        }
      const effect = d.static;
      if (effect?.kind === 'anthem' && staticApplies(s, a, o, effect, true)) {
        power += numericValue(s, effect.power, { controller: a.controller, source: ref(a) });
        toughness += numericValue(s, effect.toughness, {
          controller: a.controller,
          source: ref(a),
        });
      }
    }
  if (o.zone === 'battlefield' && hasType(d, 'creature'))
    for (const emblem of s.emblems ?? [])
      if (
        emblem.kind === 'anthem' &&
        emblem.controller === o.controller &&
        matchesFilter({ definition: d, controller: o.controller }, emblem.where, emblem.controller)
      ) {
        power += emblem.power;
        toughness += emblem.toughness;
      }
  return { power, toughness };
}
export const isAttacking = (s, o) =>
  o.zone === 'battlefield' &&
  s.combat.attackers.some((r) => r.id === o.id && r.incarnation === o.incarnation);
export const isBlocking = (s, o) =>
  o.zone === 'battlefield' &&
  Object.values(s.combat.blocks)
    .flat()
    .some((r) => r.id === o.id && r.incarnation === o.incarnation);
// CR 302.6 measures the controller's most recent turn start, not any turn change.
// Turns alternate in this two-player profile; extra turns are not implemented.
export const isSick = (s, o) =>
  o.controlledSince >= (s.active === o.controller ? s.turn : s.turn - 1) &&
  !hasKeyword(s, o, 'haste');
export const isPacified = (s, o) =>
  battlefield(s).some(
    (a) =>
      definition(s, a).aura === 'pacifism' &&
      a.attachedTo?.id === o.id &&
      a.attachedTo.incarnation === o.incarnation,
  );
export function freezeRecord(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeRecord(nested);
    Object.freeze(value);
  }
  return value;
}
export function emit(s, type, data = {}) {
  s.events.push(
    freezeRecord(structuredClone({ seq: ++s.eventSeq, turn: s.turn, step: s.step, type, ...data })),
  );
}
/** xorshift32: seed and state are persisted; no ambient random or wall clock. */
export function random(s) {
  let x = s.rng;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  s.rng = x >>> 0;
  return s.rng / 4294967296;
}
export function shuffle(s, items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random(s) * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
export function addObject(s, name, owner, zone = 'library', override = null) {
  const d = override ?? cardDefinition(name, s.catalog),
    id = `c${++s.nextId}`;
  s.objects[id] = {
    id,
    name,
    owner,
    controller: owner,
    zone,
    incarnation: 0,
    tapped: false,
    plusCounters: 0,
    ...(zone === 'battlefield' && hasType(d, 'planeswalker') ? { loyalty: d.loyalty } : {}),
    damage: 0,
    deathtouchDamage: false,
    controlledSince: s.turn,
    ...(zone === 'battlefield' ? { enteredTurn: s.turn, layerTimestamp: layerTimestamp(s) } : {}),
    token: !!d.token,
    ...(override ? { definitionOverride: structuredClone(override) } : {}),
    attachedTo: null,
  };
  if (s.players[owner][zone]) s.players[owner][zone].push(id);
  return s.objects[id];
}
export function ref(o) {
  return { kind: 'object', id: o.id, incarnation: o.incarnation };
}
export function revealFaceDownAtEnd(s) {
  for (const object of Object.values(s.objects))
    if (object.faceDown) {
      emit(s, 'revealed', { objectId: object.id, name: object.name });
      delete object.faceDown;
    }
}
export function loseLife(s, player, amount) {
  s.players[player].life -= amount;
  if (amount > 0) {
    s.players[player].lifeLostTurn = s.turn;
    const racer = s.players[opponent(player)];
    if (
      s.active === racer.id &&
      racer.speed > 0 &&
      racer.speed < 4 &&
      racer.speedTriggeredTurn !== s.turn
    ) {
      racer.speedTriggeredTurn = s.turn;
      s.pendingTriggers.push({
        id: `s${++s.nextId}`,
        kind: 'ability',
        name: 'Speed',
        controller: racer.id,
        source: null,
        sourceKeywords: [],
        effects: [],
        rule: 'increaseSpeed',
        label: 'Increase speed by 1',
      });
      emit(s, 'speedTriggered', { player: racer.id });
    }
  }
}
// CR 714: chapter numbers are intrinsic to chapter abilities, not reminder text.
export function sagaFinalChapter(s, object) {
  const d = definition(s, object);
  if (!(d.subtypes ?? []).includes('Saga')) return 0;
  return Math.max(
    0,
    ...(d.triggers ?? []).flatMap((t) => (t.event?.event === 'chapter' ? t.event.chapters : [])),
  );
}
export function addLoreCounters(s, object, amount = 1) {
  requireRule(
    Number.isSafeInteger(amount) && amount > 0 && amount <= 1000,
    'LORE_COUNTERS',
    'Expected a bounded positive lore counter amount.',
  );
  if (object.zone !== 'battlefield') return;
  const before = object.loreCounters ?? 0;
  object.loreCounters = before + amount;
  emit(s, 'loreCounters', { objectId: object.id, before, after: object.loreCounters });
  // A combined I, II ability triggers separately for each chapter crossed.
  for (
    let chapterNumber = before + 1;
    chapterNumber <= Math.min(object.loreCounters, 20);
    chapterNumber++
  )
    notifyTriggers(s, 'chapter', { object, chapterNumber });
}
export function queueTrigger(
  s,
  source,
  effects,
  label,
  optional = false,
  targetKind = null,
  sourceKeywords = null,
) {
  s.pendingTriggers.push({
    id: `s${++s.nextId}`,
    kind: 'ability',
    name: source.name,
    source: ref(source),
    controller: source.controller,
    effects: structuredClone(effects),
    sourceKeywords: sourceKeywords ?? keywords(s, source),
    ...(source.attachedTo ? { sourceAttachment: structuredClone(source.attachedTo) } : {}),
    sourceDefinition: structuredClone(definition(s, source)),
    sourceStats: structuredClone(stats(s, source)),
    ...(source.bargained ? { sourceBargained: true } : {}),
    sourceCopyDefinition: structuredClone(copiableDefinition(s, source)),
    label,
    ...(optional ? { optional: true } : {}),
    ...(targetKind ? { targetKind: structuredClone(targetKind) } : {}),
  });
  emit(s, 'triggered', { objectId: source.id, name: source.name, player: source.controller });
}
/** CR 603.6d: entry suppression is checked after the whole batch has entered.
 * This blocks the occurrence, not merely a permanent's own ETB ability. */
export function entryTriggersSuppressed(s, object) {
  const facts = { definition: definition(s, object) };
  return battlefield(s).some((watcher) => {
    const filter = definition(s, watcher).suppressEnterTriggers;
    return filter && matchesFilter(facts, filter, watcher.controller);
  });
}
export function entryTriggerMultiplicity(s, object, controller) {
  if (entryTriggersSuppressed(s, object)) return 0;
  const facts = {
    definition: definition(s, object),
    controller: object.controller,
    owner: object.owner,
    token: object.token,
    tapped: object.tapped,
    attacking: isAttacking(s, object),
    blocking: isBlocking(s, object),
    manaValue: manaValue(definition(s, object)),
    keywords: keywords(s, object),
    ...stats(s, object),
  };
  return (
    1 +
    battlefield(s).filter(
      (watcher) =>
        watcher.controller === controller &&
        object.controller === controller &&
        definition(s, watcher).additionalEnterTrigger &&
        matchesFilter(facts, definition(s, watcher).additionalEnterTrigger, controller),
    ).length
  );
}
export function queueEntryTrigger(s, object, effects, label) {
  for (let i = 0; i < entryTriggerMultiplicity(s, object, object.controller); i++)
    queueTrigger(s, object, effects, label);
}
/** Match declarative trigger predicates against committed game events. */
export function notifyTriggers(s, event, payload, context = null) {
  if (
    ['enter', 'enters'].includes(event) &&
    payload.object &&
    entryTriggersSuppressed(s, payload.object)
  )
    return;
  if (event === 'cast')
    for (const emblem of s.emblems ?? []) {
      if (emblem.kind === 'anthem' || emblem.controller !== payload.player) continue;
      s.pendingTriggers.push({
        id: `s${++s.nextId}`,
        kind: 'ability',
        name: emblem.name,
        controller: emblem.controller,
        source: { kind: 'object', id: emblem.id, incarnation: 0 },
        sourceKeywords: [],
        emblem: true,
        effects: [{ op: 'damage', amount: emblem.amount }],
        targetKind: { scope: 'damageable' },
        label: `${emblem.name} · cast trigger`,
      });
      emit(s, 'triggered', { objectId: emblem.id, name: emblem.name, player: emblem.controller });
    }
  if (event === 'step' && payload.step === 'end') {
    const due = s.delayedTriggers ?? [];
    delete s.delayedTriggers;
    for (const entry of due) {
      s.pendingTriggers.push({ ...entry, id: `s${++s.nextId}` });
      emit(s, 'triggered', {
        objectId: entry.source.id,
        name: entry.name,
        player: entry.controller,
      });
    }
  }
  const object = payload.object;
  const aggregate = ['diesGroup', 'battlefieldToGraveyardGroup'].includes(event);
  const d = payload.definition ?? (object ? definition(s, object) : null);
  const pt =
    object && hasType(d, 'creature')
      ? stats(s, object)
      : object?.zone === 'battlefield'
        ? {}
        : { power: d?.power, toughness: d?.toughness };
  const eventFacts = context?.facts?.[object?.id] ?? {
    id: object?.id,
    definition: d,
    controller: payload.player ?? object?.controller,
    step: payload.step,
    chapterNumber: payload.chapterNumber,
    castPlayer: payload.castPlayer,
    drawNumber: payload.drawNumber,
    spellNumber:
      event === 'cast' ? spellsCastCount(s, [payload.player ?? object.controller]) : undefined,
    objects: payload.objects,
    targetingController: payload.targetingController,
    targetingKind: payload.targetingKind,
    targetNumbers: payload.targetNumbers,
    saddleNumber: payload.saddleNumber,
    owner: object?.owner,
    token: object?.token,
    tapped: object?.zone === 'battlefield' ? object.tapped : undefined,
    attacking: object ? isAttacking(s, object) : false,
    blocking: object ? isBlocking(s, object) : false,
    keywords: object?.zone === 'battlefield' ? keywords(s, object) : d?.keywords,
    power: pt.power,
    toughness: pt.toughness,
    manaValue: manaValue(d, object?.zone === 'stack' ? (object.chosenX ?? 0) : 0),
  };
  const facts =
    event === 'leave' ? { ...eventFacts, destination: payload.destination } : eventFacts;
  const watchers =
    context?.watchers ??
    battlefield(s).map((object) => ({ object, keywords: keywords(s, object) }));
  for (const {
    object: watcher,
    keywords: sourceKeywords,
    definition: watcherDefinition,
  } of watchers)
    for (const [triggerIndex, trigger] of (
      (watcherDefinition ?? definition(s, watcher)).triggers ?? []
    ).entries())
      if (
        matchesEvent(trigger.event, event === 'enters' ? 'enter' : event, facts, watcher) &&
        meetsCondition(
          s,
          watcher.controller,
          trigger.triggerCondition,
          [],
          watcher,
          payload.manaSpent ?? null,
        ) &&
        meetsCondition(
          s,
          watcher.controller,
          trigger.condition,
          [],
          watcher,
          payload.manaSpent ?? null,
        )
      ) {
        const use = `${s.turn}:${watcher.incarnation}`;
        const current = s.objects[watcher.id];
        const sameIncarnation = current?.incarnation === watcher.incarnation;
        if (
          trigger.oncePerTurn &&
          (watcher.triggerUses?.[triggerIndex] === use ||
            (sameIncarnation && current.triggerUses?.[triggerIndex] === use))
        )
          continue;
        // Consume on occurrence, even if declined/countered later. Departure
        // observers are snapshots: also update the surviving permanent, if any.
        if (trigger.oncePerTurn) {
          (watcher.triggerUses ??= {})[triggerIndex] = use;
          if (sameIncarnation) (current.triggerUses ??= {})[triggerIndex] = use;
        }
        queueTrigger(
          s,
          watcher,
          trigger.effects ?? [],
          `${watcher.name} · triggered ability`,
          trigger.optional,
          trigger.target,
          sourceKeywords,
        );
        const queued = s.pendingTriggers.at(-1);
        if (trigger.modes) queued.modes = structuredClone(trigger.modes);
        // Own-death triggers are queued after movement; preserve prebatch anthems.
        const departedStats = context?.facts?.[watcher.id];
        if (departedStats)
          queued.sourceStats = {
            power: departedStats.power ?? 0,
            toughness: departedStats.toughness ?? 0,
          };
        if (watcherDefinition) queued.sourceDefinition = structuredClone(watcherDefinition);
        if (
          aggregate &&
          payload.departedObjects?.some(
            (departed) =>
              departed.id === watcher.id && departed.incarnation === watcher.incarnation,
          )
        )
          queued.departedSource = ref(s.objects[watcher.id]);
        if (
          ['dies', 'battlefieldToGraveyard', 'leave'].includes(event) &&
          watcher.id === object?.id &&
          watcher.incarnation === object.incarnation
        )
          queued.departedSource = ref(s.objects[watcher.id]);
        if (
          event === 'enters' &&
          watcher.id === object?.id &&
          watcher.incarnation === object.incarnation
        )
          queued.x = payload.x ?? 0;
        if (event === 'chapter') {
          queued.sagaChapter = payload.chapterNumber;
          queued.label = `${watcher.name} · Chapter ${payload.chapterNumber}`;
        }
        // A source's own zone-change trigger can identify the new object in the
        // destination zone (CR 400.7d/603.6). Preserve the old source for LKI,
        // but use this one-time snapshot for "another" target exclusion. Never
        // chase that ID through a later move or return to the battlefield.
        if (
          ['dies', 'battlefieldToGraveyard', 'leave'].includes(event) &&
          watcher.id === object?.id &&
          watcher.incarnation === object.incarnation &&
          [trigger, ...(trigger.modes ?? [])]
            .flatMap((mode) => [
              mode.target,
              ...(mode.targetGroups ?? []).map((group) => group.selector),
            ])
            .some((selector) => {
              const spec = targetSpec(selector);
              return spec?.scope === 'graveyard' && spec.excludeSource;
            })
        ) {
          queued.targetingSource = ref(s.objects[watcher.id]);
        }
        if (event === 'cast') queued.eventManaSpent = payload.manaSpent ?? 0;
        if (event === 'combatDamagePlayer') {
          queued.eventAmount = payload.amount;
          queued.damagedPlayer = payload.damagedPlayer;
        }
        if (trigger.targetGroups) queued.targetGroups = structuredClone(trigger.targetGroups);
        if (trigger.condition) queued.condition = structuredClone(trigger.condition);
        if (object)
          queued.eventSource = {
            ...ref(object),
            controller: facts.controller,
            keywords: facts.keywords ?? [],
            power: facts.power,
            definition: structuredClone(event === 'leave' ? facts.definition : d),
          };
        if (['enter', 'enters'].includes(event) && !trigger.oncePerTurn)
          for (let n = 1; n < entryTriggerMultiplicity(s, object, watcher.controller); n++) {
            s.pendingTriggers.push({ ...structuredClone(queued), id: `s${++s.nextId}` });
            emit(s, 'triggered', {
              objectId: watcher.id,
              name: watcher.name,
              player: watcher.controller,
            });
          }
      }
}
/** CR 603.10: leaves-the-battlefield triggers look back before the event.
 * One shared snapshot is used for an entire simultaneous departure batch.
 */
export function captureDepartureContext(s) {
  const objects = battlefield(s);
  const watchers = objects
    .filter((o) => (definition(s, o).triggers ?? []).length)
    .map((object) => ({
      object: structuredClone(object),
      keywords: keywords(s, object),
      definition: structuredClone(definition(s, object)),
    }));
  const aggregate = watchers.some(({ definition }) =>
    definition.triggers.some((trigger) =>
      ['diesGroup', 'battlefieldToGraveyardGroup'].includes(eventSpec(trigger.event)?.event),
    ),
  );
  return {
    ...(aggregate ? { aggregateDepartures: [] } : {}),
    exileGraveyardMoves: objects.some((o) => definition(s, o).exileGraveyardMoves),
    watchers,
    facts: Object.fromEntries(
      objects.map((o) => {
        const d = definition(s, o),
          pt = hasType(d, 'creature') ? stats(s, o) : {};
        return [
          o.id,
          {
            id: o.id,
            definition: d,
            controller: o.controller,
            owner: o.owner,
            token: o.token,
            tapped: o.tapped,
            stunCounters: o.stunCounters ?? 0,
            attacking: isAttacking(s, o),
            blocking: isBlocking(s, o),
            keywords: keywords(s, o),
            power: pt.power,
            toughness: pt.toughness,
            manaValue: manaValue(d),
          },
        ];
      }),
    ),
  };
}
/** Complete exactly one simultaneous departure event (CR 603.2c, 603.10a).
 * Context ownership determines the boundary, never resolution or priority:
 * individual move(), one sacrifice instruction, or one complete SBA batch.
 * No aggregate watcher means no additional event facts, trigger IDs or logs.
 */
export function finishDepartureBatch(s, context) {
  if (!context?.aggregateDepartures?.length) return;
  const departedObjects = context.aggregateDepartures;
  context.aggregateDepartures = [];
  const objects = departedObjects.map((object) => context.facts[object.id]);
  const creatures = objects.filter((facts) => hasType(facts.definition, 'creature'));
  if (creatures.length)
    notifyTriggers(s, 'diesGroup', { objects: creatures, departedObjects }, context);
  notifyTriggers(s, 'battlefieldToGraveyardGroup', { objects, departedObjects }, context);
}
/** Sacrifice is an action, not a synonym for any battlefield-to-graveyard move.
 * Capture observers and object facts before the entire simultaneous batch (CR 603.10a).
 * Do not use this helper for destruction, legend rules, or zero toughness.
 */
export function sacrificePermanents(s, objects, departureContext = null) {
  const unique = [
    ...new Map(objects.filter((o) => o?.zone === 'battlefield').map((o) => [o.id, o])).values(),
  ];
  if (!unique.length) return;
  const context = departureContext ?? captureDepartureContext(s);
  const departed = unique.map((o) => structuredClone(o));
  for (const o of unique) move(s, o, 'graveyard', context);
  for (const o of departed) {
    emit(s, 'sacrificed', { player: o.controller, objectId: o.id, name: o.name });
    notifyTriggers(s, 'sacrifice', { object: o, player: o.controller }, context);
  }
  if (!departureContext) finishDepartureBatch(s, context);
}
/** CR 603.2e: observe actual battlefield status transitions, after the whole
 * simultaneous batch is tapped. Entry tapped is initialization, not this event.
 * This does not represent "taps for mana" or aggregate "one or more" events. */
export function tapObjects(s, objects) {
  const changed = [
    ...new Map(
      objects.filter((o) => o?.zone === 'battlefield' && !o.tapped).map((o) => [o.id, o]),
    ).values(),
  ];
  for (const object of changed) object.tapped = true;
  // Ordinary games without tap watchers need neither event facts nor stack IDs.
  if (
    changed.length &&
    battlefield(s).some((watcher) =>
      (definition(s, watcher).triggers ?? []).some(
        (trigger) => eventSpec(trigger.event)?.event === 'tap',
      ),
    )
  )
    for (const object of changed) notifyTriggers(s, 'tap', { object });
  return changed.length;
}
/** Stun replaces an actual untap, not an attempt to untap an untapped object. */
export function untapObject(s, object) {
  if (object.zone !== 'battlefield' || !object.tapped) return false;
  if ((object.stunCounters ?? 0) > 0) {
    object.stunCounters--;
    emit(s, 'stunRemoved', { objectId: object.id, remaining: object.stunCounters });
    return false;
  }
  object.tapped = false;
  return true;
}
export function move(s, o, to, departureContext = null) {
  const from = o.zone;
  // Replacement effects are checked before a move, including simultaneous departure snapshots.
  if (
    to === 'graveyard' &&
    (departureContext?.exileGraveyardMoves ??
      battlefield(s).some((source) => definition(s, source).exileGraveyardMoves))
  )
    to = 'exile';
  // Earthbend creates a delayed trigger, not an ability on the land. It survives
  // ability loss and remembers this incarnation and the effect's controller.
  const oldRef = ref(o);
  const earthbend =
    from === 'battlefield'
      ? (s.earthbendReturns ?? []).filter(
          (v) => v.object.id === o.id && v.object.incarnation === o.incarnation,
        )
      : [];
  if (from === 'battlefield' && to !== 'battlefield')
    s.earthbendReturns = (s.earthbendReturns ?? []).filter((v) => !earthbend.includes(v));
  const leaving = from === 'battlefield' && to !== 'battlefield';
  if (leaving && s.linkedExiles?.length) {
    const returning = s.linkedExiles.filter(
      (link) => link.source.id === o.id && link.source.incarnation === o.incarnation,
    );
    s.linkedExiles = s.linkedExiles.filter((link) => !returning.includes(link));
    (s.pendingLinkedReturns ??= []).push(...returning.flatMap((link) => link.cards));
  }
  // CR 702.34a: replace every departure, not just successful resolution.
  if (from === 'stack' && to !== 'stack' && (o.flashbackPaid || o.harmonizePaid)) to = 'exile';
  if (to !== 'stack') {
    delete o.flashbackPaid;
    delete o.harmonizePaid;
  }
  if (to !== 'stack') delete o.warpPaid;
  delete o.chosenX;
  delete o.castPlayer;
  const toGraveyard = from === 'battlefield' && to === 'graveyard';
  const context = leaving ? (departureContext ?? captureDepartureContext(s)) : null;
  // Preserve the historic creature-only dies family for existing definitions
  // and replay catalogs. The explicit zone event also observes noncreatures.
  const dying = toGraveyard && hasType(definition(s, o), 'creature');
  const departed = leaving ? structuredClone(o) : null;
  if (!(from === 'stack' && to === 'battlefield')) delete o.bargained;
  if (from === 'battlefield' || from === 'stack') {
    const entries = [
      ...s.stack,
      ...s.pendingTriggers,
      ...(s.resolving ? [s.resolving.entry] : []),
      ...(['triggerMode', 'triggerTarget', 'triggerTargets'].includes(s.choice?.kind)
        ? [
            s.choice.entry,
            ...s.choice.remainingEntries,
            ...s.choice.remaining.flatMap((group) => group.entries),
          ]
        : []),
      ...(s.choice?.kind === 'orderTriggers'
        ? [...s.choice.entries, ...s.choice.remaining.flatMap((group) => group.entries)]
        : []),
    ];
    // Simultaneous departures retain the facts from before the entire batch.
    const lastKnown = departureContext?.facts?.[o.id];
    const lastKeywords = lastKnown?.keywords ?? keywords(s, o);
    const lastController = lastKnown?.controller ?? o.controller;
    const lastDefinition = lastKnown?.definition ?? definition(s, o);
    for (const entry of entries) {
      if (entry.eventSource?.id === o.id && entry.eventSource.incarnation === o.incarnation) {
        entry.eventSource.keywords = [...lastKeywords];
        entry.eventSource.controller = lastController;
        entry.eventSource.power = lastKnown?.power ?? stats(s, o).power;
        entry.eventSource.definition = structuredClone(lastDefinition);
      }
      if (entry.source?.id === o.id && entry.source.incarnation === o.incarnation) {
        entry.sourceQuestCounters = o.questCounters ?? 0;
        entry.sourceKeywords = [...lastKeywords];
        entry.sourceController = lastController;
        if (o.attachedTo || entry.sourceAttachment !== undefined)
          entry.sourceAttachment = o.attachedTo ? structuredClone(o.attachedTo) : null;
        entry.sourceDefinition = structuredClone(lastDefinition);
        entry.sourceStats = lastKnown
          ? { power: lastKnown.power ?? 0, toughness: lastKnown.toughness ?? 0 }
          : structuredClone(stats(s, o));
        if (entry.sourceCopyDefinition)
          entry.sourceCopyDefinition = structuredClone(copiableDefinition(s, o));
      }
    }
  }
  for (const p of s.players)
    for (const z of ['hand', 'library', 'graveyard', 'exile']) {
      const i = p[z].indexOf(o.id);
      if (i >= 0) p[z].splice(i, 1);
    }
  if (from === 'battlefield' && o.preparedCopy) {
    const copy = s.objects[o.preparedCopy.id];
    delete o.preparedCopy;
    if (copy?.zone === 'exile') move(s, copy, 'void');
  }
  if (from === 'exile' && to === 'stack' && o.preparedFrom) {
    const source = preparedSource(s, o);
    if (source) delete source.preparedCopy;
  }
  const preserveFaceDown = o.faceDown && from === 'stack' && to === 'battlefield';
  if (o.faceDown && !preserveFaceDown) emit(s, 'revealed', { objectId: o.id, name: o.name });
  if (!preserveFaceDown) delete o.faceDown;
  if (to !== 'battlefield') delete o.transformed;
  o.zone = to;
  if (to !== 'stack') delete o.adventureCast;
  o.incarnation++;
  o.controller = o.owner;
  o.damage = 0;
  o.plusCounters = 0;
  delete o.minusCounters;
  delete o.loyaltyUsed;
  delete o.loreCounters;
  delete o.questCounters;
  if (to === 'battlefield' && hasType(copiableDefinition(s, o), 'planeswalker'))
    o.loyalty = copiableDefinition(s, o).loyalty;
  else delete o.loyalty;
  delete o.stunCounters;
  delete o.chosenLandName;
  delete o.keywordCounters;
  delete o.powerUpUses;
  delete o.keywordCounterTimestamps;
  o.deathtouchDamage = false;
  o.tapped = false;
  o.controlledSince = s.turn;
  if (to === 'battlefield') {
    o.enteredTurn = s.turn;
    o.layerTimestamp = layerTimestamp(s);
  } else delete o.enteredTurn;
  o.attachedTo = null;
  delete o.chosenCreatureType;
  delete o.chosenBasicLandType;
  delete o.trackedExile;
  delete o.playPermission;
  delete o.plotted;
  delete o.saddledTurn;
  delete o.saddleHistory;
  delete o.warped;
  delete o.adventured;
  if (s.players[o.owner][to]) s.players[o.owner][to].push(o.id);
  emit(s, 'zoneChange', {
    objectId: o.id,
    name: o.faceDown || o.castingFaceDown ? 'Face-down creature' : o.name,
    from,
    to,
  });
  if (toGraveyard || (from === 'battlefield' && to === 'exile')) {
    for (const delayed of earthbend) {
      const { object: watched, ...entry } = delayed;
      s.pendingTriggers.push({
        ...entry,
        id: `s${++s.nextId}`,
        rule: 'earthbendReturn',
        delayedObjects: [ref(o)],
      });
      emit(s, 'triggered', { objectId: oldRef.id, name: entry.name, player: entry.controller });
    }
  }
  // Generic departures use the same pre-move observers as deaths, but match
  // the actual destination after replacement. Linked exile returns stay separate.
  if (leaving) notifyTriggers(s, 'leave', { object: departed, destination: to }, context);
  if (dying) notifyTriggers(s, 'dies', { object: departed }, context);
  if (toGraveyard) {
    notifyTriggers(s, 'battlefieldToGraveyard', { object: departed }, context);
    context.aggregateDepartures?.push(departed);
    if (!departureContext) finishDepartureBatch(s, context);
  }
  return o;
}
export function draw(s, p, count, { openingHand = false } = {}) {
  // CR121.2a: replacements referring to one or more draws modify the whole
  // instruction before its individual draws, once per replacement source.
  if (count > 0) {
    const handCount = s.players[p].hand.length;
    for (const object of battlefield(s)) {
      const bonus = definition(s, object).drawBonus;
      if (object.controller === p && bonus && handCount <= bonus.handAtMost) count += bonus.amount;
    }
  }
  for (let i = 0; i < count; i++) {
    const id = s.players[p].library[0];
    if (!id) {
      s.players[p].failedDraw = true;
      emit(s, 'emptyDraw', { player: p, ...(count > 1000 ? { attempts: count - i } : {}) });
      if (count > 1000) break;
      continue;
    }
    move(s, s.objects[id], 'hand');
    emit(s, 'draw', { player: p, objectId: id });
    if (!openingHand) {
      const player = s.players[p];
      const previous = player.cardsDrawn?.turn === s.turn ? player.cardsDrawn.count : 0;
      player.cardsDrawn = { turn: s.turn, count: previous + 1 };
      // CR 121.2/603.3: each successful draw is an event, but its triggers
      // wait for the enclosing instruction/resolution to finish. No hidden ID
      // is needed to match a player draw event.
      notifyTriggers(s, 'draw', { player: p, drawNumber: previous + 1 });
    }
  }
}
export function createGame({
  decks = [expandDeck(DECKS.ember.cards), expandDeck(DECKS.grove.cards)],
  seed = 731,
  startingPlayer = 0,
  names = ['You', 'Opponent'],
  mulligan = true,
  minimumDeckSize = 60,
  catalog = CARDS,
} = {}) {
  const rules = createRegistry(catalog);
  requireRule(decks.length === 2, 'PLAYER_COUNT', 'This release supports exactly two players.');
  requireRule(
    startingPlayer === 0 || startingPlayer === 1,
    'STARTING_PLAYER',
    'Starting player must be 0 or 1.',
  );
  requireRule(
    Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff,
    'SEED',
    'Seed must be an unsigned 32-bit integer.',
  );
  for (const deck of decks) {
    const errors = validateDeck(deck, { minimum: minimumDeckSize, catalog: rules });
    requireRule(!errors.length, 'INVALID_DECK', errors.join('\n'));
  }
  const s = {
    version: VERSION,
    rulesRevision: 3,
    catalog: rules,
    seed,
    rng: seed || 1,
    nextId: 0,
    eventSeq: 0,
    revision: 0,
    turn: 1,
    active: startingPlayer,
    startingPlayer,
    step: 'upkeep',
    priority: startingPlayer,
    passes: 0,
    status: mulligan ? 'mulligan' : 'playing',
    winner: null,
    objects: {},
    stack: [],
    pendingTriggers: [],
    resolving: null,
    modifiers: [],
    choice: null,
    combat: { attackers: [], blocks: {}, blocked: [], firstEligible: [], hasFirst: false },
    events: [],
    history: [],
    config: freezeRecord({
      catalog: rules,
      decks: structuredClone(decks),
      seed,
      startingPlayer,
      names: [...names],
      mulligan,
      minimumDeckSize,
    }),
    players: [0, 1].map((id) => ({
      id,
      name: names[id] ?? `Player ${id + 1}`,
      life: 20,
      mana: emptyMana(),
      hand: [],
      library: [],
      graveyard: [],
      exile: [],
      failedDraw: false,
      landsPlayed: 0,
      mulligans: 0,
      kept: !mulligan,
    })),
  };
  for (let p = 0; p < 2; p++) {
    for (const name of decks[p]) addObject(s, name, p);
    shuffle(s, s.players[p].library);
    draw(s, p, 7, { openingHand: true });
  }
  emit(s, 'gameStarted', { seed });
  if (mulligan) s.choice = { kind: 'mulligan', player: startingPlayer };
  return s;
}
/** Public view removes opponents' hidden identities. Never use a full snapshot over a network. */
export function playerView(state, viewer, { includeEvents = true } = {}) {
  requireRule(viewer === 0 || viewer === 1, 'VIEWER', 'Viewer must be a player.');
  const { rng, seed, config, history, catalog, ...core } = state;
  const s = structuredClone({ ...core, events: includeEvents ? core.events : [] });
  s.catalog = catalog;
  // Hidden-zone handles are positional placeholders, never stable card IDs.
  // Otherwise an agent can track a previously inspected card through a shuffle.
  const hidden = new Set();
  for (const p of s.players)
    for (const zone of ['library', 'hand']) {
      p[zone] = p[zone].map((id, index) => {
        const o = s.objects[id];
        const visible =
          zone === 'hand'
            ? p.id === viewer ||
              state.resolving?.revealedPlayer === p.id ||
              [...state.stack, ...(state.resolving ? [state.resolving.entry] : [])].some(
                (entry) =>
                  entry.source?.id === id &&
                  entry.source.incarnation === o.incarnation &&
                  entry.effects?.some((effect) => effect.op === 'ninjutsuEnter'),
              )
            : (p.id === viewer && index === 0 && topLibraryVisible(state, viewer)) ||
              ((state.choice?.player === viewer || state.choice?.revealed === true) &&
                ((state.choice.kind === 'libraryOrder' && state.choice.cards.includes(id)) ||
                  (state.choice.kind === 'librarySearch' && o.owner === viewer)));
        if (visible) return id;
        hidden.add(id);
        delete s.objects[id];
        const placeholder = `hidden:${p.id}:${zone}:${index}`;
        s.objects[placeholder] = { id: placeholder, zone, owner: p.id, hidden: true };
        return placeholder;
      });
    }
  if (
    s.choice?.player !== viewer &&
    ['libraryOrder', 'librarySearch', 'discardEffect', 'behold'].includes(s.choice?.kind)
  )
    s.choice = { kind: 'opponentChoice', player: s.choice.player };
  for (const o of Object.values(s.objects))
    if (o.faceDown && o.controller !== viewer) {
      o.name = 'Face-down creature';
      delete o.definitionOverride;
    }
  s.events = s.events.map((e) => {
    const c = { ...e };
    delete c.seed;
    if (hidden.has(c.objectId)) {
      delete c.name;
      delete c.objectId;
    }
    return c;
  });
  // Public stack source references remain valid historical handles. They do not
  // identify any positional hidden-zone placeholder in this observation.
  return s;
}
