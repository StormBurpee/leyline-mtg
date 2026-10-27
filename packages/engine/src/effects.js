import { tapObjects } from './model.js';
import { endTurn } from './turn.js';
import { LAND_CARD_NAMES } from './land-card-names.js';
import { attackDefenders, validateAttackDefenders } from './combat.js';
import { manaValue } from './mana-value.js';
import {
  flattenTargets,
  survivingTargets,
  targetPlanProblem,
  targetPlans,
} from './target-groups.js';
import { effectValues, numericValue } from './numeric-values.js';
import { CREATURE_TYPES } from './creature-types.js';
import { meetsCondition } from './conditions.js';
import { searchableCards } from './library-search.js';
import { targetSpec, matchesFilter } from './selectors.js';
import { hasType } from './types.js';
import { costProblem, payCost } from './costs.js';
import { cardDefinition } from './cards.js';
import {
  untapObject,
  addModifier,
  layerTimestamp,
  sagaFinalChapter,
  addLoreCounters,
  isAttacking,
  isBlocking,
  legalEquipmentAttachment,
  legalAuraAttachment,
  wardCosts,
  addObject,
  queueTrigger,
  queueEntryTrigger,
  counterKinds,
  removeOneCounter,
  removeFromCombat,
  preparePermanent,
  unpreparePermanent,
  preparedSource,
  trackExiledCard,
  entryTriggersSuppressed,
  notifyTriggers,
  notifyEntryGroup,
  captureDepartureContext,
  finishDepartureBatch,
  sacrificePermanents,
  battlefield,
  creatures,
  definition,
  copiableDefinition,
  draw,
  emit,
  hasKeyword,
  move,
  opponent,
  ref,
  stats,
  keywords,
  loseLife,
  revealFaceDownAtEnd,
  requireRule,
  shuffle,
} from './model.js';
function ignoresCreatureProtection(s, object) {
  return (
    hasType(definition(s, object), 'creature') &&
    battlefield(s).some(
      (source) =>
        source.controller !== object.controller &&
        definition(s, source).opponentCreatureProtectionBypass,
    )
  );
}
// CR 122.1a / 704.5q: placement changes stats immediately; opposing counters
// cancel only at the next simultaneous SBA batch, never between instructions.
function putStatCounters(object, effect) {
  const key = effect.counter === '-1/-1' ? 'minusCounters' : 'plusCounters';
  const next = (object[key] ?? 0) + effect.amount;
  requireRule(Number.isSafeInteger(next), 'COUNTER_RANGE', 'Too many counters.');
  object[key] = next;
}

