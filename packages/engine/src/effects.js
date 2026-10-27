import {
  flattenTargets,
  survivingTargets,
  targetPlanProblem,
  targetPlans,
} from './target-groups.js';
import { effectValues } from './numeric-values.js';
import { CREATURE_TYPES } from './creature-types.js';
import { meetsCondition } from './conditions.js';
import { searchableCards } from './library-search.js';
import { targetSpec, matchesFilter } from './selectors.js';
import { hasType } from './types.js';
import { costProblem, payCost } from './costs.js';
import { cardDefinition } from './cards.js';
import {
  untapObject,
  isAttacking,
  isBlocking,
  legalEquipmentAttachment,
  legalAuraAttachment,
  addObject,
  queueTrigger,
  notifyTriggers,
  captureDepartureContext,
  battlefield,
  creatures,
  definition,
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
export function legalTarget(s, kind, target, controller) {
  if (!kind) return target == null;
  const spec = targetSpec(kind);
  if (!spec || !target) return false;
  if (target.kind === 'player')
    return (
      (target.id === 0 || target.id === 1) &&
      ['player', 'damageable', 'playerOrPlaneswalker'].includes(spec.scope) &&
      matchesFilter({ controller: target.id, owner: target.id }, spec.where, controller)
    );
  if (target.kind === 'stack') {
    const entry = s.stack.find((e) => e.id === target.id);
    if (!entry || entry.kind !== 'spell' || spec.scope !== 'spell') return false;
    const source = s.objects[entry.source.id],
      d = definition(s, source);
    return matchesFilter(
      {
        definition: d,
        controller: entry.controller,
        owner: source?.owner,
        manaValue: Object.values(d.cost).reduce((a, b) => a + b, 0),
        power: d.power,
        toughness: d.toughness,
      },
      spec.where,
      controller,
    );
  }
  if (target.kind !== 'object' || !['permanent', 'damageable', 'graveyard'].includes(spec.scope))
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
  if (spec.scope === 'damageable' && !creature) return false;
  if (
    o.zone === 'battlefield' &&
    (hasKeyword(s, o, 'shroud') || (hasKeyword(s, o, 'hexproof') && o.controller !== controller))
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
      attacking: isAttacking(s, o),
      blocking: isBlocking(s, o),
      keywords: o.zone === 'battlefield' ? keywords(s, o) : d.keywords,
      power: pt.power,
      toughness: pt.toughness,
      manaValue: Object.values(d.cost).reduce((a, b) => a + b, 0),
    },
    spec.where,
    controller,
  );
}
export function targetsFor(s, kind, p) {
  if (!kind) return [];
  return [
    ...s.players.map((p) => ({ kind: 'player', id: p.id })),
    ...Object.values(s.objects)
      .filter((object) => ['battlefield', 'graveyard'].includes(object.zone))
      .map(ref),
    ...s.stack.map((e) => ({ kind: 'stack', id: e.id })),
  ].filter((t) => legalTarget(s, kind, t, p));
}
/** Ward is triggered, not a targeting restriction (CR 702.21). */
export function notifyTargeted(s, entry) {
  if (entry.targetGroups) {
    const seen = new Set();
    for (const target of flattenTargets(entry.targets)) {
      const key = `${target.kind}:${target.id}:${target.incarnation ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      notifyTargeted(s, { ...entry, targetGroups: undefined, target });
    }
    return;
  }
  if (entry.target?.kind !== 'object') return;
  const source = s.objects[entry.target.id];
  if (!source || source.zone !== 'battlefield' || source.controller === entry.controller) return;
  const cost = definition(s, source).ward;
  if (!cost) return;
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
function counterEntry(s, id) {
  const index = s.stack.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  if (s.stack[index].uncounterable) return;
  const [entry] = s.stack.splice(index, 1);
  const source = s.objects[entry.source.id];
  if (entry.kind === 'spell' && source?.zone === 'stack') move(s, source, 'graveyard');
  emit(s, 'countered', { name: entry.name, stackId: entry.id });
}
export function enterBattlefield(s, o, controller = o.owner, attachment = null, options = {}) {
  return enterBattlefieldBatch(s, [{ object: o, controller, attachment, tapped: options.tapped }]);
}
/** Move every entrant before observing any enters event, so simultaneous entrants see one another. */
export function enterBattlefieldBatch(s, entries, typeChoices = {}, auraChoices = {}) {
  let entering = entries.filter(
    ({ object }) =>
      object.zone !== 'battlefield' &&
      ['creature', 'artifact', 'enchantment', 'land'].includes(definition(s, object).type),
  );
  const chooser = entering.find(
    ({ object }) => definition(s, object).chooseCreatureType && !typeChoices[object.id],
  );
  if (chooser) {
    s.choice = {
      kind: 'creatureType',
      player: chooser.controller ?? chooser.object.owner,
      card: chooser.object.id,
      entries: entering.map(({ object, ...rest }) => ({ ...rest, object: ref(object) })),
      typeChoices,
      auraChoices,
      types: CREATURE_TYPES,
    };
    return false;
  }
  const ready = [];
  for (const item of entering) {
    const { object, controller = object.owner } = item;
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
    };
    return false;
  }
  entering = ready;
  const tappedReplacements = new Map(
    entering.map(({ object, controller = object.owner }) => [
      object.id,
      !!definition(s, object).entersTapped ||
        (definition(s, object).entersTappedUnless &&
          !meetsCondition(s, controller, definition(s, object).entersTappedUnless, [], object)),
    ]),
  );
  const entryCounters = new Map(
    entering.map(({ object, controller = object.owner }) => [
      object.id,
      battlefield(s).reduce((n, source) => {
        const bonus = definition(s, source).entryCounterBonus;
        return (
          n +
          (bonus &&
          source.controller === controller &&
          source.id !== object.id &&
          hasType(definition(s, object), 'creature') &&
          meetsCondition(s, controller, bonus.condition, [], source)
            ? bonus.amount
            : 0)
        );
      }, 0),
    ]),
  );
  for (const { object, controller = object.owner, attachment = null, tapped = false } of entering) {
    move(s, object, 'battlefield');
    object.controller = controller;
    if (typeChoices[object.id]) object.chosenCreatureType = typeChoices[object.id];
    object.attachedTo = attachment;
    object.plusCounters += entryCounters.get(object.id) ?? 0;
    if (definition(s, object).entryStunCounters)
      object.stunCounters = definition(s, object).entryStunCounters;
    object.tapped = !!tappedReplacements.get(object.id) || tapped;
  }
  for (const { object } of entering) {
    const d = definition(s, object);
    if (d.etb) queueTrigger(s, object, d.etb, `${object.name} · enters`);
    notifyTriggers(s, 'enters', { object });
  }
  return true;
}
export function finishCreatureTypeChoice(s, command) {
  const choice = s.choice;
  requireRule(
    command.type === 'chooseCreatureType' && CREATURE_TYPES.includes(command.creatureType),
    'CREATURE_TYPE',
    'Choose a valid creature type.',
  );
  const choices = { ...choice.typeChoices, [choice.card]: command.creatureType };
  const entries = choice.entries.map(({ object, ...rest }) => ({
    ...rest,
    object: s.objects[object.id],
  }));
  s.choice = null;
  if (enterBattlefieldBatch(s, entries, choices, choice.auraChoices ?? {}) !== false && s.resolving)
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
  if (enterBattlefieldBatch(s, entries, choice.typeChoices, selections) !== false && s.resolving)
    continueResolution(s);
}
/** Damage is marked before state-based actions. Caller batches combat packets. */
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
    o.damage += amount;
    if (source.keywords?.includes('deathtouch')) o.deathtouchDamage = true;
  }
  if (source.keywords?.includes('lifelink')) {
    s.players[source.controller].life += amount;
    if (lifeGains) {
      const key = `${source.id}:${source.incarnation ?? 0}:${source.controller}`;
      const gain = lifeGains.get(key) ?? { player: source.controller, amount: 0 };
      gain.amount += amount;
      lifeGains.set(key, gain);
    }
  }
  emit(s, 'damage', { source: source.id, target, amount, controller: source.controller });
  if (source.keywords?.includes('lifelink') && !lifeGains)
    notifyTriggers(s, 'lifeGain', { player: source.controller, amount });
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
export function resolveEffects(s, entry, startIndex = 0) {
  let effects = entry.effects ?? [];
  for (let index = startIndex; index < effects.length; index++) {
    const e = effectValues(s, effects[index], entry);
    if (e.op === 'conditional') {
      const branch = meetsCondition(s, entry.controller, e.condition, [], entry.source)
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
      } else if (['destroy', 'bounce', 'moveTarget'].includes(e.op)) {
        const context = captureDepartureContext(s);
        for (const target of targets) {
          const object = s.objects[target.id];
          if (target.kind !== 'object' || object?.incarnation !== target.incarnation) continue;
          const zone = e.op === 'moveTarget' ? ['battlefield', 'graveyard'] : ['battlefield'];
          if (!zone.includes(object.zone)) continue;
          if (e.op === 'destroy' && hasKeyword(s, object, 'indestructible')) continue;
          move(
            s,
            object,
            e.op === 'destroy' ? 'graveyard' : e.op === 'bounce' ? 'hand' : e.destination,
            context,
          );
        }
      } else {
        for (const target of targets) resolveEffects(s, { ...entry, target, effects: [effect] });
      }
      continue;
    }
    if (e.op === 'fight' || e.op === 'bite') {
      const currentCreature = (target) => {
        const object = target?.kind === 'object' && s.objects[target.id];
        return object?.zone === 'battlefield' &&
          object.incarnation === target.incarnation &&
          hasType(definition(s, object), 'creature')
          ? object
          : null;
      };
      const actor = currentCreature(entry.targets?.[e.sourceGroup]?.[0]);
      if (!actor) continue;
      const victims = (entry.targets?.[e.victimGroup] ?? []).map(currentCreature).filter(Boolean);
      const source = (object) => ({
        ...ref(object),
        controller: object.controller,
        definition: definition(s, object),
        keywords: keywords(s, object),
      });
      const packets = [];
      for (const victim of victims) {
        if (e.op === 'fight' && victim.id === actor.id) {
          packets.push({
            source: source(actor),
            target: ref(actor),
            amount: Math.max(0, stats(s, actor).power) * 2,
          });
          continue;
        }
        packets.push({
          source: source(actor),
          target: ref(victim),
          amount: Math.max(0, stats(s, actor).power),
        });
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
      e.subject === 'source'
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
      case 'destroyAll':
      case 'exileAll':
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
              const d = definition(s, object),
                pt = stats(s, object);
              return matchesFilter(
                {
                  definition: d,
                  controller: object.controller,
                  owner: object.owner,
                  token: object.token,
                  tapped: object.tapped,
                  attacking: isAttacking(s, object),
                  blocking: isBlocking(s, object),
                  keywords: keywords(s, object),
                  ...pt,
                  manaValue: Object.values(d.cost).reduce((a, b) => a + b, 0),
                },
                e.where,
                entry.controller,
              );
            })
          : [];
        if (e.op === 'destroyAll' || e.op === 'exileAll') {
          const victims = objects.filter(
            (object) => e.op === 'exileAll' || !hasKeyword(s, object, 'indestructible'),
          );
          const context = victims.length ? captureDepartureContext(s) : null;
          for (const object of victims)
            move(s, object, e.op === 'exileAll' ? 'exile' : 'graveyard', context);
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
        } else
          for (const object of objects) {
            if (e.op === 'modifyAll')
              s.modifiers.push({
                objectId: object.id,
                incarnation: object.incarnation,
                power: e.power,
                toughness: e.toughness,
                keywords: e.keywords ?? [],
                expires: s.turn,
              });
            else if (e.op === 'counterAll') object.plusCounters += e.amount;
            else if (e.op === 'untapAll') untapObject(s, object);
            else object.tapped = true;
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
      case 'stunOn':
        if (o) {
          const next = (o.stunCounters ?? 0) + e.amount;
          requireRule(Number.isSafeInteger(next), 'COUNTER_RANGE', 'Too many stun counters.');
          o.stunCounters = next;
        }
        break;
      case 'counterOn':
        if (o) o.plusCounters += e.amount;
        break;
      case 'tap':
      case 'untap':
        if (o) {
          if (e.op === 'untap') untapObject(s, o);
          else o.tapped = true;
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
      case 'bindingNegotiation': {
        s.resolving = { entry, index: index + 1, revealedPlayer: entry.target.id };
        s.choice = {
          kind: 'bindingNegotiation',
          player: entry.controller,
          cards: [...s.players[entry.target.id].hand],
          targetPlayer: entry.target.id,
        };
        return false;
      }
      case 'scry':
      case 'surveil': {
        if (e.count === 0) break;
        const cards = s.players[recipient].library.slice(0, e.count);
        if (!cards.length) {
          emit(s, e.op, { player: recipient, requested: e.count, looked: 0 });
          break;
        }
        s.resolving = { entry, index: index + 1 };
        s.choice = { kind: 'libraryOrder', player: recipient, action: e.op, cards };
        return false;
      }
      case 'searchLibrary': {
        const player = entry.controller;
        const cards = searchableCards(s, player, e.where);
        s.resolving = { entry, index: index + 1 };
        s.choice = {
          kind: 'librarySearch',
          player,
          cards,
          min: e.where ? 0 : Math.min(e.count, cards.length),
          max: Math.min(e.count, cards.length),
          destination: e.destination,
          tapped: !!e.tapped,
          reveal: !!e.reveal,
          where: e.where ? structuredClone(e.where) : null,
        };
        return false;
      }
      case 'discard': {
        const count = Math.min(e.count, s.players[recipient].hand.length);
        if (!count) break;
        s.resolving = { entry, index: index + 1 };
        s.choice = { kind: 'discardEffect', player: recipient, count };
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
      case 'offspringCopy': {
        const source = s.objects[entry.source.id];
        const base =
          source?.zone === 'battlefield' && source.incarnation === entry.source.incarnation
            ? definition(s, source)
            : entry.sourceDefinition;
        if (!base) break;
        const token = addObject(s, base.name, entry.controller, 'void');
        token.definitionOverride = {
          ...structuredClone(base),
          power: 1,
          toughness: 1,
          token: true,
        };
        // A fixed 1/1 copy exception does not copy a power/toughness-defining ability.
        delete token.definitionOverride.baseStats;
        token.token = true;
        enterBattlefield(s, token, entry.controller);
        break;
      }
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
        if (e.amount > 0) {
          s.players[recipient].life += e.amount;
          emit(s, 'lifeGain', { player: recipient, amount: e.amount });
          notifyTriggers(s, 'lifeGain', { player: recipient, amount: e.amount });
        }
        break;
      case 'loseLife':
        loseLife(s, recipient, e.amount);
        emit(s, 'lifeLost', { player: recipient, amount: e.amount });
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
                { tapped: e.tapped },
              ) === false
            ) {
              s.resolving.index = index + 1;
              return false;
            }
          } else move(s, candidate, e.destination);
        }
        break;
      case 'bounce':
        if (o) move(s, o, 'hand');
        break;
      case 'destroy':
        if (o && !hasKeyword(s, o, 'indestructible')) move(s, o, 'graveyard');
        break;
      case 'animateVehicle': {
        const source = s.objects[entry.source.id];
        if (
          source?.zone === 'battlefield' &&
          source.incarnation === entry.source.incarnation &&
          !source.faceDown &&
          definition(s, source).subtypes.includes('Vehicle')
        )
          s.modifiers.push({
            objectId: source.id,
            incarnation: source.incarnation,
            addTypes: ['artifact', 'creature'],
            expires: s.turn,
          });
        break;
      }
      case 'modify':
        if (o)
          s.modifiers.push({
            objectId: o.id,
            incarnation: o.incarnation,
            power: e.power,
            toughness: e.toughness,
            keywords: e.keywords ?? [],
            expires: s.turn,
          });
        break;
      case 'counter': {
        const i = s.stack.findIndex((x) => x.id === entry.target.id);
        if (i >= 0 && !s.stack[i].uncounterable) {
          const [countered] = s.stack.splice(i, 1);
          const card = s.objects[countered.source.id];
          if (card?.zone === 'stack') move(s, card, 'graveyard');
          emit(s, 'countered', { name: countered.name, stackId: countered.id });
        }
        break;
      }
      case 'token':
        for (let i = 0; i < e.count; i++) {
          const controller = e.player === 'targetController' ? entry.targetController : recipient;
          const token = addObject(s, e.definition, controller, 'void');
          enterBattlefield(s, token, controller, null, { tapped: e.tapped });
          if (token.zone === 'battlefield' && e.temporaryKeywords?.length)
            s.modifiers.push({
              objectId: token.id,
              incarnation: token.incarnation,
              power: 0,
              toughness: 0,
              keywords: [...e.temporaryKeywords],
              expires: s.turn,
            });
        }
        break;
      default:
        throw new Error(`Unimplemented effect opcode: ${e.op}`);
    }
  }
}
/** Resume the instruction cursor; choices do not create a priority window. */
export function continueResolution(s) {
  const frame = s.resolving;
  if (!frame) return;
  if (resolveEffects(s, frame.entry, frame.index) === false) return;
  const entry = frame.entry,
    object = s.objects[entry.source?.id];
  if (entry.kind === 'spell' && object?.zone === 'stack') move(s, object, 'graveyard');
  emit(s, 'resolved', { name: entry.name, stackId: entry.id });
  s.resolving = null;
  s.priority = s.active;
  s.passes = 0;
}
export function finishResolutionChoice(s, command) {
  const choice = s.choice;
  if (['exilePlay', 'bindingNegotiation', 'exileToGraveyard'].includes(choice.kind)) {
    requireRule(
      command.type === 'chooseResolutionCard',
      'RESOLUTION_CHOICE',
      'Choose a card for this effect.',
    );
    const id = command.card;
    requireRule(
      (id === null && choice.kind !== 'exilePlay') || choice.cards.includes(id),
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
    } else if (choice.kind === 'bindingNegotiation') {
      if (id !== null) {
        requireRule(
          s.objects[id].zone === 'hand' &&
            s.objects[id].owner === choice.targetPlayer &&
            definition(s, s.objects[id]).type !== 'land',
          'DISCARD_CHOICE',
          'Choose a nonland from the revealed hand.',
        );
        move(s, s.objects[id], 'graveyard');
      } else {
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
  if (choice.kind === 'optionalEffect') {
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
      'Choose whether to pay the ward cost.',
    );
    if (command.pay) payCost(s, choice.player, choice.cost);
    else counterEntry(s, choice.stackId);
    emit(s, 'wardPayment', { player: choice.player, paid: command.pay, stackId: choice.stackId });
  } else if (choice.kind === 'librarySearch') {
    requireRule(
      command.type === 'searchLibrary' && Array.isArray(command.cards),
      'SEARCH_CHOICE',
      'Choose the cards to find.',
    );
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
    emit(s, 'librarySearched', {
      player: choice.player,
      count: found.length,
      destination: choice.destination,
      ...(choice.reveal ? { revealed: found.map((o) => o.name) } : {}),
    });
    emit(s, 'libraryShuffled', { player: choice.player });
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
    const player = s.players[choice.player],
      inspected = new Set(choice.cards);
    if (choice.action === 'surveil')
      for (const id of command.rest) move(s, s.objects[id], 'graveyard');
    const remaining = player.library.filter((id) => !inspected.has(id));
    player.library = [
      ...command.top,
      ...remaining,
      ...(choice.action === 'scry' ? command.rest : []),
    ];
    emit(s, choice.action, {
      player: choice.player,
      looked: choice.cards.length,
      kept: command.top.length,
      moved: command.rest.length,
    });
  } else if (choice.kind === 'discardEffect') {
    requireRule(
      command.type === 'discardEffect',
      'CHOICE',
      'Choose cards to discard before resolution continues.',
    );
    requireRule(
      Array.isArray(command.cards) &&
        command.cards.length === choice.count &&
        new Set(command.cards).size === command.cards.length &&
        command.cards.every((id) => s.players[choice.player].hand.includes(id)),
      'DISCARD_CHOICE',
      `Choose exactly ${choice.count} distinct cards from your hand.`,
    );
    for (const id of command.cards) move(s, s.objects[id], 'graveyard');
    emit(s, 'discard', { player: choice.player, count: command.cards.length });
  } else throw new Error('Unexpected resolution choice.');
  if (s.choice !== choice) return;
  s.choice = null;
  continueResolution(s);
}
export function resolveTop(s) {
  const entry = s.stack.pop();
  if (!entry) return;
  if (entry.rule === 'increaseSpeed') {
    const player = s.players[entry.controller];
    if (player.speed > 0 && player.speed < 4) {
      player.speed++;
      emit(s, 'speedChanged', { player: player.id, speed: player.speed });
    }
    return;
  }
  if (entry.condition && !meetsCondition(s, entry.controller, entry.condition, [], entry.source))
    return;
  const object = s.objects[entry.source?.id],
    d = entry.kind === 'spell' && object ? definition(s, object) : null;
  if (entry.targetGroups) {
    const originalCount = flattenTargets(entry.targets).length;
    entry.targets = survivingTargets(s, entry.targetGroups, entry.targets, entry.controller);
    if (originalCount && !flattenTargets(entry.targets).length) {
      emit(s, 'fizzled', { name: entry.name, stackId: entry.id });
      if (entry.kind === 'spell' && object?.zone === 'stack') move(s, object, 'graveyard');
      return;
    }
  }
  if (entry.targetKind && !legalTarget(s, entry.targetKind, entry.target, entry.controller)) {
    emit(s, 'fizzled', { name: entry.name, stackId: entry.id });
    if (entry.kind === 'spell' && object?.zone === 'stack') move(s, object, 'graveyard');
    return;
  }
  if (entry.effects?.some((e) => e.op === 'token' && e.player === 'targetController'))
    entry.targetController =
      entry.target?.kind === 'player'
        ? entry.target.id
        : entry.target?.kind === 'stack'
          ? s.stack.find((v) => v.id === entry.target.id)?.controller
          : s.objects[entry.target?.id]?.controller;
  if (entry.kind === 'spell' && ['creature', 'enchantment', 'artifact'].includes(d.type)) {
    enterBattlefield(s, object, entry.controller, entry.target ?? null);
    if (entry.offspringPaid)
      queueTrigger(s, object, [{ op: 'offspringCopy' }], `${object.name} · offspring`);
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
    if (d.aura) {
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
    const byName = new Map();
    for (const o of battlefield(s)) {
      if (o.controller !== player || !definition(s, o).legendary) continue;
      if (!byName.has(o.name)) byName.set(o.name, []);
      byName.get(o.name).push(o.id);
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
    };
    return false;
  }
  return (
    applyStateBasedBatch(
      s,
      toGrave.map((o) => o.id),
    ) ||
    speedStarted ||
    detached
  );
}
function applyStateBasedBatch(s, ids) {
  let changed = false;
  const toGrave = [...new Set(ids)].map((id) => s.objects[id]);
  const departureContext = toGrave.length ? captureDepartureContext(s) : null;
  for (const o of toGrave) {
    move(s, o, 'graveyard', departureContext);
    changed = true;
  }
  // Deathtouch tracks damage since the previous state-based-action check.
  for (const o of battlefield(s)) o.deathtouchDamage = false;
  for (const o of Object.values(s.objects))
    if (o.token && o.zone !== 'battlefield') {
      for (const p of s.players)
        for (const zone of ['hand', 'graveyard', 'exile', 'library'])
          p[zone] = p[zone].filter((id) => id !== o.id);
      delete s.objects[o.id];
      changed = true;
    }
  return changed;
}
/** APNAP choices precede one simultaneous state-based-action batch (CR 101.4, 704). */
export function finishLegendChoice(s, card) {
  const choice = s.choice;
  requireRule(
    choice?.kind === 'legendRule' && choice.cards.includes(card),
    'LEGEND_CHOICE',
    'Choose one of these legendary permanents to keep.',
  );
  const toGrave = [...choice.toGrave, ...choice.cards.filter((id) => id !== card)];
  emit(s, 'legendChosen', { player: choice.player, name: choice.name, objectId: card });
  if (choice.remaining.length) {
    const [first, ...remaining] = choice.remaining;
    s.choice = { kind: 'legendRule', ...first, remaining, toGrave };
    return;
  }
  s.choice = null;
  applyStateBasedBatch(s, toGrave);
}
/** Stabilize before priority (CR 117.5). Trigger ordering remains an explicit choice. */
export function stabilize(s) {
  if (s.resolving) return;
  let iterations = 0;
  while (s.status === 'playing' && stateBasedActions(s)) {
    if (++iterations > 100) throw new Error('State-based action fixed point did not converge.');
  }
  if (s.status !== 'playing' || s.choice?.kind === 'legendRule' || !s.pendingTriggers.length)
    return;
  // Each player's simultaneous triggers must be ordered by that player, APNAP.
  const groups = [s.active, opponent(s.active)]
    .map((p) => ({ player: p, entries: s.pendingTriggers.filter((t) => t.controller === p) }))
    .filter((g) => g.entries.length);
  s.pendingTriggers = [];
  placeTriggerGroups(s, groups);
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
    if (entry.targetGroups) {
      // Trigger declarations currently have independent groups, so existence is exact.
      if (
        entry.targetGroups.some((g) => targetsFor(s, g.selector, entry.controller).length < g.min)
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
      const targets = targetsFor(s, entry.targetKind, entry.controller);
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
  const problem = targetPlanProblem(s, entry.targetGroups, targets, choice.player);
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
    legalTarget(s, entry.targetKind, target, choice.player),
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
