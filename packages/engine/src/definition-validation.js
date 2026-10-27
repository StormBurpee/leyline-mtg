import { CREATURE_TYPES } from './creature-types.js';
import { validateTargetGroups } from './target-group-schema.js';
import { validNumericValue } from './value-schema.js';
import { validateCondition } from './condition-schema.js';
import { validateEventSpec, eventSpec } from './events.js';
import {
  targetSpec,
  validateTargetSpec,
  effectTargetCompatible,
  validateFilter,
} from './selectors.js';
import { CARD_TYPES, hasType, primaryType, KEYWORD_NAMES, HYBRID_SYMBOLS } from './types.js';

const TYPES = new Set(CARD_TYPES);
const COLORS = new Set(['W', 'U', 'B', 'R', 'G']);
const MANA = new Set([...COLORS, 'C', 'generic', ...HYBRID_SYMBOLS]);
const KEYWORDS = new Set(KEYWORD_NAMES);
// Dynamic CDA grants require type-layer/dependency handling, not just layer-6 keywords.
const GRANTED_KEYWORDS = new Set(KEYWORD_NAMES.filter((keyword) => keyword !== 'changeling'));
const FIELDS = new Set([
  'name',
  'type',
  'types',
  'cost',
  'text',
  'color',
  'keywords',
  'subtypes',
  'power',
  'toughness',
  'loyalty',
  'basic',
  'legendary',
  'token',
  'mana',
  'manaSacrifice',
  'manaFromTrackedExile',
  'manaConditions',
  'manaLifeCosts',
  'entryLifePayment',
  'manaRestrictions',
  'chooseCreatureType',
  'chooseBasicLandType',
  'entryCounterBonus',
  'entryKeywordCounters',
  'entryPlusCounters',
  'landNameLock',
  'exileGraveyardMoves',
  'libraryTopAccess',
  'additionalEnterTrigger',
  'suppressEnterTriggers',
  'entryStunCounters',
  'damageBonus',
  'drawBonus',
  'foreignCreatureSubtype',
  'cantGainLife',
  'cantPreventDamage',
  'startEngines',
  'maxSpeedKeywords',
  'entersTappedUnless',
  'target',
  'targetGroups',
  'effects',
  'distributedCounters',
  'spree',
  'modes',
  'crew',
  'saddle',
  'crewSaddlePowerBonus',
  'cycling',
  'ninjutsu',
  'turnLoyaltyCreature',
  'cyclingType',
  'flashback',
  'harmonize',
  'plot',
  'warp',
  'prepareSpell',
  'entersPrepared',
  'backFace',
  'frontName',
  'adventure',
  'mainName',
  'kicker',
  'offspring',
  'gift',
  'disguise',
  'cannotAttack',
  'cannotBlock',
  'unblockable',
  'cannotBeBlockedByLowerPower',
  'uncounterable',
  'etb',
  'aura',
  'attachmentBonus',
  'baseStats',
  'selfBonus',
  'conditionalBonuses',
  'costModifiers',
  'sacrificeCost',
  'bargain',
  'additionalCost',
  'static',
  'triggers',
  'activated',
  'ward',
  'opponentCreatureProtectionBypass',
  'entersTapped',
]);
const plain = (v) =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const natural = (v) => Number.isSafeInteger(v) && v >= 0;
const signed = (v) => Number.isSafeInteger(v);
export class RegistryError extends Error {
  constructor(diagnostics) {
    super(`Invalid card registry:\n${diagnostics.join('\n')}`);
    this.name = 'RegistryError';
    this.diagnostics = diagnostics;
  }
}
function validateCost(cost, path, errors, allowX = false, allowTwobrid = false) {
  if (!plain(cost)) {
    errors.push(`${path}: expected a mana-cost object.`);
    return;
  }
  for (const [key, n] of Object.entries(cost))
    if (
      (!MANA.has(key) &&
        !(allowTwobrid && /^2\/[WUBRG]$/.test(key)) &&
        !(allowX && key === 'X' && n > 0 && n <= 10)) ||
      !natural(n)
    )
      errors.push(`${path}.${key}: unsupported mana symbol or nonnegative integer amount.`);
}
function validatePaymentCost(cost, path, errors, { allowTap = false } = {}) {
  if (!plain(cost)) {
    errors.push(`${path}: expected a cost object.`);
    return;
  }
  const allowed = allowTap
    ? ['mana', 'life', 'tap', 'sacrificeSelf', 'sacrifice', 'exileSelf', 'discard']
    : ['mana', 'life'];
  if (Object.keys(cost).some((key) => !allowed.includes(key)))
    errors.push(`${path}: unsupported cost.`);
  if (cost.mana !== undefined) validateCost(cost.mana, `${path}.mana`, errors);
  if (cost.life !== undefined && !natural(cost.life))
    errors.push(`${path}.life: expected a nonnegative safe integer.`);
  if (cost.sacrificeSelf !== undefined && typeof cost.sacrificeSelf !== 'boolean')
    errors.push(`${path}.sacrificeSelf: expected a boolean.`);
  if (cost.sacrifice !== undefined) {
    const selected = cost.sacrifice;
    if (
      !plain(selected) ||
      Object.keys(selected).some((k) => !['count', 'where', 'excludeSource'].includes(k)) ||
      !Number.isSafeInteger(selected.count) ||
      selected.count < 1 ||
      selected.count > 10 ||
      (selected.excludeSource !== undefined && typeof selected.excludeSource !== 'boolean')
    )
      errors.push(
        `${path}.sacrifice: expected 1–10 chosen permanents with an optional filter and source exclusion.`,
      );
    if (plain(selected) && selected.where !== undefined)
      errors.push(...validateFilter(selected.where).map((e) => `${path}.sacrifice: ${e}`));
  }
  if (cost.exileSelf !== undefined && typeof cost.exileSelf !== 'boolean')
    errors.push(`${path}.exileSelf: expected a boolean.`);
  if (cost.discard !== undefined && cost.discard !== 1)
    errors.push(`${path}.discard: only a single-card discard cost is supported.`);
  if (cost.tap !== undefined && typeof cost.tap !== 'boolean')
    errors.push(`${path}.tap: expected a boolean.`);
}
function filterOnlyPermanents(where) {
  if (where?.type)
    return ['land', 'creature', 'artifact', 'enchantment', 'planeswalker'].includes(where.type);
  if (where?.all) return where.all.some(filterOnlyPermanents);
  if (where?.any) return where.any.every(filterOnlyPermanents);
  return false;
}
function validateGroupHolder(holder, path, errors) {
  if (holder.targetGroups === undefined) return;
  errors.push(
    ...validateTargetGroups(holder.targetGroups).map((e) => `${path}.targetGroups: ${e}`),
  );
  if (holder.target != null) errors.push(`${path}: use either a single target or target groups.`);
}
function validateEffects(
  effects,
  path,
  target,
  errors,
  groups = [],
  budget = { nodes: 0 },
  depth = 0,
) {
  if (depth > 8) {
    errors.push(`${path}: conditional effects exceed depth budget.`);
    return;
  }
  if (!Array.isArray(effects) || effects.length > 64) {
    errors.push(`${path}: expected at most 64 effect instructions.`);
    return;
  }
  for (const [index, e] of effects.entries()) {
    const p = `${path}[${index}]`;
    if (++budget.nodes > 256) {
      errors.push(`${path}: effect graph exceeds instruction budget.`);
      return;
    }
    if (!plain(e)) {
      errors.push(`${p}: expected an effect object.`);
      continue;
    }
    if (e.op === 'questCounterTrigger') {
      if (Object.keys(e).some((k) => !['op', 'threshold', 'selector', 'effects'].includes(k)))
        errors.push(`${p}: unsupported quest trigger field.`);
      if (!Number.isSafeInteger(e.threshold) || e.threshold < 1 || e.threshold > 1000)
        errors.push(`${p}: invalid quest threshold.`);
      errors.push(...validateTargetSpec(e.selector));
      validateEffects(e.effects, `${p}.effects`, e.selector, errors, [], budget, depth + 1);
      continue;
    }
    if (e.op === 'removeCounterTrigger') {
      if (Object.keys(e).some((k) => !['op', 'selector', 'effects'].includes(k)))
        errors.push(`${p}: unsupported counter-removal trigger field.`);
      errors.push(...validateTargetSpec(e.selector));
      validateEffects(e.effects, `${p}.effects`, e.selector, errors, [], budget, depth + 1);
      continue;
    }
    if (e.op === 'discardTrigger') {
      if (Object.keys(e).some((k) => !['op', 'count', 'where', 'selector', 'effects'].includes(k)))
        errors.push(`${p}: unsupported discard-trigger field.`);
      if (!Number.isSafeInteger(e.count) || e.count < 1 || e.count > 16)
        errors.push(`${p}.count: expected 1–16 cards.`);
      errors.push(...validateFilter(e.where).map((error) => `${p}.where: ${error}`));
      errors.push(...validateTargetSpec(e.selector).map((error) => `${p}.selector: ${error}`));
      validateEffects(
        e.effects,
        `${p}.effects`,
        null,
        errors,
        [{ id: 'chosen', selector: e.selector, min: 0, max: e.count }],
        budget,
        depth + 1,
      );
      continue;
    }
    if (e.op === 'behold') {
      if (
        Object.keys(e).some((k) => !['op', 'subtype', 'then'].includes(k)) ||
        !CREATURE_TYPES.includes(e.subtype)
      )
        errors.push(`${p}: unsupported behold.`);
      validateEffects(e.then, `${p}.then`, target, errors, groups, budget, depth + 1);
      continue;
    }
    if (e.op === 'conditional') {
      if (Object.keys(e).some((k) => !['op', 'condition', 'then', 'else'].includes(k)))
        errors.push(`${p}: unsupported conditional field.`);
      errors.push(...validateCondition(e.condition, { resolving: true, target, groups }));
      validateEffects(e.then, `${p}.then`, target, errors, groups, budget, depth + 1);
      if (e.else !== undefined)
        validateEffects(e.else, `${p}.else`, target, errors, groups, budget, depth + 1);
      continue;
    }
    if (e.targetGroup !== undefined) {
      const group = groups.find((g) => g.id === e.targetGroup);
      if (
        !group ||
        ![
          'counter',
          'damageTargetController',
          'copyToken',
          'damage',
          'destroy',
          'bounce',
          'modify',
          'combatRestriction',
          'counterOn',
          'stunOn',
          'tap',
          'untap',
          'prepare',
          'unprepare',
          'moveTarget',
          'exileUntilSourceLeaves',
          'delayedBlink',
          'removeAbilities',
          'counterAbility',
          'keywordCounters',
          'fightAttached',
        ].includes(e.op) ||
        e.subject !== undefined ||
        (['counter', 'copyToken', 'delayedBlink', 'damageTargetController'].includes(e.op) &&
          group.max !== 1) ||
        (e.op === 'counter' && e.unlessPay !== undefined) ||
        (e.op === 'damageTargetController' &&
          !['permanent', 'graveyard'].includes(targetSpec(group.selector)?.scope)) ||
        (e.op === 'moveTarget' && e.destination === 'battlefield')
      ) {
        errors.push(`${p}: unsupported target group binding.`);
        continue;
      }
      const { targetGroup, ...bound } = e;
      validateEffects([bound], p, group.selector, errors, [], budget, depth + 1);
      continue;
    }
    if (e.op === 'fight' || e.op === 'bite') {
      const actor = groups.find((g) => g.id === e.sourceGroup);
      const victim = groups.find((g) => g.id === e.victimGroup);
      const sourceBound = e.source === 'source' && e.sourceGroup === undefined;
      const groupBound =
        e.source === undefined &&
        actor &&
        actor.min === 1 &&
        actor.max === 1 &&
        effectTargetCompatible('attachEquipment', actor.selector);
      if (
        Object.keys(e).some((k) => !['op', 'source', 'sourceGroup', 'victimGroup'].includes(k)) ||
        (!sourceBound && !groupBound) ||
        !victim ||
        !(e.op === 'fight'
          ? effectTargetCompatible('attachEquipment', victim.selector) && victim.max === 1
          : targetSpec(victim.selector)?.scope === 'permanent' &&
            effectTargetCompatible('damage', victim.selector))
      )
        errors.push(
          `${p}: fight/bite requires exactly one explicit source binding and compatible victim groups.`,
        );
      continue;
    }
    if (e.op === 'empowerJace' && (!natural(e.count) || e.count > 1000))
      errors.push(`${p}.count: Empower requires a literal from 0 to 1000.`);
    if (e.op === 'anthemEmblem') {
      errors.push(...validateFilter(e.where).map((error) => `${p}.where: ${error}`));
      if (!Number.isSafeInteger(e.power) || !Number.isSafeInteger(e.toughness))
        errors.push(`${p}: expected integer emblem bonus.`);
    }
    const schema = {
      damage: ['amount'],
      damageOpponent: ['amount'],
      damageEventOpponent: ['amount'],
      damageEventPowerOpponent: [],
      drawEventAmount: [],
      endTurn: [],
      chooseLandName: [],
      moveLinkedExileToGraveyard: [],
      exileUntilSourceLeavesAll: ['where'],
      disableDamagePrevention: [],
      exileGraveyards: ['players'],
      damageEachPlayer: ['amount'],
      damageTargetController: ['amount'],
      damageEventPlayer: ['amount'],
      exileTop: ['count', 'player', 'duration', 'castOnly', 'anyMana'],
      impulseCastOrDamage: ['amount'],
      castDamageEmblem: ['amount'],
      anthemEmblem: ['where', 'power', 'toughness'],
      returnTransformed: [],
      chooseMana: [],
      combatMana: ['count'],
      addMana: ['mana'],
      impulseChoose: ['count'],
      bindingNegotiation: [],
      revealDiscard: ['where'],
      gainLife: ['amount', 'player'],
      loseLife: ['amount', 'player'],
      exileUntilSourceLeaves: [],
      delayedBlink: ['controller'],
      moveTarget: ['destination', 'controller', 'tapped', 'subject', 'trackSource'],
      draw: ['count', 'player'],
      mill: ['count', 'player'],
      lookChooseHand: [
        'count',
        'player',
        'selectCount',
        'restOrder',
        'where',
        'optional',
        'reveal',
        'revealAll',
        'restDestination',
      ],
      scry: ['count', 'player'],
      surveil: ['count', 'player'],
      explore: ['subject'],
      prepare: ['subject'],
      unprepare: ['subject'],
      discard: ['count', 'player'],
      optionalDiscardDraw: [],
      distributedCounters: [],
      sacrifice: ['count', 'player', 'where'],
      chooseExile: ['count', 'player', 'where'],
      returnSelfAsEnchantment: [],
      shuffleSourceAndTarget: [],
      sacrificeSelf: [],
      searchLibrary: [
        'count',
        'where',
        'destination',
        'tapped',
        'reveal',
        'player',
        'optional',
        'countFrom',
      ],
      counter: ['unlessPay', 'exile'],
      counterAbility: ['removeSourceAbilities'],
      removeAbilities: ['until'],
      stripDestroyByManaValue: ['amount'],
      bounce: ['subject'],
      destroy: ['subject'],
      attachEquipment: [],
      becomeLand: ['mana'],
      creatureForm: ['power', 'toughness', 'subtypes'],
      earthbend: ['amount'],
      animateLand: [
        'power',
        'toughness',
        'colors',
        'subtypes',
        'keywords',
        'permanent',
        'allCreatureTypes',
      ],
      keywordCounters: ['keywords'],
      modify: ['subject', 'power', 'toughness', 'keywords'],
      combatRestriction: ['subject', 'restriction'],
      token: ['definition', 'count', 'player', 'tapped', 'temporaryKeywords', 'countFrom'],
      mobilize: ['definition', 'count'],
      empowerJace: ['definition', 'count'],
      copyToken: ['subject', 'count', 'exceptions'],
      keywordCounter: ['subject', 'keyword', 'amount'],
      stunOn: ['subject', 'amount'],
      fightAttached: [],
      untapSearched: [],
      doubleCounters: ['subject', 'where'],
      doublePower: ['subject'],
      counterOn: ['subject', 'amount', 'counter'],
      untap: ['subject'],
      tap: ['subject'],
      bounceAll: ['where', 'excludeSource'],
      destroyAll: ['where', 'excludeSource'],
      exileAll: ['where', 'excludeSource', 'player', 'rememberMovedCount'],
      modifyAll: ['where', 'excludeSource', 'power', 'toughness', 'keywords'],
      damageAll: ['where', 'excludeSource', 'amount', 'players'],
      counterAll: ['where', 'excludeSource', 'amount', 'counter'],
      tapAll: ['where', 'excludeSource'],
      untapAll: ['where', 'excludeSource'],
    }[e.op];
    if (
      e.op === 'exileGraveyards' &&
      !['controller', 'opponent', 'all', 'target'].includes(e.players)
    )
      errors.push(`${p}.players: unsupported player set.`);
    if (!Array.isArray(schema)) {
      errors.push(`${p}: unsupported effect opcode ${String(e.op)}.`);
      continue;
    }
    for (const key of Object.keys(e))
      if (key !== 'op' && !schema.includes(key))
        errors.push(`${p}.${key}: unsupported effect parameter.`);
    if (
      [
        'damage',
        'damageOpponent',
        'damageEachPlayer',
        'damageTargetController',
        'damageEventPlayer',
        'damageEventOpponent',
        'stripDestroyByManaValue',
        'earthbend',
        'gainLife',
        'loseLife',
        'counterOn',
        'stunOn',
      ].includes(e.op) &&
      !validNumericValue(e.amount, { effect: true, nonnegative: true })
    )
      errors.push(`${p}.amount: expected a nonnegative safe integer.`);
    if (
      [
        'draw',
        'mill',
        'token',
        'mobilize',
        'empowerJace',
        'scry',
        'lookChooseHand',
        'surveil',
        'discard',
      ].includes(e.op) &&
      !validNumericValue(e.count, { effect: true, nonnegative: true, limit: 1000 })
    )
      errors.push(`${p}.count: expected a literal count from 0 to 1000.`);
    if (e.op === 'lookChooseHand') {
      if (
        e.selectCount !== undefined &&
        !validNumericValue(e.selectCount, { effect: true, nonnegative: true, limit: 1000 })
      )
        errors.push(`${p}.selectCount: expected a bounded nonnegative selection count.`);
      if (e.restOrder !== undefined && !['chosen', 'random'].includes(e.restOrder))
        errors.push(`${p}.restOrder: expected chosen or random.`);
      if (e.where !== undefined) errors.push(...validateFilter(e.where));
      for (const key of ['optional', 'reveal', 'revealAll'])
        if (e[key] !== undefined && typeof e[key] !== 'boolean')
          errors.push(`${p}.${key}: expected a boolean.`);
      if (e.restDestination !== undefined && !['bottom', 'graveyard'].includes(e.restDestination))
        errors.push(`${p}.restDestination: expected bottom or graveyard.`);
      if (e.restDestination === 'graveyard' && e.restOrder === 'random')
        errors.push(`${p}.restOrder: random ordering requires a bottom destination.`);
    }
    if (
      e.op === 'mill' &&
      (!['controller', 'opponent', 'target'].includes(e.player) ||
        (e.player === 'target' && !effectTargetCompatible('mill', target)))
    )
      errors.push(`${p}: mill requires a supported player selector and compatible target.`);
    if (
      ['draw', 'discard', 'gainLife', 'loseLife', 'scry', 'lookChooseHand', 'surveil'].includes(
        e.op,
      ) &&
      e.player !== undefined &&
      (!['controller', 'opponent', 'target'].includes(e.player) ||
        (e.player === 'target' && !effectTargetCompatible(e.op, target)))
    )
      errors.push(`${p}.player: expected a compatible player recipient.`);
    if (['sacrifice', 'chooseExile'].includes(e.op)) {
      if (!natural(e.count) || e.count > 1000) errors.push(`${p}.count: expected 0 to 1000.`);
      if (!['controller', 'opponent', 'target', 'all'].includes(e.player))
        errors.push(`${p}.player: unsupported sacrifice player.`);
      if (e.player === 'target' && targetSpec(target)?.scope !== 'player')
        errors.push(`${p}: sacrifice requires a player target.`);
      if (e.where !== undefined)
        for (const error of validateFilter(e.where)) errors.push(`${p}.where: ${error}`);
    }
    if (
      e.player !== undefined &&
      ['searchLibrary', 'exileAll'].includes(e.op) &&
      ![
        'controller',
        'opponent',
        'target',
        ...(e.op === 'searchLibrary' ? ['targetController'] : []),
      ].includes(e.player)
    )
      errors.push(`${p}: invalid player binding.`);
    if (e.rememberMovedCount !== undefined && typeof e.rememberMovedCount !== 'boolean')
      errors.push(`${p}: invalid moved-count flag.`);
    if (
      e.op === 'delayedBlink' &&
      e.controller !== undefined &&
      !['owner', 'you'].includes(e.controller)
    )
      errors.push(`${p}: unsupported return controller.`);
    if (e.op === 'exileUntilSourceLeavesAll')
      errors.push(...validateFilter(e.where).map((error) => `${p}: ${error}`));
    if (
      e.op === 'keywordCounter' &&
      (e.keyword !== 'indestructible' ||
        !natural(e.amount) ||
        e.amount > 1000 ||
        e.subject !== 'source')
    )
      errors.push(`${p}: invalid keyword counter.`);
    if (e.op === 'token' && e.countFrom !== undefined && e.countFrom !== 'moved')
      errors.push(`${p}: unsupported count binding.`);
    if (e.op === 'searchLibrary') {
      if (e.optional !== undefined && typeof e.optional !== 'boolean')
        errors.push(`${p}: invalid optional flag.`);
      if (e.countFrom !== undefined && e.countFrom !== 'moved')
        errors.push(`${p}: invalid count binding.`);
      if (!natural(e.count) || e.count > 1000) errors.push(`${p}.count: expected 0 to 1000.`);
      if (!['hand', 'battlefield', 'top', 'graveyard'].includes(e.destination))
        errors.push(`${p}.destination: unsupported search destination.`);
      if (e.where !== undefined)
        errors.push(...validateFilter(e.where).map((message) => `${p}.${message}`));
      if (
        e.tapped !== undefined &&
        (e.destination !== 'battlefield' || typeof e.tapped !== 'boolean')
      )
        errors.push(`${p}.tapped: only battlefield entry accepts a boolean tapped flag.`);
      if (e.reveal !== undefined && typeof e.reveal !== 'boolean')
        errors.push(`${p}.reveal: expected a boolean.`);
      if (e.destination === 'battlefield' && (!e.where || !filterOnlyPermanents(e.where)))
        errors.push(`${p}.where: battlefield searches require a permanent-only filter.`);
    }
    if (e.op === 'fightAttached' && !effectTargetCompatible('attachEquipment', target))
      errors.push(`${p}: fightAttached requires a creature target.`);
    if (e.op === 'moveTarget') {
      if (
        e.trackSource !== undefined &&
        (typeof e.trackSource !== 'boolean' || e.destination !== 'exile')
      )
        errors.push(`${p}.trackSource: requires exile and a boolean.`);
      if (!['hand', 'battlefield', 'exile'].includes(e.destination))
        errors.push(`${p}.destination: unsupported zone.`);
      if (
        e.controller !== undefined &&
        (e.destination !== 'battlefield' || !['owner', 'you'].includes(e.controller))
      )
        errors.push(`${p}.controller: only battlefield entry can change control.`);
      if (
        e.tapped !== undefined &&
        (e.destination !== 'battlefield' || typeof e.tapped !== 'boolean')
      )
        errors.push(`${p}.tapped: expected a battlefield entry flag.`);
    }
    if (
      e.op === 'exileTop' &&
      (!validNumericValue(e.count) ||
        !['controller', 'target'].includes(e.player) ||
        ['castOnly', 'anyMana'].some((k) => e[k] !== undefined && typeof e[k] !== 'boolean') ||
        !['turn', 'nextTurn'].includes(e.duration) ||
        (e.player === 'target' && targetSpec(target)?.scope !== 'player'))
    )
      errors.push(`${p}: invalid exile permission.`);
    if (
      ['impulseCastOrDamage', 'castDamageEmblem'].includes(e.op) &&
      (!natural(e.amount) || e.amount > 1000)
    )
      errors.push(`${p}: expected bounded literal damage.`);
    if (e.op === 'combatMana' && (!natural(e.count) || e.count > 1000))
      errors.push(`${p}: invalid combat mana count.`);
    if (e.op === 'impulseChoose' && (!natural(e.count) || e.count > 1000))
      errors.push(`${p}.count: invalid count.`);
    if (
      ['bindingNegotiation', 'revealDiscard'].includes(e.op) &&
      targetSpec(target)?.scope !== 'player'
    )
      errors.push(`${p}: requires a player target.`);
    if (e.op === 'revealDiscard' && e.where !== undefined) errors.push(...validateFilter(e.where));
    if (
      e.op === 'removeAbilities' &&
      (!['endOfTurn', 'sourceLeaves'].includes(e.until) ||
        targetSpec(target)?.scope !== 'permanent')
    )
      errors.push(`${p}: ability removal needs a permanent and supported duration.`);
    if (
      e.op === 'counterAbility' &&
      (targetSpec(target)?.scope !== 'ability' ||
        (e.removeSourceAbilities !== undefined && typeof e.removeSourceAbilities !== 'boolean'))
    )
      errors.push(`${p}: ability counter requires an ability target.`);
    if (
      e.op === 'exileGraveyards' &&
      (!['controller', 'opponent', 'all', 'target'].includes(e.players) ||
        (e.players === 'target' && targetSpec(target)?.scope !== 'player'))
    )
      errors.push(`${p}: invalid graveyard players.`);
    if (e.op === 'shuffleSourceAndTarget' && targetSpec(target)?.scope !== 'permanent')
      errors.push(`${p}: shuffle needs a permanent target.`);
    if (e.op === 'addMana') {
      validateCost(e.mana, `${p}.mana`, errors);
      if (
        Object.keys(e.mana ?? {}).some((symbol) => !['W', 'U', 'B', 'R', 'G', 'C'].includes(symbol))
      )
        errors.push(`${p}.mana: mana production cannot be generic.`);
    }
    if (
      e.op === 'explore' &&
      (e.subject !== undefined
        ? e.subject !== 'source'
        : !effectTargetCompatible('explore', target))
    )
      errors.push(`${p}: explore requires source or a creature target.`);
    if (e.op === 'copyToken') {
      if (!natural(e.count) || e.count > 1000) errors.push(`${p}.count: expected 0 to 1000.`);
      if (e.subject !== undefined && e.subject !== 'source')
        errors.push(`${p}.subject: only source copying is supported.`);
      if (e.subject !== 'source' && !effectTargetCompatible('copyToken', target))
        errors.push(`${p}: requires a current permanent target.`);
      const x = e.exceptions;
      if (x !== undefined) {
        if (
          !plain(x) ||
          Object.keys(x).some(
            (k) => !['power', 'toughness', 'nonlegendary', 'addSubtypes'].includes(k),
          )
        )
          errors.push(`${p}.exceptions: unsupported copy exception.`);
        else {
          if (
            (x.power !== undefined || x.toughness !== undefined) &&
            (!Number.isSafeInteger(x.power) || !Number.isSafeInteger(x.toughness))
          )
            errors.push(`${p}.exceptions: both fixed power and toughness are required.`);
          if (x.nonlegendary !== undefined && typeof x.nonlegendary !== 'boolean')
            errors.push(`${p}.exceptions.nonlegendary: expected boolean.`);
          if (
            x.addSubtypes !== undefined &&
            (!Array.isArray(x.addSubtypes) ||
              x.addSubtypes.length > 16 ||
              x.addSubtypes.some((t) => !['Hero', 'Coward'].includes(t)))
          )
            errors.push(`${p}.exceptions.addSubtypes: only Hero/Coward additions are supported.`);
        }
      }
    }
    if (e.op === 'token') {
      if (
        e.temporaryKeywords !== undefined &&
        (!Array.isArray(e.temporaryKeywords) ||
          e.temporaryKeywords.some((k) => !GRANTED_KEYWORDS.has(k)))
      )
        errors.push(`${p}.temporaryKeywords: unsupported keyword.`);
      if (
        e.player !== undefined &&
        !['controller', 'opponent', 'target', 'targetController'].includes(e.player)
      )
        errors.push(`${p}: invalid token controller.`);
      if (e.player === 'target' && targetSpec(target)?.scope !== 'player')
        errors.push(`${p}: token recipient needs a player target.`);
      if (
        e.player === 'targetController' &&
        !['spell', 'permanent', 'graveyard'].includes(targetSpec(target)?.scope)
      )
        errors.push(`${p}: token recipient needs an object or spell target.`);
      if (e.tapped !== undefined && typeof e.tapped !== 'boolean')
        errors.push(`${p}.tapped: expected boolean.`);
    }
    if (
      ['token', 'mobilize', 'empowerJace'].includes(e.op) &&
      (typeof e.definition !== 'string' || !e.definition)
    )
      errors.push(`${p}.definition: expected a token definition name.`);
    if (
      [
        'bounceAll',
        'destroyAll',
        'exileAll',
        'modifyAll',
        'damageAll',
        'counterAll',
        'tapAll',
        'untapAll',
      ].includes(e.op)
    ) {
      if (e.where !== undefined)
        errors.push(...validateFilter(e.where).map((v) => `${p}.where: ${v}`));
      else if (e.op !== 'damageAll')
        errors.push(`${p}.where: a group effect needs an explicit filter.`);
      if (e.excludeSource !== undefined && typeof e.excludeSource !== 'boolean')
        errors.push(`${p}.excludeSource: expected boolean.`);
      if (
        ['damageAll', 'counterAll'].includes(e.op) &&
        !validNumericValue(e.amount, { effect: true, nonnegative: true })
      )
        errors.push(`${p}.amount: expected a nonnegative integer.`);
      if (e.op === 'damageAll') {
        if (!['none', 'controller', 'opponent', 'all'].includes(e.players ?? 'none'))
          errors.push(`${p}.players: invalid player group.`);
        if (!e.where && (!e.players || e.players === 'none'))
          errors.push(`${p}: damage needs creatures or players.`);
        if (e.where && !effectTargetCompatible('damage', { scope: 'permanent', where: e.where }))
          errors.push(`${p}: group damage requires a creature filter.`);
      }
    }
    if (
      e.op === 'becomeLand' &&
      (!Array.isArray(e.mana) ||
        !e.mana.length ||
        e.mana.length > 6 ||
        new Set(e.mana).size !== e.mana.length ||
        e.mana.some((c) => !['W', 'U', 'B', 'R', 'G', 'C'].includes(c)))
    )
      errors.push(`${p}: invalid granted mana colors.`);
    if (
      e.op === 'earthbend' &&
      (!Number.isSafeInteger(e.amount) ||
        e.amount < 0 ||
        e.amount > 1000 ||
        targetSpec(target)?.scope !== 'permanent')
    )
      errors.push(`${p}: earthbend requires a permanent target and 0–1000 counters.`);
    if (e.op === 'animateLand' || e.op === 'creatureForm') {
      if (
        !Number.isSafeInteger(e.power) ||
        !Number.isSafeInteger(e.toughness) ||
        Math.abs(e.power) > 1000 ||
        Math.abs(e.toughness) > 1000
      )
        errors.push(`${p}: animation requires bounded integer base power/toughness.`);
      if (
        e.colors !== undefined &&
        (!Array.isArray(e.colors) || e.colors.some((c) => !['W', 'U', 'B', 'R', 'G'].includes(c)))
      )
        errors.push(`${p}: invalid animation colors.`);
      if (
        !Array.isArray(e.subtypes) ||
        (!e.subtypes.length && !e.allCreatureTypes) ||
        e.subtypes.some((t) => !CREATURE_TYPES.includes(t))
      )
        errors.push(`${p}: invalid animation creature subtypes.`);
    }
    if (e.op === 'combatRestriction') {
      if (!['cannotBlock', 'cannotBeBlocked'].includes(e.restriction))
        errors.push(`${p}.restriction: unsupported combat restriction.`);
      if (e.subject !== undefined && !['source', 'attached'].includes(e.subject))
        errors.push(`${p}.subject: unsupported binding.`);
    }
    if (e.op === 'animateLand') {
      if (e.permanent !== undefined && e.permanent !== true)
        errors.push(`${p}: permanent must be true.`);
      if (e.allCreatureTypes !== undefined && e.allCreatureTypes !== true)
        errors.push(`${p}: allCreatureTypes must be true.`);
    }
    if (
      ['animateLand', 'keywordCounters'].includes(e.op) &&
      e.keywords !== undefined &&
      (!Array.isArray(e.keywords) || e.keywords.some((k) => !GRANTED_KEYWORDS.has(k)))
    )
      errors.push(`${p}: invalid granted keywords.`);
    if (
      e.op === 'keywordCounters' &&
      (!Array.isArray(e.keywords) ||
        !e.keywords.length ||
        e.keywords.length > 32 ||
        targetSpec(target)?.scope !== 'permanent')
    )
      errors.push(`${p}: keyword counters need keywords and a target.`);
    if (e.op === 'modify' || e.op === 'modifyAll') {
      if (
        !validNumericValue(e.power, { effect: true }) ||
        !validNumericValue(e.toughness, { effect: true })
      )
        errors.push(`${p}: power and toughness changes must be safe integers.`);
      if (e.subject !== undefined && !['source', 'attached'].includes(e.subject))
        errors.push(
          `${p}.subject: only source, attached permanent or the chosen target is supported.`,
        );
      if (
        e.keywords !== undefined &&
        (!Array.isArray(e.keywords) || e.keywords.some((k) => !GRANTED_KEYWORDS.has(k)))
      )
        errors.push(`${p}.keywords: unsupported keyword.`);
    }
    if (
      ['bounce', 'destroy', 'moveTarget'].includes(e.op) &&
      e.subject !== undefined &&
      !['source', 'attached'].includes(e.subject)
    )
      errors.push(`${p}.subject: unsupported binding.`);
    if (
      ['untap', 'tap', 'prepare', 'unprepare'].includes(e.op) &&
      e.subject !== undefined &&
      !['source', 'attached'].includes(e.subject)
    )
      errors.push(
        `${p}.subject: only source, attached permanent or the chosen target is supported.`,
      );
    if (
      ['counterOn', 'counterAll'].includes(e.op) &&
      e.counter !== undefined &&
      e.counter !== '-1/-1'
    )
      errors.push(`${p}.counter: expected -1/-1 or omitted for +1/+1 counters.`);
    if (
      ['counterOn', 'stunOn'].includes(e.op) &&
      e.subject !== undefined &&
      !['source', 'attached'].includes(e.subject)
    )
      errors.push(
        `${p}.subject: only source, attached permanent or the chosen target is supported.`,
      );
    if (['doubleCounters', 'doublePower'].includes(e.op)) {
      if (e.where !== undefined) {
        if (e.op !== 'doubleCounters' || e.subject !== undefined)
          errors.push(`${p}: invalid group doubling.`);
        errors.push(...validateFilter(e.where));
      } else if (e.subject !== undefined && !['source', 'attached'].includes(e.subject))
        errors.push(`${p}: invalid doubling subject.`);
      else if (e.subject === undefined && !effectTargetCompatible('counterOn', target, e))
        errors.push(`${p}: doubling requires a permanent target.`);
    }
    if (e.op === 'counter') {
      if (e.unlessPay !== undefined) {
        validateCost(e.unlessPay, `${p}.unlessPay`, errors);
        if (
          plain(e.unlessPay) &&
          Object.keys(e.unlessPay).some(
            (key) => !['generic', 'W', 'U', 'B', 'R', 'G', 'C'].includes(key),
          )
        )
          errors.push(`${p}.unlessPay: only literal generic and single-color mana are supported.`);
      }
      if (e.exile !== undefined && typeof e.exile !== 'boolean')
        errors.push(`${p}.exile: expected a boolean.`);
    }
    if (
      [
        'damage',
        'counter',
        'bounce',
        'destroy',
        'attachEquipment',
        'creatureForm',
        'modify',
        'combatRestriction',
        'moveTarget',
        'prepare',
        'unprepare',
        'exileUntilSourceLeaves',
        'delayedBlink',
        'untap',
        'tap',
        'counterOn',
        'stunOn',
      ].includes(e.op) &&
      !['source', 'attached'].includes(e.subject) &&
      !effectTargetCompatible(e.op === 'stunOn' ? 'tap' : e.op, target, e)
    )
      errors.push(`${p}: effect requires a compatible target selector.`);
  }
}
/** Validate untrusted JSON definitions before any card is shuffled or resolved. */
export function validateDefinition(card) {
  const errors = [];
  if (!plain(card)) return ['Card definition must be a plain object.'];
  const name = typeof card.name === 'string' ? card.name : '(unnamed)';
  for (const key of Object.keys(card))
    if (!FIELDS.has(key)) errors.push(`${name}.${key}: unsupported definition field.`);
  if (
    typeof card.name !== 'string' ||
    !card.name.trim() ||
    card.name.length > 200 ||
    ['__proto__', 'constructor', 'prototype'].includes(card.name)
  )
    errors.push('Card name must be a nonempty, nonreserved string of at most 200 characters.');
  if (!TYPES.has(card.type)) errors.push(`${name}.type: unsupported card type.`);
  if (card.types !== undefined) {
    if (
      !Array.isArray(card.types) ||
      !card.types.length ||
      card.types.length > 3 ||
      card.types.some((t) => !TYPES.has(t)) ||
      new Set(card.types).size !== card.types.length
    )
      errors.push(`${name}.types: expected distinct supported card types.`);
    else if (
      primaryType(card.types) !== card.type ||
      (card.types.length > 1 && card.types.some((t) => ['land', 'instant', 'sorcery'].includes(t)))
    )
      errors.push(`${name}.types: unsupported combination or inconsistent primary type.`);
  }
  const permanent = ['land', 'creature', 'artifact', 'enchantment', 'planeswalker'].includes(
    card.type,
  );
  if (permanent && card.effects !== undefined)
    errors.push(
      `${name}.effects: permanent spells use enters triggers, not direct spell instructions.`,
    );
  if (!permanent)
    for (const field of ['etb', 'triggers', 'activated', 'static', 'ward', 'mana', 'entersTapped'])
      if (card[field] !== undefined)
        errors.push(`${name}.${field}: only battlefield permanents support this field.`);
  if (
    card.crew !== undefined &&
    (!Number.isSafeInteger(card.crew) ||
      card.crew < 0 ||
      card.crew > 1000 ||
      !card.subtypes?.includes('Vehicle') ||
      !hasType(card, 'artifact') ||
      hasType(card, 'creature') ||
      !signed(card.power) ||
      !signed(card.toughness) ||
      card.disguise ||
      card.baseStats)
  )
    errors.push(
      `${name}.crew: requires a noncreature artifact Vehicle with literal power/toughness and crew 0–1000.`,
    );
  for (const field of ['saddle', 'crewSaddlePowerBonus'])
    if (
      card[field] !== undefined &&
      (!Number.isSafeInteger(card[field]) ||
        card[field] < 0 ||
        card[field] > 1000 ||
        !hasType(card, 'creature'))
    )
      errors.push(`${name}.${field}: requires a creature and an integer from 0 to 1000.`);
  if (card.ninjutsu !== undefined) validateCost(card.ninjutsu, `${name}.ninjutsu`, errors);
  if (card.turnLoyaltyCreature !== undefined) {
    const f = card.turnLoyaltyCreature;
    if (
      !plain(f) ||
      Object.keys(f).some((k) => !['power', 'toughness', 'subtypes', 'keywords'].includes(k)) ||
      !Number.isSafeInteger(f.power) ||
      !Number.isSafeInteger(f.toughness) ||
      !Array.isArray(f.subtypes) ||
      f.subtypes.some((t) => !CREATURE_TYPES.includes(t)) ||
      !Array.isArray(f.keywords) ||
      f.keywords.some((k) => !GRANTED_KEYWORDS.has(k))
    )
      errors.push(`${name}.turnLoyaltyCreature: invalid creature characteristics.`);
  }
  if (card.cycling !== undefined) validateCost(card.cycling, `${name}.cycling`, errors);
  if (
    card.cyclingType !== undefined &&
    (!card.cycling ||
      typeof card.cyclingType !== 'string' ||
      !/^[A-Za-z][A-Za-z -]{0,79}$/.test(card.cyclingType))
  )
    errors.push(`${name}.cyclingType: expected a type name and a cycling cost.`);
  validateCost(card.cost, `${name}.cost`, errors, true, true);
  const twobridCount = Object.entries(card.cost ?? {})
    .filter(([symbol]) => /^2\/[WUBRG]$/.test(symbol))
    .reduce((n, [, count]) => n + count, 0);
  if (
    twobridCount &&
    (twobridCount > 5 ||
      card.type === 'land' ||
      card.cost.X ||
      card.modes ||
      card.kicker ||
      card.offspring ||
      card.disguise ||
      card.flashback ||
      card.plot ||
      card.warp)
  )
    errors.push(
      `${name}.cost: twobrid supports at most five symbols without other casting options.`,
    );
  const contains = (value, predicate, seen = new Set(), depth = 0) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return false;
    if (depth > 16) return true; // Reject rather than recurse into unbounded input.
    seen.add(value);
    return (
      predicate(value) || Object.values(value).some((v) => contains(v, predicate, seen, depth + 1))
    );
  };
  const paidCondition = (v) => v.kind === 'additionalCostPaid';
  if (
    contains({ ...card, effects: undefined }, paidCondition) ||
    (contains(card.effects, paidCondition) && !card.additionalCost)
  )
    errors.push(
      `${name}: additional-cost conditions require spell effects and an additional cost.`,
    );
  const hasX = (value) => contains(value, (v) => v.kind === 'x');
  if (contains(card.effects, (v) => v.condition && hasX(v.condition)))
    errors.push(`${name}: X-dependent conditions are not supported.`);
  const {
    effects: spellEffects,
    cost: printedCost,
    adventure: nestedAdventure,
    prepareSpell: nestedPrepareSpell,
    triggers,
    etb,
    entryPlusCounters,
    ...otherFields
  } = card;
  const entryEffects = [etb];
  const otherTriggers = (triggers ?? []).map((trigger) => {
    const spec = eventSpec(trigger.event);
    if (spec?.event === 'enter' && spec.object === 'source') {
      entryEffects.push(trigger.effects);
      const { effects, ...rest } = trigger;
      return rest;
    }
    return trigger;
  });
  if (hasX(otherFields) || hasX(otherTriggers))
    errors.push(
      `${name}: X expressions are supported only in spell effects, self-entry effects and entry counters.`,
    );
  if ((hasX(spellEffects) || hasX(entryEffects) || hasX(entryPlusCounters)) && !printedCost?.X)
    errors.push(`${name}: X expressions require an X mana cost.`);
  if (
    printedCost?.X &&
    (!['instant', 'sorcery', 'creature', 'artifact', 'enchantment', 'planeswalker'].includes(
      card.type,
    ) ||
      card.modes ||
      card.kicker ||
      card.flashback ||
      card.disguise ||
      card.offspring)
  )
    errors.push(`${name}: X supports spells without alternative casting options.`);
  if (card.distributedCounters !== undefined) {
    errors.push(...validateTargetSpec(card.distributedCounters));
    if (
      !card.cost.X ||
      !['instant', 'sorcery'].includes(card.type) ||
      !effectTargetCompatible('creatureForm', card.distributedCounters) ||
      card.target ||
      card.targetGroups ||
      card.effects?.length !== 1 ||
      card.effects[0].op !== 'distributedCounters'
    )
      errors.push(
        `${name}.distributedCounters: requires an X spell with exactly its distribution effect and creature selector.`,
      );
  }
  if (card.effects?.some((e) => e.op === 'distributedCounters') && !card.distributedCounters)
    errors.push(`${name}: distribution effect requires a distributedCounters declaration.`);
  if (
    card.opponentCreatureProtectionBypass !== undefined &&
    card.opponentCreatureProtectionBypass !== true
  )
    errors.push(`${name}: protection bypass must be true.`);
  if (card.ward !== undefined) validatePaymentCost(card.ward, `${name}.ward`, errors);
  if (card.text !== undefined && typeof card.text !== 'string')
    errors.push(`${name}.text: expected a string.`);
  if (hasType(card, 'planeswalker') && (!natural(card.loyalty) || card.loyalty > 1000))
    errors.push(`${name}.loyalty: expected initial loyalty from 0 to 1000.`);
  if (!hasType(card, 'planeswalker') && card.loyalty !== undefined)
    errors.push(`${name}.loyalty: requires planeswalker type.`);
  if (card.type === 'creature' && (!signed(card.power) || !signed(card.toughness)))
    errors.push(`${name}: creatures require literal safe-integer power/toughness.`);
  if (
    card.keywords !== undefined &&
    (!Array.isArray(card.keywords) || card.keywords.some((k) => !KEYWORDS.has(k)))
  )
    errors.push(`${name}.keywords: unsupported keyword.`);
  if (
    card.subtypes !== undefined &&
    (!Array.isArray(card.subtypes) || card.subtypes.some((x) => typeof x !== 'string'))
  )
    errors.push(`${name}.subtypes: expected strings.`);
  if (
    card.color !== undefined &&
    (!Array.isArray(card.color) || card.color.some((x) => !COLORS.has(x)))
  )
    errors.push(`${name}.color: expected Magic colors; colorless is an empty array.`);
  if (card.startEngines !== undefined && typeof card.startEngines !== 'boolean')
    errors.push(`${name}.startEngines: expected boolean.`);
  if (
    card.maxSpeedKeywords !== undefined &&
    (!Array.isArray(card.maxSpeedKeywords) ||
      card.maxSpeedKeywords.some((k) => !GRANTED_KEYWORDS.has(k)))
  )
    errors.push(`${name}.maxSpeedKeywords: unsupported keywords.`);
  if (
    card.mainName !== undefined &&
    ((!card.adventure && !card.prepareSpell) ||
      typeof card.mainName !== 'string' ||
      !card.mainName.trim() ||
      card.mainName.length > 200)
  )
    errors.push(`${name}.mainName: requires an Adventure and a valid main-face name.`);
  if (
    card.entersPrepared !== undefined &&
    (typeof card.entersPrepared !== 'boolean' || !card.prepareSpell)
  )
    errors.push(`${name}.entersPrepared: requires a prepare spell and boolean.`);
  if (card.manaFromTrackedExile !== undefined && card.manaFromTrackedExile !== true)
    errors.push(`${name}.manaFromTrackedExile: expected true.`);
  if (card.prepareSpell !== undefined) {
    const spell = card.prepareSpell;
    if (!hasType(card, 'creature') || !card.mainName || card.adventure)
      errors.push(`${name}.prepareSpell: requires a named creature without Adventure.`);
    if (
      !plain(spell) ||
      !['instant', 'sorcery'].includes(spell.type) ||
      spell.prepareSpell ||
      spell.adventure ||
      spell.mainName
    )
      errors.push(`${name}.prepareSpell: requires a nonnested instant or sorcery.`);
    else errors.push(...validateDefinition(spell).map((e) => `${name}.prepareSpell: ${e}`));
  }
  if (
    card.frontName !== undefined &&
    (!card.backFace ||
      typeof card.frontName !== 'string' ||
      !card.frontName.trim() ||
      card.frontName.length > 200)
  )
    errors.push(`${name}.frontName: requires a transforming face and valid front name.`);
  if (card.backFace !== undefined) {
    if (
      !plain(card.backFace) ||
      card.backFace.backFace ||
      card.backFace.adventure ||
      card.adventure ||
      typeof card.frontName !== 'string' ||
      !['creature', 'artifact', 'enchantment', 'land', 'planeswalker'].includes(card.backFace.type)
    )
      errors.push(`${name}.backFace: expected a nonnested permanent face.`);
    else
      errors.push(
        ...validateDefinition(card.backFace).map((message) => `${name}.backFace: ${message}`),
      );
  }
  if (card.adventure !== undefined) {
    const adventure = card.adventure;
    const forbidden = [
      'prepareSpell',
      'entersPrepared',
      'adventure',
      'mainName',
      'backFace',
      'frontName',
      'modes',
      'kicker',
      'offspring',
      'gift',
      'disguise',
      'flashback',
      'plot',
      'warp',
    ];
    if (
      !['creature', 'artifact', 'enchantment'].includes(card.type) ||
      !card.mainName ||
      card.token ||
      card.cost?.X ||
      Object.keys(card.cost ?? {}).some((key) => key.startsWith('2/')) ||
      forbidden
        .filter((key) => !['adventure', 'mainName'].includes(key))
        .some((key) => card[key] !== undefined)
    )
      errors.push(
        `${name}.adventure: requires a fixed-cost permanent without other casting options.`,
      );
    if (
      !plain(adventure) ||
      !['instant', 'sorcery'].includes(adventure.type) ||
      Object.keys(adventure.cost ?? {}).some((key) => key.startsWith('2/')) ||
      forbidden.some((key) => adventure[key] !== undefined)
    )
      errors.push(`${name}.adventure: requires a nonnested fixed-cost instant or sorcery.`);
    else
      errors.push(
        ...validateDefinition(adventure).map((message) => `${name}.adventure: ${message}`),
      );
  }
  if (card.warp !== undefined) {
    validateCost(card.warp, `${name}.warp`, errors);
    if (
      !['creature', 'artifact', 'enchantment'].includes(card.type) ||
      card.cost?.X ||
      card.modes ||
      card.kicker ||
      card.offspring ||
      card.disguise ||
      card.flashback ||
      card.plot
    )
      errors.push(`${name}.warp: requires a fixed-cost permanent without other casting options.`);
  }
  if (card.plot !== undefined) {
    validateCost(card.plot, `${name}.plot`, errors);
    if (
      card.type === 'land' ||
      card.cost?.X ||
      card.modes ||
      card.kicker ||
      card.offspring ||
      card.disguise ||
      card.flashback
    )
      errors.push(
        `${name}.plot: requires a fixed-cost nonland without alternative or additional casting options.`,
      );
  }
  if (card.harmonize !== undefined) {
    validateCost(card.harmonize, `${name}.harmonize`, errors);
    if (
      !['instant', 'sorcery'].includes(card.type) ||
      card.harmonize.X ||
      card.cost.X ||
      card.flashback ||
      card.plot ||
      card.adventure ||
      card.modes ||
      card.kicker ||
      card.offspring ||
      card.disguise ||
      card.sacrificeCost ||
      card.keywords?.includes('convoke')
    )
      errors.push(
        `${name}.harmonize: requires fixed-cost nonmodal instant/sorcery without competing casting choices.`,
      );
  }
  if (card.flashback !== undefined) {
    validateCost(card.flashback, `${name}.flashback`, errors);
    if (
      !['instant', 'sorcery'].includes(card.type) ||
      card.modes ||
      card.kicker ||
      card.offspring ||
      card.disguise
    )
      errors.push(`${name}.flashback: requires a fixed-cost nonmodal instant or sorcery.`);
  }
  if (card.disguise !== undefined) {
    validateCost(card.disguise, `${name}.disguise`, errors);
    if (card.type !== 'creature' || card.modes || card.kicker || card.offspring)
      errors.push(`${name}.disguise: unsupported combination.`);
  }
  if (card.gift !== undefined) {
    if (
      !plain(card.gift) ||
      Object.keys(card.gift).some((k) => !['definition', 'effects'].includes(k)) ||
      typeof card.gift.definition !== 'string' ||
      !card.gift.definition.length ||
      !['instant', 'sorcery'].includes(card.type) ||
      card.modes ||
      card.kicker ||
      card.offspring ||
      card.adventure ||
      card.warp ||
      card.cost.X ||
      Object.keys(card.cost).some((k) => k.startsWith('2/'))
    )
      errors.push(`${name}.gift: requires a bounded nonmodal spell and token definition.`);
    else validateEffects(card.gift.effects, `${name}.gift.effects`, card.target, errors);
  }
  if (card.offspring !== undefined) {
    validateCost(card.offspring, `${name}.offspring`, errors);
    if (card.type !== 'creature' || card.modes || card.kicker)
      errors.push(`${name}.offspring: requires a nonmodal creature.`);
  }
  if (card.kicker !== undefined) {
    const k = card.kicker;
    if (
      !plain(k) ||
      Object.keys(k).some((v) => !['cost', 'effects'].includes(v)) ||
      card.modes ||
      !['instant', 'sorcery'].includes(card.type)
    )
      errors.push(`${name}.kicker: unsupported kicker profile.`);
    else {
      validateCost(k.cost, `${name}.kicker.cost`, errors);
      validateEffects(k.effects, `${name}.kicker.effects`, card.target, errors);
    }
  }
  if (
    card.entryKeywordCounters !== undefined &&
    (!Array.isArray(card.entryKeywordCounters) ||
      !card.entryKeywordCounters.length ||
      card.entryKeywordCounters.some((k) => !GRANTED_KEYWORDS.has(k)))
  )
    errors.push(`${name}.entryKeywordCounters: expected supported keyword counters.`);
  if (
    card.entryPlusCounters !== undefined &&
    !natural(card.entryPlusCounters) &&
    !(
      plain(card.entryPlusCounters) &&
      card.entryPlusCounters.kind === 'x' &&
      Object.keys(card.entryPlusCounters).length === 1
    )
  )
    errors.push(`${name}.entryPlusCounters: expected a nonnegative safe integer or X.`);
  if (card.landNameLock !== undefined && card.landNameLock !== true)
    errors.push(`${name}: landNameLock must be true.`);
  if (card.exileGraveyardMoves !== undefined && card.exileGraveyardMoves !== true)
    errors.push(`${name}: exileGraveyardMoves must be true.`);
  if (card.libraryTopAccess !== undefined) {
    if (
      !plain(card.libraryTopAccess) ||
      Object.keys(card.libraryTopAccess).some((k) => k !== 'play')
    )
      errors.push(`${name}.libraryTopAccess: invalid profile.`);
    else {
      errors.push(...validateFilter(card.libraryTopAccess.play));
      const supported = (f) =>
        plain(f) &&
        Object.keys(f).length === 1 &&
        (typeof f.type === 'string' ||
          typeof f.subtype === 'string' ||
          (Array.isArray(f.any) && f.any.every(supported)) ||
          (Array.isArray(f.all) && f.all.every(supported)) ||
          (f.not && supported(f.not)));
      if (!supported(card.libraryTopAccess.play))
        errors.push(`${name}.libraryTopAccess: only type/subtype predicates are supported.`);
    }
  }
  if (card.additionalEnterTrigger !== undefined)
    errors.push(...validateFilter(card.additionalEnterTrigger));
  if (card.suppressEnterTriggers !== undefined) {
    errors.push(...validateFilter(card.suppressEnterTriggers));
    const typesOnly = (f) =>
      plain(f) &&
      Object.keys(f).length === 1 &&
      (typeof f.type === 'string' ||
        (Array.isArray(f.any) && f.any.every(typesOnly)) ||
        (Array.isArray(f.all) && f.all.every(typesOnly)) ||
        (f.not && typesOnly(f.not)));
    if (!typesOnly(card.suppressEnterTriggers))
      errors.push(`${name}.suppressEnterTriggers: only type predicates are supported.`);
  }
  if (card.entryCounterBonus !== undefined) {
    const b = card.entryCounterBonus;
    if (
      !plain(b) ||
      Object.keys(b).some((k) => !['amount', 'condition'].includes(k)) ||
      !natural(b.amount)
    )
      errors.push(`${name}.entryCounterBonus: invalid replacement.`);
    else errors.push(...validateCondition(b.condition));
  }
  if (card.damageBonus !== undefined) {
    const b = card.damageBonus;
    if (
      !plain(b) ||
      Object.keys(b).some((k) => !['amount', 'where'].includes(k)) ||
      !natural(b.amount)
    )
      errors.push(`${name}.damageBonus: invalid replacement.`);
    else errors.push(...validateFilter(b.where));
  }
  if (card.entersTappedUnless !== undefined)
    errors.push(
      ...validateCondition(card.entersTappedUnless).map((v) => `${name}.entersTappedUnless: ${v}`),
    );
  if (
    card.chooseBasicLandType !== undefined &&
    (card.chooseBasicLandType !== true || card.type !== 'land' || card.chooseCreatureType)
  )
    errors.push(
      `${name}.chooseBasicLandType: requires a land and no competing creature-type choice.`,
    );
  if (card.chooseCreatureType !== undefined && card.chooseCreatureType !== true)
    errors.push(`${name}.chooseCreatureType: expected true.`);
  if (card.manaRestrictions !== undefined) {
    if (!plain(card.manaRestrictions)) errors.push(`${name}.manaRestrictions: expected object.`);
    else
      for (const [color, restriction] of Object.entries(card.manaRestrictions)) {
        if (
          !(Array.isArray(card.mana) ? card.mana : [card.mana]).includes(color) ||
          !['creature', 'chosenCreatureType'].includes(restriction)
        )
          errors.push(`${name}.manaRestrictions: invalid restriction.`);
        if (restriction === 'chosenCreatureType' && !card.chooseCreatureType)
          errors.push(`${name}: restricted mana requires a type choice.`);
      }
  }
  if (
    card.entryLifePayment !== undefined &&
    (card.type !== 'land' ||
      card.token ||
      !Number.isSafeInteger(card.entryLifePayment) ||
      card.entryLifePayment < 1 ||
      card.entryLifePayment > 1000)
  )
    errors.push(`${name}.entryLifePayment: expected 1–1000 life on a land.`);
  if (card.manaLifeCosts !== undefined) {
    if (!plain(card.manaLifeCosts)) errors.push(`${name}.manaLifeCosts: expected an object.`);
    else
      for (const [color, amount] of Object.entries(card.manaLifeCosts))
        if (
          !(Array.isArray(card.mana) ? card.mana : [card.mana]).includes(color) ||
          !Number.isSafeInteger(amount) ||
          amount < 1 ||
          amount > 1000
        )
          errors.push(`${name}.manaLifeCosts: invalid production color or life amount.`);
  }
  if (card.manaConditions !== undefined) {
    if (!plain(card.manaConditions)) errors.push(`${name}.manaConditions: expected an object.`);
    else
      for (const [color, condition] of Object.entries(card.manaConditions)) {
        if (!(Array.isArray(card.mana) ? card.mana : [card.mana]).includes(color))
          errors.push(`${name}.manaConditions: unknown production color.`);
        errors.push(...validateCondition(condition).map((v) => `${name}.manaConditions: ${v}`));
      }
  }
  if (
    card.foreignCreatureSubtype !== undefined &&
    !CREATURE_TYPES.includes(card.foreignCreatureSubtype)
  )
    errors.push(`${name}.foreignCreatureSubtype: unsupported creature subtype.`);
  if (card.drawBonus !== undefined) {
    const b = card.drawBonus;
    if (
      !plain(b) ||
      Object.keys(b).some((k) => !['amount', 'handAtMost'].includes(k)) ||
      !Number.isSafeInteger(b.amount) ||
      b.amount < 1 ||
      b.amount > 1000 ||
      !Number.isSafeInteger(b.handAtMost) ||
      b.handAtMost < 0 ||
      b.handAtMost > 1000
    )
      errors.push(`${name}.drawBonus: invalid draw replacement.`);
  }
  if (card.mana !== undefined) {
    const options = Array.isArray(card.mana) ? card.mana : [card.mana];
    if (
      !options.length ||
      options.length > 6 ||
      new Set(options).size !== options.length ||
      options.some((c) => !['W', 'U', 'B', 'R', 'G', 'C'].includes(c))
    )
      errors.push(`${name}.mana: expected distinct supported production colors.`);
  }
  for (const key of [
    'basic',
    'legendary',
    'token',
    'entersTapped',
    'manaSacrifice',
    'manaFromTrackedExile',
    'cannotAttack',
    'cannotBlock',
    'unblockable',
    'cannotBeBlockedByLowerPower',
    'uncounterable',
    'cantGainLife',
    'cantPreventDamage',
  ])
    if (card[key] !== undefined && typeof card[key] !== 'boolean')
      errors.push(`${name}.${key}: expected a boolean.`);
  if (card.manaSacrifice && !card.mana)
    errors.push(`${name}: a sacrificing mana source must produce mana.`);
  if (card.legendary && ['instant', 'sorcery'].includes(card.type))
    errors.push(`${name}: legendary spell casting restrictions are not implemented.`);
  if (card.basic && card.type !== 'land') errors.push(`${name}: only lands can be basic.`);
  if (
    card.entryStunCounters !== undefined &&
    (!natural(card.entryStunCounters) ||
      card.entryStunCounters > 1000 ||
      !['creature', 'artifact', 'enchantment', 'land', 'planeswalker'].includes(card.type))
  )
    errors.push(`${name}.entryStunCounters: expected 0–1000 counters on a permanent.`);
  if (card.targetGroups !== undefined) {
    errors.push(
      ...validateTargetGroups(card.targetGroups).map((e) => `${name}.targetGroups: ${e}`),
    );
    if (
      !['instant', 'sorcery'].includes(card.type) ||
      card.target != null ||
      card.modes ||
      card.kicker
    )
      errors.push(
        `${name}.targetGroups: currently requires a nonmodal instant or sorcery without kicker or a legacy target.`,
      );
  }
  if (card.target != null)
    errors.push(...validateTargetSpec(card.target).map((error) => `${name}.target: ${error}`));
  if (card.additionalCost !== undefined) {
    const cost = card.additionalCost;
    const field = { discardOrLife: 'life', blight: 'amount', teamwork: 'power' }[cost?.kind];
    if (
      !plain(cost) ||
      !field ||
      Object.keys(cost).some((k) => !['kind', field].includes(k)) ||
      !Number.isSafeInteger(cost[field]) ||
      cost[field] < 1 ||
      cost[field] > 1000
    )
      errors.push(`${name}: invalid additional cost.`);
    if (
      !['instant', 'sorcery'].includes(card.type) ||
      card.sacrificeCost ||
      card.keywords?.includes('convoke') ||
      card.disguise ||
      card.modes ||
      card.kicker ||
      card.offspring
    )
      errors.push(`${name}: additional cost cannot combine with other casting choices.`);
  }
  if (card.bargain !== undefined) {
    if (
      card.bargain !== true ||
      card.type === 'land' ||
      card.modes ||
      card.kicker ||
      card.offspring ||
      card.gift ||
      card.spree ||
      card.disguise ||
      card.adventure ||
      card.warp ||
      card.plot ||
      card.flashback ||
      card.harmonize ||
      card.sacrificeCost ||
      card.additionalCost ||
      card.distributedCounters ||
      twobridCount ||
      card.keywords?.includes('convoke')
    )
      errors.push(`${name}.bargain: requires a nonland without competing casting options.`);
  }
  if (contains(card, (v) => v.kind === 'sourceBargained') && !card.bargain)
    errors.push(`${name}: bargained conditions require bargain.`);
  if (card.sacrificeCost !== undefined) {
    const cost = card.sacrificeCost;
    const typeFilter = (v) =>
      plain(v) &&
      Object.keys(v).length === 1 &&
      (['creature', 'artifact', 'enchantment'].includes(v.type) ||
        (Array.isArray(v.any) &&
          v.any.length > 0 &&
          v.any.length <= 3 &&
          v.any.every(
            (f) =>
              plain(f) &&
              Object.keys(f).length === 1 &&
              ['creature', 'artifact', 'enchantment'].includes(f.type),
          )));
    if (!plain(cost) || Object.keys(cost).some((k) => k !== 'where') || !typeFilter(cost.where))
      errors.push(
        `${name}.sacrificeCost: expected one mandatory sacrifice with a creature/artifact/enchantment type filter.`,
      );
    if (card.type === 'land' || card.disguise)
      errors.push(`${name}.sacrificeCost: lands and disguise combinations are unsupported.`);
  }
  if (card.costModifiers !== undefined) {
    if (
      !Array.isArray(card.costModifiers) ||
      !card.costModifiers.length ||
      card.costModifiers.length > 32
    )
      errors.push(`${name}.costModifiers: expected 1–32 modifiers.`);
    else
      for (const m of card.costModifiers) {
        if (!plain(m)) {
          errors.push(`${name}.costModifiers: expected an object.`);
          continue;
        }
        if (
          Object.keys(m).some(
            (k) => !['scope', 'change', 'amount', 'where', 'targetWhere', 'condition'].includes(k),
          ) ||
          !['self', 'you', 'opponent', 'all'].includes(m.scope) ||
          !['increase', 'reduce'].includes(m.change) ||
          !validNumericValue(m.amount, { nonnegative: true })
        )
          errors.push(`${name}.costModifiers: unsupported modifier.`);
        if (m.where !== undefined) errors.push(...validateFilter(m.where));
        if (m.targetWhere !== undefined) errors.push(...validateFilter(m.targetWhere));
        if (m.condition !== undefined) errors.push(...validateCondition(m.condition));
        if (m.scope !== 'self' && !permanent)
          errors.push(`${name}.costModifiers: global modifiers need a permanent source.`);
        if (m.scope === 'self' && card.type === 'land')
          errors.push(`${name}.costModifiers: lands are not cast.`);
      }
  }
  if (card.conditionalBonuses !== undefined) {
    if (
      !Array.isArray(card.conditionalBonuses) ||
      !card.conditionalBonuses.length ||
      card.conditionalBonuses.length > 16
    )
      errors.push(`${name}.conditionalBonuses: expected 1–16 bonuses.`);
    else
      for (const bonus of card.conditionalBonuses) {
        if (!plain(bonus)) {
          errors.push(`${name}.conditionalBonuses: expected an object.`);
          continue;
        }
        if (
          Object.keys(bonus).some(
            (k) => !['affects', 'condition', 'power', 'toughness', 'keywords'].includes(k),
          ) ||
          !['self', 'attached'].includes(bonus.affects) ||
          !validNumericValue(bonus.power) ||
          !validNumericValue(bonus.toughness) ||
          (bonus.keywords !== undefined &&
            (!Array.isArray(bonus.keywords) ||
              bonus.keywords.some((k) => !GRANTED_KEYWORDS.has(k))))
        )
          errors.push(`${name}.conditionalBonuses: unsupported bonus.`);
        errors.push(
          ...validateCondition(bonus.condition, { continuous: true }).map(
            (e) => `${name}.conditionalBonuses: ${e}`,
          ),
        );
        if (bonus.affects === 'attached' && !card.aura && !card.subtypes?.includes('Equipment'))
          errors.push(`${name}.conditionalBonuses: attached bonuses need an Aura or Equipment.`);
      }
  }
  for (const field of ['baseStats', 'selfBonus'])
    if (card[field] !== undefined) {
      const value = card[field];
      if (
        !plain(value) ||
        !Object.keys(value).length ||
        Object.keys(value).some((k) => !['power', 'toughness'].includes(k)) ||
        Object.values(value).some((v) => !validNumericValue(v)) ||
        (field === 'selfBonus' && (value.power === undefined || value.toughness === undefined)) ||
        card.type !== 'creature'
      )
        errors.push(`${name}.${field}: expected supported creature stat values.`);
    }
  if (card.attachmentBonus !== undefined) {
    const b = card.attachmentBonus;
    if (
      b?.maxBlockers !== undefined &&
      (!Number.isInteger(b.maxBlockers) || b.maxBlockers < 1 || b.maxBlockers > 16)
    )
      errors.push(`${name}.attachmentBonus.maxBlockers: expected 1-16.`);
    if (b?.noUntap !== undefined && typeof b.noUntap !== 'boolean')
      errors.push(`${name}.attachmentBonus.noUntap: expected boolean.`);
    if (
      !plain(b) ||
      !validNumericValue(b.power) ||
      !validNumericValue(b.toughness) ||
      Object.keys(b).some(
        (k) => !['power', 'toughness', 'keywords', 'noUntap', 'maxBlockers'].includes(k),
      ) ||
      (b.keywords !== undefined &&
        (!Array.isArray(b.keywords) || b.keywords.some((k) => !GRANTED_KEYWORDS.has(k)))) ||
      (!card.subtypes?.includes('Equipment') && !card.aura)
    )
      errors.push(`${name}.attachmentBonus: expected a supported Equipment or Aura bonus.`);
  }
  if (
    card.aura !== undefined &&
    (!['pacifism', 'creature'].includes(card.aura) ||
      card.type !== 'enchantment' ||
      !effectTargetCompatible('attachEquipment', card.target))
  )
    errors.push(`${name}.aura: expected a creature-enchanting Aura.`);
  if (card.aura) {
    const stable = (v) =>
      !v ||
      Object.entries(v).every(([k, value]) =>
        ['all', 'any'].includes(k)
          ? value.every(stable)
          : k === 'not'
            ? stable(value)
            : !['power', 'toughness', 'keyword'].includes(k),
      );
    if (!validateTargetSpec(card.target).length && !stable(targetSpec(card.target)?.where))
      errors.push(
        `${name}.aura: dependent characteristic enchant restrictions are not implemented.`,
      );
  }
  if (
    card.static !== undefined &&
    (!plain(card.static) ||
      card.static.kind !== 'anthem' ||
      !validNumericValue(card.static.power) ||
      !validNumericValue(card.static.toughness) ||
      Object.keys(card.static).some(
        (k) => !['kind', 'power', 'toughness', 'where', 'excludeSource', 'keywords'].includes(k),
      ))
  )
    errors.push(`${name}.static: unsupported continuous effect.`);
  if (plain(card.static)) {
    const e = card.static;
    if (e.where !== undefined) {
      errors.push(...validateFilter(e.where).map((v) => `${name}.static.where: ${v}`));
      const stable = (v) =>
        Object.entries(v).every(([key, value]) =>
          ['all', 'any'].includes(key)
            ? value.every(stable)
            : key === 'not'
              ? stable(value)
              : !['power', 'toughness'].includes(key) &&
                (key !== 'keyword' ||
                  (Array.isArray(e.keywords) ? e.keywords.length === 0 : e.keywords === undefined)),
        );
      if (!validateFilter(e.where).length && !stable(e.where))
        errors.push(
          `${name}.static.where: power/toughness filters and keyword-dependent ability grants require the future layer evaluator.`,
        );
    }
    if (e.excludeSource !== undefined && typeof e.excludeSource !== 'boolean')
      errors.push(`${name}.static.excludeSource: expected boolean.`);
    if (
      e.keywords !== undefined &&
      (!Array.isArray(e.keywords) || e.keywords.some((k) => !GRANTED_KEYWORDS.has(k)))
    )
      errors.push(`${name}.static.keywords: unsupported keyword.`);
  }
  if (
    card.spree !== undefined &&
    (card.spree !== true || !Array.isArray(card.modes) || card.modes.length > 3)
  )
    errors.push(`${name}: Spree requires 2–3 modes.`);
  if (card.spree && Array.isArray(card.modes)) {
    const ids = card.modes.flatMap((mode) => (mode.targetGroups ?? []).map((group) => group.id));
    if (new Set(ids).size !== ids.length)
      errors.push(`${name}: Spree target-group ids must be distinct across modes.`);
  }
  if (card.modes !== undefined) {
    if (
      !['instant', 'sorcery'].includes(card.type) ||
      card.effects !== undefined ||
      card.target != null
    )
      errors.push(
        `${name}.modes: only choose-one instants/sorceries without shared effects or targets are supported.`,
      );
    if (!Array.isArray(card.modes) || card.modes.length < 2 || card.modes.length > 8)
      errors.push(`${name}.modes: expected 2–8 modes.`);
    else {
      const labels = new Set();
      for (const [i, mode] of card.modes.entries()) {
        const path = `${name}.modes[${i}]`;
        if (
          !plain(mode) ||
          Object.keys(mode).some(
            (key) =>
              !['label', 'target', 'targetGroups', 'effects', 'additionalCost'].includes(key),
          )
        ) {
          errors.push(`${path}: unsupported mode fields.`);
          continue;
        }
        if (
          typeof mode.label !== 'string' ||
          !mode.label.trim() ||
          mode.label.length > 180 ||
          labels.has(mode.label)
        )
          errors.push(
            `${path}.label: expected a distinct nonempty label of at most 180 characters.`,
          );
        labels.add(mode.label);
        if (card.spree) {
          validateCost(mode.additionalCost, `${path}.additionalCost`, errors);
          if (mode.target != null) errors.push(`${path}: Spree modes use named target groups.`);
        } else if (mode.additionalCost !== undefined)
          validateCost(mode.additionalCost, `${path}.additionalCost`, errors);
        if (mode.target != null)
          errors.push(...validateTargetSpec(mode.target).map((e) => `${path}.target: ${e}`));
        validateGroupHolder(mode, path, errors);
        validateEffects(
          mode.effects,
          `${path}.effects`,
          mode.target,
          errors,
          Array.isArray(mode.targetGroups) ? mode.targetGroups : [],
        );
      }
    }
  }
  for (const key of ['effects', 'etb'])
    if (card[key] !== undefined)
      validateEffects(
        card[key],
        `${name}.${key}`,
        key === 'effects' ? card.target : null,
        errors,
        key === 'effects' && Array.isArray(card.targetGroups) ? card.targetGroups : [],
      );
  if (card.triggers !== undefined) {
    if (!Array.isArray(card.triggers) || card.triggers.length > 32)
      errors.push(`${name}.triggers: expected at most 32 triggers.`);
    else
      for (const [i, t] of card.triggers.entries()) {
        if (
          !plain(t) ||
          Object.keys(t).some(
            (k) =>
              ![
                'event',
                'effects',
                'optional',
                'target',
                'targetGroups',
                'condition',
                'triggerCondition',
                'oncePerTurn',
                'modes',
              ].includes(k),
          )
        ) {
          errors.push(`${name}.triggers[${i}]: unsupported trigger predicate or field.`);
          continue;
        }
        if (t.modes !== undefined) {
          const path = `${name}.triggers[${i}].modes`;
          if (t.effects !== undefined || t.target !== undefined || t.targetGroups !== undefined)
            errors.push(`${path}: modes cannot share effects or targets.`);
          if (!Array.isArray(t.modes) || t.modes.length < 2 || t.modes.length > 8)
            errors.push(`${path}: expected 2–8 choose-one modes.`);
          else {
            const labels = new Set();
            for (const [j, mode] of t.modes.entries()) {
              if (
                !plain(mode) ||
                Object.keys(mode).some(
                  (key) => !['label', 'target', 'targetGroups', 'effects'].includes(key),
                )
              ) {
                errors.push(`${path}[${j}]: unsupported triggered mode fields.`);
                continue;
              }
              if (
                typeof mode.label !== 'string' ||
                !mode.label.trim() ||
                mode.label.length > 180 ||
                labels.has(mode.label)
              )
                errors.push(
                  `${path}[${j}].label: expected a distinct nonempty label of at most 180 characters.`,
                );
              labels.add(mode.label);
              const { modes, ...trigger } = t;
              const { label, ...branch } = mode;
              errors.push(
                ...validateDefinition({ ...card, triggers: [{ ...trigger, ...branch }] }).map(
                  (error) => `${path}[${j}]: ${error}`,
                ),
              );
            }
          }
          continue;
        }
        if (t.event?.event === 'chapter' && !(card.subtypes ?? []).includes('Saga'))
          errors.push(
            `${name}.triggers[${i}]: chapter abilities require Saga subtype in this bounded implementation.`,
          );
        errors.push(
          ...validateEventSpec(t.event).map((error) => `${name}.triggers[${i}].event: ${error}`),
        );
        if (t.oncePerTurn !== undefined && typeof t.oncePerTurn !== 'boolean')
          errors.push(`${name}.triggers[${i}].oncePerTurn: expected a boolean.`);
        if (t.condition !== undefined) errors.push(...validateCondition(t.condition));
        if (t.triggerCondition !== undefined) errors.push(...validateCondition(t.triggerCondition));
        if (t.optional !== undefined && typeof t.optional !== 'boolean')
          errors.push(`${name}.triggers[${i}].optional: expected a boolean.`);
        if (t.target != null)
          errors.push(
            ...validateTargetSpec(t.target).map(
              (error) => `${name}.triggers[${i}].target: ${error}`,
            ),
          );
        // Cross-object death triggers need a simultaneous-departure identity
        // contract before "another graveyard card" can refer to their source.
        // Own-dies triggers have an explicit one-time targetingSource snapshot.
        const targetSelectors = [
          t.target,
          ...(Array.isArray(t.targetGroups) ? t.targetGroups : []).map((g) => g?.selector),
        ];
        const triggerEvent = eventSpec(t.event);
        if (
          ((['dies', 'leave'].includes(triggerEvent?.event) && triggerEvent.object !== 'source') ||
            ['sacrifice', 'diesGroup', 'battlefieldToGraveyardGroup'].includes(
              triggerEvent?.event,
            )) &&
          targetSelectors.some((selector) => {
            const spec = targetSpec(selector);
            return spec?.scope === 'graveyard' && spec.excludeSource;
          })
        )
          errors.push(
            `${name}.triggers[${i}]: graveyard source exclusion supports own-dies triggers only.`,
          );
        validateGroupHolder(t, `${name}.triggers[${i}]`, errors);
        if (Array.isArray(t.targetGroups) && t.targetGroups.some((g) => g?.excludeFrom?.length))
          errors.push(
            `${name}.triggers[${i}]: cross-group exclusions are currently spell/activated-only.`,
          );
        validateEffects(
          t.effects,
          `${name}.triggers[${i}].effects`,
          t.target,
          errors,
          Array.isArray(t.targetGroups) ? t.targetGroups : [],
        );
      }
  }
  if (card.activated !== undefined) {
    if (!Array.isArray(card.activated) || card.activated.length > 32)
      errors.push(`${name}.activated: expected at most 32 abilities.`);
    else
      for (const [i, a] of card.activated.entries()) {
        const p = `${name}.activated[${i}]`;
        if (!plain(a) || !plain(a.cost)) {
          errors.push(`${p}: expected an ability with costs.`);
          continue;
        }
        if (
          Object.keys(a).some(
            (k) =>
              ![
                'cost',
                'zone',
                'effects',
                'target',
                'targetGroups',
                'text',
                'timing',
                'condition',
                'oncePerTurn',
                'powerUp',
                'loyalty',
              ].includes(k),
          )
        )
          errors.push(`${p}: unsupported ability field.`);
        if (
          a.loyalty !== undefined &&
          (!hasType(card, 'planeswalker') ||
            a.zone !== undefined ||
            !signed(a.loyalty) ||
            Math.abs(a.loyalty) > 1000 ||
            Object.keys(a.cost).length)
        )
          errors.push(
            `${p}.loyalty: requires a planeswalker, integer loyalty cost and no other costs.`,
          );
        if (
          a.powerUp !== undefined &&
          (a.powerUp !== true ||
            !a.cost.mana ||
            a.zone ||
            a.oncePerTurn ||
            a.loyalty !== undefined ||
            Object.keys(card.cost).some((k) => k.includes('/')))
        )
          errors.push(`${p}: invalid power-up ability.`);
        if (a.zone !== undefined && a.zone !== 'graveyard')
          errors.push(`${p}.zone: unsupported activation zone.`);
        // CR 113.6m / 602.1a: the zone restriction is not an additional exile cost.
        if (a.zone === 'graveyard' && (a.cost.tap || a.cost.sacrificeSelf))
          errors.push(`${p}: graveyard abilities cannot tap or sacrifice their source.`);
        if (a.cost.exileSelf && a.zone !== 'graveyard')
          errors.push(`${p}: exileSelf requires a graveyard ability.`);
        if (a.condition !== undefined) errors.push(...validateCondition(a.condition));
        if (a.oncePerTurn !== undefined && typeof a.oncePerTurn !== 'boolean')
          errors.push(`${p}.oncePerTurn: expected a boolean.`);
        if (a.timing !== undefined && a.timing !== 'sorcery')
          errors.push(`${p}.timing: unsupported timing.`);
        validatePaymentCost(a.cost, `${p}.cost`, errors, { allowTap: true });
        if (
          a.cost.sacrifice &&
          !a.target &&
          !a.targetGroups &&
          a.loyalty === undefined &&
          contains(a.effects, (v) => v.op === 'addMana')
        )
          errors.push(
            `${p}: selected-sacrifice mana abilities require unsupported mana payment planning.`,
          );
        if (a.target != null)
          errors.push(...validateTargetSpec(a.target).map((error) => `${p}.target: ${error}`));
        if (a.text !== undefined && typeof a.text !== 'string')
          errors.push(`${p}.text: expected a string.`);
        validateGroupHolder(a, p, errors);
        if (a.targetGroups && a.cost.discard)
          errors.push(`${p}: grouped targets with discard costs are not yet supported.`);
        validateEffects(
          a.effects,
          `${p}.effects`,
          a.target,
          errors,
          Array.isArray(a.targetGroups) ? a.targetGroups : [],
        );
      }
  }
  const usesLinkedExile = (effects, depth = 0) =>
    depth < 9 &&
    Array.isArray(effects) &&
    effects.some(
      (e) =>
        e?.op === 'exileUntilSourceLeaves' ||
        (e?.op === 'conditional' &&
          (usesLinkedExile(e.then, depth + 1) || usesLinkedExile(e.else, depth + 1))),
    );
  const linked =
    usesLinkedExile(card.effects) ||
    usesLinkedExile(card.etb) ||
    (Array.isArray(card.triggers) && card.triggers.some((t) => usesLinkedExile(t.effects))) ||
    (Array.isArray(card.activated) && card.activated.some((a) => usesLinkedExile(a.effects)));
  if (
    linked &&
    (!['creature', 'artifact', 'enchantment', 'land', 'planeswalker'].includes(card.type) ||
      card.manaSacrifice ||
      (Array.isArray(card.activated) &&
        card.activated.some((a) => a.cost?.sacrificeSelf && a.cost?.life)))
  )
    errors.push(
      `${name}: linked exile requires a permanent source without sacrificing mana abilities or combined sacrifice/life activation costs.`,
    );
  // The current one-option-per-color mana profile cannot represent a free
  // grant alongside an intrinsic sacrifice-as-cost mana ability. Fail closed.
  const usesLandForm = (effects, depth = 0) =>
    depth <= 8 &&
    Array.isArray(effects) &&
    effects.some(
      (e) =>
        e?.op === 'becomeLand' ||
        (e?.op === 'conditional' &&
          (usesLandForm(e.then, depth + 1) || usesLandForm(e.else, depth + 1))),
    );
  if (
    card.manaSacrifice &&
    (usesLandForm(card.effects) ||
      usesLandForm(card.etb) ||
      (Array.isArray(card.triggers) && card.triggers.some((t) => usesLandForm(t.effects))) ||
      (Array.isArray(card.activated) && card.activated.some((a) => usesLandForm(a.effects))))
  )
    errors.push(
      `${name}: temporary mana grants cannot be combined with intrinsic sacrifice mana abilities.`,
    );
  return errors;
}
