import { numericValue } from './numeric-values.js';
import { FACE_DOWN } from './disguise.js';
import { meetsCondition } from './conditions.js';
import { matchesFilter, targetSpec } from './selectors.js';
import { matchesEvent } from './events.js';
import { hasType } from './types.js';
import { cardDefinition, CARDS, DECKS, expandDeck, validateDeck } from './cards.js';
import { createRegistry } from './registry.js';
export const VERSION = '0.36.1';
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
export function playableZone(s, o, p) {
  return (
    !!o &&
    ((o.zone === 'hand' && o.owner === p) ||
      (o.zone === 'exile' &&
        o.playPermission?.player === p &&
        o.playPermission.turn === s.turn &&
        o.playPermission.incarnation === o.incarnation))
  );
}
export function playableCards(s, p) {
  return [
    ...s.players[p].hand,
    ...Object.values(s.objects)
      .filter((o) => o.zone === 'exile' && playableZone(s, o, p))
      .map((o) => o.id),
  ];
}

export const emptyMana = () => Object.fromEntries(COLORS.map((c) => [c, 0]));
export function definition(stateOrObject, object) {
  if ((object ?? stateOrObject).faceDown) return FACE_DOWN;
  return object
    ? (object.definitionOverride ?? cardDefinition(object.name, stateOrObject.catalog))
    : (stateOrObject.definitionOverride ?? cardDefinition(stateOrObject.name));
}
export const battlefield = (s) => Object.values(s.objects).filter((o) => o.zone === 'battlefield');
export const creatures = (s) => battlefield(s).filter((o) => definition(s, o).type === 'creature');
export const controlled = (s, p) => battlefield(s).filter((o) => o.controller === p);
function staticApplies(s, source, object, effect) {
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
      attacking: isAttacking(s, object),
      blocking: isBlocking(s, object),
      manaValue: Object.values(d.cost).reduce((a, b) => a + b, 0),
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
      attacking: isAttacking(s, target),
      blocking: isBlocking(s, target),
      manaValue: Object.values(t.cost).reduce((a, b) => a + b, 0),
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
  return [
    ...new Set([
      ...definition(s, o).keywords,
      ...(s.players[o.controller].speed === 4 ? (definition(s, o).maxSpeedKeywords ?? []) : []),
      ...battlefield(s).flatMap((source) => {
        const d = definition(s, source);
        const e = d.static;
        return [
          ...(d.attachmentBonus && attachmentApplies(s, source, o)
            ? (d.attachmentBonus.keywords ?? [])
            : []),
          ...(e?.kind === 'anthem' && staticApplies(s, source, o, e) ? (e.keywords ?? []) : []),
          ...(d.conditionalBonuses ?? []).flatMap((bonus) =>
            conditionalApplies(s, source, o, bonus) ? (bonus.keywords ?? []) : [],
          ),
        ];
      }),
      ...s.modifiers
        .filter((m) => m.objectId === o.id && m.incarnation === o.incarnation)
        .flatMap((m) => m.keywords ?? []),
    ]),
  ];
}
export const hasKeyword = (s, o, k) => keywords(s, o).includes(k);
export function stats(s, o) {
  const d = definition(s, o);
  const context = { controller: o.controller, source: ref(o) };
  let power = numericValue(s, d.baseStats?.power ?? d.power ?? 0, context) + (o.plusCounters ?? 0),
    toughness =
      numericValue(s, d.baseStats?.toughness ?? d.toughness ?? 0, context) + (o.plusCounters ?? 0);
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
      if (effect?.kind === 'anthem' && staticApplies(s, a, o, effect)) {
        power += numericValue(s, effect.power, { controller: a.controller, source: ref(a) });
        toughness += numericValue(s, effect.toughness, {
          controller: a.controller,
          source: ref(a),
        });
      }
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
export function addObject(s, name, owner, zone = 'library') {
  const d = cardDefinition(name, s.catalog),
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
    damage: 0,
    deathtouchDamage: false,
    controlledSince: s.turn,
    ...(zone === 'battlefield' ? { enteredTurn: s.turn } : {}),
    token: !!d.token,
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
    label,
    ...(optional ? { optional: true } : {}),
    ...(targetKind ? { targetKind: structuredClone(targetKind) } : {}),
  });
  emit(s, 'triggered', { objectId: source.id, name: source.name, player: source.controller });
}
/** Match declarative trigger predicates against committed game events. */
export function notifyTriggers(s, event, payload, context = null) {
  const object = payload.object;
  const d = payload.definition ?? (object ? definition(s, object) : null);
  const pt =
    object && hasType(d, 'creature')
      ? stats(s, object)
      : { power: d?.power, toughness: d?.toughness };
  const facts = context?.facts?.[object?.id] ?? {
    id: object?.id,
    definition: d,
    controller: payload.player ?? object?.controller,
    step: payload.step,
    objects: payload.objects,
    owner: object?.owner,
    token: object?.token,
    tapped: object?.zone === 'battlefield' ? object.tapped : undefined,
    attacking: object ? isAttacking(s, object) : false,
    blocking: object ? isBlocking(s, object) : false,
    keywords: object?.zone === 'battlefield' ? keywords(s, object) : d?.keywords,
    power: pt.power,
    toughness: pt.toughness,
    manaValue: Object.values(d?.cost ?? {}).reduce((a, b) => a + b, 0),
  };
  const watchers =
    context?.watchers ??
    battlefield(s).map((object) => ({ object, keywords: keywords(s, object) }));
  for (const { object: watcher, keywords: sourceKeywords } of watchers)
    for (const trigger of definition(s, watcher).triggers ?? [])
      if (
        matchesEvent(trigger.event, event === 'enters' ? 'enter' : event, facts, watcher) &&
        meetsCondition(s, watcher.controller, trigger.condition, [], watcher)
      ) {
        queueTrigger(
          s,
          watcher,
          trigger.effects,
          `${watcher.name} · triggered ability`,
          trigger.optional,
          trigger.target,
          sourceKeywords,
        );
        const queued = s.pendingTriggers.at(-1);
        if (trigger.condition) queued.condition = structuredClone(trigger.condition);
        if (object)
          queued.eventSource = {
            ...ref(object),
            controller: facts.controller,
            keywords: facts.keywords ?? [],
            power: facts.power,
            definition: structuredClone(d),
          };
      }
}
/** CR 603.10: leaves-the-battlefield triggers look back before the event.
 * One shared snapshot is used for an entire simultaneous state-based-action batch.
 */
