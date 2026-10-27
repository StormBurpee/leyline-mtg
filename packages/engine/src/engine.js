import { cyclingFilter } from './cycling.js';
import { flattenTargets, targetPlanProblem, targetPlans } from './target-groups.js';
import { castingProfile } from './casting-costs.js';
import { cardDefinition } from './cards.js';
import { meetsCondition } from './conditions.js';
import { spellProfile, spellOptions } from './spell-modes.js';
import { costProblem, payCost } from './costs.js';
import {
  createGame,
  playableZone,
  playableCards,
  revealFaceDownAtEnd,
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
  finishLegendChoice,
  finishCreatureTypeChoice,
  finishAuraEntryChoice,
  finishTriggerOrder,
  finishTriggerTarget,
  finishTriggerTargets,
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
export function castProblem(s, p, id, target, { autoTap = true, mode, targets } = {}) {
  const o = s.objects[id];
  if (!playableZone(s, o, p)) return 'You cannot play this card from its current zone.';
  if (s.status !== 'playing' || s.choice || s.priority !== p) return 'You do not have priority.';
  const d = castingProfile(s, p, o, mode, targets ? flattenTargets(targets) : target);
  if (!d) return 'Choose one valid spell mode.';
  if (d.type === 'land') return 'Lands are played, not cast.';
  if (
    d.type !== 'instant' &&
    !hasKeyword(s, o, 'flash') &&
    !(s.active === p && main(s) && s.stack.length === 0)
  )
    return 'Cast this only during your main phase with an empty stack.';
  if (d.targetGroups) {
    if (target != null) return 'Use grouped targets for this spell.';
    const problem = targetPlanProblem(s, d.targetGroups, targets, p);
    if (problem) return problem;
  } else if (targets !== undefined) return 'This spell has no target groups.';
  if (d.target && !legalTarget(s, d.target, target, p)) return 'Choose a legal target.';
  if (!d.target && target != null) return 'This spell has no targets.';
  if (!planPayment(s, p, d.cost, { autoTap, purpose: { type: 'cast', card: d } }))
    return 'Not enough available mana.';
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
    playableZone(s, o, p) &&
    definition(s, o).type === 'land'
  );
}
function cast(s, p, c) {
  const problem = castProblem(s, p, c.card, c.target, {
    autoTap: c.autoTap !== false,
    mode: c.mode,
    targets: c.targets,
  });
  requireRule(!problem, 'CAST', problem);
  const o = s.objects[c.card],
    d = castingProfile(s, p, o, c.mode, c.targets ? flattenTargets(c.targets) : c.target);
  const payment = pay(s, p, d.cost, c.autoTap !== false, [], { type: 'cast', card: d });
  if (d.faceDownCast) o.castingFaceDown = true;
  move(s, o, 'stack');
  o.controller = p;
  if (d.flashbackPaid) o.flashbackPaid = true;
  delete o.castingFaceDown;
  if (d.faceDownCast) o.faceDown = true;
  s.stack.push({
    id: `s${++s.nextId}`,
    kind: 'spell',
    uncounterable: payment.uncounterable || !!d.uncounterable,
    name: o.faceDown ? 'Face-down creature' : o.name,
    controller: p,
    source: ref(o),
    sourceKeywords: [...d.keywords],
    sourceDefinition: structuredClone(definition(s, o)),
    effects: structuredClone(d.effects ?? []),
    ...(d.castingLabel ? { mode: c.mode ?? 0, modeLabel: d.castingLabel } : {}),
    ...(d.flashbackPaid ? { flashbackPaid: true } : {}),
    ...(d.kicked ? { kicked: true } : {}),
    ...(d.offspringPaid ? { offspringPaid: true } : {}),
    ...(d.targetGroups
      ? { targetGroups: structuredClone(d.targetGroups), targets: structuredClone(c.targets) }
      : {}),
    targetKind: d.target ?? null,
    target: c.target ?? null,
  });
  s.passes = 0;
  emit(s, 'cast', {
    player: p,
    objectId: o.id,
    name: o.faceDown ? 'Face-down creature' : o.name,
    target: c.target ?? null,
    ...(d.targetGroups ? { targets: structuredClone(c.targets) } : {}),
    ...(d.castingLabel ? { mode: c.mode ?? 0, modeLabel: d.castingLabel } : {}),
    ...(d.flashbackPaid ? { flashbackPaid: true } : {}),
    ...(d.kicked ? { kicked: true } : {}),
    ...(d.offspringPaid ? { offspringPaid: true } : {}),
  });
  notifyTriggers(s, 'cast', { player: p, definition: definition(s, o), object: o });
  notifyTargeted(s, s.stack.at(-1));
}
export function abilityProblem(s, p, id, index, target, discardCard, targets) {
  const o = s.objects[id];
  if (!o || o.zone !== 'battlefield' || o.controller !== p)
    return 'You do not control that permanent.';
  if (s.status !== 'playing' || s.choice || s.priority !== p) return 'You do not have priority.';
  if (!Number.isSafeInteger(index) || index < 0) return 'That ability does not exist.';
  const ability = definition(s, o).activated?.[index];
  if (!ability) return 'That ability does not exist.';
  if (!meetsCondition(s, p, ability.condition, [], o))
    return 'The activation condition is not met.';
  if (ability.oncePerTurn && o.abilityUses?.[index] === `${s.turn}:${o.incarnation}`)
    return 'This ability has already been activated this turn.';
  if (ability.timing === 'sorcery' && !(s.active === p && main(s) && s.stack.length === 0))
    return 'Activate this only as a sorcery.';

  if (ability.targetGroups) {
    if (target != null) return 'Use grouped ability targets.';
    const problem = targetPlanProblem(s, ability.targetGroups, targets, p);
    if (problem) return problem;
  } else if (targets !== undefined) return 'This ability has no target groups.';
  if (ability.target && !legalTarget(s, ability.target, target, p))
    return 'Choose a legal ability target.';
  if (!ability.target && target != null) return 'This ability has no targets.';
  const payment = costProblem(s, p, ability.cost, { sourceId: id, discardCard });
  if (payment) return payment;
  return null;
}
export function turnFaceUpProblem(s, p, id) {
  const o = s.objects[id];
  if (!o || !o.faceDown || o.zone !== 'battlefield' || o.controller !== p)
    return 'You do not control that face-down creature.';
  if (s.status !== 'playing' || s.choice || s.priority !== p) return 'You do not have priority.';
  const d = o.definitionOverride ?? cardDefinition(o.name, s.catalog);
  if (!d.disguise || !planPayment(s, p, d.disguise)) return 'Cannot pay its disguise cost.';
  return null;
}
function turnFaceUp(s, p, id) {
  const error = turnFaceUpProblem(s, p, id);
  requireRule(!error, 'DISGUISE', error);
  const o = s.objects[id],
    d = o.definitionOverride ?? cardDefinition(o.name, s.catalog);
  pay(s, p, d.disguise);
  delete o.faceDown;
  s.passes = 0;
  emit(s, 'turnedFaceUp', { player: p, objectId: id, name: o.name });
  notifyTriggers(s, 'faceUp', { object: o });
}
export function cyclingProblem(s, p, id) {
  const o = s.objects[id];
  if (!o || o.zone !== 'hand' || o.owner !== p || !definition(s, o).cycling)
    return 'That card cannot be cycled from your hand.';
  if (s.status !== 'playing' || s.choice || s.priority !== p) return 'You do not have priority.';
  if (!planPayment(s, p, definition(s, o).cycling))
    return 'Not enough available mana to cycle this card.';
  return null;
}
function cycle(s, p, c) {
  const problem = cyclingProblem(s, p, c.card);
  requireRule(!problem, 'CYCLING', problem);
  const o = s.objects[c.card],
    d = definition(s, o);
  s.stack.push({
    id: `s${++s.nextId}`,
    kind: 'ability',
    name: o.name,
    controller: p,
    source: ref(o),
    sourceKeywords: keywords(s, o),
    ...(o.attachedTo ? { sourceAttachment: structuredClone(o.attachedTo) } : {}),
    effects: d.cyclingType
      ? [
          {
            op: 'searchLibrary',
            count: 1,
            destination: 'hand',
            reveal: true,
            where: cyclingFilter(d.cyclingType),
          },
        ]
      : [{ op: 'draw', count: 1 }],
    targetKind: null,
    target: null,
    label: d.cyclingType ? `${d.cyclingType}cycling` : 'Cycling',
  });
  pay(s, p, d.cycling);
  move(s, o, 'graveyard');
  s.passes = 0;
  emit(s, 'cycled', { player: p, objectId: o.id, name: o.name });
}
function activate(s, p, c) {
  const problem = abilityProblem(s, p, c.card, c.ability, c.target, c.discardCard, c.targets);
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
    ...(o.attachedTo ? { sourceAttachment: structuredClone(o.attachedTo) } : {}),
    effects: structuredClone(a.effects),
    ...(a.targetGroups
      ? { targetGroups: structuredClone(a.targetGroups), targets: structuredClone(c.targets) }
      : {}),
    targetKind: a.target ?? null,
    target: c.target ?? null,
    label: a.text,
  });
  if (a.oncePerTurn) (o.abilityUses ??= {})[c.ability] = `${s.turn}:${o.incarnation}`;
  payCost(s, p, a.cost, { sourceId: o.id, discardCard: c.discardCard });
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
  if (
    [
      'libraryOrder',
      'librarySearch',
      'discardEffect',
      'payCost',
      'optionalEffect',
      'exilePlay',
      'bindingNegotiation',
      'exileToGraveyard',
    ].includes(choice.kind)
  ) {
    finishResolutionChoice(s, c);
    return;
  }
  switch (choice.kind) {
    case 'triggerTargets':
      requireRule(
        c.type === 'chooseTriggerTargets',
        'CHOICE',
        'Choose the triggered ability targets.',
      );
      finishTriggerTargets(s, c.targets);
      return;
    case 'auraEntry':
      finishAuraEntryChoice(s, c);
      return;
    case 'creatureType':
      finishCreatureTypeChoice(s, c);
      return;
    case 'legendRule':
      requireRule(c.type === 'chooseLegend', 'CHOICE', 'Choose a legendary permanent to keep.');
      finishLegendChoice(s, c.card);
      return;
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
      revealFaceDownAtEnd(s);
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
        case 'turnFaceUp':
          turnFaceUp(s, p, command.card);
          break;
        case 'cycle':
          cycle(s, p, command);
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
  if (s.choice?.kind === 'auraEntry' && s.choice.player === p)
    return [
      ...s.choice.cards.map((card) => ({ type: 'chooseAuraAttachment', card })),
      { type: 'concede' },
    ];
  if (s.choice?.kind === 'legendRule' && s.choice.player === p)
    return [...s.choice.cards.map((card) => ({ type: 'chooseLegend', card })), { type: 'concede' }];
  if (s.choice?.kind === 'triggerTargets' && s.choice.player === p)
    return [
      ...targetPlans(s, s.choice.entry.targetGroups, p).map((targets) => ({
        type: 'chooseTriggerTargets',
        targets,
      })),
      { type: 'concede' },
    ];
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
  for (const id of playableCards(s, p)) {
    if (!cyclingProblem(s, p, id)) actions.push({ type: 'cycle', card: id });
    if (canPlayLand(s, p, id)) {
      actions.push({ type: 'playLand', card: id });
      continue;
    }
    const d = definition(s, s.objects[id]);
    if (d.type === 'land') continue;
    for (const { mode, profile } of spellOptions(d)) {
      if (profile.targetGroups) {
        for (const targets of targetPlans(s, profile.targetGroups, p))
          if (!castProblem(s, p, id, null, { mode, targets }))
            actions.push({
              type: 'cast',
              card: id,
              ...(mode !== undefined ? { mode } : {}),
              targets,
            });
        continue;
      }
      const targets = profile.target ? targetsFor(s, profile.target, p) : [null];
      for (const target of targets)
        if (!castProblem(s, p, id, target, { mode }))
          actions.push({
            type: 'cast',
            card: id,
            ...(mode !== undefined ? { mode } : {}),
            ...(target ? { target } : {}),
          });
    }
  }
  for (const o of Object.values(s.objects)) {
    if (!turnFaceUpProblem(s, p, o.id)) actions.push({ type: 'turnFaceUp', card: o.id });
    if (canTapForMana(s, o, p))
      for (const color of manaOptions(s, o)) actions.push({ type: 'tapMana', card: o.id, color });
    if (o.zone !== 'battlefield' || o.controller !== p) continue;
    for (const [index, a] of (definition(s, o).activated ?? []).entries()) {
      if (a.targetGroups) {
        for (const targets of targetPlans(s, a.targetGroups, p))
          for (const discardCard of a.cost.discard ? s.players[p].hand : [undefined])
            if (!abilityProblem(s, p, o.id, index, null, discardCard, targets))
              actions.push({
                type: 'activate',
                card: o.id,
                ability: index,
                targets,
                ...(discardCard ? { discardCard } : {}),
              });
        continue;
      }
      for (const target of a.target ? targetsFor(s, a.target, p) : [null])
        for (const discardCard of a.cost.discard ? s.players[p].hand : [undefined])
          if (!abilityProblem(s, p, o.id, index, target, discardCard))
            actions.push({
              type: 'activate',
              card: o.id,
              ability: index,
              ...(discardCard ? { discardCard } : {}),
              ...(target ? { target } : {}),
            });
    }
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
        '0.38.0',
        '0.37.0',
        '0.36.1',
        '0.36.0',
        '0.35.0',
        '0.34.0',
        '0.33.0',
        '0.32.0',
        '0.31.0',
        '0.30.0',
        '0.29.0',
        '0.28.0',
        '0.27.0',
        '0.27.1',
        '0.26.0',
        '0.25.0',
        '0.24.0',
        '0.23.0',
        '0.22.0',
        '0.21.0',
        '0.20.0',
        '0.17.0',
        '0.16.0',
        '0.15.0',
        '0.14.0',
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
