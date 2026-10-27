import { validateTargetGroups } from './target-group-schema.js';
import { validNumericValue } from './value-schema.js';
import { validateCondition } from './condition-schema.js';
import { validateEventSpec } from './events.js';
import {
  targetSpec,
  validateTargetSpec,
  effectTargetCompatible,
  validateFilter,
} from './selectors.js';
import { CARD_TYPES, primaryType, KEYWORD_NAMES, HYBRID_SYMBOLS } from './types.js';

const TYPES = new Set(CARD_TYPES);
const COLORS = new Set(['W', 'U', 'B', 'R', 'G']);
const MANA = new Set([...COLORS, 'C', 'generic', ...HYBRID_SYMBOLS]);
const KEYWORDS = new Set(KEYWORD_NAMES);
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
  'basic',
  'legendary',
  'token',
  'mana',
  'manaSacrifice',
  'manaConditions',
  'manaRestrictions',
  'chooseCreatureType',
  'entryCounterBonus',
  'damageBonus',
  'startEngines',
  'maxSpeedKeywords',
  'entersTappedUnless',
  'target',
  'targetGroups',
  'effects',
  'modes',
  'cycling',
  'kicker',
  'offspring',
  'disguise',
  'cannotAttack',
  'cannotBlock',
  'unblockable',
  'uncounterable',
  'etb',
  'aura',
  'attachmentBonus',
  'baseStats',
  'selfBonus',
  'conditionalBonuses',
  'costModifiers',
  'static',
  'triggers',
  'activated',
  'ward',
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
function validateCost(cost, path, errors) {
  if (!plain(cost)) {
    errors.push(`${path}: expected a mana-cost object.`);
    return;
  }
  for (const [key, n] of Object.entries(cost))
    if (!MANA.has(key) || !natural(n))
      errors.push(`${path}.${key}: unsupported mana symbol or nonnegative integer amount.`);
}
function validatePaymentCost(cost, path, errors, { allowTap = false } = {}) {
  if (!plain(cost)) {
    errors.push(`${path}: expected a cost object.`);
    return;
  }
  const allowed = allowTap ? ['mana', 'life', 'tap', 'sacrificeSelf', 'discard'] : ['mana', 'life'];
  if (Object.keys(cost).some((key) => !allowed.includes(key)))
    errors.push(`${path}: unsupported cost.`);
  if (cost.mana !== undefined) validateCost(cost.mana, `${path}.mana`, errors);
  if (cost.life !== undefined && !natural(cost.life))
    errors.push(`${path}.life: expected a nonnegative safe integer.`);
  if (cost.sacrificeSelf !== undefined && typeof cost.sacrificeSelf !== 'boolean')
    errors.push(`${path}.sacrificeSelf: expected a boolean.`);
  if (cost.discard !== undefined && cost.discard !== 1)
    errors.push(`${path}.discard: only a single-card discard cost is supported.`);
  if (cost.tap !== undefined && typeof cost.tap !== 'boolean')
    errors.push(`${path}.tap: expected a boolean.`);
}
function filterOnlyPermanents(where) {
  if (where?.type) return ['land', 'creature', 'artifact', 'enchantment'].includes(where.type);
  if (where?.all) return where.all.some(filterOnlyPermanents);
  if (where?.any) return where.any.every(filterOnlyPermanents);
  return false;
}
function validateEffects(effects, path, target, errors, groups = []) {
  if (!Array.isArray(effects) || effects.length > 64) {
    errors.push(`${path}: expected at most 64 effect instructions.`);
    return;
  }
  for (const [index, e] of effects.entries()) {
    const p = `${path}[${index}]`;
    if (!plain(e)) {
      errors.push(`${p}: expected an effect object.`);
      continue;
    }
    if (e.targetGroup !== undefined) {
      const group = groups.find((g) => g.id === e.targetGroup);
      if (
        !group ||
        ![
          'damage',
          'destroy',
          'bounce',
          'modify',
          'counterOn',
          'tap',
          'untap',
          'moveTarget',
        ].includes(e.op) ||
        e.subject !== undefined ||
        (e.op === 'moveTarget' && e.destination === 'battlefield')
      ) {
        errors.push(`${p}: unsupported target group binding.`);
        continue;
      }
      const { targetGroup, ...bound } = e;
      validateEffects([bound], p, group.selector, errors);
      continue;
    }
    if (e.op === 'fight' || e.op === 'bite') {
      const actor = groups.find((g) => g.id === e.sourceGroup);
      const victim = groups.find((g) => g.id === e.victimGroup);
      if (
        Object.keys(e).some((k) => !['op', 'sourceGroup', 'victimGroup'].includes(k)) ||
        !actor ||
        actor.min !== 1 ||
        actor.max !== 1 ||
        !victim ||
        !effectTargetCompatible('attachEquipment', actor.selector) ||
        !effectTargetCompatible('attachEquipment', victim.selector) ||
        (e.op === 'fight' && victim.max !== 1)
      )
        errors.push(`${p}: fight/bite requires creature target groups and exactly one source.`);
      continue;
    }
    const schema = {
      damage: ['amount'],
      damageOpponent: ['amount'],
      damageEventOpponent: ['amount'],
      damageEventPowerOpponent: [],
      addMana: ['mana'],
      impulseChoose: ['count'],
      bindingNegotiation: [],
      gainLife: ['amount', 'player'],
      loseLife: ['amount', 'player'],
      moveTarget: ['destination', 'controller', 'tapped', 'subject'],
      draw: ['count', 'player'],
      mill: ['count', 'player'],
      scry: ['count', 'player'],
      surveil: ['count', 'player'],
      discard: ['count', 'player'],
      searchLibrary: ['count', 'where', 'destination', 'tapped', 'reveal'],
      counter: [],
      bounce: ['subject'],
      destroy: ['subject'],
      attachEquipment: [],
      modify: ['subject', 'power', 'toughness', 'keywords'],
      token: ['definition', 'count', 'player', 'tapped', 'temporaryKeywords'],
      counterOn: ['subject', 'amount'],
      untap: ['subject'],
      tap: ['subject'],
      destroyAll: ['where', 'excludeSource'],
      exileAll: ['where', 'excludeSource'],
      modifyAll: ['where', 'excludeSource', 'power', 'toughness', 'keywords'],
      damageAll: ['where', 'excludeSource', 'amount', 'players'],
      counterAll: ['where', 'excludeSource', 'amount'],
      tapAll: ['where', 'excludeSource'],
      untapAll: ['where', 'excludeSource'],
    }[e.op];
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
        'damageEventOpponent',
        'gainLife',
        'loseLife',
        'counterOn',
      ].includes(e.op) &&
      !validNumericValue(e.amount, { nonnegative: true })
    )
      errors.push(`${p}.amount: expected a nonnegative safe integer.`);
    if (
      ['draw', 'mill', 'token', 'scry', 'surveil', 'discard'].includes(e.op) &&
      !validNumericValue(e.count, { nonnegative: true, limit: 1000 })
    )
      errors.push(`${p}.count: expected a literal count from 0 to 1000.`);
    if (
      e.op === 'mill' &&
      (!['controller', 'opponent', 'target'].includes(e.player) ||
        (e.player === 'target' && !effectTargetCompatible('mill', target)))
    )
      errors.push(`${p}: mill requires a supported player selector and compatible target.`);
    if (
      ['draw', 'discard', 'gainLife', 'loseLife', 'scry', 'surveil'].includes(e.op) &&
      e.player !== undefined &&
      (!['controller', 'opponent', 'target'].includes(e.player) ||
        (e.player === 'target' && !effectTargetCompatible(e.op, target)))
    )
      errors.push(`${p}.player: expected a compatible player recipient.`);
    if (e.op === 'searchLibrary') {
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
    if (e.op === 'moveTarget') {
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
    if (e.op === 'impulseChoose' && (!natural(e.count) || e.count > 1000))
      errors.push(`${p}.count: invalid count.`);
    if (e.op === 'bindingNegotiation' && targetSpec(target)?.scope !== 'player')
      errors.push(`${p}: requires a player target.`);
    if (e.op === 'addMana') {
      validateCost(e.mana, `${p}.mana`, errors);
      if (
        Object.keys(e.mana ?? {}).some((symbol) => !['W', 'U', 'B', 'R', 'G', 'C'].includes(symbol))
      )
        errors.push(`${p}.mana: mana production cannot be generic.`);
    }
    if (e.op === 'token') {
      if (
        e.temporaryKeywords !== undefined &&
        (!Array.isArray(e.temporaryKeywords) || e.temporaryKeywords.some((k) => !KEYWORDS.has(k)))
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
    if (e.op === 'token' && (typeof e.definition !== 'string' || !e.definition))
      errors.push(`${p}.definition: expected a token definition name.`);
    if (
      [
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
        !validNumericValue(e.amount, { nonnegative: true })
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
    if (e.op === 'modify' || e.op === 'modifyAll') {
      if (!validNumericValue(e.power) || !validNumericValue(e.toughness))
        errors.push(`${p}: power and toughness changes must be safe integers.`);
      if (e.subject !== undefined && !['source', 'attached'].includes(e.subject))
        errors.push(
          `${p}.subject: only source, attached permanent or the chosen target is supported.`,
        );
      if (
        e.keywords !== undefined &&
        (!Array.isArray(e.keywords) || e.keywords.some((k) => !KEYWORDS.has(k)))
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
      ['untap', 'tap'].includes(e.op) &&
      e.subject !== undefined &&
      !['source', 'attached'].includes(e.subject)
    )
      errors.push(
        `${p}.subject: only source, attached permanent or the chosen target is supported.`,
      );
    if (
      e.op === 'counterOn' &&
      e.subject !== undefined &&
      !['source', 'attached'].includes(e.subject)
    )
      errors.push(
        `${p}.subject: only source, attached permanent or the chosen target is supported.`,
      );
    if (
      [
        'damage',
        'counter',
        'bounce',
        'destroy',
        'attachEquipment',
        'modify',
        'moveTarget',
        'untap',
        'tap',
        'counterOn',
      ].includes(e.op) &&
      !['source', 'attached'].includes(e.subject) &&
      !effectTargetCompatible(e.op, target, e)
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
  const permanent = ['land', 'creature', 'artifact', 'enchantment'].includes(card.type);
  if (permanent && card.effects !== undefined)
    errors.push(
      `${name}.effects: permanent spells use enters triggers, not direct spell instructions.`,
    );
  if (!permanent)
    for (const field of ['etb', 'triggers', 'activated', 'static', 'ward', 'mana', 'entersTapped'])
      if (card[field] !== undefined)
        errors.push(`${name}.${field}: only battlefield permanents support this field.`);
  if (card.cycling !== undefined) validateCost(card.cycling, `${name}.cycling`, errors);
  validateCost(card.cost, `${name}.cost`, errors);
  if (card.ward !== undefined) validatePaymentCost(card.ward, `${name}.ward`, errors);
  if (card.text !== undefined && typeof card.text !== 'string')
    errors.push(`${name}.text: expected a string.`);
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
    (!Array.isArray(card.maxSpeedKeywords) || card.maxSpeedKeywords.some((k) => !KEYWORDS.has(k)))
  )
    errors.push(`${name}.maxSpeedKeywords: unsupported keywords.`);
  if (card.disguise !== undefined) {
    validateCost(card.disguise, `${name}.disguise`, errors);
    if (card.type !== 'creature' || card.modes || card.kicker || card.offspring)
      errors.push(`${name}.disguise: unsupported combination.`);
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
  if (card.manaConditions !== undefined) {
    if (!plain(card.manaConditions)) errors.push(`${name}.manaConditions: expected an object.`);
    else
      for (const [color, condition] of Object.entries(card.manaConditions)) {
        if (!(Array.isArray(card.mana) ? card.mana : [card.mana]).includes(color))
          errors.push(`${name}.manaConditions: unknown production color.`);
        errors.push(...validateCondition(condition).map((v) => `${name}.manaConditions: ${v}`));
      }
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
    'cannotAttack',
    'cannotBlock',
    'unblockable',
    'uncounterable',
  ])
    if (card[key] !== undefined && typeof card[key] !== 'boolean')
      errors.push(`${name}.${key}: expected a boolean.`);
  if (card.manaSacrifice && !card.mana)
    errors.push(`${name}: a sacrificing mana source must produce mana.`);
  if (card.legendary && ['instant', 'sorcery'].includes(card.type))
    errors.push(`${name}: legendary spell casting restrictions are not implemented.`);
  if (card.basic && card.type !== 'land') errors.push(`${name}: only lands can be basic.`);
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
            (!Array.isArray(bonus.keywords) || bonus.keywords.some((k) => !KEYWORDS.has(k))))
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
    if (b?.noUntap !== undefined && typeof b.noUntap !== 'boolean')
      errors.push(`${name}.attachmentBonus.noUntap: expected boolean.`);
    if (
      !plain(b) ||
      !validNumericValue(b.power) ||
      !validNumericValue(b.toughness) ||
      Object.keys(b).some((k) => !['power', 'toughness', 'keywords', 'noUntap'].includes(k)) ||
      (b.keywords !== undefined &&
        (!Array.isArray(b.keywords) || b.keywords.some((k) => !KEYWORDS.has(k)))) ||
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
              : !['power', 'toughness', 'keyword'].includes(key),
        );
      if (!validateFilter(e.where).length && !stable(e.where))
        errors.push(
          `${name}.static.where: dependent characteristic filters require the future layer evaluator.`,
        );
    }
    if (e.excludeSource !== undefined && typeof e.excludeSource !== 'boolean')
      errors.push(`${name}.static.excludeSource: expected boolean.`);
    if (
      e.keywords !== undefined &&
      (!Array.isArray(e.keywords) || e.keywords.some((k) => !KEYWORDS.has(k)))
    )
      errors.push(`${name}.static.keywords: unsupported keyword.`);
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
          Object.keys(mode).some((key) => !['label', 'target', 'effects'].includes(key))
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
        if (mode.target != null)
          errors.push(...validateTargetSpec(mode.target).map((e) => `${path}.target: ${e}`));
        validateEffects(mode.effects, `${path}.effects`, mode.target, errors);
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
            (k) => !['event', 'effects', 'optional', 'target', 'condition'].includes(k),
          )
        ) {
          errors.push(`${name}.triggers[${i}]: unsupported trigger predicate or field.`);
          continue;
        }
        errors.push(
          ...validateEventSpec(t.event).map((error) => `${name}.triggers[${i}].event: ${error}`),
        );
        if (t.condition !== undefined) errors.push(...validateCondition(t.condition));
        if (t.optional !== undefined && typeof t.optional !== 'boolean')
          errors.push(`${name}.triggers[${i}].optional: expected a boolean.`);
        if (t.target != null)
          errors.push(
            ...validateTargetSpec(t.target).map(
              (error) => `${name}.triggers[${i}].target: ${error}`,
            ),
          );
        validateEffects(t.effects, `${name}.triggers[${i}].effects`, t.target, errors);
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
              !['cost', 'effects', 'target', 'text', 'timing', 'condition', 'oncePerTurn'].includes(
                k,
              ),
          )
        )
          errors.push(`${p}: unsupported ability field.`);
        if (a.condition !== undefined) errors.push(...validateCondition(a.condition));
        if (a.oncePerTurn !== undefined && typeof a.oncePerTurn !== 'boolean')
          errors.push(`${p}.oncePerTurn: expected a boolean.`);
        if (a.timing !== undefined && a.timing !== 'sorcery')
          errors.push(`${p}.timing: unsupported timing.`);
        validatePaymentCost(a.cost, `${p}.cost`, errors, { allowTap: true });
        if (a.target != null)
          errors.push(...validateTargetSpec(a.target).map((error) => `${p}.target: ${error}`));
        if (a.text !== undefined && typeof a.text !== 'string')
          errors.push(`${p}.text: expected a string.`);
        validateEffects(a.effects, `${p}.effects`, a.target, errors);
      }
  }
  return errors;
}
