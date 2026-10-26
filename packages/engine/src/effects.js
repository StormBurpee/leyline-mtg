import { costProblem, payCost } from './costs.js';
import { cardDefinition } from './cards.js';
import {
  addObject,
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
  requireRule,
} from './model.js';
export function legalTarget(s, kind, target, controller) {
  if (!kind) return target == null;
  if (!target) return false;
  if (target.kind === 'player')
    return (
      (target.id === 0 || target.id === 1) &&
      ['any', 'player', 'opponent'].includes(kind) &&
      (kind !== 'opponent' || target.id !== controller)
    );
  if (target.kind === 'stack') {
    const entry = s.stack.find((e) => e.id === target.id);
    return (
      !!entry &&
      entry.kind === 'spell' &&
      (kind === 'spell' ||
        (kind === 'noncreatureSpell' && cardDefinition(entry.name, s.catalog).type !== 'creature'))
    );
  }
  if (target.kind !== 'object') return false;
  const o = s.objects[target.id];
  if (!o || o.zone !== 'battlefield' || o.incarnation !== target.incarnation) return false;
  const d = definition(s, o);
  if (d.type !== 'creature') return false;
  if (hasKeyword(s, o, 'shroud') || (hasKeyword(s, o, 'hexproof') && o.controller !== controller))
    return false;
  return (
    ['any', 'creature'].includes(kind) || (kind === 'nonblackCreature' && !d.color.includes('B'))
  );
}
export function targetsFor(s, kind, p) {
  if (!kind) return [];
  return [
    ...s.players.map((p) => ({ kind: 'player', id: p.id })),
    ...creatures(s).map(ref),
    ...s.stack.map((e) => ({ kind: 'stack', id: e.id })),
  ].filter((t) => legalTarget(s, kind, t, p));
}
export function queueTrigger(s, source, effects, label) {
  s.pendingTriggers.push({
    id: `s${++s.nextId}`,
    kind: 'ability',
    name: source.name,
    source: ref(source),
    controller: source.controller,
    effects: structuredClone(effects),
    sourceKeywords: keywords(s, source),
    label,
  });
  emit(s, 'triggered', { objectId: source.id, name: source.name, player: source.controller });
}
/** Ward is triggered, not a targeting restriction (CR 702.21). */
export function notifyTargeted(s, entry) {
  if (entry.target?.kind !== 'object') return;
  const source = s.objects[entry.target.id];
  if (!source || source.controller === entry.controller) return;
  const cost = definition(s, source).ward;
  if (!cost) return;
  s.pendingTriggers.push({
    id: `s${++s.nextId}`,
    kind: 'ability',
    name: source.name,
    source: ref(source),
    controller: source.controller,
    sourceKeywords: keywords(s, source),
    effects: [{ op: 'wardPayment', cost: structuredClone(cost) }],
    relatedStackId: entry.id,
    label: `${source.name} · ward`,
  });
  emit(s, 'triggered', { objectId: source.id, name: source.name, player: source.controller });
}
function counterEntry(s, id) {
  const index = s.stack.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  const [entry] = s.stack.splice(index, 1);
  const source = s.objects[entry.source.id];
  if (entry.kind === 'spell' && source?.zone === 'stack') move(s, source, 'graveyard');
  emit(s, 'countered', { name: entry.name, stackId: entry.id });
}
export function enterBattlefield(s, o, controller = o.owner, attachment = null) {
  move(s, o, 'battlefield');
  o.controller = controller;
  o.attachedTo = attachment;
  const d = definition(s, o);
  if (d.etb) queueTrigger(s, o, d.etb, `${o.name} · enters`);
  if (d.type === 'creature') notifyTriggers(s, 'creatureEnters', { object: o });
}
/** Match declarative trigger predicates against committed game events. */
export function notifyTriggers(s, event, payload) {
  for (const watcher of battlefield(s))
    for (const trigger of definition(s, watcher).triggers ?? []) {
      const match =
        (trigger.event === 'otherCreatureEnters' &&
          event === 'creatureEnters' &&
          watcher.id !== payload.object.id) ||
        (event === 'cast' &&
          watcher.controller === payload.player &&
          trigger.event === 'controllerCastsNoncreature' &&
          payload.definition.type !== 'creature') ||
        (event === 'cast' &&
          watcher.controller === payload.player &&
          trigger.event === 'controllerCastsInstantOrSorcery' &&
          ['instant', 'sorcery'].includes(payload.definition.type));
      if (match) queueTrigger(s, watcher, trigger.effects, `${watcher.name} · triggered ability`);
    }
}
/** Damage is marked before state-based actions. Caller batches combat packets. */
export function dealDamage(s, source, target, amount) {
  if (amount <= 0) return;
  if (target.kind === 'player') s.players[target.id].life -= amount;
  else {
    const o = s.objects[target.id];
    if (!o || o.zone !== 'battlefield' || o.incarnation !== target.incarnation) return;
    o.damage += amount;
    if (source.keywords?.includes('deathtouch')) o.deathtouchDamage = true;
  }
  if (source.keywords?.includes('lifelink')) s.players[source.controller].life += amount;
  emit(s, 'damage', { source: source.id, target, amount, controller: source.controller });
}
function damageSource(s, entry) {
  const source = s.objects[entry.source?.id];
  const current =
    source &&
    source.incarnation === entry.source.incarnation &&
    source.zone === (entry.kind === 'spell' ? 'stack' : 'battlefield');
  return {
    id: entry.source?.id,
    controller: current ? source.controller : (entry.sourceController ?? entry.controller),
    keywords: current ? keywords(s, source) : (entry.sourceKeywords ?? []),
  };
}
export function resolveEffects(s, entry, startIndex = 0) {
  const effects = entry.effects ?? [];
  for (let index = startIndex; index < effects.length; index++) {
    const e = effects[index];
    const target = e.subject === 'source' ? entry.source : entry.target;
    const candidate = target?.kind === 'object' ? s.objects[target.id] : null;
    const o =
      candidate?.zone === 'battlefield' && candidate.incarnation === target.incarnation
        ? candidate
        : null;
    switch (e.op) {
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
      case 'counterOn':
        if (o) o.plusCounters += e.amount;
        break;
      case 'untap':
        if (o) o.tapped = false;
        break;
      case 'scry':
      case 'surveil': {
        if (e.count === 0) break;
        const cards = s.players[entry.controller].library.slice(0, e.count);
        if (!cards.length) {
          emit(s, e.op, { player: entry.controller, requested: e.count, looked: 0 });
          break;
        }
        s.resolving = { entry, index: index + 1 };
        s.choice = { kind: 'libraryOrder', player: entry.controller, action: e.op, cards };
        return false;
      }
      case 'discard': {
        const count = Math.min(e.count, s.players[entry.controller].hand.length);
        if (!count) break;
        s.resolving = { entry, index: index + 1 };
        s.choice = { kind: 'discardEffect', player: entry.controller, count };
        return false;
      }
      case 'draw':
        draw(s, entry.controller, e.count);
        break;
      case 'gainLife':
        s.players[entry.controller].life += e.amount;
        emit(s, 'lifeGain', { player: entry.controller, amount: e.amount });
        break;
      case 'bounce':
        if (o) move(s, o, 'hand');
        break;
      case 'destroy':
        if (o && !hasKeyword(s, o, 'indestructible')) move(s, o, 'graveyard');
        break;
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
        if (i >= 0) {
          const [countered] = s.stack.splice(i, 1);
          const card = s.objects[countered.source.id];
          if (card?.zone === 'stack') move(s, card, 'graveyard');
          emit(s, 'countered', { name: countered.name, stackId: countered.id });
        }
        break;
      }
      case 'token':
        for (let i = 0; i < e.count; i++) {
          const token = addObject(s, e.definition, entry.controller, 'void');
          enterBattlefield(s, token, entry.controller);
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
  if (choice.kind === 'payCost') {
    requireRule(
      command.type === 'payCost' && typeof command.pay === 'boolean',
      'PAYMENT_CHOICE',
      'Choose whether to pay the ward cost.',
    );
    if (command.pay) payCost(s, choice.player, choice.cost);
    else counterEntry(s, choice.stackId);
    emit(s, 'wardPayment', { player: choice.player, paid: command.pay, stackId: choice.stackId });
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
  s.choice = null;
  continueResolution(s);
}
export function resolveTop(s) {
  const entry = s.stack.pop();
  if (!entry) return;
  const d = cardDefinition(entry.name, s.catalog),
    object = s.objects[entry.source?.id];
  if (entry.targetKind && !legalTarget(s, entry.targetKind, entry.target, entry.controller)) {
    emit(s, 'fizzled', { name: entry.name, stackId: entry.id });
    if (entry.kind === 'spell' && object?.zone === 'stack') move(s, object, 'graveyard');
    return;
  }
  if (entry.kind === 'spell' && ['creature', 'enchantment', 'artifact'].includes(d.type)) {
    enterBattlefield(s, object, entry.controller, entry.target ?? null);
    emit(s, 'resolved', { name: entry.name, stackId: entry.id });
  } else {
    s.resolving = { entry, index: 0 };
    emit(s, 'resolutionStarted', { name: entry.name, stackId: entry.id });
    continueResolution(s);
  }
}
/** All supported state-based actions are computed from one pre-action state. */
export function stateBasedActions(s) {
  if (s.resolving) return false;
  let changed = false;
  const losers = s.players.filter((p) => p.life <= 0 || p.failedDraw).map((p) => p.id);
  if (losers.length) {
    s.status = 'finished';
    s.winner = losers.length === 2 ? null : opponent(losers[0]);
    s.choice = null;
    emit(s, 'gameOver', {
      winner: s.winner,
      reason: losers.some((p) => s.players[p].failedDraw) ? 'emptyLibrary' : 'life',
    });
    return true;
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
    if (d.aura) {
      const target = s.objects[o.attachedTo?.id];
      if (
        !target ||
        target.zone !== 'battlefield' ||
        target.incarnation !== o.attachedTo.incarnation ||
        definition(s, target).type !== 'creature'
      )
        toGrave.push(o);
    }
  }
  for (const o of toGrave) {
    move(s, o, 'graveyard');
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
/** Stabilize before priority (CR 117.5). Trigger ordering remains an explicit choice. */
export function stabilize(s) {
  if (s.resolving) return;
  let iterations = 0;
  while (s.status === 'playing' && stateBasedActions(s)) {
    if (++iterations > 100) throw new Error('State-based action fixed point did not converge.');
  }
  if (s.status !== 'playing' || !s.pendingTriggers.length) return;
  // Each player's simultaneous triggers must be ordered by that player, APNAP.
  const groups = [s.active, opponent(s.active)]
    .map((p) => ({ player: p, entries: s.pendingTriggers.filter((t) => t.controller === p) }))
    .filter((g) => g.entries.length);
  s.pendingTriggers = [];
  for (const g of groups) {
    if (g.entries.length === 1) {
      s.stack.push(g.entries[0]);
      continue;
    }
    s.choice = {
      kind: 'orderTriggers',
      player: g.player,
      entries: g.entries,
      remaining: groups.slice(groups.indexOf(g) + 1),
    };
    return;
  }
}
export function finishTriggerOrder(s, ids) {
  const choice = s.choice,
    byId = Object.fromEntries(choice.entries.map((e) => [e.id, e]));
  for (const id of ids) s.stack.push(byId[id]);
  s.choice = null;
  for (const g of choice.remaining) {
    if (g.entries.length === 1) s.stack.push(g.entries[0]);
    else {
      s.choice = {
        kind: 'orderTriggers',
        player: g.player,
        entries: g.entries,
        remaining: choice.remaining.slice(choice.remaining.indexOf(g) + 1),
      };
      return;
    }
  }
}
