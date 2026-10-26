import { costProblem, payCost } from './costs.js';
import {
  createGame,
  freezeRecord,
  definition,
  draw,
  emit,
  hasKeyword,
  keywords,
  move,
  opponent,
  ref,
  requireRule,
  RuleError,
  shuffle,
  VERSION,
  REPLAY_SCHEMA_VERSION,
} from './model.js';
import { canTapForMana, manaOptions, pay, planPayment, tapForMana } from './mana.js';
import {
  finishTriggerOrder,
  finishTriggerTarget,
  legalTarget,
  resolveTop,
  stabilize,
  targetsFor,
  notifyTriggers,
  notifyTargeted,
  finishResolutionChoice,
  enterBattlefield,
} from './effects.js';
import { assignDamage, canAttack, declareAttackers, declareBlockers } from './combat.js';
import { advanceStep, finishCleanup } from './turn.js';
const main = (s) => ['main1', 'main2'].includes(s.step);
export function castProblem(s, p, id, target, { autoTap = true } = {}) {
  const o = s.objects[id];
  if (!o || o.zone !== 'hand' || o.owner !== p) return 'Card is not in your hand.';
  if (s.status !== 'playing' || s.choice || s.priority !== p) return 'You do not have priority.';
  const d = definition(s, o);
  if (d.type === 'land') return 'Lands are played, not cast.';
  if (
    d.type !== 'instant' &&
    !hasKeyword(s, o, 'flash') &&
    !(s.active === p && main(s) && s.stack.length === 0)
  )
    return 'Cast this only during your main phase with an empty stack.';
  if (d.target && !legalTarget(s, d.target, target, p)) return 'Choose a legal target.';
  if (!d.target && target != null) return 'This spell has no targets.';
  if (!planPayment(s, p, d.cost, { autoTap })) return 'Not enough available mana.';
  return null;
}
export function canPlayLand(s, p, id) {
  const o = s.objects[id];
  return (
    s.status === 'playing' &&
    !s.choice &&
    s.priority === p &&
    s.active === p &&
    main(s) &&
    !s.stack.length &&
    s.players[p].landsPlayed < 1 &&
    o?.zone === 'hand' &&
    o.owner === p &&
    definition(s, o).type === 'land'
  );
}
function cast(s, p, c) {
  const problem = castProblem(s, p, c.card, c.target, { autoTap: c.autoTap !== false });
  requireRule(!problem, 'CAST', problem);
  const o = s.objects[c.card],
    d = definition(s, o);
  pay(s, p, d.cost, c.autoTap !== false);
  move(s, o, 'stack');
  s.stack.push({
    id: `s${++s.nextId}`,
    kind: 'spell',
    name: o.name,
    controller: p,
    source: ref(o),
    sourceKeywords: [...d.keywords],
    effects: structuredClone(d.effects ?? []),
    targetKind: d.target ?? null,
    target: c.target ?? null,
  });
  s.passes = 0;
  emit(s, 'cast', { player: p, objectId: o.id, name: o.name, target: c.target ?? null });
  notifyTriggers(s, 'cast', { player: p, definition: d, object: o });
  notifyTargeted(s, s.stack.at(-1));
}
export function abilityProblem(s, p, id, index, target) {
  const o = s.objects[id];
  if (!o || o.zone !== 'battlefield' || o.controller !== p)
    return 'You do not control that permanent.';
  if (s.status !== 'playing' || s.choice || s.priority !== p) return 'You do not have priority.';
  if (!Number.isSafeInteger(index) || index < 0) return 'That ability does not exist.';
  const ability = definition(s, o).activated?.[index];
  if (!ability) return 'That ability does not exist.';

  if (ability.target && !legalTarget(s, ability.target, target, p))
    return 'Choose a legal ability target.';
  if (!ability.target && target != null) return 'This ability has no targets.';
  const payment = costProblem(s, p, ability.cost, { sourceId: id });
  if (payment) return payment;
  return null;
}
function activate(s, p, c) {
  const problem = abilityProblem(s, p, c.card, c.ability, c.target);
  requireRule(!problem, 'ACTIVATE', problem);
  const o = s.objects[c.card],
    a = definition(s, o).activated[c.ability];
  s.stack.push({
    id: `s${++s.nextId}`,
    kind: 'ability',
    name: o.name,
    controller: p,
    source: ref(o),
    sourceKeywords: keywords(s, o),
    effects: structuredClone(a.effects),
    targetKind: a.target ?? null,
    target: c.target ?? null,
    label: a.text,
  });
  payCost(s, p, a.cost, { sourceId: o.id });
  s.passes = 0;
  emit(s, 'activated', { player: p, name: o.name, objectId: o.id, ability: c.ability });
  notifyTargeted(s, s.stack.at(-1));
}
function completeMulligan(s, p) {
  s.players[p].kept = true;
  const next = [s.startingPlayer, opponent(s.startingPlayer)].find((id) => !s.players[id].kept);
  if (next !== undefined) {
    s.choice = { kind: 'mulligan', player: next };
    return;
  }
  s.choice = null;
  s.status = 'playing';
  s.priority = s.startingPlayer;
  stabilize(s);
}
function handleChoice(s, p, c) {
  const choice = s.choice;
  requireRule(choice.player === p, 'CHOICE_PLAYER', 'The other player must make this choice.');
  if (['libraryOrder', 'discardEffect', 'payCost', 'optionalEffect'].includes(choice.kind)) {
    finishResolutionChoice(s, c);
    return;
  }
  switch (choice.kind) {
    case 'mulligan': {
      requireRule(
        ['keep', 'mulligan'].includes(c.type),
        'CHOICE',
        'Keep or mulligan your opening hand.',
      );
      const player = s.players[p];
      if (c.type === 'mulligan') {
        requireRule(
          player.mulligans < 7,
          'MULLIGAN_LIMIT',
          'You cannot mulligan below zero cards.',
        );
        for (const id of [...player.hand]) move(s, s.objects[id], 'library');
        shuffle(s, player.library);
        draw(s, p, 7);
        player.mulligans++;
        emit(s, 'mulligan', { player: p, count: player.mulligans });
      } else if (player.mulligans > 0)
        s.choice = { kind: 'bottom', player: p, count: player.mulligans };
      else completeMulligan(s, p);
      return;
    }
    case 'bottom':
    case 'discard': {
      requireRule(c.type === choice.kind, 'CHOICE', `Choose cards to ${choice.kind}.`);
      requireRule(
        Array.isArray(c.cards) &&
          c.cards.length === choice.count &&
          new Set(c.cards).size === c.cards.length,
        'CHOICE_COUNT',
        `Choose exactly ${choice.count} distinct cards.`,
      );
      for (const id of c.cards)
        requireRule(
          s.players[p].hand.includes(id),
          'CHOICE_CARD',
          'Choose only cards in your hand.',
        );
      for (const id of c.cards)
        move(s, s.objects[id], choice.kind === 'bottom' ? 'library' : 'graveyard');
      s.choice = null;
      if (choice.kind === 'bottom') completeMulligan(s, p);
      else finishCleanup(s);
      return;
    }
    case 'attackers':
      requireRule(c.type === 'attackers', 'CHOICE', 'Declare attackers first.');
      declareAttackers(s, c.cards);
      return;
    case 'blockers':
      requireRule(c.type === 'blockers', 'CHOICE', 'Declare blockers first.');
      declareBlockers(s, c.pairs);
      return;
    case 'assignDamage':
      requireRule(c.type === 'assignDamage', 'CHOICE', 'Assign combat damage first.');
      assignDamage(s, c.orders);
      return;
    case 'triggerTarget':
      requireRule(
        c.type === 'chooseTriggerTarget',
        'CHOICE',
        'Choose the triggered ability target first.',
      );
      finishTriggerTarget(s, c.target);
      return;
    case 'orderTriggers':
      requireRule(c.type === 'orderTriggers', 'CHOICE', 'Order pending triggers first.');
      requireRule(
        Array.isArray(c.ids) &&
          c.ids.length === choice.entries.length &&
          new Set(c.ids).size === c.ids.length &&
          c.ids.every((id) => choice.entries.some((e) => e.id === id)),
        'TRIGGER_ORDER',
        'Order each pending trigger exactly once, bottom to top.',
      );
      finishTriggerOrder(s, c.ids);
      return;
    default:
      throw new Error(`Unknown choice kind ${choice.kind}`);
  }
}
/**
 * Atomic command boundary. Invalid commands never mutate the input. Revision
 * leases reject stale double-clicks and establish a future server protocol.
 */