export function legalTarget(s, kind, target, controller, sourceRef = null) {
  if (!kind) return target == null;
  const spec = targetSpec(kind);
  if (!spec || !target) return false;
  // "Another" identifies the exact source object, never every object sharing its ID
  // or controller. Missing context fails closed rather than offering the source.
  if (
    spec.excludeSource &&
    (!sourceRef ||
      sourceRef.kind !== 'object' ||
      typeof sourceRef.id !== 'string' ||
      !Number.isSafeInteger(sourceRef.incarnation) ||
      (target.kind === 'object' &&
        target.id === sourceRef.id &&
        target.incarnation === sourceRef.incarnation))
  )
    return false;
  if (target.kind === 'player')
    return (
      (target.id === 0 || target.id === 1) &&
      ['player', 'damageable', 'playerOrPlaneswalker'].includes(spec.scope) &&
      matchesFilter({ controller: target.id, owner: target.id }, spec.where, controller)
    );
  if (target.kind === 'stack') {
    const entry = s.stack.find((e) => e.id === target.id);
    if (!entry || !['spell', 'ability'].includes(spec.scope) || entry.kind !== spec.scope)
      return false;
    const source = s.objects[entry.source.id],
      d =
        entry.kind === 'spell'
          ? definition(s, source)
          : (entry.sourceDefinition ?? (source ? definition(s, source) : {}));
    return matchesFilter(
      {
        definition: d,
        controller: entry.controller,
        owner: source?.owner,
        manaValue: manaValue(d, entry.x ?? 0),
        power: d.power,
        toughness: d.toughness,
      },
      spec.where,
      controller,
    );
  }
  if (
    target.kind !== 'object' ||
    !['permanent', 'damageable', 'playerOrPlaneswalker', 'graveyard'].includes(spec.scope)
  )
    return false;
  const o = s.objects[target.id];
  if (
    !o ||
    o.zone !== (spec.scope === 'graveyard' ? 'graveyard' : 'battlefield') ||
    o.incarnation !== target.incarnation
  )
    return false;
  const d = definition(s, o),
    creature = hasType(d, 'creature');
  const planeswalker = hasType(d, 'planeswalker');
  if (spec.scope === 'damageable' && !creature && !planeswalker) return false;
  if (spec.scope === 'playerOrPlaneswalker' && !planeswalker) return false;
  if (
    o.zone === 'battlefield' &&
    (hasKeyword(s, o, 'shroud') ||
      (hasKeyword(s, o, 'hexproof') &&
        o.controller !== controller &&
        !ignoresCreatureProtection(s, o)))
  )
    return false;
  const pt = creature || o.zone !== 'battlefield' ? stats(s, o) : {};
  return matchesFilter(
    {
      definition: d,
      controller: o.controller,
      owner: o.owner,
      token: o.token,
      tapped: o.tapped,
      stunCounters: o.stunCounters ?? 0,
      attacking: isAttacking(s, o),
      blocking: isBlocking(s, o),
      keywords: o.zone === 'battlefield' ? keywords(s, o) : d.keywords,
      power: pt.power,
      toughness: pt.toughness,
      manaValue: manaValue(d),
    },
    spec.where,
    controller,
  );
}
export function targetsFor(s, kind, p, sourceRef = null) {
  if (!kind) return [];
  return [
    ...s.players.map((p) => ({ kind: 'player', id: p.id })),
    ...Object.values(s.objects)
      .filter((object) => ['battlefield', 'graveyard'].includes(object.zone))
      .map(ref),
    ...s.stack.map((e) => ({ kind: 'stack', id: e.id })),
  ].filter((t) => legalTarget(s, kind, t, p, sourceRef));
}
/** Ward is triggered, not a targeting restriction (CR 702.21). */
export function notifyTargeted(s, entry) {
  if (entry.targetGroups) {
    const seen = new Set();
    for (const target of flattenTargets(entry.targets)) {
      const key = `${target.kind}:${target.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      notifyTargeted(s, { ...entry, targetGroups: undefined, target });
    }
    return;
  }
  if (entry.target?.kind === 'stack') {
    const targeted = s.stack.find((item) => item.id === entry.target.id && item.kind === 'spell');
    const spell = targeted && s.objects[targeted.source?.id];
    if (spell?.zone === 'stack' && spell.incarnation === targeted.source.incarnation)
      notifyTriggers(s, 'targeted', {
        object: spell,
        targetingController: entry.controller,
        targetingKind: entry.kind,
      });
    return;
  }
  if (entry.target?.kind !== 'object') return;
  const source = s.objects[entry.target.id];
  if (
    !source ||
    source.zone !== 'battlefield' ||
    (entry.target.incarnation !== undefined && entry.target.incarnation !== source.incarnation)
  )
    return;
  const stamp = `${s.turn}:${source.incarnation}`;
  if (source.targetHistory?.stamp !== stamp) source.targetHistory = { stamp, counts: {} };
  const counts = source.targetHistory.counts;
  const relation = source.controller === entry.controller ? 'you' : 'opponent';
  for (const who of ['all', relation])
    for (const kind of ['all', entry.kind]) {
      const key = `${who}:${kind}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  notifyTriggers(s, 'targeted', {
    object: source,
    targetingController: entry.controller,
    targetingKind: entry.kind,
    targetNumbers: counts,
  });
  if (source.controller === entry.controller) return;
  if (ignoresCreatureProtection(s, source)) return;
  for (const cost of wardCosts(s, source)) {
    s.pendingTriggers.push({
      id: `s${++s.nextId}`,
      kind: 'ability',
      name: source.faceDown ? 'Face-down creature' : source.name,
      source: ref(source),
      controller: source.controller,
      sourceKeywords: keywords(s, source),
      effects: [{ op: 'wardPayment', cost: structuredClone(cost) }],
      relatedStackId: entry.id,
      label: `${source.faceDown ? 'Face-down creature' : source.name} · ward`,
    });
    emit(s, 'triggered', {
      objectId: source.id,
      name: source.faceDown ? 'Face-down creature' : source.name,
      player: source.controller,
    });
  }
}
function counterEntry(s, id, destination = 'graveyard') {
  const index = s.stack.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  if (s.stack[index].uncounterable) return;
  const [entry] = s.stack.splice(index, 1);
  const source = s.objects[entry.source.id];
  if (entry.kind === 'spell' && source?.zone === 'stack') move(s, source, destination);
  emit(s, 'countered', { name: entry.name, stackId: entry.id });
}
/** One-shot duration expiry, not a triggered ability (CR 610.3). */
export function flushLinkedReturns(s) {
  if (!s.pendingLinkedReturns?.length) return true;
  const refs = s.pendingLinkedReturns;
  s.pendingLinkedReturns = [];
  const entries = refs
    .map((r) => s.objects[r.id])
    .filter((o, i) => o && !o.token && o.zone === 'exile' && o.incarnation === refs[i].incarnation)
    .map((object) => ({ object, controller: object.owner }))
    .sort((a, b) => Number(b.controller === s.active) - Number(a.controller === s.active));
  return enterBattlefieldBatch(s, entries);
}
function exileUntilSourceLeaves(s, entry, target, departureContext = null) {
  const source = s.objects[entry.source?.id];
  const object = target?.kind === 'object' && s.objects[target.id];
  // The duration must not already have ended when the first one-shot effect resolves.
  if (
    !source ||
    source.zone !== 'battlefield' ||
    source.incarnation !== entry.source.incarnation ||
    !object ||
    object.zone !== 'battlefield' ||
    object.incarnation !== target.incarnation
  )
    return;
  // Register before the move: a source exiling itself also ends its duration immediately.
  (s.linkedExiles ??= []).push({
    source: ref(source),
    cards: [{ ...ref(object), incarnation: object.incarnation + 1 }],
  });
  move(s, object, 'exile', departureContext);
}
function createAttachedToken(s, name, controller, target) {
  const object = target?.kind === 'object' && s.objects[target.id];
  if (!object || object.zone !== 'battlefield' || object.incarnation !== target.incarnation) return;
  const d = cardDefinition(name, s.catalog);
  const probe = { name, controller, owner: controller, zone: 'void' };
  if (!d.token || !d.aura || !legalAuraAttachment(s, probe, object, controller)) return;
  const token = addObject(s, name, controller, 'void');
  enterBattlefield(s, token, controller, ref(object));
}
export function enterBattlefield(s, o, controller = o.owner, attachment = null, options = {}) {
  return enterBattlefieldBatch(s, [
    {
      object: o,
      controller,
      attachment,
      tapped: options.tapped,
      enchantmentOnly: options.enchantmentOnly,
      ...(options.attachedToken
        ? { attachedToken: options.attachedToken, tokenController: options.tokenController }
        : {}),
    },
  ]);
}
/** Move every entrant before observing any enters event, so simultaneous entrants see one another. */
export function enterBattlefieldBatch(
  s,
  entries,
  typeChoices = {},
  auraChoices = {},
  lifeChoices = {},
) {
  let entering = entries.filter(
    ({ object }) =>
      object.zone !== 'battlefield' &&
      ['creature', 'artifact', 'enchantment', 'land', 'planeswalker'].includes(
        definition(s, object).type,
      ),
  );
  const ready = [];
  for (const item of entering) {
    const { object, controller = object.owner } = item;
    if (definition(s, object).chooseBasicLandType && !typeChoices[object.id]) {
      s.choice = {
        kind: 'landType',
        player: controller,
        card: object.id,
        entries: entering.map(({ object, ...rest }) => ({ ...rest, object: ref(object) })),
        typeChoices,
        auraChoices,
        lifeChoices,
        types: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'],
      };
      return false;
    }
    if (definition(s, object).entryLifePayment && !Object.hasOwn(lifeChoices, object.id)) {
      const amount = definition(s, object).entryLifePayment;
      s.choice = {
        kind: 'entryLife',
        player: controller,
        card: object.id,
        amount,
        payable: s.players[controller].life >= amount,
        forcedTapped:
          !!item.tapped ||
          !!definition(s, object).entersTapped ||
          !!(
            definition(s, object).entersTappedUnless &&
            !meetsCondition(s, controller, definition(s, object).entersTappedUnless, [], object)
          ),
        entries: entering.map(({ object, ...rest }) => ({ ...rest, object: ref(object) })),
        typeChoices,
        auraChoices,
        lifeChoices,
      };
      return false;
    }
    if (definition(s, object).chooseCreatureType && !typeChoices[object.id]) {
      s.choice = {
        kind: 'creatureType',
        player: controller,
        card: object.id,
        entries: entering.map(({ object, ...rest }) => ({ ...rest, object: ref(object) })),
        typeChoices,
        auraChoices,
        lifeChoices,
        types: CREATURE_TYPES,
      };
      return false;
    }
    if (!definition(s, object).aura) {
      ready.push(item);
      continue;
    }
    const attachment = item.attachment ?? auraChoices[object.id];
    if (attachment) {
      const target = s.objects[attachment.id];
      if (
        target?.incarnation === attachment.incarnation &&
        legalAuraAttachment(s, object, target, controller)
      )
        ready.push({ ...item, attachment });
      else if (object.zone === 'stack') move(s, object, 'graveyard');
      continue;
    }
    const targets = battlefield(s)
      .filter((target) => legalAuraAttachment(s, object, target, controller))
      .map(ref);
    if (!targets.length) {
      if (object.zone === 'stack') move(s, object, 'graveyard');
      continue;
    }
    s.choice = {
      kind: 'auraEntry',
      player: controller,
      card: object.id,
      cards: targets.map((t) => t.id),
      targets,
      entries: entering.map(({ object, ...rest }) => ({ ...rest, object: ref(object) })),
      typeChoices,
      auraChoices,
      lifeChoices,
    };
    return false;
  }
  entering = ready;
  const tappedReplacements = new Map(
    entering.map(({ object, controller = object.owner }) => [
      object.id,
      !!definition(s, object).entersTapped ||
        (!!definition(s, object).entryLifePayment && !lifeChoices[object.id]) ||
        (definition(s, object).entersTappedUnless &&
          !meetsCondition(s, controller, definition(s, object).entersTappedUnless, [], object)),
    ]),
  );
  const castValues = new Map(
    entering.map(({ object }) => [object.id, object.zone === 'stack' ? (object.chosenX ?? 0) : 0]),
  );
  const castPlayers = new Map(
    entering.map(({ object }) => [
      object.id,
      object.zone === 'stack' ? object.castPlayer : undefined,
    ]),
  );
  const entryCounters = new Map(
    entering.map(({ object, controller = object.owner, enchantmentOnly }) => [
      object.id,
      battlefield(s).reduce((n, source) => {
        const bonus = definition(s, source).entryCounterBonus;
        return (
          n +
          (bonus &&
          source.controller === controller &&
          source.id !== object.id &&
          !enchantmentOnly &&
          hasType(definition(s, object), 'creature') &&
          meetsCondition(s, controller, bonus.condition, [], source)
            ? bonus.amount
            : 0)
        );
      }, 0),
    ]),
  );
  // Role Auras attached in one entry batch have simultaneous timestamps (CR 303.7a, 613.7m).
  const roleTimestamp = entering.some(
    ({ object, attachment }) => attachment && definition(s, object).subtypes.includes('Role'),
  )
    ? layerTimestamp(s)
    : null;
  for (const {
    object,
    controller = object.owner,
    attachment = null,
    tapped = false,
    attacking = false,
    enchantmentOnly = false,
    defender,
  } of entering) {
    const warped = object.zone === 'stack' && object.warpPaid;
    move(s, object, 'battlefield');
    object.controller = controller;
    if (enchantmentOnly)
      addModifier(s, {
        objectId: object.id,
        incarnation: object.incarnation,
        enchantmentOnly: true,
        permanent: true,
      });
    // CR 702.185a / 608.3: resolving the warped permanent spell creates this delay.
    // It survives control changes and ability loss, but refers to this incarnation only.
    if (warped) {
      s.delayedTriggers ??= [];
      s.delayedTriggers.push({
        kind: 'ability',
        name: object.name,
        controller,
        source: ref(object),
        sourceDefinition: structuredClone(definition(s, object)),
        sourceKeywords: [...keywords(s, object)],
        effects: [],
        rule: 'warpExile',
        label: `${object.name} · warp`,
      });
    }
    if (typeChoices[object.id]) {
      if (definition(s, object).chooseBasicLandType)
        object.chosenBasicLandType = typeChoices[object.id];
      else object.chosenCreatureType = typeChoices[object.id];
    }
    object.attachedTo = attachment;
    if (attachment && definition(s, object).subtypes.includes('Role'))
      object.roleTimestamp = roleTimestamp;
    // Entry counters are a replacement, not a triggered effect. move() clears the
    // spell's chosenX, so use its pre-move snapshot (zero for nonstack entry).
    // This runs before entry observers and state-based actions see the permanent.
    object.plusCounters +=
      (entryCounters.get(object.id) ?? 0) +
      (definition(s, object).entryPlusCounters?.kind === 'x'
        ? castValues.get(object.id)
        : (definition(s, object).entryPlusCounters ?? 0));
    if (definition(s, object).entryKeywordCounters) {
      object.keywordCounters = {};
      object.keywordCounterTimestamps = {};
      const timestamp = layerTimestamp(s);
      for (const keyword of definition(s, object).entryKeywordCounters) {
        object.keywordCounters[keyword] = (object.keywordCounters[keyword] ?? 0) + 1;
        object.keywordCounterTimestamps[keyword] = timestamp;
      }
    }
    if (definition(s, object).entryStunCounters)
      object.stunCounters = definition(s, object).entryStunCounters;
    object.tapped = !!tappedReplacements.get(object.id) || tapped;
    // Entering attacking is not declaring an attacker and causes no attack event.
    if (
      attacking &&
      hasType(definition(s, object), 'creature') &&
      (!defender ||
        attackDefenders(s, controller).some(
          (target) =>
            target.kind === defender.kind &&
            target.id === defender.id &&
            (target.kind !== 'object' || target.incarnation === defender.incarnation),
        )) &&
      controller === s.active &&
      ['beginCombat', 'attackers', 'blockers', 'firstDamage', 'damage', 'endCombat'].includes(
        s.step,
      )
    ) {
      s.combat.attackers.push(ref(object));
      if (defender) (s.combat.defenders ??= {})[object.id] = structuredClone(defender);
    }
  }
  for (const { object } of entering)
    if (definition(s, object).entersPrepared) preparePermanent(s, object);
  // All simultaneous entrants exist before any chapter/entry triggers are collected.
  for (const { object } of entering)
    if (definition(s, object).subtypes?.includes('Saga')) addLoreCounters(s, object);
  for (const { object } of entering) {
    const d = definition(s, object);
    if (d.etb && !entryTriggersSuppressed(s, object)) {
      const start = s.pendingTriggers.length;
      queueEntryTrigger(s, object, d.etb, `${object.name} · enters`);
      for (const queued of s.pendingTriggers.slice(start)) queued.x = castValues.get(object.id);
    }
    notifyTriggers(s, 'enters', {
      object,
      castPlayer: castPlayers.get(object.id),
      x: castValues.get(object.id),
    });
  }
  notifyEntryGroup(
    s,
    entering.map(({ object }) => object),
  );
  // A token instruction's temporary keywords are granted after the tokens enter,
  // but before continuing resolution. Keep them across any paused entry choices.
  for (const { object, temporaryKeywords } of entering)
    if (temporaryKeywords?.length)
      addModifier(s, {
        objectId: object.id,
        incarnation: object.incarnation,
        power: 0,
        toughness: 0,
        keywords: [...temporaryKeywords],
        expires: s.turn,
      });
  // Run after the entire entry batch and its ETB observations, never before entry
  // choices. This ref is captured from the object that actually entered (CR 400.7).
  for (const { object, attachedToken, tokenController } of entering)
    if (attachedToken) createAttachedToken(s, attachedToken, tokenController, ref(object));
  return true;
}
export function finishCreatureTypeChoice(s, command) {
  const choice = s.choice;
  requireRule(
    choice.kind === 'landType'
      ? command.type === 'chooseLandType' && choice.types.includes(command.landType)
      : command.type === 'chooseCreatureType' && CREATURE_TYPES.includes(command.creatureType),
    'CREATURE_TYPE',
    'Choose a valid creature type.',
  );
  const choices = {
    ...choice.typeChoices,
    [choice.card]: choice.kind === 'landType' ? command.landType : command.creatureType,
  };
  const entries = choice.entries.map(({ object, ...rest }) => ({
    ...rest,
    object: s.objects[object.id],
  }));
  s.choice = null;
  if (
    enterBattlefieldBatch(
      s,
      entries,
      choices,
      choice.auraChoices ?? {},
      choice.lifeChoices ?? {},
    ) !== false &&
    s.resolving
  )
    continueResolution(s);
}
export function finishEntryLifeChoice(s, command) {
  const choice = s.choice;
  requireRule(
    command.type === 'payEntryLife' && typeof command.pay === 'boolean',
    'ENTRY_LIFE',
    'Choose whether to pay life.',
  );
  requireRule(
    !command.pay || s.players[choice.player].life >= choice.amount,
    'ENTRY_LIFE',
    'You cannot pay that much life.',
  );
  if (command.pay) {
    loseLife(s, choice.player, choice.amount);
    emit(s, 'lifePaid', { player: choice.player, amount: choice.amount, objectId: choice.card });
  }
  const entries = choice.entries.map(({ object, ...rest }) => ({
    ...rest,
    object: s.objects[object.id],
  }));
  const lifeChoices = { ...choice.lifeChoices, [choice.card]: command.pay };
  s.choice = null;
  if (
    enterBattlefieldBatch(s, entries, choice.typeChoices, choice.auraChoices, lifeChoices) !==
      false &&
    s.resolving
  )
    continueResolution(s);
}
export function finishAuraEntryChoice(s, command) {
  const choice = s.choice;
  const target = choice.targets.find((t) => t.id === command.card);
  const aura = s.objects[choice.card],
    object = target && s.objects[target.id];
  requireRule(
    command.type === 'chooseAuraAttachment' &&
      target &&
      object?.incarnation === target.incarnation &&
      legalAuraAttachment(s, aura, object, choice.player),
    'AURA_ATTACHMENT',
    'Choose a legal permanent for this Aura to enchant.',
  );
  const entries = choice.entries.map(({ object, ...rest }) => ({
    ...rest,
    object: s.objects[object.id],
  }));
  s.choice = null;
  const selections = { ...choice.auraChoices, [aura.id]: target };
  if (
    enterBattlefieldBatch(s, entries, choice.typeChoices, selections, choice.lifeChoices ?? {}) !==
      false &&
    s.resolving
  )
    continueResolution(s);
}
/** Damage is marked before state-based actions. Caller batches combat packets. */
// All prevention implementations must consult this global turn rule before preventing damage.
export function damageCanBePrevented(s) {
  return (
    s.damagePreventionDisabledTurn !== s.turn &&
    !battlefield(s).some((o) => definition(s, o).cantPreventDamage)
  );
}
export function canGainLife(s) {
  return !battlefield(s).some((o) => definition(s, o).cantGainLife);
}
export function dealDamage(
  s,
  source,
  target,
  amount,
  combat = false,
  lifeGains = null,
  combatEvents = null,
) {
  if (amount <= 0) return;
  const sourceObject = s.objects[source.id];
  const sourceDefinition = source.definition ?? (sourceObject ? definition(s, sourceObject) : null);
  for (const watcher of battlefield(s)) {
    const bonus = definition(s, watcher).damageBonus;
    if (
      bonus &&
      watcher.controller === source.controller &&
      matchesFilter({ definition: sourceDefinition }, bonus.where, watcher.controller)
    )
      amount += bonus.amount;
  }
  if (target.kind === 'player') loseLife(s, target.id, amount);
  else {
    const o = s.objects[target.id];
    if (!o || o.zone !== 'battlefield' || o.incarnation !== target.incarnation) return;
    const d = definition(s, o);
    if (!hasType(d, 'creature') && !hasType(d, 'planeswalker')) return;
    if (hasType(d, 'planeswalker')) o.loyalty = Math.max(0, (o.loyalty ?? 0) - amount);
    if (hasType(d, 'creature')) {
      o.damage += amount;
      if (source.keywords?.includes('deathtouch')) o.deathtouchDamage = true;
    }
  }
  const gainsLife = source.keywords?.includes('lifelink') && canGainLife(s);
  if (gainsLife) {
    s.players[source.controller].life += amount;
    if (lifeGains) {
      const key = `${source.id}:${source.incarnation ?? 0}:${source.controller}`;
      const gain = lifeGains.get(key) ?? { player: source.controller, amount: 0 };
      gain.amount += amount;
      lifeGains.set(key, gain);
    }
  }
  emit(s, 'damage', { source: source.id, target, amount, controller: source.controller });
  if (gainsLife && !lifeGains) notifyTriggers(s, 'lifeGain', { player: source.controller, amount });
  if (!combat && target.kind === 'player')
    notifyTriggers(s, 'noncombatDamageToPlayer', { player: target.id });
  if (combat && target.kind === 'player' && sourceObject) {
    const payload = {
      object: sourceObject,
      definition: sourceDefinition,
      amount,
      damagedPlayer: target.id,
    };
    if (combatEvents) combatEvents.push(payload);
    else notifyTriggers(s, 'combatDamagePlayer', payload);
  }
}
/** CR 119.9 and 702.15e: one gain event per source, not per damage recipient. */
export function dealDamageBatch(s, packets, combat = false) {
  const lifeGains = new Map(),
    combatEvents = [];
  for (const packet of packets)
    dealDamage(s, packet.source, packet.target, packet.amount, combat, lifeGains, combatEvents);
  // All simultaneous damage and life changes precede trigger-condition checks.
  for (const gain of lifeGains.values()) notifyTriggers(s, 'lifeGain', gain);
  for (const payload of combatEvents) notifyTriggers(s, 'combatDamagePlayer', payload);
}
function damageSource(s, entry) {
  if (entry.emblem)
    return { id: entry.source.id, controller: entry.controller, keywords: [], definition: null };
  const source = s.objects[entry.source?.id];
  const current =
    source &&
    source.incarnation === entry.source.incarnation &&
    source.zone === (entry.kind === 'spell' ? 'stack' : 'battlefield');
  return {
    id: entry.source?.id,
    incarnation: entry.source?.incarnation,
    definition: current
      ? definition(s, source)
      : (entry.sourceDefinition ?? cardDefinition(entry.name, s.catalog)),
    controller: current ? source.controller : (entry.sourceController ?? entry.controller),
    keywords: current ? keywords(s, source) : (entry.sourceKeywords ?? []),
  };
}
function copyToken(s, base, controller, exceptions = {}) {
  const copied = structuredClone(base);
  delete copied.frontFaceCost;
  if (exceptions.power !== undefined) {
    copied.power = exceptions.power;
    copied.toughness = exceptions.toughness;
    // CR 707.9d: fixed P/T replaces the characteristic-defining ability itself.
    delete copied.baseStats;
  }
  if (exceptions.nonlegendary) delete copied.legendary;
  if (exceptions.addSubtypes && hasType(copied, 'creature'))
    copied.subtypes = [...new Set([...(copied.subtypes ?? []), ...exceptions.addSubtypes])];
  copied.token = true;
  return addObject(s, copied.name, controller, 'void', copied);
}
// Bind the primary or explicitly grouped target controller before effects move it.
// Conditional branches are scanned only for dependencies, not evaluated early.
function needsTargetController(effects = [], group) {
  return effects.some(
    (effect) =>
      ((effect.player === 'targetController' || effect.op === 'damageTargetController') &&
        effect.targetGroup === group) ||
      (effect.op === 'conditional' &&
        (needsTargetController(effect.then, group) || needsTargetController(effect.else, group))) ||
      (['discardThen', 'behold'].includes(effect.op) &&
        needsTargetController(effect.then, group)) ||
      (effect.op === 'chooseEffect' &&
        effect.options.some((option) => needsTargetController(option.effects, group))),
  );
}
export function resolveEffects(s, entry, startIndex = 0) {
  let effects = entry.effects ?? [];
  for (let index = startIndex; index < effects.length; index++) {
    const e = effectValues(s, effects[index], entry);
    // CR 608.2d: inline alternatives are chosen only as this instruction resolves.
    // The chooser is independent of the effect controller and announced bindings.
    if (e.op === 'chooseEffect') {
      const options = e.options.flatMap((option, optionIndex) =>
        meetsCondition(s, entry.controller, option.condition, [], entry.source, entry)
          ? [{ index: optionIndex, label: option.label }]
          : [],
      );
      if (!options.length) continue;
      s.resolving = { entry, index: index + 1 };
      s.choice = {
        kind: 'effectChoice',
        player: e.player === 'opponent' ? opponent(entry.controller) : entry.controller,
        name: entry.name,
        options,
      };
      return false;
    }
    if (e.op === 'conditional') {
      const branch = meetsCondition(s, entry.controller, e.condition, [], entry.source, entry)
        ? e.then
        : (e.else ?? []);
      // Expand once at this instruction. Pausing children retain the chosen branch.
      effects = [
        ...effects.slice(0, index),
        ...structuredClone(branch),
        ...effects.slice(index + 1),
      ];
      entry.effects = effects;
      index--;
      continue;
    }
    if (e.targetGroup !== undefined) {
      const targets = entry.targets?.[e.targetGroup] ?? [];
      const { targetGroup, ...effect } = e;
      if (e.op === 'damage') {
        const source = damageSource(s, entry);
        dealDamageBatch(
          s,
          targets.map((target) => ({ source, target, amount: e.amount })),
        );
      } else if (e.op === 'tap') {
        tapObjects(
          s,
          targets
            .filter(
              (target) =>
                target.kind === 'object' &&
                s.objects[target.id]?.incarnation === target.incarnation,
            )
            .map((target) => s.objects[target.id]),
        );
      } else if (['destroy', 'bounce', 'moveTarget', 'exileUntilSourceLeaves'].includes(e.op)) {
        const context = captureDepartureContext(s);
        for (const target of targets) {
          const object = s.objects[target.id];
          if (target.kind !== 'object' || object?.incarnation !== target.incarnation) continue;
          const zone = e.op === 'moveTarget' ? ['battlefield', 'graveyard'] : ['battlefield'];
          if (!zone.includes(object.zone)) continue;
          if (e.op === 'destroy' && hasKeyword(s, object, 'indestructible')) continue;
          if (e.op === 'exileUntilSourceLeaves') {
            exileUntilSourceLeaves(s, entry, target, context);
            continue;
          }
          move(
            s,
            object,
            e.op === 'destroy' ? 'graveyard' : e.op === 'bounce' ? 'hand' : e.destination,
            context,
          );
          if (e.trackSource) trackExiledCard(s, entry.source, object);
        }
        finishDepartureBatch(s, context);
      } else {
        for (const [targetIndex, target] of targets.entries()) {
          if (
            resolveEffects(s, {
              ...entry,
              target,
              ...(e.op === 'damageTargetController'
                ? { targetController: entry.targetControllers?.[targetGroup] }
                : {}),
              effects: [effect],
            }) === false
          ) {
            // Retain each target's binding across a child decision, then restore
            // the parent binding. Appending effects to the child loses later
            // targets and can accidentally rebind later parent instructions.
            let resume = { entry, index: index + 1 };
            for (let j = targets.length - 1; j > targetIndex; j--)
              resume = {
                entry: { ...entry, target: targets[j], effects: [structuredClone(effect)] },
                index: 0,
                resume,
              };
            s.resolving.resume = resume;
            return false;
          }
        }
      }
      if (flushLinkedReturns(s) === false) {
        s.resolving = { entry, index: index + 1 };
        return false;
      }
      continue;
    }
    if (e.op === 'fight' || e.op === 'bite') {
      const currentPermanent = (target) => {
        const object = target?.kind === 'object' && s.objects[target.id];
        return object?.zone === 'battlefield' && object.incarnation === target.incarnation
          ? object
          : null;
      };
      const actorRef = e.source === 'source' ? entry.source : entry.targets?.[e.sourceGroup]?.[0];
      const actor = currentPermanent(actorRef);
      // A fight requires both current creatures (CR 701.14b). A nontargeted
      // bite source instead uses its last battlefield information (CR 608.2h).
      if (
        (!actor || !hasType(definition(s, actor), 'creature')) &&
        (e.op === 'fight' || e.source !== 'source')
      )
        continue;
      const source = (object) => ({
        ...ref(object),
        controller: object.controller,
        definition: definition(s, object),
        keywords: keywords(s, object),
      });
      const actorSource = actor ? source(actor) : damageSource(s, entry);
      const power = Math.max(0, actor ? stats(s, actor).power : (entry.sourceStats?.power ?? 0));
      const packets = [];
      for (const target of entry.targets?.[e.victimGroup] ?? []) {
        const victim = currentPermanent(target);
        if (
          !victim ||
          !(e.op === 'fight'
            ? hasType(definition(s, victim), 'creature')
            : ['creature', 'planeswalker'].some((type) => hasType(definition(s, victim), type)))
        )
          continue;
        if (e.op === 'fight' && victim.id === actor.id) {
          packets.push({ source: actorSource, target: ref(actor), amount: power * 2 });
          continue;
        }
        packets.push({ source: actorSource, target: ref(victim), amount: power });
        if (e.op === 'fight')
          packets.push({
            source: source(victim),
            target: ref(actor),
            amount: Math.max(0, stats(s, victim).power),
          });
      }
      dealDamageBatch(s, packets);
      continue;
    }
    const recipient =
      e.player === 'target'
        ? entry.target?.id
        : e.player === 'opponent'
          ? opponent(entry.controller)
          : entry.controller;
    const sourceObject = s.objects[entry.source?.id];
    const sourceAttachment =
      sourceObject?.zone === 'battlefield' && sourceObject.incarnation === entry.source?.incarnation
        ? sourceObject.attachedTo
        : entry.sourceAttachment;
    const target =
      e.subject === 'eventSource'
        ? entry.eventSource
        : e.subject === 'source'
          ? entry.source
          : e.subject === 'attached'
            ? sourceAttachment
            : entry.target;
    const candidate = target?.kind === 'object' ? s.objects[target.id] : null;
    const o =
      candidate?.zone === 'battlefield' && candidate.incarnation === target.incarnation
        ? candidate
        : null;
    switch (e.op) {
      case 'setClassLevel': {
        const source = s.objects[entry.source?.id];
        if (source?.zone !== 'battlefield' || source.incarnation !== entry.source.incarnation)
          break;
        const previous = source.classLevel ?? 1;
        source.classLevel = e.level;
        if (previous !== e.level) {
          emit(s, 'classLevel', { objectId: source.id, player: source.controller, level: e.level });
          notifyTriggers(s, 'classLevel', { object: source, classLevel: e.level });
        }
        break;
      }
      case 'moveLinkedExileToGraveyard': {
        const links = (s.linkedExiles ?? []).filter(
          (link) =>
            link.source.id === entry.source?.id &&
            link.source.incarnation === entry.source.incarnation,
        );
        const cards = links
          .flatMap((link) => link.cards)
          .map((r) => {
            const o = s.objects[r.id];
            return o && !o.token && o.zone === 'exile' && o.incarnation === r.incarnation
              ? o
              : null;
          })
          .filter(Boolean);
        s.linkedExiles = (s.linkedExiles ?? []).filter((link) => !links.includes(link));
        entry.movedCount = 0;
        for (const object of cards) {
          move(s, object, 'graveyard');
          if (object.zone === 'graveyard') entry.movedCount++;
        }
        break;
      }
      case 'endTurn':
        endTurn(s, entry);
        return false;
      case 'chooseLandName':
        s.resolving = { entry, index: index + 1 };
        s.choice = {
          kind: 'landName',
          player: entry.controller,
          card: entry.source.id,
          names: [
            ...new Set([
              ...LAND_CARD_NAMES,
              ...Object.values(s.catalog)
                .filter((d) => hasType(d, 'land') && !d.token)
                .map((d) => d.name),
            ]),
          ].sort(),
        };
        return false;
      case 'damageTargetController':
        if (entry.targetController !== undefined)
          dealDamage(
            s,
            damageSource(s, entry),
            { kind: 'player', id: entry.targetController },
            e.amount,
          );
        break;
      case 'damageEachPlayer':
        dealDamageBatch(
          s,
          s.players.map((player) => ({
            source: damageSource(s, entry),
            target: { kind: 'player', id: player.id },
            amount: numericValue(s, e.amount, { controller: player.id, source: entry.source }),
          })),
        );
        break;
      case 'damageEventPlayer':
        if (entry.eventSource?.controller !== undefined)
          dealDamage(
            s,
            damageSource(s, entry),
            { kind: 'player', id: entry.eventSource.controller },
            e.amount,
          );
        break;
      case 'exileGraveyards': {
        const players =
          e.players === 'all'
            ? s.players
            : [
                s.players[
                  e.players === 'target'
                    ? entry.target.id
                    : e.players === 'opponent'
                      ? opponent(entry.controller)
                      : entry.controller
                ],
              ];
        for (const id of players.flatMap((player) => [...player.graveyard]))
          move(s, s.objects[id], 'exile');
        break;
      }
      case 'disableDamagePrevention':
        s.damagePreventionDisabledTurn = s.turn;
        emit(s, 'damagePreventionDisabled', { turn: s.turn });
        break;
      case 'bounceAll':
      case 'destroyAll':
      case 'exileAll':
      case 'exileUntilSourceLeavesAll':
      case 'modifyAll':
      case 'damageAll':
      case 'counterAll':
      case 'tapAll':
      case 'untapAll': {
        const objects = e.where
          ? battlefield(s).filter((object) => {
              if (
                e.excludeSource &&
                object.id === entry.source?.id &&
                object.incarnation === entry.source.incarnation
              )
                return false;
              if (e.player !== undefined && object.controller !== recipient) return false;
              const d = definition(s, object),
                pt = stats(s, object);
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
                  keywords: keywords(s, object),
                  ...pt,
                  manaValue: manaValue(d),
                },
                e.where,
                entry.controller,
              );
            })
          : [];
        if (e.op === 'exileUntilSourceLeavesAll') {
          const context = captureDepartureContext(s);
          for (const object of objects) exileUntilSourceLeaves(s, entry, ref(object), context);
        } else if (e.op === 'bounceAll' || e.op === 'destroyAll' || e.op === 'exileAll') {
          const victims = objects.filter(
            (object) => e.op !== 'destroyAll' || !hasKeyword(s, object, 'indestructible'),
          );
          if (e.rememberMovedCount) entry.movedCount = victims.length;
          const context = victims.length ? captureDepartureContext(s) : null;
          for (const object of victims)
            move(
              s,
              object,
              e.op === 'bounceAll' ? 'hand' : e.op === 'exileAll' ? 'exile' : 'graveyard',
              context,
            );
          finishDepartureBatch(s, context);
        } else if (e.op === 'damageAll') {
          const source = damageSource(s, entry);
          const packets = objects.map((object) => ({
            source,
            target: ref(object),
            amount: e.amount,
          }));
          for (const player of s.players)
            if (
              e.players === 'all' ||
              (e.players === 'controller' && player.id === entry.controller) ||
              (e.players === 'opponent' && player.id !== entry.controller)
            )
              packets.push({ source, target: { kind: 'player', id: player.id }, amount: e.amount });
          dealDamageBatch(s, packets);
        } else if (e.op === 'tapAll') tapObjects(s, objects);
        else
          for (const object of objects) {
            if (e.op === 'modifyAll')
              addModifier(s, {
                objectId: object.id,
                incarnation: object.incarnation,
                power: e.power,
                toughness: e.toughness,
                keywords: e.keywords ?? [],
                expires: s.turn,
              });
            else if (e.op === 'counterAll') putStatCounters(object, e);
            else if (e.op === 'untapAll') untapObject(s, object);
            else tapObjects(s, [object]);
          }
        break;
      }
      case 'attachEquipment': {
        const source = s.objects[entry.source?.id];
        if (
          source?.incarnation === entry.source?.incarnation &&
          o &&
          legalEquipmentAttachment(s, source, o)
        ) {
          source.attachedTo = ref(o);
          source.layerTimestamp = layerTimestamp(s);
          emit(s, 'attached', { objectId: source.id, target: ref(o) });
        }
        break;
      }
      case 'wardPayment': {
        const affected = s.stack.find((item) => item.id === entry.relatedStackId);
        if (!affected) break;
        s.resolving = { entry, index: index + 1 };
        s.choice = {
          kind: 'payCost',
          player: affected.controller,
          cost: structuredClone(e.cost),
          stackId: affected.id,
          reason: 'ward',
          payable: !costProblem(s, affected.controller, e.cost),
        };
        return false;
      }
      case 'damage':
        dealDamage(s, damageSource(s, entry), entry.target, e.amount);
        break;
      case 'damageOpponent':
        dealDamage(
          s,
          damageSource(s, entry),
          { kind: 'player', id: opponent(entry.controller) },
          e.amount,
        );
        break;
      case 'keywordCounter':
        if (o) {
          (o.keywordCounters ??= {})[e.keyword] = (o.keywordCounters?.[e.keyword] ?? 0) + e.amount;
          (o.keywordCounterTimestamps ??= {})[e.keyword] = layerTimestamp(s);
        }
        break;
      case 'stunOn':
        if (o) {
          const next = (o.stunCounters ?? 0) + e.amount;
          requireRule(Number.isSafeInteger(next), 'COUNTER_RANGE', 'Too many stun counters.');
          o.stunCounters = next;
        }
        break;
      case 'doubleCounters': {
        const objects = e.where
          ? battlefield(s).filter((object) =>
              matchesFilter(
                {
                  definition: definition(s, object),
                  controller: object.controller,
                  owner: object.owner,
                  token: object.token,
                  tapped: object.tapped,
                  attacking: isAttacking(s, object),
                  blocking: isBlocking(s, object),
                  manaValue: manaValue(definition(s, object)),
                  ...stats(s, object),
                  keywords: keywords(s, object),
                },
                e.where,
                entry.controller,
              ),
            )
          : o
            ? [o]
            : [];
        for (const object of objects) {
          const next = object.plusCounters * 2;
          requireRule(Number.isSafeInteger(next), 'COUNTER_RANGE', 'Too many counters.');
          object.plusCounters = next;
        }
        break;
      }
      case 'doublePower':
        if (o)
          addModifier(s, {
            objectId: o.id,
            incarnation: o.incarnation,
            power: stats(s, o).power,
            toughness: 0,
            keywords: [],
            expires: s.turn,
          });
        break;
      case 'distributedCounters':
        if (o) o.plusCounters += entry.distribution?.[target.id] ?? 0;
        break;
      case 'counterOn':
        if (o) putStatCounters(o, e);
        break;
      case 'prepare':
        if (o) preparePermanent(s, o);
        break;
      case 'unprepare':
        if (o) unpreparePermanent(s, o);
        break;
      case 'tap':
      case 'untap':
        if (o) {
          if (e.op === 'untap') untapObject(s, o);
          else tapObjects(s, [o]);
        }
        break;
      case 'impulseChoose': {
        const cards = s.players[entry.controller].library.slice(0, e.count);
        for (const id of cards) move(s, s.objects[id], 'exile');
        if (!cards.length) break;
        s.resolving = { entry, index: index + 1 };
        s.choice = { kind: 'exilePlay', player: entry.controller, cards };
        return false;
      }
      case 'revealDiscard':
      case 'bindingNegotiation': {
        s.resolving = { entry, index: index + 1, revealedPlayer: entry.target.id };
        s.choice = {
          kind: e.op,
          player: entry.controller,
          ...(e.op === 'revealDiscard'
            ? {
                eligibleCards: s.players[entry.target.id].hand.filter((id) => {
                  const d = definition(s, s.objects[id]);
                  return (
                    !hasType(d, 'land') &&
                    matchesFilter({ definition: d }, e.where, entry.controller)
                  );
                }),
              }
            : {}),
          cards: [...s.players[entry.target.id].hand],
          targetPlayer: entry.target.id,
        };
        return false;
      }
      case 'explore': {
        // Explore: a specified source still explores using its last controller
        // after leaving; a targeted creature must remain legal at resolution.
        if (!o && e.subject !== 'source') break;
        const player = o?.controller ?? damageSource(s, entry).controller;
        const id = s.players[player].library[0];
        const card = id ? s.objects[id] : null;
        const land = card && hasType(definition(s, card), 'land');
        emit(s, 'exploreRevealed', {
          player,
          creature: o?.name ?? entry.name,
          ...(card ? { revealed: card.name } : {}),
        });
        if (land) {
          move(s, card, 'hand');
          break;
        }
        if (o) o.plusCounters += 1;
        if (!card) break;
        s.resolving = { entry, index: index + 1 };
        s.choice = { kind: 'libraryOrder', player, action: 'explore', cards: [id], revealed: true };
        return false;
      }
      case 'lookChooseHand':
      case 'scry':
      case 'surveil': {
        if (e.count === 0) break;
        const cards = s.players[recipient].library.slice(0, e.count);
        if (!cards.length) {
          emit(s, e.op, { player: recipient, requested: e.count, looked: 0 });
          break;
        }
        const legal =
          e.op === 'lookChooseHand' && e.where !== undefined
            ? new Set(searchableCards(s, recipient, e.where, entry.controller))
            : null;
        const eligibleCards = legal ? cards.filter((id) => legal.has(id)) : cards;
        if (e.revealAll)
          emit(s, 'libraryRevealed', {
            player: recipient,
            revealed: cards.map((id) => s.objects[id].name),
          });
        s.resolving = { entry, index: index + 1 };
        s.choice = {
          kind: 'libraryOrder',
          player: recipient,
          action: e.op,
          cards,
          ...(e.op === 'lookChooseHand'
            ? {
                selectCount: Math.min(e.selectCount ?? 1, eligibleCards.length),
                restOrder: e.restOrder ?? 'chosen',
                ...(e.where !== undefined ? { eligibleCards } : {}),
                ...(e.optional ? { optional: true } : {}),
                ...(e.reveal ? { reveal: true } : {}),
                ...(e.revealAll ? { revealed: true } : {}),
                ...(e.restDestination ? { restDestination: e.restDestination } : {}),
              }
            : {}),
        };
        return false;
      }
      case 'removeCounterTrigger': {
        const source = s.objects[entry.source?.id];
        if (source?.zone !== 'battlefield' || source.incarnation !== entry.source.incarnation)
          break;
        s.resolving = { entry, index: index + 1 };
        s.choice = {
          kind: 'removeCounter',
          player: entry.controller,
          source: ref(source),
          counters: counterKinds(source),
          reflexive: structuredClone(e),
        };
        return false;
      }
      case 'fightAttached': {
        const actor = sourceAttachment?.kind === 'object' && s.objects[sourceAttachment.id];
        if (
          actor?.zone !== 'battlefield' ||
          actor.incarnation !== sourceAttachment.incarnation ||
          !hasType(definition(s, actor), 'creature') ||
          !o ||
          !hasType(definition(s, o), 'creature')
        )
          break;
        const damageSource = (object) => ({
          ...ref(object),
          controller: object.controller,
          definition: definition(s, object),
          keywords: keywords(s, object),
        });
        dealDamageBatch(s, [
          {
            source: damageSource(actor),
            target: ref(o),
            amount: Math.max(0, stats(s, actor).power),
          },
          { source: damageSource(o), target: ref(actor), amount: Math.max(0, stats(s, o).power) },
        ]);
        break;
      }
      case 'untapSearched':
        for (const r of entry.searchedObjects ?? []) {
          const found = s.objects[r.id];
          if (found?.zone === 'battlefield' && found.incarnation === r.incarnation)
            untapObject(s, found);
        }
        break;
      case 'behold': {
        const cards = Object.values(s.objects)
          .filter(
            (object) =>
              ((object.zone === 'battlefield' && object.controller === entry.controller) ||
                (object.zone === 'hand' && object.owner === entry.controller)) &&
              matchesFilter(
                { definition: definition(s, object) },
                { subtype: e.subtype },
                entry.controller,
              ),
          )
          .map((o) => o.id);
        s.resolving = { entry, index: index + 1 };
        s.choice = {
          kind: 'behold',
          player: entry.controller,
          cards,
          subtype: e.subtype,
          then: structuredClone(e.then),
        };
        return false;
      }
      case 'searchLibrary': {
        const player = e.player === 'targetController' ? entry.targetController : recipient;
        if (player !== 0 && player !== 1) break;
        entry.searchedObjects = [];
        const count = e.countFrom === 'moved' ? (entry.movedCount ?? 0) : e.count;
        const cards = searchableCards(s, player, e.where);
        s.resolving = { entry, index: index + 1 };
        s.choice = {
          kind: 'librarySearch',
          player,
          cards,
          min: e.where || e.optional ? 0 : Math.min(count, cards.length),
          max: Math.min(count, cards.length),
          ...(e.optional ? { optional: true } : {}),
          destination: e.destination,
          tapped: !!e.tapped,
          reveal: !!e.reveal,
          where: e.where ? structuredClone(e.where) : null,
        };
        return false;
      }
      case 'grantDeathReturn':
        if (o)
          addModifier(s, {
            objectId: o.id,
            incarnation: o.incarnation,
            expires: s.turn,
            deathReturn: { attachedToken: e.attachedToken, tapped: !!e.tapped },
          });
        break;
      case 'returnDepartedSource': {
        const source = s.objects[entry.departedSource?.id];
        if (
          source?.zone === 'graveyard' &&
          !source.token &&
          source.incarnation === entry.departedSource.incarnation &&
          enterBattlefield(s, source, source.owner, null, {
            tapped: e.tapped,
            attachedToken: e.attachedToken,
            tokenController: entry.controller,
          }) === false
        ) {
          s.resolving = { entry, index: index + 1 };
          return false;
        }
        break;
      }
      case 'returnSelfAsEnchantment': {
        const source = s.objects[entry.departedSource?.id];
        if (
          source?.zone === 'graveyard' &&
          !source.token &&
          source.incarnation === entry.departedSource.incarnation
        )
          enterBattlefield(s, source, source.owner, null, { enchantmentOnly: true });
        break;
      }
      case 'shuffleSourceAndTarget': {
        const source = s.objects[entry.source?.id];
        const objects = [
          ...new Map(
            [
              ...(o ? [o] : []),
              ...(source?.zone === 'battlefield' && source.incarnation === entry.source.incarnation
                ? [source]
                : []),
            ].map((object) => [object.id, object]),
          ).values(),
        ];
        const owners = new Set(objects.map((object) => object.owner));
        const context = captureDepartureContext(s);
        for (const object of objects) move(s, object, 'library', context);
        for (const owner of owners) {
          shuffle(s, s.players[owner].library);
          emit(s, 'libraryShuffled', { player: owner });
        }
        break;
      }
      case 'sacrificeSelf': {
        const source = s.objects[entry.source?.id];
        if (
          source?.zone === 'battlefield' &&
          source.incarnation === entry.source.incarnation &&
          source.controller === entry.controller
        ) {
          sacrificePermanents(s, [source]);
        }
        break;
      }
      case 'chooseExile':
      case 'sacrifice': {
        // CR 101.4: every player chooses in APNAP order before any departure.
        const players = e.player === 'all' ? [s.active, opponent(s.active)] : [recipient];
        const choices = players
          .map((player) => {
            const objects = battlefield(s).filter((object) => {
              if (object.controller !== player) return false;
              const d = definition(s, object);
              return (
                !e.where ||
                matchesFilter(
                  {
                    definition: d,
                    controller: object.controller,
                    owner: object.owner,
                    token: object.token,
                    tapped: object.tapped,
                    stunCounters: object.stunCounters ?? 0,
                    attacking: isAttacking(s, object),
                    blocking: isBlocking(s, object),
                    keywords: keywords(s, object),
                    ...stats(s, object),
                    manaValue: manaValue(d),
                  },
                  e.where,
                  entry.controller,
                )
              );
            });
            return {
              player,
              cards: objects.map((o) => o.id),
              refs: objects.map(ref),
              count: Math.min(e.count, objects.length),
            };
          })
          .filter((choice) => choice.count);
        if (!choices.length) break;
        const [first, ...remaining] = choices;
        s.resolving = { entry, index: index + 1 };
        s.choice = {
          kind: 'sacrifice',
          ...first,
          remaining,
          selected: [],
          ...(e.op === 'chooseExile' ? { destination: 'exile' } : {}),
        };
        return false;
      }
      case 'connive': {
        // CR 701 (Connive), 608.2h, 400.7 (rules profile 2026-09-25): the creature's current/last controller draws
        // and discards even if the specified nontargeted creature has left.
        if (!o && !['source', 'eventSource'].includes(e.subject)) break;
        const player =
          o?.controller ??
          (e.subject === 'eventSource'
            ? entry.eventSource?.controller
            : damageSource(s, entry).controller);
        if (player === undefined) break;
        draw(s, player, 1);
        if (!s.players[player].hand.length) break;
        s.resolving = { entry, index: index + 1 };
        s.choice = {
          kind: 'discardEffect',
          player,
          count: 1,
          conniving: structuredClone(target),
        };
        return false;
      }
      case 'discardThen':
      case 'optionalDiscardDraw':
      case 'discardTrigger':
      case 'discard': {
        const count = Math.min(
          e.op === 'optionalDiscardDraw' ? 1 : e.count,
          s.players[recipient].hand.length,
        );
        if (!count || (e.op === 'discardThen' && e.optional && count < e.count)) break;
        s.resolving = { entry, index: index + 1 };
        s.choice = {
          kind: 'discardEffect',
          player: recipient,
          count,
          ...(e.op === 'optionalDiscardDraw' ? { optional: true, drawOnDiscard: 1 } : {}),
          ...(e.op === 'discardTrigger' ? { reflexive: structuredClone(e) } : {}),
          ...(e.op === 'discardThen'
            ? { continuation: structuredClone(e), optional: e.optional ?? false }
            : {}),
        };
        return false;
      }
      case 'mill': {
        const player =
          e.player === 'target'
            ? entry.target.id
            : e.player === 'opponent'
              ? opponent(entry.controller)
              : entry.controller;
        const cards = s.players[player].library.slice(0, e.count);
        for (const id of cards) move(s, s.objects[id], 'graveyard');
        emit(s, 'mill', { player, count: cards.length, requested: e.count });
        break;
      }
      case 'copyToken': {
        const bound = e.subject === 'source' ? entry.source : entry.target;
        const source = bound?.kind === 'object' && s.objects[bound.id];
        const base =
          source?.zone === 'battlefield' && source.incarnation === bound.incarnation
            ? copiableDefinition(s, source)
            : e.subject === 'source'
              ? entry.sourceCopyDefinition
              : null;
        if (!base) break;
        const entries = Array.from({ length: e.count }, () => ({
          object: copyToken(s, base, entry.controller, e.exceptions),
          controller: entry.controller,
        }));
        if (enterBattlefieldBatch(s, entries) === false) {
          s.resolving = { entry, index: index + 1 };
          return false;
        }
        break;
      }
      case 'offspringCopy': {
        const source = s.objects[entry.source.id];
        const base =
          source?.zone === 'battlefield' && source.incarnation === entry.source.incarnation
            ? copiableDefinition(s, source)
            : entry.sourceCopyDefinition;
        if (!base) break;
        const token = copyToken(s, base, entry.controller, { power: 1, toughness: 1 });
        if (enterBattlefield(s, token, entry.controller) === false) {
          s.resolving = { entry, index: index + 1 };
          return false;
        }
        break;
      }
      case 'ninjutsuEnter': {
        const object = s.objects[entry.source?.id];
        if (object?.zone === 'hand' && object.incarnation === entry.source.incarnation)
          enterBattlefieldBatch(s, [
            {
              object,
              controller: entry.controller,
              tapped: true,
              attacking: true,
              defender: e.defender,
            },
          ]);
        break;
      }
      case 'anthemEmblem': {
        const emblem = {
          id: `emblem${++s.nextId}`,
          kind: 'anthem',
          controller: entry.controller,
          name: `${entry.name} emblem`,
          where: structuredClone(e.where),
          power: e.power,
          toughness: e.toughness,
        };
        (s.emblems ??= []).push(emblem);
        emit(s, 'emblemCreated', { ...emblem });
        break;
      }
      case 'castDamageEmblem': {
        const emblem = {
          id: `emblem${++s.nextId}`,
          controller: entry.controller,
          name: `${entry.name} emblem`,
          amount: e.amount,
        };
        (s.emblems ??= []).push(emblem);
        emit(s, 'emblemCreated', { ...emblem });
        break;
      }
      case 'discover': {
        // Discover exiles publicly, one at a time. It never draws or searches.
        const player = entry.controller,
          exiled = [];
        let found = null;
        while (s.players[player].library.length) {
          const object = s.objects[s.players[player].library[0]];
          move(s, object, 'exile');
          const card = definition(s, object);
          if (!hasType(card, 'land') && manaValue(card) <= e.amount) {
            found = object;
            break;
          }
          exiled.push(ref(object));
        }
        if (!found) {
          bottomDiscoveredRemainder(s, exiled);
          emit(s, 'discovered', { player, amount: e.amount, objectId: null });
          break;
        }
        s.resolving = {
          entry,
          index: index + 1,
          discover: { exiled, amount: e.amount, card: ref(found) },
        };
        s.choice = {
          kind: 'castExiled',
          player,
          card: found.id,
          incarnation: found.incarnation,
          discover: e.amount,
        };
        return false;
      }
      case 'impulseCastOrDamage': {
        const id = s.players[entry.controller].library[0];
        if (!id) {
          dealDamage(
            s,
            damageSource(s, entry),
            { kind: 'player', id: opponent(entry.controller) },
            e.amount,
          );
          break;
        }
        const card = s.objects[id];
        move(s, card, 'exile');
        s.resolving = { entry, index: index + 1 };
        s.choice = {
          kind: 'castExiled',
          player: entry.controller,
          card: id,
          incarnation: card.incarnation,
          amount: e.amount,
        };
        return false;
      }
      case 'exileTop': {
        const player = e.player === 'target' ? entry.target.id : entry.controller;
        const cards = s.players[player].library.slice(0, e.count);
        for (const id of cards) {
          const object = s.objects[id];
          move(s, object, 'exile');
          object.playPermission = {
            player: entry.controller,
            turn: s.turn,
            incarnation: object.incarnation,
            ...(e.castOnly ? { castOnly: true } : {}),
            ...(e.anyMana ? { anyMana: true } : {}),
            ...(e.duration === 'nextTurn'
              ? { untilNextTurn: entry.controller, nextTurnStarted: false }
              : {}),
          };
        }
        break;
      }
      case 'returnTransformed': {
        const object = s.objects[entry.source.id];
        if (
          !object ||
          object.zone !== 'battlefield' ||
          object.incarnation !== entry.source.incarnation ||
          !definition(s, object).backFace
        )
          break;
        move(s, object, 'exile');
        if (object.token || !cardDefinition(object.name, s.catalog).backFace) break;
        object.transformed = true;
        if (enterBattlefield(s, object, entry.controller) === false) {
          s.resolving = { entry, index: index + 1 };
          return false;
        }
        break;
      }
      case 'chooseMana':
        s.resolving = { entry, index: index + 1 };
        s.choice = { kind: 'manaColor', player: entry.controller, card: entry.source.id };
        return false;
      case 'combatMana':
        for (let n = 0; n < e.count; n++)
          (s.players[entry.controller].restrictedMana ??= []).push({
            color: 'R',
            duration: 'combat',
          });
        break;
      case 'addMana':
        for (const [color, amount] of Object.entries(e.mana))
          s.players[entry.controller].mana[color] += amount;
        break;
      case 'damageEventPowerOpponent':
      case 'damageEventOpponent': {
        const bound = entry.eventSource;
        const current = bound && s.objects[bound.id];
        if (bound)
          dealDamage(
            s,
            current?.zone === 'battlefield' && current.incarnation === bound.incarnation
              ? { id: current.id, controller: current.controller, keywords: keywords(s, current) }
              : bound,
            { kind: 'player', id: opponent(entry.controller) },
            e.op === 'damageEventPowerOpponent'
              ? current?.zone === 'battlefield' && current.incarnation === bound.incarnation
                ? stats(s, current).power
                : bound.power
              : e.amount,
          );
        break;
      }
      case 'draw':
        draw(s, recipient, e.count);
        break;
      case 'gainLife':
        if (e.amount > 0 && canGainLife(s)) {
          s.players[recipient].life += e.amount;
          emit(s, 'lifeGain', { player: recipient, amount: e.amount });
          notifyTriggers(s, 'lifeGain', { player: recipient, amount: e.amount });
        }
        break;
      case 'loseLife':
        loseLife(s, recipient, e.amount);
        emit(s, 'lifeLost', { player: recipient, amount: e.amount });
        break;
      case 'delayedBlink': {
        if (!o) break;
        move(s, o, 'exile');
        // Only this exile incarnation can return; tokens cease to exist off battlefield.
        if (o.zone !== 'exile' || o.token) break;
        (s.delayedTriggers ??= []).push({
          kind: 'ability',
          name: entry.name,
          controller: entry.controller,
          source: { ...entry.source },
          sourceKeywords: [],
          effects: [{ op: 'returnDelayedBlink', controller: e.controller ?? 'owner' }],
          delayedObjects: [ref(o)],
          label: `${entry.name} · return exiled card`,
        });
        break;
      }
      case 'returnDelayedBlink': {
        const entering = (entry.delayedObjects ?? []).flatMap((target) => {
          const object = s.objects[target.id];
          return object?.zone === 'exile' &&
            object.incarnation === target.incarnation &&
            !object.token
            ? [{ object, controller: e.controller === 'you' ? entry.controller : object.owner }]
            : [];
        });
        if (enterBattlefieldBatch(s, entering) === false) {
          s.resolving = { entry, index: index + 1 };
          return false;
        }
        break;
      }
      case 'exileUntilSourceLeaves':
        exileUntilSourceLeaves(s, entry, target);
        break;
      case 'moveTarget':
        if (
          candidate &&
          ['battlefield', 'graveyard'].includes(candidate.zone) &&
          candidate.incarnation === target.incarnation
        ) {
          if (e.destination === 'battlefield') {
            if (
              enterBattlefield(
                s,
                candidate,
                e.controller === 'you' ? entry.controller : candidate.owner,
                null,
                {
                  tapped: e.tapped,
                  attachedToken: e.attachedToken,
                  tokenController: entry.controller,
                },
              ) === false
            ) {
              s.resolving.index = index + 1;
              return false;
            }
          } else {
            move(s, candidate, e.destination);
            if (e.trackSource) trackExiledCard(s, entry.source, candidate);
          }
        }
        break;
      case 'bounce':
        if (o) move(s, o, 'hand');
        break;
      case 'destroy':
        if (o && !hasKeyword(s, o, 'indestructible')) move(s, o, 'graveyard');
        break;
      case 'becomeLand': {
        const source = s.objects[entry.source.id];
        if (source?.zone === 'battlefield' && source.incarnation === entry.source.incarnation) {
          addModifier(s, {
            objectId: source.id,
            incarnation: source.incarnation,
            landForm: { mana: e.mana },
            untilNextTurn: entry.controller,
          });
          // CR 506.4: a permanent that stops being a creature leaves combat,
          // even if another effect animates it again before combat ends.
          removeFromCombat(s, source);
        }
        break;
      }
      case 'keywordCounters':
        for (const object of o ? [o] : []) {
          object.keywordCounters ??= {};
          object.keywordCounterTimestamps ??= {};
          const timestamp = layerTimestamp(s);
          for (const keyword of e.keywords) {
            object.keywordCounters[keyword] = (object.keywordCounters[keyword] ?? 0) + 1;
            object.keywordCounterTimestamps[keyword] = timestamp;
          }
        }
        break;
      case 'earthbend': {
        if (!o || !hasType(definition(s, o), 'land')) break;
        addModifier(s, {
          objectId: o.id,
          incarnation: o.incarnation,
          addTypes: ['creature'],
          animation: { power: 0, toughness: 0, subtypes: [], preserveSubtypes: true },
          keywords: ['haste'],
          permanent: true,
        });
        o.plusCounters += e.amount;
        (s.earthbendReturns ??= []).push({
          object: ref(o),
          kind: 'ability',
          name: entry.name,
          source: structuredClone(entry.source),
          controller: entry.controller,
          effects: [],
          sourceDefinition: entry.sourceDefinition,
          sourceKeywords: [...(entry.sourceKeywords ?? [])],
          label: `${entry.name} · earthbend return`,
        });
        emit(s, 'earthbent', { objectId: o.id, player: entry.controller, amount: e.amount });
        break;
      }
      case 'questCounterTrigger': {
        const source = s.objects[entry.source.id];
        if (source?.zone !== 'battlefield' || source.incarnation !== entry.source.incarnation)
          break;
        source.questCounters = (source.questCounters ?? 0) + 1;
        emit(s, 'questCounters', { objectId: source.id, amount: source.questCounters });
        const condition = { kind: 'sourceQuestCountersAtLeast', count: e.threshold };
        if (meetsCondition(s, entry.controller, condition, [], entry.source)) {
          queueTrigger(
            s,
            { ...source, controller: entry.controller },
            e.effects,
            `${source.name} · quest counter`,
            false,
            e.selector,
          );
          s.pendingTriggers.at(-1).condition = condition;
        }
        break;
      }
      case 'returnEarthbent': {
        const target = entry.delayedObjects?.[0],
          object = s.objects[target?.id];
        if (
          object &&
          ['graveyard', 'exile'].includes(object.zone) &&
          object.incarnation === target.incarnation
        ) {
          if (
            enterBattlefieldBatch(s, [{ object, controller: entry.controller, tapped: true }]) ===
            false
          ) {
            s.resolving = { entry, index: index + 1 };
            return false;
          }
        }
        break;
      }
      case 'animateLand': {
        const source = s.objects[entry.source.id];
        if (
          source?.zone === 'battlefield' &&
          source.incarnation === entry.source.incarnation &&
          hasType(definition(s, source), 'land')
        )
          addModifier(s, {
            objectId: source.id,
            incarnation: source.incarnation,
            addTypes: ['creature'],
            animation: {
              power: e.power,
              toughness: e.toughness,
              colors: e.colors,
              subtypes: e.allCreatureTypes ? [...CREATURE_TYPES] : e.subtypes,
            },
            ...(e.keywords ? { keywords: [...e.keywords] } : {}),
            ...(e.permanent ? { permanent: true } : { expires: s.turn }),
          });
        break;
      }
      case 'stationCharge': {
        const source = s.objects[entry.source.id],
          payer = s.objects[entry.stationPayer?.id];
        // Resolve on this permanent even if it lost station or its printed subtype.
        if (source?.zone !== 'battlefield' || source.incarnation !== entry.source.incarnation)
          break;
        const power =
          payer?.zone === 'battlefield' && payer.incarnation === entry.stationPayer.incarnation
            ? stats(s, payer).power
            : (entry.stationPower ?? 0);
        const amount = Math.max(0, power),
          next = (source.chargeCounters ?? 0) + amount;
        requireRule(Number.isSafeInteger(next), 'COUNTER_RANGE', 'Too many charge counters.');
        if (amount) {
          source.chargeCounters = next;
          emit(s, 'chargeCounters', { objectId: source.id, amount, total: next });
        }
        break;
      }
      case 'becomeSaddled': {
        const source = s.objects[entry.source.id];
        if (source?.zone === 'battlefield' && source.incarnation === entry.source.incarnation) {
          // Resolution history is permanent/incarnation history, not ability-use history.
          // Track it even if this permanent currently has no saddle-related trigger.
          const previous = source.saddleHistory?.turn === s.turn ? source.saddleHistory.count : 0;
          source.saddleHistory = { turn: s.turn, count: previous + 1 };
          emit(s, 'saddleResolved', {
            objectId: source.id,
            player: source.controller,
            count: previous + 1,
          });
          // CR 603.2e: a persisting designation does not itself become true again.
          if (source.saddledTurn !== s.turn) {
            source.saddledTurn = s.turn;
            emit(s, 'saddled', { objectId: source.id, player: source.controller });
            notifyTriggers(s, 'saddled', { object: source, saddleNumber: previous + 1 });
          }
        }
        break;
      }
      case 'animateVehicle': {
        const source = s.objects[entry.source.id];
        if (
          source?.zone === 'battlefield' &&
          source.incarnation === entry.source.incarnation &&
          !source.faceDown &&
          definition(s, source).subtypes.includes('Vehicle')
        )
          addModifier(s, {
            objectId: source.id,
            incarnation: source.incarnation,
            addTypes: ['artifact', 'creature'],
            expires: s.turn,
          });
        break;
      }
      case 'combatRestriction':
        if (o)
          s.modifiers.push({
            objectId: o.id,
            incarnation: o.incarnation,
            combatRestriction: e.restriction,
            expires: s.turn,
          });
        break;
      case 'creatureForm':
        if (o)
          s.modifiers.push({
            objectId: o.id,
            incarnation: o.incarnation,
            creatureForm: { power: e.power, toughness: e.toughness, subtypes: e.subtypes },
            expires: s.turn,
          });
        break;
      case 'modify':
        if (o)
          addModifier(s, {
            objectId: o.id,
            incarnation: o.incarnation,
            power: e.power,
            toughness: e.toughness,
            keywords: e.keywords ?? [],
            expires: s.turn,
          });
        break;
      case 'removeAbilities': {
        const source = s.objects[entry.source?.id];
        if (
          o &&
          (e.until === 'endOfTurn' ||
            (source?.zone === 'battlefield' && source.incarnation === entry.source.incarnation))
        )
          addModifier(s, {
            objectId: o.id,
            incarnation: o.incarnation,
            removeAbilities: true,
            ...(e.until === 'endOfTurn'
              ? { expires: s.turn }
              : { untilSourceLeaves: { ...entry.source } }),
          });
        break;
      }
      case 'stripDestroyByManaValue': {
        const victims = creatures(s).filter(
          (object) => manaValue(definition(s, object)) <= e.amount,
        );
        for (const object of victims)
          addModifier(s, {
            objectId: object.id,
            incarnation: object.incarnation,
            removeAbilities: true,
            expires: s.turn,
          });
        const context = captureDepartureContext(s);
        for (const object of victims)
          if (!hasKeyword(s, object, 'indestructible')) move(s, object, 'graveyard', context);
        finishDepartureBatch(s, context);
        break;
      }
      case 'counterAbility': {
        const affected = s.stack.find(
          (item) => item.id === entry.target?.id && item.kind === 'ability',
        );
        if (!affected || affected.uncounterable) break;
        const original = affected.source,
          source = s.objects[original?.id];
        counterEntry(s, affected.id);
        if (
          e.removeSourceAbilities &&
          source?.zone === 'battlefield' &&
          source.incarnation === original.incarnation &&
          ['artifact', 'creature', 'planeswalker'].some((type) =>
            hasType(definition(s, source), type),
          )
        )
          resolveEffects(s, {
            ...entry,
            target: ref(source),
            effects: [{ op: 'removeAbilities', until: 'sourceLeaves' }],
          });
        break;
      }
      case 'counter': {
        const affected = s.stack.find((item) => item.id === entry.target?.id);
        if (!affected) break;
        if (e.unlessPay !== undefined) {
          const cost = { mana: structuredClone(e.unlessPay) };
          s.resolving = { entry, index: index + 1 };
          s.choice = {
            kind: 'payCost',
            player: affected.controller,
            cost,
            stackId: affected.id,
            reason: 'counterUnless',
            counterDestination: e.exile ? 'exile' : 'graveyard',
            payable: !costProblem(s, affected.controller, cost),
          };
          return false;
        }
        counterEntry(s, affected.id, e.exile ? 'exile' : 'graveyard');
        break;
      }
      case 'empowerJace': {
        let candidates = battlefield(s).filter(
          (object) =>
            object.controller === entry.controller &&
            object.token &&
            hasType(definition(s, object), 'planeswalker') &&
            definition(s, object).subtypes.includes('Jace'),
        );
        if (!candidates.length) {
          const object = addObject(s, e.definition, entry.controller, 'void');
          enterBattlefieldBatch(s, [{ object, controller: entry.controller }]);
          candidates = [object];
        }
        if (candidates.length === 1) candidates[0].loyalty += e.count;
        else {
          s.choice = {
            kind: 'empowerJace',
            player: entry.controller,
            cards: candidates.map((o) => o.id),
            objects: candidates.map(ref),
            count: e.count,
          };
          s.resolving = { entry, index: index + 1 };
          return false;
        }
        break;
      }
      case 'mobilize': {
        const tokens = Array.from({ length: e.count }, () =>
          addObject(s, e.definition, entry.controller, 'void'),
        );
        enterBattlefieldBatch(
          s,
          tokens.map((object) => ({
            object,
            controller: entry.controller,
            tapped: true,
            attacking: true,
          })),
        );
        if (tokens.length) {
          (s.delayedTriggers ??= []).push({
            kind: 'ability',
            name: entry.name,
            controller: entry.controller,
            source: structuredClone(entry.source),
            sourceDefinition: structuredClone(entry.sourceDefinition),
            sourceKeywords: [],
            effects: [],
            rule: 'mobilizeSacrifice',
            delayedObjects: tokens.filter((o) => o.zone === 'battlefield').map(ref),
            label: `${entry.name} · sacrifice mobilized tokens`,
          });
        }
        const attacking = tokens.filter(
          (o) => o.zone === 'battlefield' && s.combat.attackers.some((r) => r.id === o.id),
        );
        if (attacking.length && attackDefenders(s, entry.controller).length > 1) {
          s.resolving = { entry, index: index + 1 };
          s.choice = {
            kind: 'attackDefenders',
            player: entry.controller,
            cards: attacking.map((o) => o.id),
          };
          return false;
        }
        break;
      }
      case 'attachedToken':
        createAttachedToken(s, e.definition, entry.controller, target);
        break;
      case 'token': {
        // Revision 4 makes one token instruction a simultaneous entry. Preserve
        // historical trigger/object ID interleaving for already-exported games.
        if ((s.rulesRevision ?? 4) < 4) {
          for (let i = 0; i < (e.countFrom === 'moved' ? (entry.movedCount ?? 0) : e.count); i++) {
            const controller = e.player === 'targetController' ? entry.targetController : recipient;
            const token = addObject(s, e.definition, controller, 'void');
            enterBattlefield(s, token, controller, null, { tapped: e.tapped });
            if (token.zone === 'battlefield' && e.temporaryKeywords?.length)
              addModifier(s, {
                objectId: token.id,
                incarnation: token.incarnation,
                power: 0,
                toughness: 0,
                keywords: [...e.temporaryKeywords],
                expires: s.turn,
              });
          }
          break;
        }
        const controller = e.player === 'targetController' ? entry.targetController : recipient;
        const count = e.countFrom === 'moved' ? (entry.movedCount ?? 0) : e.count;
        const entries = Array.from({ length: count }, () => ({
          object: addObject(s, e.definition, controller, 'void'),
          controller,
          tapped: e.tapped,
          temporaryKeywords: e.temporaryKeywords,
        }));
        if (enterBattlefieldBatch(s, entries) === false) {
          s.resolving = { entry, index: index + 1 };
          return false;
        }
        break;
      }
      default:
        throw new Error(`Unimplemented effect opcode: ${e.op}`);
    }
    if (flushLinkedReturns(s) === false) {
      s.resolving = { entry, index: index + 1 };
      return false;
    }
  }
}
/** Return only the same still-exiled objects, using the replay's seeded RNG. */
function bottomDiscoveredRemainder(s, references) {
  const cards = references.filter((r) => {
    const o = s.objects[r.id];
    return o?.zone === 'exile' && o.incarnation === r.incarnation;
  });
  shuffle(s, cards);
  for (const r of cards) move(s, s.objects[r.id], 'library');
}
/** Resume the instruction cursor; choices do not create a priority window. */
export function continueResolution(s) {
  const frame = s.resolving;
  if (!frame) return;
  if (frame.discover) {
    bottomDiscoveredRemainder(s, frame.discover.exiled);
    emit(s, 'discovered', {
      player: frame.entry.controller,
      amount: frame.discover.amount,
      objectId: frame.discover.card.id,
    });
    delete frame.discover;
  }
  if (flushLinkedReturns(s) === false) return;
  if (resolveEffects(s, frame.entry, frame.index) === false) {
    if (frame.resume) {
      let tail = s.resolving;
      while (tail.resume) tail = tail.resume;
      tail.resume = frame.resume;
    }
    return;
  }
  if (frame.resume) {
    s.resolving = frame.resume;
    continueResolution(s);
    return;
  }
  const entry = frame.entry,
    object = s.objects[entry.source?.id];
  if (entry.kind === 'spell' && object?.zone === 'stack') {
    if (entry.adventureCast) {
      move(s, object, 'exile');
      object.adventured = { player: entry.controller, incarnation: object.incarnation };
      emit(s, 'adventureExiled', {
        objectId: object.id,
        name: object.name,
        player: entry.controller,
      });
    } else move(s, object, 'graveyard');
  }
  emit(s, 'resolved', { name: entry.name, stackId: entry.id });
  s.resolving = null;
  s.priority = s.active;
  s.passes = 0;
}
export function finishResolutionChoice(s, command) {
  const choice = s.choice;
  if (choice.kind === 'effectChoice') {
    const { entry, index } = s.resolving;
    const instruction = entry.effects[index - 1];
    requireRule(
      command.type === 'chooseEffect' &&
        Number.isSafeInteger(command.option) &&
        choice.options.some((option) => option.index === command.option),
      'EFFECT_CHOICE',
      'Choose one of the offered resolution alternatives.',
    );
    const option = instruction.options[command.option];
    requireRule(
      meetsCondition(s, entry.controller, option.condition, [], entry.source, entry),
      'EFFECT_CHOICE',
      'That resolution alternative is no longer available.',
    );
    entry.effects.splice(index, 0, ...structuredClone(option.effects));
    emit(s, 'effectChosen', { player: choice.player, option: command.option, label: option.label });
    s.choice = null;
    continueResolution(s);
    return;
  }
  if (choice.kind === 'empowerJace') {
    const object = s.objects[command.card];
    requireRule(
      command.type === 'chooseResolutionCard' &&
        object &&
        choice.objects.some((r) => r.id === object.id && r.incarnation === object.incarnation) &&
        object.zone === 'battlefield' &&
        object.controller === choice.player &&
        object.token &&
        hasType(definition(s, object), 'planeswalker') &&
        definition(s, object).subtypes.includes('Jace'),
      'EMPOWER_JACE',
      'Choose an offered Jace planeswalker token.',
    );
    object.loyalty += choice.count;
    s.choice = null;
    continueResolution(s);
    return;
  }
  if (choice.kind === 'castExiled') {
    requireRule(
      command.type === 'declineCastExiled',
      'CAST_EXILED',
      'Cast the exiled card now or decline.',
    );
    if (choice.discover !== undefined) {
      const card = s.objects[choice.card];
      if (card?.zone === 'exile' && card.incarnation === choice.incarnation) move(s, card, 'hand');
    } else
      dealDamage(
        s,
        damageSource(s, s.resolving.entry),
        { kind: 'player', id: opponent(choice.player) },
        choice.amount,
      );
    s.choice = null;
    continueResolution(s);
    return;
  }
  if (choice.kind === 'manaColor') {
    requireRule(
      command.type === 'chooseManaColor' && ['W', 'U', 'B', 'R', 'G'].includes(command.color),
      'MANA_COLOR',
      'Choose a mana color.',
    );
    s.players[choice.player].mana[command.color]++;
    s.choice = null;
    continueResolution(s);
    return;
  }
  if (choice.kind === 'attackDefenders') {
    requireRule(
      command.type === 'chooseAttackDefenders',
      'DEFENDERS',
      'Choose attack destinations for the new creatures.',
    );
    validateAttackDefenders(s, choice.cards, command.defenders);
    s.combat.defenders = { ...s.combat.defenders, ...structuredClone(command.defenders ?? {}) };
    s.choice = null;
    continueResolution(s);
    return;
  }
  if (
    ['exilePlay', 'bindingNegotiation', 'revealDiscard', 'exileToGraveyard'].includes(choice.kind)
  ) {
    requireRule(
      command.type === 'chooseResolutionCard',
      'RESOLUTION_CHOICE',
      'Choose a card for this effect.',
    );
    const id = command.card;
    requireRule(
      (id === null &&
        choice.kind !== 'exilePlay' &&
        (choice.kind !== 'revealDiscard' || !choice.eligibleCards.length)) ||
        choice.cards.includes(id),
      'RESOLUTION_CARD',
      'Choose an offered card.',
    );
    if (choice.kind === 'exilePlay') {
      const object = s.objects[id];
      requireRule(object.zone === 'exile', 'EXILE_CHOICE', 'Card has left exile.');
      object.playPermission = {
        player: choice.player,
        turn: s.turn,
        incarnation: object.incarnation,
      };
    } else if (choice.kind === 'bindingNegotiation' || choice.kind === 'revealDiscard') {
      if (id !== null) {
        requireRule(
          s.objects[id].zone === 'hand' &&
            s.objects[id].owner === choice.targetPlayer &&
            !hasType(definition(s, s.objects[id]), 'land') &&
            (choice.kind !== 'revealDiscard' || choice.eligibleCards.includes(id)),
          'DISCARD_CHOICE',
          'Choose a nonland from the revealed hand.',
        );
        move(s, s.objects[id], 'graveyard');
      } else if (choice.kind === 'bindingNegotiation') {
        s.choice = {
          kind: 'exileToGraveyard',
          player: choice.player,
          targetPlayer: choice.targetPlayer,
          cards: s.players[choice.targetPlayer].exile.filter((id) => !s.objects[id].faceDown),
        };
        return;
      }
    } else if (id !== null) {
      requireRule(
        s.objects[id].zone === 'exile' &&
          s.objects[id].owner === choice.targetPlayer &&
          !s.objects[id].faceDown,
        'EXILE_CHOICE',
        'Choose a face-up exiled card the targeted opponent owns.',
      );
      move(s, s.objects[id], 'graveyard');
    }
    s.choice = null;
    continueResolution(s);
    return;
  }
  if (choice.kind === 'removeCounter') {
    requireRule(
      command.type === 'chooseCounter' &&
        (command.counter === null || choice.counters.includes(command.counter)),
      'COUNTER_CHOICE',
      'Choose an offered counter or decline.',
    );
    if (command.counter !== null) {
      const source = s.objects[choice.source.id];
      requireRule(
        source?.zone === 'battlefield' &&
          source.incarnation === choice.source.incarnation &&
          counterKinds(source).includes(command.counter),
        'COUNTER_CHOICE',
        'That counter is no longer available.',
      );
      removeOneCounter(source, command.counter);
      if (!hasType(definition(s, source), 'creature')) removeFromCombat(s, source);
      emit(s, 'counterRemoved', {
        objectId: source.id,
        counter: command.counter,
        player: choice.player,
      });
      queueTrigger(
        s,
        { ...source, controller: choice.player },
        choice.reflexive.effects,
        `${source.name} · counter removed`,
        false,
        choice.reflexive.selector,
      );
    }
    s.choice = null;
    continueResolution(s);
    return;
  }
  if (choice.kind === 'behold') {
    requireRule(
      command.type === 'chooseResolutionCard' &&
        (command.card === null || choice.cards.includes(command.card)),
      'BEHOLD_CHOICE',
      'Choose an offered card or decline.',
    );
    if (command.card !== null) {
      const object = s.objects[command.card];
      requireRule(
        object &&
          ((object.zone === 'hand' && object.owner === choice.player) ||
            (object.zone === 'battlefield' && object.controller === choice.player)) &&
          matchesFilter(
            { definition: definition(s, object) },
            { subtype: choice.subtype },
            choice.player,
          ),
        'BEHOLD_CHOICE',
        'Choose a matching card in your hand or permanent you control.',
      );
      if (object.zone === 'hand')
        emit(s, 'revealed', {
          objectId: object.id,
          name: object.name,
          revealed: [object.name],
          player: choice.player,
        });
      emit(s, 'beheld', { objectId: object.id, player: choice.player, subtype: choice.subtype });
      const { entry, index } = s.resolving;
      entry.effects.splice(index, 0, ...structuredClone(choice.then));
    }
    s.choice = null;
    continueResolution(s);
    return;
  }
  if (choice.kind === 'landName') {
    requireRule(
      command.type === 'chooseLandName' && choice.names.includes(command.name),
      'LAND_NAME',
      'Choose a land card name.',
    );
    const source = s.objects[s.resolving.entry.source.id];
    if (
      source?.zone === 'battlefield' &&
      source.incarnation === s.resolving.entry.source.incarnation
    )
      source.chosenLandName = command.name;
    emit(s, 'landNameChosen', { player: choice.player, objectId: choice.card, name: command.name });
  } else if (choice.kind === 'optionalEffect') {
    requireRule(
      command.type === 'resolveOptional' && typeof command.accept === 'boolean',
      'OPTIONAL_CHOICE',
      'Choose whether to resolve this optional ability.',
    );
    if (!command.accept) s.resolving.index = s.resolving.entry.effects.length;
    emit(s, 'optionalEffect', { player: choice.player, accepted: command.accept });
  } else if (choice.kind === 'payCost') {
    requireRule(
      command.type === 'payCost' && typeof command.pay === 'boolean',
      'PAYMENT_CHOICE',
      'Choose whether to pay this cost.',
    );
    if (command.pay) payCost(s, choice.player, choice.cost);
    else counterEntry(s, choice.stackId, choice.counterDestination);
    emit(s, choice.reason === 'ward' ? 'wardPayment' : 'counterPayment', {
      player: choice.player,
      paid: command.pay,
      stackId: choice.stackId,
    });
  } else if (choice.kind === 'librarySearch') {
    requireRule(
      command.type === 'searchLibrary' && Array.isArray(command.cards),
      'SEARCH_CHOICE',
      'Choose the cards to find.',
    );
    if (command.decline) {
      requireRule(
        choice.optional && command.cards.length === 0,
        'SEARCH_DECLINE',
        'Only optional searches may be declined.',
      );
      emit(s, 'librarySearchDeclined', { player: choice.player });
    } else {
      requireRule(
        command.cards.length >= choice.min &&
          command.cards.length <= choice.max &&
          new Set(command.cards).size === command.cards.length,
        'SEARCH_COUNT',
        `Choose ${choice.min} to ${choice.max} distinct cards.`,
      );
      const legal = searchableCards(s, choice.player, choice.where ?? undefined);
      requireRule(
        command.cards.every((id) => choice.cards.includes(id) && legal.includes(id)),
        'SEARCH_CARD',
        'A chosen card does not match this library search.',
      );
      const found = command.cards.map((id) => s.objects[id]);
      s.resolving.entry.searchedObjects = found.map((object) => ({
        ...ref(object),
        incarnation: object.incarnation + (choice.destination === 'top' ? 0 : 1),
      }));
      // Top destinations are set aside while the rest is shuffled (CR 701.24b).
      if (choice.destination === 'battlefield')
        enterBattlefieldBatch(
          s,
          found.map((object) => ({ object, controller: choice.player, tapped: choice.tapped })),
        );
      else if (['hand', 'graveyard'].includes(choice.destination))
        for (const object of found) move(s, object, choice.destination);
      const library = s.players[choice.player].library;
      if (choice.destination === 'top') {
        const selected = new Set(command.cards);
        s.players[choice.player].library = library.filter((id) => !selected.has(id));
      }
      shuffle(s, s.players[choice.player].library);
      if (choice.destination === 'top') s.players[choice.player].library.unshift(...command.cards);
      notifyTriggers(s, 'librarySearch', { player: choice.player });
      emit(s, 'librarySearched', {
        player: choice.player,
        count: found.length,
        destination: choice.destination,
        ...(choice.reveal ? { revealed: found.map((o) => o.name) } : {}),
      });
      emit(s, 'libraryShuffled', { player: choice.player });
    }
  } else if (choice.kind === 'libraryOrder') {
    requireRule(
      command.type === 'orderLibrary',
      'CHOICE',
      'Order the inspected library cards first.',
    );
    requireRule(
      Array.isArray(command.top) && Array.isArray(command.rest),
      'LIBRARY_ORDER',
      'Provide ordered top and remaining card lists.',
    );
    const all = [...command.top, ...command.rest];
    requireRule(
      all.length === choice.cards.length &&
        new Set(all).size === all.length &&
        all.every((id) => choice.cards.includes(id)),
      'LIBRARY_ORDER',
      'Place each inspected card exactly once.',
    );
    const selectCount = choice.selectCount ?? Math.min(1, choice.cards.length);
    requireRule(
      choice.action !== 'lookChooseHand' ||
        (choice.optional ? command.top.length <= selectCount : command.top.length === selectCount),
      'LIBRARY_SELECTION',
      `Choose ${choice.optional ? 'up to' : 'exactly'} ${selectCount} inspected cards for your hand.`,
    );
    requireRule(
      choice.action !== 'lookChooseHand' ||
        command.top.every((id) => (choice.eligibleCards ?? choice.cards).includes(id)),
      'LIBRARY_SELECTION_FILTER',
      'Choose only eligible inspected cards for your hand.',
    );
    const revealed = choice.reveal ? command.top.map((id) => s.objects[id].name) : null;
    const player = s.players[choice.player],
      inspected = new Set(choice.cards);
    if (['surveil', 'explore'].includes(choice.action) || choice.restDestination === 'graveyard')
      for (const id of command.rest) move(s, s.objects[id], 'graveyard');
    if (choice.action === 'lookChooseHand')
      for (const id of command.top) move(s, s.objects[id], 'hand');
    const remaining = player.library.filter((id) => !inspected.has(id));
    // Canonicalize the unchosen subset before shuffling: submitted ordering must not
    // let a chooser control a random-bottom instruction or change seeded replay.
    const rest =
      choice.restOrder === 'random'
        ? shuffle(
            s,
            choice.cards.filter((id) => !command.top.includes(id)),
          )
        : command.rest;
    player.library = [
      ...(choice.action === 'lookChooseHand' ? [] : command.top),
      ...remaining,
      ...(['scry', 'lookChooseHand'].includes(choice.action) &&
      choice.restDestination !== 'graveyard'
        ? rest
        : []),
    ];
    emit(s, choice.action, {
      player: choice.player,
      looked: choice.cards.length,
      kept: command.top.length,
      moved: command.rest.length,
      ...(revealed ? { revealed } : {}),
    });
  } else if (choice.kind === 'sacrifice') {
    requireRule(
      command.type === 'sacrifice' &&
        Array.isArray(command.cards) &&
        (command.cards.length === choice.count ||
          (choice.optional && command.cards.length === 0)) &&
        new Set(command.cards).size === choice.count &&
        command.cards.every((id) =>
          choice.refs.some(
            (r) =>
              r.id === id &&
              s.objects[id]?.incarnation === r.incarnation &&
              s.objects[id]?.zone === 'battlefield' &&
              s.objects[id]?.controller === choice.player,
          ),
        ),
      'SACRIFICE_CHOICE',
      `Choose exactly ${choice.count} eligible permanents you control.`,
    );
    const selected = [
      ...choice.selected,
      ...command.cards.map((id) => ({
        ...choice.refs.find((r) => r.id === id),
        player: choice.player,
      })),
    ];
    if (choice.remaining.length) {
      const [first, ...remaining] = choice.remaining;
      s.choice = {
        kind: 'sacrifice',
        ...first,
        remaining,
        selected,
        ...(choice.destination ? { destination: choice.destination } : {}),
      };
      return;
    }
    const sacrificed = selected
      .map((r) => {
        const object = s.objects[r.id];
        return object?.zone === 'battlefield' &&
          object.incarnation === r.incarnation &&
          object.controller === r.player
          ? object
          : null;
      })
      .filter(Boolean);
    if (choice.destination === 'exile') {
      const context = captureDepartureContext(s);
      for (const object of sacrificed) move(s, object, 'exile', context);
    } else sacrificePermanents(s, sacrificed);
  } else if (choice.kind === 'discardEffect') {
    requireRule(
      command.type === 'discardEffect',
      'CHOICE',
      'Choose cards to discard before resolution continues.',
    );
    requireRule(
      Array.isArray(command.cards) &&
        (command.cards.length === choice.count ||
          (choice.optional && command.cards.length === 0)) &&
        new Set(command.cards).size === command.cards.length &&
        command.cards.every((id) => s.players[choice.player].hand.includes(id)),
      'DISCARD_CHOICE',
      `Choose exactly ${choice.count} distinct cards from your hand.`,
    );
    // Snapshot qualifying cards before movement; a reflexive trigger belongs to
    // this resolving ability, even if its source has since left the battlefield.
    const discardFilter =
      choice.reflexive?.where ??
      choice.continuation?.where ??
      (choice.conniving ? { not: { type: 'land' } } : undefined);
    const qualifying =
      choice.reflexive || choice.continuation || choice.conniving
        ? command.cards.filter((id) => {
            const object = s.objects[id],
              d = definition(s, object);
            return matchesFilter(
              {
                definition: d,
                owner: object.owner,
                controller: object.controller,
                manaValue: manaValue(d),
                power: d.power,
                toughness: d.toughness,
                keywords: d.keywords,
              },
              discardFilter,
              choice.player,
            );
          }).length
        : 0;
    for (const id of command.cards) move(s, s.objects[id], 'graveyard');
    emit(s, 'discard', { player: choice.player, count: command.cards.length });
    if (choice.drawOnDiscard && command.cards.length) draw(s, choice.player, choice.drawOnDiscard);
    if (qualifying && choice.conniving) {
      const creature = s.objects[choice.conniving.id];
      if (creature?.zone === 'battlefield' && creature.incarnation === choice.conniving.incarnation)
        putStatCounters(creature, { amount: qualifying });
    }
    if (qualifying && choice.continuation) {
      const frame = s.resolving;
      frame.entry.effects.splice(frame.index, 0, ...structuredClone(choice.continuation.then));
    }
    if (qualifying && choice.reflexive) {
      const parent = s.resolving.entry;
      s.pendingTriggers.push({
        id: `s${++s.nextId}`,
        kind: 'ability',
        name: parent.name,
        source: structuredClone(parent.source),
        controller: parent.controller,
        sourceKeywords: structuredClone(parent.sourceKeywords ?? []),
        ...(parent.sourceStats ? { sourceStats: structuredClone(parent.sourceStats) } : {}),
        ...(parent.sourceDefinition
          ? { sourceDefinition: structuredClone(parent.sourceDefinition) }
          : {}),
        effects: structuredClone(choice.reflexive.effects),
        targetGroups: [
          {
            id: 'chosen',
            selector: structuredClone(choice.reflexive.selector),
            min: 0,
            max: qualifying,
          },
        ],
        label: 'Discard-linked ability',
      });
      emit(s, 'triggered', {
        objectId: parent.source.id,
        name: parent.name,
        player: parent.controller,
      });
    }
  } else throw new Error('Unexpected resolution choice.');
  if (s.choice !== choice) return;
  s.choice = null;
  continueResolution(s);
}
export function resolveTop(s) {
  const entry = s.stack.pop();
  if (!entry) return;
  if (entry.rule === 'earthbendReturn') entry.effects = [{ op: 'returnEarthbent' }];
  if (entry.rule === 'mobilizeSacrifice') {
    const objects = (entry.delayedObjects ?? []).flatMap((target) => {
      const object = s.objects[target.id];
      return object?.zone === 'battlefield' &&
        object.incarnation === target.incarnation &&
        object.controller === entry.controller
        ? [object]
        : [];
    });
    sacrificePermanents(s, objects);
    emit(s, 'resolved', { name: entry.name, stackId: entry.id });
    return;
  }
  if (entry.rule === 'warpExile') {
    const object = s.objects[entry.source?.id];
    if (object?.zone === 'battlefield' && object.incarnation === entry.source.incarnation) {
      move(s, object, 'exile');
      object.warped = { turn: s.turn, incarnation: object.incarnation };
      emit(s, 'warpedExiled', { player: object.owner, objectId: object.id, name: object.name });
    }
    emit(s, 'resolved', { name: entry.name, stackId: entry.id });
    return;
  }
  if (entry.rule === 'increaseSpeed') {
    const player = s.players[entry.controller];
    if (player.speed > 0 && player.speed < 4) {
      player.speed++;
      emit(s, 'speedChanged', { player: player.id, speed: player.speed });
    }
    return;
  }
  if (
    entry.condition &&
    !meetsCondition(
      s,
      entry.controller,
      entry.condition,
      [],
      {
        ...entry.source,
        questCountersLKI: entry.sourceQuestCounters,
        bargainedLKI: entry.sourceBargained,
        statsLKI: entry.sourceStats,
      },
      entry.eventManaSpent ?? null,
    )
  )
    return;
  const object = s.objects[entry.source?.id],
    d = entry.kind === 'spell' && object ? definition(s, object) : null;
  if (entry.targetGroups) {
    const originalCount = flattenTargets(entry.targets).length;
    entry.targets = survivingTargets(
      s,
      entry.targetGroups,
      entry.targets,
      entry.controller,
      entry.targetingSource ?? entry.source,
    );
    if (originalCount && !flattenTargets(entry.targets).length) {
      emit(s, 'fizzled', { name: entry.name, stackId: entry.id });
      if (entry.kind === 'spell' && object?.zone === 'stack') move(s, object, 'graveyard');
      return;
    }
  }
  if (
    entry.targetKind &&
    !legalTarget(
      s,
      entry.targetKind,
      entry.target,
      entry.controller,
      entry.targetingSource ?? entry.source,
    )
  ) {
    emit(s, 'fizzled', { name: entry.name, stackId: entry.id });
    if (entry.kind === 'spell' && object?.zone === 'stack') move(s, object, 'graveyard');
    return;
  }
  entry.targetsRechecked = true;
  if (entry.targetGroups) {
    entry.targetControllers = Object.fromEntries(
      entry.targetGroups
        .filter((group) => group.max === 1 && needsTargetController(entry.effects, group.id))
        .flatMap((group) => {
          const target = entry.targets[group.id]?.[0];
          const object = target?.kind === 'object' && s.objects[target.id];
          return object ? [[group.id, object.controller]] : [];
        }),
    );
  }
  if (needsTargetController(entry.effects))
    entry.targetController =
      entry.target?.kind === 'player'
        ? entry.target.id
        : entry.target?.kind === 'stack'
          ? s.stack.find((v) => v.id === entry.target.id)?.controller
          : s.objects[entry.target?.id]?.controller;
  if (
    entry.kind === 'spell' &&
    ['creature', 'enchantment', 'artifact', 'planeswalker'].includes(d.type)
  ) {
    enterBattlefield(s, object, entry.controller, entry.target ?? null);
    if (entry.offspringPaid)
      queueEntryTrigger(s, object, [{ op: 'offspringCopy' }], `${object.name} · offspring`);
    emit(s, 'resolved', { name: entry.name, stackId: entry.id });
  } else {
    s.resolving = { entry, index: 0 };
    emit(s, 'resolutionStarted', { name: entry.name, stackId: entry.id });
    if (entry.optional)
      s.choice = { kind: 'optionalEffect', player: entry.controller, name: entry.name };
    else continueResolution(s);
  }
}
/** All supported state-based actions are computed from one pre-action state. */
export function stateBasedActions(s) {
  if (s.resolving || s.choice?.kind === 'legendRule') return false;
  // Reconcile continuous type changes before priority; explicit counter removals
  // also remove combat membership immediately, before their next instruction.
  for (const r of [...s.combat.attackers, ...Object.values(s.combat.blocks).flat()]) {
    const object = s.objects[r.id];
    if (
      object?.zone === 'battlefield' &&
      object.incarnation === r.incarnation &&
      !hasType(definition(s, object), 'creature')
    )
      removeFromCombat(s, object);
  }
  const losers = s.players.filter((p) => p.life <= 0 || p.failedDraw).map((p) => p.id);
  if (losers.length) {
    s.status = 'finished';
    revealFaceDownAtEnd(s);
    s.winner = losers.length === 2 ? null : opponent(losers[0]);
    s.choice = null;
    emit(s, 'gameOver', {
      winner: s.winner,
      reason: losers.some((p) => s.players[p].failedDraw) ? 'emptyLibrary' : 'life',
    });
    return true;
  }
  // Chapter triggers awaiting ordering/targets still count as pending. Never
  // complete a Saga while its chapter is resolving or a choice is outstanding.
  const completedSagas = s.choice
    ? []
    : battlefield(s).filter((object) => {
        const final = sagaFinalChapter(s, object);
        return (
          final &&
          (object.loreCounters ?? 0) >= final &&
          ![...s.pendingTriggers, ...s.stack].some(
            (entry) =>
              entry.sagaChapter &&
              entry.source?.id === object.id &&
              entry.source.incarnation === object.incarnation,
          )
        );
      });
  let speedStarted = false;
  let detached = false;
  for (const object of battlefield(s)) {
    const player = s.players[object.controller];
    if (!player.speed && definition(s, object).startEngines) {
      player.speed = 1;
      speedStarted = true;
      emit(s, 'speedChanged', { player: player.id, speed: 1 });
    }
  }
  const toGrave = [];
  for (const o of battlefield(s)) {
    const d = definition(s, o);
    if (hasType(d, 'planeswalker') && (o.loyalty ?? 0) <= 0) toGrave.push(o);
    if (d.type === 'creature') {
      const { toughness } = stats(s, o);
      if (
        toughness <= 0 ||
        (!hasKeyword(s, o, 'indestructible') && (o.damage >= toughness || o.deathtouchDamage))
      )
        toGrave.push(o);
    }
    if (d.subtypes.includes('Equipment') && o.attachedTo) {
      const target = s.objects[o.attachedTo.id];
      if (
        !legalEquipmentAttachment(s, o, target) ||
        target.incarnation !== o.attachedTo.incarnation
      ) {
        o.attachedTo = null;
        detached = true;
        emit(s, 'detached', { objectId: o.id });
      }
    }
    if (d.subtypes.includes('Aura')) {
      const target = s.objects[o.attachedTo?.id];
      if (
        !target ||
        target.zone !== 'battlefield' ||
        target.incarnation !== o.attachedTo.incarnation ||
        !legalAuraAttachment(s, o, target)
      )
        toGrave.push(o);
    }
  }
  const groups = [];
  for (const player of [s.active, opponent(s.active)]) {
    const rolesByTarget = new Map();
    for (const role of battlefield(s)) {
      if (
        role.controller !== player ||
        !definition(s, role).subtypes.includes('Role') ||
        !role.attachedTo
      )
        continue;
      const key = `${role.attachedTo.id}:${role.attachedTo.incarnation}`;
      if (!rolesByTarget.has(key)) rolesByTarget.set(key, []);
      rolesByTarget.get(key).push(role);
    }
    for (const roles of rolesByTarget.values()) {
      if (roles.length < 2) continue;
      const newest = Math.max(
        ...roles.map((role) => role.roleTimestamp ?? role.layerTimestamp ?? 0),
      );
      const keepers = roles.filter(
        (role) => (role.roleTimestamp ?? role.layerTimestamp ?? 0) === newest,
      );
      toGrave.push(
        ...roles.filter((role) => (role.roleTimestamp ?? role.layerTimestamp ?? 0) < newest),
      );
      if (keepers.length > 1)
        groups.push({ player, name: 'Role', rule: 'role', cards: keepers.map((role) => role.id) });
    }
    const byName = new Map();
    for (const o of battlefield(s)) {
      if (o.controller !== player || !definition(s, o).legendary) continue;
      const name = definition(s, o).name;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(o.id);
    }
    for (const [name, cards] of byName) if (cards.length > 1) groups.push({ player, name, cards });
  }
  if (groups.length) {
    const [first, ...remaining] = groups;
    // Even a lethally damaged legend can be chosen. All SBAs use this same snapshot.
    s.choice = {
      kind: 'legendRule',
      ...first,
      remaining,
      toGrave: [...new Set(toGrave.map((o) => o.id))],
      ...(completedSagas.length ? { sagaSacrifices: completedSagas.map((o) => o.id) } : {}),
    };
    return false;
  }
  return (
    applyStateBasedBatch(
      s,
      toGrave.map((o) => o.id),
      completedSagas.map((o) => o.id),
    ) ||
    speedStarted ||
    detached
  );
}
function applyStateBasedBatch(s, ids, sagaSacrifices = []) {
  let changed = false;
  const toGrave = [...new Set(ids)].map((id) => s.objects[id]);
  const departureContext =
    toGrave.length || sagaSacrifices.length ? captureDepartureContext(s) : null;
  // Counter cancellation is simultaneous with departures: preserve pre-SBA LKI.
  for (const object of battlefield(s)) {
    const cancel = Math.min(object.plusCounters ?? 0, object.minusCounters ?? 0);
    if (cancel) {
      object.plusCounters -= cancel;
      object.minusCounters -= cancel;
      changed = true;
    }
  }
  // Sacrifice and ordinary SBA deaths share the same pre-departure snapshot.
  if (sagaSacrifices.length) {
    sacrificePermanents(
      s,
      sagaSacrifices.map((id) => s.objects[id]),
      departureContext,
    );
    changed = true;
  }
  for (const o of toGrave.filter((object) => !sagaSacrifices.includes(object.id))) {
    move(s, o, 'graveyard', departureContext);
    changed = true;
  }
  finishDepartureBatch(s, departureContext);
  // Deathtouch tracks damage since the previous state-based-action check.
  for (const o of battlefield(s)) o.deathtouchDamage = false;
  for (const o of Object.values(s.objects))
    if (
      (o.token && o.zone !== 'battlefield') ||
      (o.spellCopy && o.zone !== 'stack' && !(o.zone === 'exile' && preparedSource(s, o)))
    ) {
      for (const p of s.players)
        for (const zone of ['hand', 'graveyard', 'exile', 'library'])
          p[zone] = p[zone].filter((id) => id !== o.id);
      delete s.objects[o.id];
      changed = true;
    }
  flushLinkedReturns(s);
  return changed;
}
/** APNAP choices precede one simultaneous state-based-action batch (CR 101.4, 704). */
export function finishLegendChoice(s, card) {
  const choice = s.choice;
  requireRule(
    choice?.kind === 'legendRule' && choice.cards.includes(card),
    'LEGEND_CHOICE',
    'Choose one of these permanents to keep.',
  );
  const toGrave = [...choice.toGrave, ...choice.cards.filter((id) => id !== card)];
  emit(s, choice.rule === 'role' ? 'roleChosen' : 'legendChosen', {
    player: choice.player,
    name: choice.name,
    objectId: card,
  });
  if (choice.remaining.length) {
    const [first, ...remaining] = choice.remaining;
    s.choice = {
      kind: 'legendRule',
      ...first,
      remaining,
      toGrave,
      ...(choice.sagaSacrifices ? { sagaSacrifices: choice.sagaSacrifices } : {}),
    };
    return;
  }
  s.choice = null;
  applyStateBasedBatch(s, toGrave, choice.sagaSacrifices);
}
/** Stabilize before priority (CR 117.5). Trigger ordering remains an explicit choice. */
export function stabilize(s) {
  if (s.resolving || s.choice || s.endingTurn) return;
  if (flushLinkedReturns(s) === false) return;
  let iterations = 0;
  while (s.status === 'playing' && !s.choice && stateBasedActions(s)) {
    if (++iterations > 100) throw new Error('State-based action fixed point did not converge.');
  }
  if (s.status !== 'playing' || s.choice || !s.pendingTriggers.length) return;
  // Each player's simultaneous triggers must be ordered by that player, APNAP.
  const groups = [s.active, opponent(s.active)]
    .map((p) => ({ player: p, entries: s.pendingTriggers.filter((t) => t.controller === p) }))
    .filter((g) => g.entries.length);
  s.pendingTriggers = [];
  placeTriggerGroups(s, groups);
  // Removing an unplaceable final chapter can now complete its Saga.
  if (!s.choice && stateBasedActions(s)) stabilize(s);
}
function placeTriggerGroups(s, groups) {
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index],
      remaining = groups.slice(index + 1);
    if (group.entries.length > 1) {
      s.choice = { kind: 'orderTriggers', player: group.player, entries: group.entries, remaining };
      return;
    }
    if (!placeOrderedTriggers(s, group.entries, remaining)) return;
  }
}
function placeOrderedTriggers(s, entries, remaining) {
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry.modes) {
      const modes = legalTriggerModes(s, entry);
      if (!modes.length) {
        emit(s, 'triggerRemoved', { stackId: entry.id, name: entry.name, reason: 'no legal mode' });
        continue;
      }
      s.choice = {
        kind: 'triggerMode',
        player: entry.controller,
        entry,
        modes,
        remainingEntries: entries.slice(index + 1),
        remaining,
      };
      return false;
    }
    if (entry.targetGroups) {
      // Trigger declarations currently have independent groups, so existence is exact.
      if (
        entry.targetGroups.some(
          (g) =>
            targetsFor(s, g.selector, entry.controller, entry.targetingSource ?? entry.source)
              .length < g.min,
        )
      ) {
        emit(s, 'triggerRemoved', {
          stackId: entry.id,
          name: entry.name,
          reason: 'no legal target plan',
        });
        continue;
      }
      s.choice = {
        kind: 'triggerTargets',
        player: entry.controller,
        entry,
        remainingEntries: entries.slice(index + 1),
        remaining,
      };
      return false;
    }
    if (entry.targetKind) {
      const targets = targetsFor(
        s,
        entry.targetKind,
        entry.controller,
        entry.targetingSource ?? entry.source,
      );
      if (!targets.length) {
        // CR 603.3d: a trigger with no legal required choice is removed, not deferred.
        emit(s, 'triggerRemoved', {
          stackId: entry.id,
          name: entry.name,
          reason: 'no legal target',
        });
        continue;
      }
      s.choice = {
        kind: 'triggerTarget',
        player: entry.controller,
        entry,
        targets,
        remainingEntries: entries.slice(index + 1),
        remaining,
      };
      return false;
    }
    s.stack.push(entry);
  }
  return true;
}
/** CR 603.3c/700.2: modes are announced before their targets, never at resolution.
 * Independent target groups keep this existence check exact, not proposal-budget dependent. */