export function captureDepartureContext(s) {
  const objects = battlefield(s);
  return {
    watchers: objects
      .filter((o) => (definition(s, o).triggers ?? []).length)
      .map((object) => ({ object: structuredClone(object), keywords: keywords(s, object) })),
    facts: Object.fromEntries(
      objects.map((o) => {
        const d = definition(s, o),
          pt = stats(s, o);
        return [
          o.id,
          {
            id: o.id,
            definition: d,
            controller: o.controller,
            owner: o.owner,
            token: o.token,
            tapped: o.tapped,
            attacking: isAttacking(s, o),
            blocking: isBlocking(s, o),
            keywords: keywords(s, o),
            power: pt.power,
            toughness: pt.toughness,
            manaValue: Object.values(d?.cost ?? {}).reduce((a, b) => a + b, 0),
          },
        ];
      }),
    ),
  };
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
  const dying =
    from === 'battlefield' && to === 'graveyard' && hasType(definition(s, o), 'creature');
  const context = dying ? (departureContext ?? captureDepartureContext(s)) : null;
  const departed = dying ? structuredClone(o) : null;
  if (from === 'battlefield' || from === 'stack') {
    const entries = [
      ...s.stack,
      ...s.pendingTriggers,
      ...(s.resolving ? [s.resolving.entry] : []),
      ...(s.choice?.kind === 'triggerTarget'
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
        entry.sourceKeywords = [...lastKeywords];
        entry.sourceController = lastController;
        if (o.attachedTo || entry.sourceAttachment !== undefined)
          entry.sourceAttachment = o.attachedTo ? structuredClone(o.attachedTo) : null;
        entry.sourceDefinition = structuredClone(lastDefinition);
      }
    }
  }
  for (const p of s.players)
    for (const z of ['hand', 'library', 'graveyard', 'exile']) {
      const i = p[z].indexOf(o.id);
      if (i >= 0) p[z].splice(i, 1);
    }
  const preserveFaceDown = o.faceDown && from === 'stack' && to === 'battlefield';
  if (o.faceDown && !preserveFaceDown) emit(s, 'revealed', { objectId: o.id, name: o.name });
  if (!preserveFaceDown) delete o.faceDown;
  o.zone = to;
  o.incarnation++;
  o.controller = o.owner;
  o.damage = 0;
  o.plusCounters = 0;
  delete o.stunCounters;
  o.deathtouchDamage = false;
  o.tapped = false;
  o.controlledSince = s.turn;
  if (to === 'battlefield') o.enteredTurn = s.turn;
  else delete o.enteredTurn;
  o.attachedTo = null;
  delete o.chosenCreatureType;
  delete o.playPermission;
  if (s.players[o.owner][to]) s.players[o.owner][to].push(o.id);
  emit(s, 'zoneChange', {
    objectId: o.id,
    name: o.faceDown || o.castingFaceDown ? 'Face-down creature' : o.name,
    from,
    to,
  });
  if (dying) notifyTriggers(s, 'dies', { object: departed }, context);
  return o;
}
export function draw(s, p, count) {
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
    draw(s, p, 7);
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
            ? p.id === viewer || state.resolving?.revealedPlayer === p.id
            : state.choice?.player === viewer &&
              ((state.choice.kind === 'libraryOrder' && state.choice.cards.includes(id)) ||
                (state.choice.kind === 'librarySearch' && o.owner === viewer));
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
    ['libraryOrder', 'librarySearch', 'discardEffect'].includes(s.choice?.kind)
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
