import { cardDefinition, CARDS, DECKS, expandDeck, validateDeck } from './cards.js';
import { createRegistry } from './registry.js';
export const VERSION = '0.6.0';
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
export const emptyMana = () => Object.fromEntries(COLORS.map((c) => [c, 0]));
export function definition(stateOrObject, object) {
  return object
    ? cardDefinition(object.name, stateOrObject.catalog)
    : cardDefinition(stateOrObject.name);
}
export const battlefield = (s) => Object.values(s.objects).filter((o) => o.zone === 'battlefield');
export const creatures = (s) => battlefield(s).filter((o) => definition(s, o).type === 'creature');
export const controlled = (s, p) => battlefield(s).filter((o) => o.controller === p);
export function keywords(s, o) {
  return [
    ...new Set([
      ...definition(s, o).keywords,
      ...s.modifiers
        .filter((m) => m.objectId === o.id && m.incarnation === o.incarnation)
        .flatMap((m) => m.keywords ?? []),
    ]),
  ];
}
export const hasKeyword = (s, o, k) => keywords(s, o).includes(k);
export function stats(s, o) {
  const d = definition(s, o);
  let power = (d.power ?? 0) + (o.plusCounters ?? 0),
    toughness = (d.toughness ?? 0) + (o.plusCounters ?? 0);
  for (const m of s.modifiers)
    if (m.objectId === o.id && m.incarnation === o.incarnation) {
      power += m.power ?? 0;
      toughness += m.toughness ?? 0;
    }
  if (d.type === 'creature' && o.zone === 'battlefield')
    for (const a of controlled(s, o.controller)) {
      const effect = definition(s, a).static;
      if (effect?.kind === 'anthem') {
        power += effect.power;
        toughness += effect.toughness;
      }
    }
  return { power, toughness };
}
export const isSick = (s, o) => o.controlledSince >= s.turn && !hasKeyword(s, o, 'haste');
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
    token: !!d.token,
    attachedTo: null,
  };
  if (s.players[owner][zone]) s.players[owner][zone].push(id);
  return s.objects[id];
}
export function ref(o) {
  return { kind: 'object', id: o.id, incarnation: o.incarnation };
}
export function move(s, o, to) {
  const from = o.zone;
  if (from === 'battlefield' || from === 'stack') {
    const entries = [
      ...s.stack,
      ...s.pendingTriggers,
      ...(s.resolving ? [s.resolving.entry] : []),
      ...(s.choice?.kind === 'orderTriggers'
        ? [...s.choice.entries, ...s.choice.remaining.flatMap((group) => group.entries)]
        : []),
    ];
    for (const entry of entries)
      if (entry.source?.id === o.id && entry.source.incarnation === o.incarnation) {
        entry.sourceKeywords = keywords(s, o);
        entry.sourceController = o.controller;
      }
  }
  for (const p of s.players)
    for (const z of ['hand', 'library', 'graveyard', 'exile']) {
      const i = p[z].indexOf(o.id);
      if (i >= 0) p[z].splice(i, 1);
    }
  o.zone = to;
  o.incarnation++;
  o.controller = o.owner;
  o.damage = 0;
  o.plusCounters = 0;
  o.deathtouchDamage = false;
  o.tapped = false;
  o.controlledSince = s.turn;
  o.attachedTo = null;
  if (s.players[o.owner][to]) s.players[o.owner][to].push(o.id);
  emit(s, 'zoneChange', { objectId: o.id, name: o.name, from, to });
  return o;
}
export function draw(s, p, count) {
  for (let i = 0; i < count; i++) {
    const id = s.players[p].library[0];
    if (!id) {
      s.players[p].failedDraw = true;
      emit(s, 'emptyDraw', { player: p });
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
  for (const [id, o] of Object.entries(s.objects))
    if (
      (o.zone === 'library' &&
        !(
          state.choice?.kind === 'libraryOrder' &&
          state.choice.player === viewer &&
          state.choice.cards.includes(id)
        )) ||
      (o.zone === 'hand' && o.owner !== viewer)
    )
      s.objects[id] = { id, zone: o.zone, owner: o.owner, hidden: true };
  if (s.choice?.player !== viewer && ['libraryOrder', 'discardEffect'].includes(s.choice?.kind))
    s.choice = { kind: 'opponentChoice', player: s.choice.player };
  s.events = s.events.map((e) => {
    const c = { ...e };
    delete c.seed;
    if (c.objectId && s.objects[c.objectId]?.hidden) delete c.name;
    return c;
  });
  return s;
}