export function legalTriggerModes(s, entry) {
  return (entry.modes ?? []).flatMap((mode, index) => {
    const source = entry.targetingSource ?? entry.source;
    const legal = mode.targetGroups
      ? mode.targetGroups.every(
          (group) => targetsFor(s, group.selector, entry.controller, source).length >= group.min,
        )
      : !mode.target || targetsFor(s, mode.target, entry.controller, source).length > 0;
    return legal ? [index] : [];
  });
}
export function finishTriggerMode(s, mode) {
  const choice = s.choice,
    entry = choice.entry;
  requireRule(
    Number.isSafeInteger(mode) && legalTriggerModes(s, entry).includes(mode),
    'TRIGGER_MODE',
    'Choose a legal mode for the triggered ability.',
  );
  const selected = entry.modes[mode];
  entry.effects = structuredClone(selected.effects);
  entry.mode = mode;
  entry.label = `${entry.name} · ${selected.label}`;
  entry.modeLabel = selected.label;
  if (selected.target) entry.targetKind = structuredClone(selected.target);
  if (selected.targetGroups) entry.targetGroups = structuredClone(selected.targetGroups);
  delete entry.modes;
  s.choice = null;
  emit(s, 'triggerModeChosen', {
    stackId: entry.id,
    player: entry.controller,
    mode,
    label: selected.label,
  });
  if (placeOrderedTriggers(s, [entry, ...choice.remainingEntries], choice.remaining))
    placeTriggerGroups(s, choice.remaining);
}
export function finishTriggerOrder(s, ids) {
  const choice = s.choice,
    byId = Object.fromEntries(choice.entries.map((entry) => [entry.id, entry]));
  s.choice = null;
  if (
    placeOrderedTriggers(
      s,
      ids.map((id) => byId[id]),
      choice.remaining,
    )
  )
    placeTriggerGroups(s, choice.remaining);
}
export function finishTriggerTargets(s, targets) {
  const choice = s.choice,
    entry = choice.entry;
  const problem = targetPlanProblem(
    s,
    entry.targetGroups,
    targets,
    choice.player,
    entry.targetingSource ?? entry.source,
  );
  requireRule(!problem, 'TRIGGER_TARGETS', problem);
  entry.targets = structuredClone(targets);
  s.stack.push(entry);
  s.choice = null;
  notifyTargeted(s, entry);
  if (placeOrderedTriggers(s, choice.remainingEntries, choice.remaining))
    placeTriggerGroups(s, choice.remaining);
}
export function finishTriggerTarget(s, target) {
  const choice = s.choice,
    entry = choice.entry;
  requireRule(
    legalTarget(s, entry.targetKind, target, choice.player, entry.targetingSource ?? entry.source),
    'TRIGGER_TARGET',
    'Choose a legal target for the triggered ability.',
  );
  entry.target = structuredClone(target);
  s.stack.push(entry);
  s.choice = null;
  notifyTargeted(s, entry);
  if (placeOrderedTriggers(s, choice.remainingEntries, choice.remaining))
    placeTriggerGroups(s, choice.remaining);
}

export { queueTrigger, notifyTriggers } from './model.js';