export function dispatch(state, command) {
  try {
    requireRule(command && typeof command === 'object', 'COMMAND', 'Command must be an object.');
    requireRule(command.player === 0 || command.player === 1, 'PLAYER', 'Player must be 0 or 1.');
    requireRule(state.status !== 'finished', 'GAME_OVER', 'The game is over.');
    if (command.expectedRevision !== undefined)
      requireRule(
        command.expectedRevision === state.revision,
        'STALE_COMMAND',
        'State changed. Refresh your legal actions.',
      );
    command = structuredClone(command);
    const s = structuredClone({ ...state, events: [], history: [], catalog: null, config: null }),
      p = command.player;
    s.catalog = state.catalog;
    s.config = state.config;
    s.events = [...state.events];
    s.history = [...state.history];
    if (command.type === 'concede') {
      s.status = 'finished';
      s.winner = opponent(p);
      s.choice = null;
      emit(s, 'gameOver', { winner: s.winner, reason: 'concession' });
    } else if (s.choice) handleChoice(s, p, command);
    else {
      requireRule(s.status === 'playing', 'GAME_STATUS', 'The game has not started.');
      requireRule(s.priority === p, 'PRIORITY', 'You do not have priority.');
      switch (command.type) {
        case 'playLand':
          requireRule(canPlayLand(s, p, command.card), 'LAND', 'You cannot play that land now.');
          enterBattlefield(s, s.objects[command.card], p);
          s.players[p].landsPlayed++;
          s.passes = 0;
          emit(s, 'land', { player: p, objectId: command.card });
          break;
        case 'tapMana':
          tapForMana(s, command.card, p, command.color);
          s.passes = 0;
          break;
        case 'cast':
          cast(s, p, command);
          break;
        case 'activate':
          activate(s, p, command);
          break;
        case 'pass':
          s.passes++;
          emit(s, 'pass', { player: p });
          if (s.passes === 2) {
            s.passes = 0;
            if (s.stack.length) {
              resolveTop(s);
              s.priority = s.active;
            } else advanceStep(s);
          } else s.priority = opponent(p);
          break;
        default:
          throw new RuleError('COMMAND_TYPE', `Unsupported command: ${command.type}`);
      }
    }
    if (s.status === 'playing' && !s.choice) stabilize(s);
    s.revision++;
    s.history.push(freezeRecord(structuredClone(command)));
    assertInvariants(s);
    return { ok: true, state: s, events: s.events.slice(state.events.length) };
  } catch (error) {
    if (error instanceof RuleError)
      return { ok: false, state, error: { code: error.code, message: error.message }, events: [] };
    throw error;
  }
}
export function legalActions(s, p) {
  if (s.status === 'finished') return [];
  if (s.choice?.kind === 'triggerTarget' && s.choice.player === p)
    return [
      ...s.choice.targets.map((target) => ({
        type: 'chooseTriggerTarget',
        target: structuredClone(target),
      })),
      { type: 'concede' },
    ];
  if (s.choice)
    return s.choice.player === p
      ? [{ type: 'choice', kind: s.choice.kind }, { type: 'concede' }]
      : [{ type: 'concede' }];
  if (s.priority !== p) return [{ type: 'concede' }];
  const actions = [{ type: 'pass' }, { type: 'concede' }];
  for (const id of s.players[p].hand) {
    if (canPlayLand(s, p, id)) {
      actions.push({ type: 'playLand', card: id });
      continue;
    }
    const d = definition(s, s.objects[id]);
    if (d.type === 'land') continue;
    const targets = d.target ? targetsFor(s, d.target, p) : [null];
    for (const target of targets)
      if (!castProblem(s, p, id, target))
        actions.push({ type: 'cast', card: id, ...(target ? { target } : {}) });
  }
  for (const o of Object.values(s.objects)) {
    if (canTapForMana(s, o, p))
      for (const color of manaOptions(s, o)) actions.push({ type: 'tapMana', card: o.id, color });
    if (o.zone !== 'battlefield' || o.controller !== p) continue;
    for (const [index, a] of (definition(s, o).activated ?? []).entries())
      for (const target of a.target ? targetsFor(s, a.target, p) : [null])
        if (!abilityProblem(s, p, o.id, index, target))
          actions.push({
            type: 'activate',
            card: o.id,
            ability: index,
            ...(target ? { target } : {}),
          });
  }
  return actions;
}
export function assertInvariants(s) {
  const located = new Set();
  for (const p of s.players) {
    for (const z of ['library', 'hand', 'graveyard', 'exile'])
      for (const id of p[z]) {
        const o = s.objects[id];
        if (!o || o.zone !== z || o.owner !== p.id || located.has(id))
          throw new Error(`Zone invariant failed: ${id} in ${z}`);
        located.add(id);
      }
    if (!Number.isFinite(p.life)) throw new Error('Invalid life');
    for (const value of Object.values(p.mana))
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid mana pool');
  }
  for (const o of Object.values(s.objects)) {
    if (['library', 'hand', 'graveyard', 'exile'].includes(o.zone) && !located.has(o.id))
      throw new Error(`Unindexed object ${o.id}`);
    if (
      o.zone === 'stack' &&
      !s.stack.some((e) => e.kind === 'spell' && e.source.id === o.id) &&
      !(s.resolving?.entry.kind === 'spell' && s.resolving.entry.source.id === o.id)
    )
      throw new Error(`Unindexed stack card ${o.id}`);
  }
  if (new Set(s.stack.map((e) => e.id)).size !== s.stack.length)
    throw new Error('Duplicate stack entry');
  if (s.priority !== 0 && s.priority !== 1) throw new Error('Invalid priority');
  return true;
}
export function exportReplay(s) {
  return structuredClone({
    schemaVersion: REPLAY_SCHEMA_VERSION,
    version: VERSION,
    config: s.config,
    commands: s.history,
  });
}
export function replay(record) {
  requireRule(
    record &&
      [
        VERSION,
        '0.13.0',
        '0.12.0',
        '0.11.0',
        '0.10.0',
        '0.9.0',
        '0.8.0',
        '0.6.0',
        '0.5.0',
        '0.4.0',
        '0.3.0',
        '0.2.0',
        '0.1.0',
      ].includes(record.version) &&
      (record.schemaVersion === undefined || record.schemaVersion === REPLAY_SCHEMA_VERSION),
    'REPLAY_VERSION',
    'Unsupported replay schema or engine version.',
  );
  requireRule(
    Array.isArray(record.commands) && record.commands.length <= 10000,
    'REPLAY',
    'Invalid or oversized replay.',
  );
  let s = createGame(record.config);
  for (const [index, c] of record.commands.entries()) {
    const r = dispatch(s, c);
    requireRule(r.ok, 'REPLAY_COMMAND', `Replay command ${index} rejected: ${r.error?.message}`);
    s = r.state;
  }
  return s;
}
