import { activationSacrificeOptions } from './activation-sacrifice.js';
import { tapObjects } from './model.js';
import { sacrificePermanents } from './model.js';
import {
  castingPayment,
  castingSacrificeCandidates,
  harmonizeCandidates,
  additionalCostOptions,
  payAdditionalCost,
} from './casting-sacrifice.js';
import { convokeCandidates } from './convoke.js';
import { recordSpellCast } from './spell-history.js';
import { crewProblem, crewPlan } from './crew.js';
import { saddleProblem, saddlePlan } from './saddle.js';
import { MAX_X, manaValue } from './mana-value.js';
import { cyclingFilter } from './cycling.js';
import { flattenTargets, targetPlanProblem, targetPlans } from './target-groups.js';
import { castingProfile, distributionProblem } from './casting-costs.js';
import { cardDefinition } from './cards.js';
import { meetsCondition } from './conditions.js';
import { spellProfile, spellOptions } from './spell-modes.js';
import { costProblem, payCost, activationCost } from './costs.js';
import {
  createGame,
  playableZone,
  playableCards,
  revealFaceDownAtEnd,
  freezeRecord,
  definition,
  copiableDefinition,
  draw,
  emit,
  hasKeyword,
  keywords,
  stats,
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
  continueResolution,
  finishLegendChoice,
  finishCreatureTypeChoice,
  finishAuraEntryChoice,
  finishEntryLifeChoice,
  finishTriggerOrder,
  finishTriggerMode,
  finishTriggerTarget,
  finishTriggerTargets,
  legalTarget,
  resolveTop,
  flushLinkedReturns,
  stabilize,
  targetsFor,
  notifyTriggers,
  notifyTargeted,
  finishResolutionChoice,
  enterBattlefield,
} from './effects.js';
import { assignDamage, canAttack, declareAttackers, declareBlockers } from './combat.js';
import { advanceStep, finishCleanup, finishEndingTurn } from './turn.js';
const main = (s) => ['main1', 'main2'].includes(s.step);
export function castProblem(
  s,
  p,
  id,
  target,
  {
    autoTap = true,
    mode,
    targets,
    x,
    convoke,
    sacrifice,
    harmonize,
    distribution,
    additionalCost,
  } = {},
) {
  const o = s.objects[id];
  if (!playableZone(s, o, p)) return 'You cannot play this card from its current zone.';
  const resolutionCast =
    s.choice?.kind === 'castExiled' &&
    s.choice.player === p &&
    s.choice.card === id &&
    s.choice.incarnation === o.incarnation;
  if (s.status !== 'playing' || (!resolutionCast && (s.choice || s.priority !== p)))
    return 'You do not have priority.';
  const d = castingProfile(s, p, o, mode, targets ? flattenTargets(targets) : target, undefined, x);
  if (!d) return `Choose a valid spell mode and X value (0–${MAX_X} for X spells).`;
  if (o.warped?.incarnation === o.incarnation && s.turn <= o.warped.turn)
    return 'Cast a warped card only after the turn it was exiled.';
  if (d.type === 'land') return 'Lands are played, not cast.';
  if (d.plottedCast && s.turn <= o.plotted.turn) return 'Cast a plotted card only on a later turn.';
  if (
    !resolutionCast &&
    (d.plottedCast || (d.type !== 'instant' && !d.keywords.includes('flash'))) &&
    !(s.active === p && main(s) && s.stack.length === 0)
  )
    return 'Cast this only during your main phase with an empty stack.';
  const divisionProblem = distributionProblem(d, targets, distribution);
  if (divisionProblem) return divisionProblem;
  if (d.targetGroups) {
    if (target != null) return 'Use grouped targets for this spell.';
    const problem = targetPlanProblem(s, d.targetGroups, targets, p, ref(o));
    if (problem) return problem;
  } else if (targets !== undefined) return 'This spell has no target groups.';
  if (d.target && !legalTarget(s, d.target, target, p, ref(o))) return 'Choose a legal target.';
  if (!d.target && target != null) return 'This spell has no targets.';
  if (
    !castingPayment(s, p, d, { card: id, convoke, autoTap, sacrifice, harmonize, additionalCost })
  )
    return 'Cannot pay the casting cost with the selected mana, convoke creatures, and additional sacrifice.';
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
    !(o.zone === 'exile' && o.playPermission?.castOnly) &&
    definition(s, o).type === 'land'
  );
}
function cast(s, p, c) {
  const problem = castProblem(s, p, c.card, c.target, {
    autoTap: c.autoTap !== false,
    mode: c.mode,
    x: c.x,
    convoke: c.convoke,
    sacrifice: c.sacrifice,
    harmonize: c.harmonize,
    distribution: c.distribution,
    additionalCost: c.additionalCost,
    targets: c.targets,
  });
  requireRule(!problem, 'CAST', problem);
  const o = s.objects[c.card],
    d = castingProfile(
      s,
      p,
      o,
      c.mode,
      c.targets ? flattenTargets(c.targets) : c.target,
      undefined,
      c.x,
    );
  requireRule(
    !d.sacrificeCost || c.sacrifice !== undefined,
    'CAST',
    'Choose a permanent to sacrifice as an additional cost.',
  );
  requireRule(
    !d.harmonizePaid || c.harmonize !== undefined,
    'CAST',
    'Choose whether to tap a creature for harmonize.',
  );
  const parentResolution = s.choice?.kind === 'castExiled' ? s.resolving : null;
  if (parentResolution) {
    s.choice = null;
    s.resolving = null;
  }
  requireRule(
    !d.additionalCost || c.additionalCost !== undefined,
    'CAST',
    'Choose whether and how to pay the additional cost.',
  );
  const plan = castingPayment(s, p, d, c);
  // Legacy saves bind trigger choices to sequential stack IDs. Keep their
  // original cost/target timing throughout resume and subsequent re-exports.
  const legacyTiming = s.rulesRevision === 1;
  const payCastingCost = () => {
    const payment = pay(s, p, plan.cost, c.autoTap !== false, plan.excludeSources, {
      type: 'cast',
      card: d,
    });
    tapObjects(s, [
      ...(plan.harmonize ? [s.objects[plan.harmonize.id]] : []),
      ...plan.choices.map((choice) => s.objects[choice.card]),
    ]);
    if (plan.sacrifice) {
      const sacrificed = s.objects[plan.sacrifice.id];
      sacrificePermanents(s, [sacrificed]);
    }
    payAdditionalCost(s, p, d, plan.additionalCost);
    return payment;
  };
  const legacyPayment = legacyTiming ? payCastingCost() : null;
  if (d.faceDownCast) o.castingFaceDown = true;
  move(s, o, 'stack');
  o.controller = p;
  o.castPlayer = p;
  if (c.x !== undefined) o.chosenX = c.x;
  if (d.flashbackPaid) o.flashbackPaid = true;
  if (d.harmonizePaid) o.harmonizePaid = true;
  if (d.warpPaid) o.warpPaid = true;
  if (d.bargained) o.bargained = true;
  if (d.adventureCast) o.adventureCast = true;
  delete o.castingFaceDown;
  if (d.faceDownCast) o.faceDown = true;
  s.stack.push({
    id: `s${++s.nextId}`,
    kind: 'spell',
    ...(c.x !== undefined ||
    d.discoveredCast ||
    d.keywords.includes('convoke') ||
    d.sacrificeCost ||
    d.harmonizePaid
      ? { castingCost: structuredClone(d.harmonizePaid ? plan.cost : d.cost) }
      : {}),
    uncounterable: !!d.uncounterable,
    name: o.faceDown ? 'Face-down creature' : d.name,
    controller: p,
    source: ref(o),
    sourceKeywords: [...d.keywords],
    sourceDefinition: structuredClone(definition(s, o)),
    sourceStats: structuredClone(stats(s, o)),
    effects: structuredClone(d.effects ?? []),
    ...(d.castingLabel ? { mode: c.mode ?? 0, modeLabel: d.castingLabel } : {}),
    ...(c.x !== undefined ? { x: c.x } : {}),
    ...(c.distribution !== undefined ? { distribution: structuredClone(c.distribution) } : {}),
    ...(d.keywords.includes('convoke') ? { convoke: structuredClone(plan.choices) } : {}),
    ...(plan.sacrifice ? { sacrifice: structuredClone(plan.sacrifice) } : {}),
    ...(d.additionalCost ? { additionalCost: structuredClone(plan.additionalCost) } : {}),
    ...(d.flashbackPaid ? { flashbackPaid: true } : {}),
    ...(d.harmonizePaid ? { harmonizePaid: true, harmonize: structuredClone(plan.harmonize) } : {}),
    ...(d.warpPaid ? { warpPaid: true } : {}),
    ...(d.adventureCast ? { adventureCast: true } : {}),
    ...(d.bargained ? { bargained: true } : {}),
    ...(d.kicked ? { kicked: true } : {}),
    ...(d.offspringPaid ? { offspringPaid: true } : {}),
    ...(d.giftPromised ? { giftPromised: true } : {}),
    ...(d.targetGroups
      ? { targetGroups: structuredClone(d.targetGroups), targets: structuredClone(c.targets) }
      : {}),
    targetKind: d.target ?? null,
    target: c.target ?? null,
  });
  // Targets are chosen before payment (CR 601.2c, 601.2h); all validation
  // above is read-only, and dispatch rolls back an unsuccessful command.
  const entry = s.stack.at(-1);
  if (!legacyTiming) notifyTargeted(s, entry);
  const payment = legacyPayment ?? payCastingCost();
  entry.uncounterable ||= payment.uncounterable;
  entry.manaSpent = Object.values(plan.cost).reduce((n, amount) => n + amount, 0);
  s.castingCompletion = {
    player: p,
    command: c,
    profile: d,
    stackId: entry.id,
    plan,
    ...(parentResolution ? { parentResolution } : {}),
  };
  if (flushLinkedReturns(s) !== false) finishCasting(s);
}
function finishCasting(s) {
  const {
    player: p,
    command: c,
    profile: d,
    stackId,
    plan,
    parentResolution,
  } = s.castingCompletion;
  const entry = s.stack.find((item) => item.id === stackId),
    o = s.objects[c.card];
  delete s.castingCompletion;
  recordSpellCast(s, p, definition(s, o));
  s.passes = 0;
  emit(s, 'cast', {
    player: p,
    objectId: o.id,
    name: o.faceDown ? 'Face-down creature' : d.name,
    target: c.target ?? null,
    ...(d.targetGroups ? { targets: structuredClone(c.targets) } : {}),
    ...(d.castingLabel ? { mode: c.mode ?? 0, modeLabel: d.castingLabel } : {}),
    ...(c.x !== undefined ? { x: c.x } : {}),
    ...(c.distribution !== undefined ? { distribution: structuredClone(c.distribution) } : {}),
    ...(d.keywords.includes('convoke') ? { convoke: structuredClone(plan.choices) } : {}),
    ...(plan.sacrifice ? { sacrifice: structuredClone(plan.sacrifice) } : {}),
    ...(d.additionalCost ? { additionalCost: structuredClone(plan.additionalCost) } : {}),
    ...(d.flashbackPaid ? { flashbackPaid: true } : {}),
    ...(d.harmonizePaid ? { harmonizePaid: true, harmonize: structuredClone(plan.harmonize) } : {}),
    ...(d.warpPaid ? { warpPaid: true } : {}),
    ...(d.adventureCast ? { adventureCast: true } : {}),
    ...(d.bargained ? { bargained: true } : {}),
    ...(d.kicked ? { kicked: true } : {}),
    ...(d.offspringPaid ? { offspringPaid: true } : {}),
    ...(d.giftPromised ? { giftPromised: true } : {}),
  });
  notifyTriggers(s, 'cast', {
    player: p,
    definition: definition(s, o),
    object: o,
    manaSpent: entry.manaSpent,
  });
  if (s.rulesRevision === 1) notifyTargeted(s, entry);
  if (parentResolution) {
    s.resolving = parentResolution;
    continueResolution(s);
  }
}
export function abilityProblem(s, p, id, index, target, discardCard, targets, sacrifices) {
  const o = s.objects[id];
  if (!o) return 'That ability source does not exist.';
  if (s.status !== 'playing' || s.choice || s.priority !== p) return 'You do not have priority.';
  if (!Number.isSafeInteger(index) || index < 0) return 'That ability does not exist.';
  const ability = definition(s, o).activated?.[index];
  if (!ability) return 'That ability does not exist.';
  if (
    Object.values(s.objects).some(
      (source) =>
        source.zone === 'battlefield' &&
        source.chosenLandName === definition(s, o).name &&
        definition(s, source).landNameLock,
    )
  )
    return 'Activated abilities with this chosen name cannot be activated.';
  if (
    ability.zone === 'graveyard'
      ? o.zone !== 'graveyard' || o.owner !== p
      : o.zone !== 'battlefield' || o.controller !== p
  )
    return 'That ability is not available from this zone.';
  if (!meetsCondition(s, p, ability.condition, [], o))
    return 'The activation condition is not met.';
  if (ability.powerUp && o.powerUpUses?.[index] === o.incarnation)
    return 'This power-up ability has already been activated.';
  if (ability.exhaust && o.exhaustUses?.[index] === o.incarnation)
    return 'This exhaust ability has already been activated.';
  if (ability.oncePerTurn && o.abilityUses?.[index] === `${s.turn}:${o.incarnation}`)
    return 'This ability has already been activated this turn.';
  if (ability.loyalty !== undefined) {
    if (o.loyaltyUsed === `${s.turn}:${o.incarnation}`)
      return 'A loyalty ability of this permanent has already been activated this turn.';
    if ((o.loyalty ?? 0) + ability.loyalty < 0) return 'Not enough loyalty counters.';
  }
  if (
    (ability.loyalty !== undefined || ability.timing === 'sorcery') &&
    !(s.active === p && main(s) && s.stack.length === 0)
  )
    return 'Activate this only as a sorcery.';

  if (ability.targetGroups) {
    if (target != null) return 'Use grouped ability targets.';
    const problem = targetPlanProblem(s, ability.targetGroups, targets, p, ref(o));
    if (problem) return problem;
  } else if (targets !== undefined) return 'This ability has no target groups.';
  if (ability.target && !legalTarget(s, ability.target, target, p, ref(o)))
    return 'Choose a legal ability target.';
  if (!ability.target && target != null) return 'This ability has no targets.';
  const payment = costProblem(s, p, activationCost(s, o, ability), {
    sourceId: id,
    discardCard,
    sacrifices,
  });
  if (payment) return payment;
  return null;
}
export function ninjutsuProblem(s, p, id, attacker) {
  const o = s.objects[id],
    a = s.objects[attacker?.id];
  if (s.status !== 'playing' || s.choice || s.priority !== p) return 'You do not have priority.';
  if (!o || o.zone !== 'hand' || o.owner !== p || !definition(s, o).ninjutsu)
    return 'Ninjutsu is available only from your hand.';
  if (s.active !== p || !['blockers', 'firstDamage', 'damage', 'endCombat'].includes(s.step))
    return 'Activate ninjutsu only after blockers have been declared.';
  if (
    attacker?.kind !== 'object' ||
    !a ||
    a.zone !== 'battlefield' ||
    a.controller !== p ||
    a.incarnation !== attacker.incarnation ||
    definition(s, a).type !== 'creature' ||
    !s.combat.attackers.some((r) => r.id === a.id && r.incarnation === a.incarnation) ||
    s.combat.blocked.includes(a.id)
  )
    return 'Return an unblocked attacker you control.';
  if (!planPayment(s, p, definition(s, o).ninjutsu))
    return 'Not enough available mana for ninjutsu.';
  return null;
}
function ninjutsu(s, p, c) {
  const problem = ninjutsuProblem(s, p, c.card, c.attacker);
  requireRule(!problem, 'NINJUTSU', problem);
  const o = s.objects[c.card],
    a = s.objects[c.attacker.id];
  // Store the declared defender, including a vanished planeswalker. Never retarget.
  const defender = structuredClone(
    s.combat.defenders?.[a.id] ?? { kind: 'player', id: opponent(p) },
  );
  s.stack.push({
    id: `s${++s.nextId}`,
    kind: 'ability',
    name: o.name,
    controller: p,
    source: ref(o),
    sourceKeywords: [],
    sourceDefinition: structuredClone(definition(s, o)),
    effects: [{ op: 'ninjutsuEnter', defender }],
    targetKind: null,
    target: null,
    label: 'Ninjutsu',
  });
  emit(s, 'revealed', { player: p, objectId: o.id, name: o.name });
  pay(s, p, definition(s, o).ninjutsu);
  move(s, a, 'hand');
  s.passes = 0;
  emit(s, 'activated', { player: p, name: o.name, objectId: o.id, ability: 'ninjutsu' });
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
// CR 702.170: plotting is a special action; casting remains restricted even with flash.
export function plotProblem(s, p, id) {
  const o = s.objects[id];
  if (!o || o.zone !== 'hand' || o.owner !== p || !definition(s, o).plot)
    return 'That card cannot be plotted from your hand.';
  if (s.status !== 'playing' || s.choice || s.priority !== p) return 'You do not have priority.';
  if (!(s.active === p && main(s) && s.stack.length === 0)) return 'Plot only as a sorcery.';
  if (!planPayment(s, p, definition(s, o).plot))
    return 'Not enough available mana to plot this card.';
  return null;
}
function plot(s, p, id) {
  const problem = plotProblem(s, p, id);
  requireRule(!problem, 'PLOT', problem);
  const o = s.objects[id];
  pay(s, p, definition(s, o).plot);
  move(s, o, 'exile');
  o.plotted = { turn: s.turn, incarnation: o.incarnation };
  s.passes = 0;
  emit(s, 'plotted', { player: p, objectId: id, name: o.name });
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
function saddle(s, p, c) {
  const problem = saddleProblem(s, p, c.card, c.cards);
  requireRule(!problem, 'SADDLE', problem);
  const o = s.objects[c.card];
  tapObjects(
    s,
    c.cards.map((id) => s.objects[id]),
  );
  s.stack.push({
    id: `s${++s.nextId}`,
    kind: 'ability',
    name: o.name,
    controller: p,
    source: ref(o),
    sourceKeywords: keywords(s, o),
    effects: [{ op: 'becomeSaddled' }],
    targetKind: null,
    target: null,
    label: `Saddle ${definition(s, o).saddle}`,
  });
  s.passes = 0;
  emit(s, 'saddleActivated', { player: p, objectId: o.id, cards: [...c.cards] });
}
function crew(s, p, c) {
  const problem = crewProblem(s, p, c.card, c.cards);
  requireRule(!problem, 'CREW', problem);
  const o = s.objects[c.card];
  tapObjects(
    s,
    c.cards.map((id) => s.objects[id]),
  );
  s.stack.push({
    id: `s${++s.nextId}`,
    kind: 'ability',
    name: o.name,
    controller: p,
    source: ref(o),
    sourceKeywords: keywords(s, o),
    effects: [{ op: 'animateVehicle' }],
    targetKind: null,
    target: null,
    label: `Crew ${definition(s, o).crew}`,
  });
  s.passes = 0;
  emit(s, 'crewActivated', { player: p, objectId: o.id, cards: [...c.cards] });
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
    sourceDefinition: structuredClone(definition(s, o)),
    sourceStats: structuredClone(stats(s, o)),
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
  const problem = abilityProblem(
    s,
    p,
    c.card,
    c.ability,
    c.target,
    c.discardCard,
    c.targets,
    c.sacrifices,
  );
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
    sourceDefinition: structuredClone(definition(s, o)),
    sourceStats: structuredClone(stats(s, o)),
    ...(o.attachedTo ? { sourceAttachment: structuredClone(o.attachedTo) } : {}),
    sourceCopyDefinition: structuredClone(copiableDefinition(s, o)),
    effects: structuredClone(a.effects),
    ...(a.targetGroups
      ? { targetGroups: structuredClone(a.targetGroups), targets: structuredClone(c.targets) }
      : {}),
    targetKind: a.target ?? null,
    target: c.target ?? null,
    label: a.text,
  });
  if (s.rulesRevision !== 1) notifyTargeted(s, s.stack.at(-1));
  const lockedCost = activationCost(s, o, a);
  if (a.powerUp) (o.powerUpUses ??= {})[c.ability] = o.incarnation;
  // CR 702.177a / 602.5b: activation, not resolution, consumes this ability's use.
  if (a.exhaust) (o.exhaustUses ??= {})[c.ability] = o.incarnation;
  if (a.oncePerTurn) (o.abilityUses ??= {})[c.ability] = `${s.turn}:${o.incarnation}`;
  if (a.loyalty !== undefined) {
    o.loyalty = (o.loyalty ?? 0) + a.loyalty;
    o.loyaltyUsed = `${s.turn}:${o.incarnation}`;
  }
  payCost(s, p, lockedCost, {
    sourceId: o.id,
    discardCard: c.discardCard,
    sacrifices: c.sacrifices,
  });
  s.passes = 0;
  emit(s, 'activated', { player: p, name: o.name, objectId: o.id, ability: c.ability });
  if (s.rulesRevision === 1) notifyTargeted(s, s.stack.at(-1));
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
  if (choice.kind === 'castExiled' && c.type === 'cast') {
    cast(s, p, c);
    return;
  }
  if (
    [
      'castExiled',
      'libraryOrder',
      'librarySearch',
      'landName',
      'discardEffect',
      'sacrifice',
      'payCost',
      'removeCounter',
      'behold',
      'optionalEffect',
      'effectChoice',
      'attackDefenders',
      'manaColor',
      'exilePlay',
      'empowerJace',
      'bindingNegotiation',
      'revealDiscard',
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
    case 'entryLife':
      finishEntryLifeChoice(s, c);
      return;
    case 'auraEntry':
      finishAuraEntryChoice(s, c);
      return;
    case 'landType':
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
        draw(s, p, 7, { openingHand: true });
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
      declareAttackers(s, c.cards, c.defenders);
      return;
    case 'blockers':
      requireRule(c.type === 'blockers', 'CHOICE', 'Declare blockers first.');
      declareBlockers(s, c.pairs);
      return;
    case 'assignDamage':
      requireRule(c.type === 'assignDamage', 'CHOICE', 'Assign combat damage first.');
      assignDamage(s, c.orders);
      return;
    case 'triggerMode':
      requireRule(
        c.type === 'chooseTriggerMode',
        'CHOICE',
        'Choose the triggered ability mode first.',
      );
      finishTriggerMode(s, c.mode);
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
        case 'plot':
          plot(s, p, command.card);
          break;
        case 'ninjutsu':
          ninjutsu(s, p, command);
          break;
        case 'cycle':
          cycle(s, p, command);
          break;
        case 'cast':
          cast(s, p, command);
          break;
        case 'saddle':
          saddle(s, p, command);
          break;
        case 'crew':
          crew(s, p, command);
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
    if (s.status === 'playing' && !s.choice) {
      if (s.endingTurn) finishEndingTurn(s);
      if (flushLinkedReturns(s) !== false && s.castingCompletion) finishCasting(s);
      if (!s.choice) stabilize(s);
    }
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
/** A bounded proposal set; explicit submitted X values need not appear here.
 * Pass {x} to inspect exact-X casts without enumerating every integer per target.
 */
export function legalActions(s, p, { x: exactX } = {}) {
  if (s.status === 'finished') return [];
  const resolutionCast = s.choice?.kind === 'castExiled' && s.choice.player === p;
  if (s.choice?.kind === 'effectChoice' && s.choice.player === p)
    return [
      ...s.choice.options.map(({ index }) => ({ type: 'chooseEffect', option: index })),
      { type: 'concede' },
    ];
  if (s.choice?.kind === 'manaColor' && s.choice.player === p)
    return ['W', 'U', 'B', 'R', 'G'].map((color) => ({ type: 'chooseManaColor', color }));
  if (s.choice?.kind === 'payCost' && s.choice.player === p)
    return [
      { type: 'payCost', pay: false },
      ...(s.choice.payable ? [{ type: 'payCost', pay: true }] : []),
      { type: 'concede' },
    ];
  if (s.choice?.kind === 'discardEffect' && s.choice.optional && s.choice.player === p)
    return [
      { type: 'discardEffect', cards: [] },
      ...s.players[p].hand.map((id) => ({ type: 'discardEffect', cards: [id] })),
      { type: 'concede' },
    ];
  if (s.choice?.kind === 'landType' && s.choice.player === p)
    return [
      ...s.choice.types.map((landType) => ({ type: 'chooseLandType', landType })),
      { type: 'concede' },
    ];
  if (s.choice?.kind === 'entryLife' && s.choice.player === p)
    return [
      { type: 'payEntryLife', pay: false },
      ...(s.choice.payable ? [{ type: 'payEntryLife', pay: true }] : []),
      { type: 'concede' },
    ];
  if (s.choice?.kind === 'auraEntry' && s.choice.player === p)
    return [
      ...s.choice.cards.map((card) => ({ type: 'chooseAuraAttachment', card })),
      { type: 'concede' },
    ];
  if (s.choice?.kind === 'legendRule' && s.choice.player === p)
    return [...s.choice.cards.map((card) => ({ type: 'chooseLegend', card })), { type: 'concede' }];
  if (s.choice?.kind === 'triggerMode' && s.choice.player === p)
    return [
      ...s.choice.modes.map((mode) => ({ type: 'chooseTriggerMode', mode })),
      { type: 'concede' },
    ];
  if (s.choice?.kind === 'triggerTargets' && s.choice.player === p)
    return [
      ...targetPlans(
        s,
        s.choice.entry.targetGroups,
        p,
        256,
        s.choice.entry.targetingSource ?? s.choice.entry.source,
      ).map((targets) => ({
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
  if (s.choice && !resolutionCast)
    return s.choice.player === p
      ? [{ type: 'choice', kind: s.choice.kind }, { type: 'concede' }]
      : [{ type: 'concede' }];
  if (s.priority !== p && !resolutionCast) return [{ type: 'concede' }];
  const actions = resolutionCast
    ? [{ type: 'declineCastExiled' }]
    : [{ type: 'pass' }, { type: 'concede' }];
  for (const id of resolutionCast ? [s.choice.card] : playableCards(s, p)) {
    if (!plotProblem(s, p, id)) actions.push({ type: 'plot', card: id });
    if (!cyclingProblem(s, p, id)) actions.push({ type: 'cycle', card: id });
    if (definition(s, s.objects[id]).ninjutsu)
      for (const attacker of s.combat.attackers)
        if (!ninjutsuProblem(s, p, id, attacker))
          actions.push({ type: 'ninjutsu', card: id, attacker: structuredClone(attacker) });
    if (canPlayLand(s, p, id)) {
      actions.push({ type: 'playLand', card: id });
      continue;
    }
    const d = definition(s, s.objects[id]);
    if (d.type === 'land') continue;
    for (const { mode, profile } of spellOptions(d)) {
      const available = profile.cost.X
        ? Object.values(s.players[p].mana).reduce((a, b) => a + b, 0) +
          (s.players[p].restrictedMana?.length ?? 0) +
          Object.values(s.objects).filter(
            (o) =>
              canTapForMana(s, o, p) ||
              (profile.keywords.includes('convoke') && convokeCandidates(s, p).includes(o)),
          ).length
        : 0;
      const proposals = !profile.cost.X
        ? [undefined]
        : resolutionCast && s.choice.discover !== undefined
          ? [exactX ?? 0]
          : exactX !== undefined
            ? [exactX]
            : [
                ...new Set([
                  ...Array.from({ length: 11 }, (_, i) => i),
                  16,
                  20,
                  32,
                  50,
                  64,
                  100,
                  128,
                  200,
                  256,
                  500,
                  1000,
                  Math.floor((available - manaValue(profile)) / profile.cost.X),
                  Math.floor(available / profile.cost.X),
                ]),
              ]
                .filter((x) => x >= 0 && x <= MAX_X)
                .sort((a, b) => a - b);
      for (const additionalCost of additionalCostOptions(s, p, profile, id))
        for (const sacrifice of profile.sacrificeCost
          ? castingSacrificeCandidates(s, p, profile).map(ref)
          : [undefined])
          for (const harmonize of s.objects[id].zone === 'graveyard' && profile.harmonize
            ? [null, ...harmonizeCandidates(s, p).map(ref)]
            : [undefined])
            for (const x of proposals) {
              if (profile.distributedCounters) {
                const candidates = targetsFor(
                  s,
                  profile.distributedCounters,
                  p,
                  ref(s.objects[id]),
                );
                const plans = x === 0 ? [[]] : candidates.map((t) => [t]);
                if (x > 1 && candidates.length > 1) plans.push(candidates.slice(0, x));
                for (const selected of plans) {
                  const targets = { distributed: selected },
                    distribution = Object.fromEntries(
                      selected.map((t, i) => [t.id, i === 0 ? x - selected.length + 1 : 1]),
                    );
                  if (!castProblem(s, p, id, null, { mode, x, targets, distribution }))
                    actions.push({
                      type: 'cast',
                      card: id,
                      ...(mode !== undefined ? { mode } : {}),
                      x,
                      targets,
                      distribution,
                    });
                }
                continue;
              }
              if (profile.targetGroups) {
                for (const targets of targetPlans(
                  s,
                  profile.targetGroups,
                  p,
                  256,
                  ref(s.objects[id]),
                ))
                  if (
                    !castProblem(s, p, id, null, {
                      mode,
                      targets,
                      x,
                      sacrifice,
                      harmonize,
                      additionalCost,
                    })
                  )
                    actions.push({
                      type: 'cast',
                      card: id,
                      ...(sacrifice ? { sacrifice } : {}),
                      ...(harmonize !== undefined ? { harmonize } : {}),
                      ...(profile.additionalCost ? { additionalCost } : {}),
                      ...(mode !== undefined ? { mode } : {}),
                      ...(x !== undefined ? { x } : {}),
                      targets,
                    });
                continue;
              }
              const targets = profile.target
                ? targetsFor(s, profile.target, p, ref(s.objects[id]))
                : [null];
              for (const target of targets)
                if (
                  !castProblem(s, p, id, target, { mode, x, sacrifice, harmonize, additionalCost })
                )
                  actions.push({
                    type: 'cast',
                    card: id,
                    ...(sacrifice ? { sacrifice } : {}),
                    ...(harmonize !== undefined ? { harmonize } : {}),
                    ...(profile.additionalCost ? { additionalCost } : {}),
                    ...(mode !== undefined ? { mode } : {}),
                    ...(x !== undefined ? { x } : {}),
                    ...(target ? { target } : {}),
                  });
            }
    }
  }
  if (resolutionCast) return actions;
  for (const o of Object.values(s.objects)) {
    if (!turnFaceUpProblem(s, p, o.id)) actions.push({ type: 'turnFaceUp', card: o.id });
    if (canTapForMana(s, o, p))
      for (const color of manaOptions(s, o)) actions.push({ type: 'tapMana', card: o.id, color });
    if (
      !(
        (o.zone === 'battlefield' && o.controller === p) ||
        (o.zone === 'graveyard' && o.owner === p)
      )
    )
      continue;
    if (o.zone === 'battlefield' && definition(s, o).saddle !== undefined) {
      const cards = saddlePlan(s, p, o.id);
      if (cards) actions.push({ type: 'saddle', card: o.id, cards });
    }
    if (o.zone === 'battlefield' && definition(s, o).crew !== undefined) {
      const cards = crewPlan(s, p, o.id);
      if (cards) actions.push({ type: 'crew', card: o.id, cards });
    }
    for (const [index, a] of (definition(s, o).activated ?? []).entries()) {
      for (const sacrifices of activationSacrificeOptions(s, p, a.cost, o.id)) {
        if (a.targetGroups) {
          for (const targets of targetPlans(s, a.targetGroups, p, 256, ref(o)))
            for (const discardCard of a.cost.discard ? s.players[p].hand : [undefined])
              if (!abilityProblem(s, p, o.id, index, null, discardCard, targets, sacrifices))
                actions.push({
                  type: 'activate',
                  card: o.id,
                  ability: index,
                  targets,
                  ...(discardCard ? { discardCard } : {}),
                  ...(sacrifices ? { sacrifices } : {}),
                });
          continue;
        }
        for (const target of a.target ? targetsFor(s, a.target, p, ref(o)) : [null])
          for (const discardCard of a.cost.discard ? s.players[p].hand : [undefined])
            if (!abilityProblem(s, p, o.id, index, target, discardCard, undefined, sacrifices))
              actions.push({
                type: 'activate',
                card: o.id,
                ability: index,
                ...(discardCard ? { discardCard } : {}),
                ...(sacrifices ? { sacrifices } : {}),
                ...(target ? { target } : {}),
              });
      }
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
    rulesRevision: s.rulesRevision ?? 3,
    config: s.config,
    commands: s.history,
  });
}
export function replay(record) {
  requireRule(
    record &&
      [
        VERSION,
        '0.41.0',
        '0.42.0',
        '0.43.0',
        '0.44.0',
        '0.45.0',
        '0.46.0',
        '0.47.0',
        '0.48.0',
        '0.49.0',
        '0.50.0',
        '0.51.0',
        '0.52.0',
        '0.53.0',
        '0.54.0',
        '0.40.0',
        '0.39.0',
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
  requireRule(
    record.rulesRevision === undefined || [1, 2, 3].includes(record.rulesRevision),
    'REPLAY_VERSION',
    'Unsupported replay rules revision.',
  );
  let s = createGame(record.config);
  // Revision 2 introduced announcement-time targeting in v0.43. Unmarked
  // published envelopes through v0.42 use the historical timing and ID order.
  const minor = Number(record.version.split('.')[1]);
  // Revision 3 skips the starting player's entire first draw step (v0.49).
  s.rulesRevision = record.rulesRevision ?? (minor <= 42 ? 1 : minor <= 48 ? 2 : 3);
  for (const [index, c] of record.commands.entries()) {
    const r = dispatch(s, c);
    requireRule(r.ok, 'REPLAY_COMMAND', `Replay command ${index} rejected: ${r.error?.message}`);
    s = r.state;
  }
  return s;
}
