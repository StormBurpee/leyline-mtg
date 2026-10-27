import { canGainLife } from './effects.js';
import { manaValue } from './mana-value.js';
import { subtypesOf } from './creature-types.js';
import { predictedEffects } from './conditional-effects.js';
import { flattenTargets, targetPlans } from './target-groups.js';
import { castingProfile } from './casting-costs.js';
import { meetsCondition } from './conditions.js';
import { effectValues, numericValue } from './numeric-values.js';
import { spellProfile } from './spell-modes.js';
import { chooseSearchCards } from './library-search.js';
import {
  actionSafe,
  actionEffects,
  canPayTargetWard,
  directLethal,
  drawsFor,
  libraryCount,
  resolutionRisk,
} from './decision-safety.js';
import {
  chooseBlocks,
  plannedAttackDefenders,
  preserveForDefense,
  tacticalDamage,
  permanentValue,
} from './combat-policy.js';
import { orderLifePayoffs, acceptLifePayoff } from './combat-payoffs.js';
import { trickScore, combatRestrictionScore } from './trick-policy.js';
import { chooseLandAction } from './development-policy.js';
import { chooseDiscards, chooseLibraryOrder, chooseLibrarySelection } from './hand-policy.js';
import { chooseSequence } from './sequence-policy.js';
import { choosePlannedAttacks } from './attack-plan-policy.js';
import { planPayment } from './mana.js';
import { matchesEvent } from './events.js';
import { legalActions } from './engine.js';
import { canAttack, canBlock, suggestedDamage } from './combat.js';
import {
  controlled,
  definition as rawDefinition,
  hasKeyword,
  isPacified,
  isSick,
  opponent,
  stats,
} from './model.js';
// Estimate private-library selection using only public counts, never unknown faces.
function selectionYield(s, p, effect, source) {
  const e = effectValues(s, effect, { controller: p, source });
  return Math.min(e.count, e.selectCount ?? 1, libraryCount(s, p));
}
function groupedSpellScore(s, p, action, card) {
  const adjusted = new Map();
  let tempo = 0;
  const tempoTargets = new Set();
  const data = (target) => {
    const object = target?.kind === 'object' && s.objects[target.id];
    if (!object) return null;
    if (!adjusted.has(object.id))
      adjusted.set(object.id, { object, ...stats(s, object), damage: object.damage, death: false });
    return adjusted.get(object.id);
  };
  // Keep the lowered casting-profile instructions, including distributed shares.
  // Only resolve their conditions with the now-announced target bindings.
  const effects = predictedEffects(s, card.effects ?? [], {
    ...card,
    controller: p,
    source: card.source ?? {
      kind: 'object',
      id: action.card,
      incarnation: s.objects[action.card]?.incarnation,
    },
    targets: action.targets,
    additionalCost: action.additionalCost,
    x: action.x ?? 0,
  });
  for (const raw of effects) {
    const effect = effectValues(s, raw, {
      controller: p,
      x: action.x ?? 0,
      source: card.source ?? { id: action.card, incarnation: s.objects[action.card]?.incarnation },
    });
    const targets = action.targets[effect.targetGroup] ?? [];
    if (effect.op === 'counterAbility') {
      for (const target of targets) {
        const entry = s.stack.find((e) => e.id === target.id && e.kind === 'ability');
        if (entry && !entry.uncounterable)
          tempo += (entry.controller === p ? -1 : 1) * (5 + (effect.removeSourceAbilities ? 3 : 0));
      }
    }
    if (effect.op === 'removeAbilities') {
      for (const target of targets) {
        const object = s.objects[target.id];
        if (object) tempo += (object.controller === p ? -1 : 1) * (2 + keywords(s, object).length);
      }
    }
    if (effect.op === 'draw' && effect.player !== 'opponent') tempo += effect.count * 3;
    if (effect.op === 'lookChooseHand' && !['opponent', 'target'].includes(effect.player))
      tempo += selectionYield(s, p, effect, s.objects[action.card]) * 3;
    if (effect.op === 'token') tempo += effect.count * 2;
    if (effect.op === 'gainLife' && canGainLife(s) && effect.player !== 'opponent')
      tempo += effect.amount * 0.25;
    if (effect.op === 'delayedBlink') {
      for (const t of targets) {
        const d = data(t);
        if (!d) continue;
        // Blink is not permanent removal. Recover stolen cards, reuse ETBs, or save a threatened body.
        const owner = effect.controller === 'you' ? p : d.object.owner;
        tempo +=
          owner === p
            ? 1 +
              (definition(s, d.object).triggers?.some(
                (t) =>
                  t.event === 'selfEnters' ||
                  (t.event?.event === 'enter' && t.event.object === 'source'),
              )
                ? 2
                : 0)
            : 0.5;
      }
    }
    if (['bounce', 'moveTarget', 'exileUntilSourceLeaves'].includes(effect.op)) {
      for (const t of targets) {
        const d = data(t);
        if (!d) continue;
        const helpful =
          d.object.zone === 'graveyard' && effect.destination === 'hand'
            ? d.object.owner === p
            : d.object.controller !== p;
        tempo += (helpful ? 1 : -1) * (3 + value(s, d.object));
      }
    }
    if (['tap', 'stunOn'].includes(effect.op)) {
      for (const t of targets) {
        const d = data(t);
        if (!d || tempoTargets.has(d.object.id)) continue;
        tempoTargets.add(d.object.id);
        tempo +=
          (d.object.controller === p ? -1 : 1) *
          ((d.object.stunCounters ?? 0) > 0 ? 0.5 : 2 + value(s, d.object) * 0.4);
      }
    }
    if (effect.op === 'distributedCounters') {
      for (const t of targets) {
        const d = data(t),
          amount = action.distribution?.[t.id] ?? 0;
        if (!d) continue;
        tempo += (d.object.controller === p ? 1 : -1) * amount * 1.5;
        d.power += amount;
        d.toughness += amount;
      }
      if (card.adventureCast) tempo += 1;
    }
    if (effect.op === 'modify' || effect.op === 'counterOn') {
      const counters = effect.amount * (effect.counter === '-1/-1' ? -1 : 1);
      for (const t of targets) {
        const d = data(t);
        if (!d) continue;
        if (d.object.controller === p)
          tempo +=
            effect.op === 'modify'
              ? Math.max(0, effect.power + effect.toughness) * 0.25 + (effect.keywords?.length ?? 0)
              : counters;
        else if (effect.op === 'counterOn' && counters < 0) tempo -= counters;
        d.power += effect.op === 'modify' ? effect.power : counters;
        d.toughness += effect.op === 'modify' ? effect.toughness : counters;
      }
    }
    if (effect.op === 'fight' || effect.op === 'bite') {
      const actor = data(
        effect.source === 'source'
          ? { kind: 'object', ...(card.source ?? { id: action.card }) }
          : action.targets[effect.sourceGroup]?.[0],
      );
      if (!actor) continue;
      for (const t of action.targets[effect.victimGroup] ?? []) {
        const victim = data(t);
        if (!victim) continue;
        victim.damage += Math.max(0, actor.power);
        if (actor.power > 0 && hasKeyword(s, actor.object, 'deathtouch')) victim.death = true;
        if (effect.op === 'fight') {
          actor.damage += Math.max(0, victim.power);
          if (victim.power > 0 && hasKeyword(s, victim.object, 'deathtouch')) actor.death = true;
        }
      }
    }
    if (effect.op === 'damage')
      for (const t of targets) {
        const d = data(t);
        if (d) d.damage += effect.amount;
      }
    if (effect.op === 'destroy')
      for (const t of targets) {
        const d = data(t);
        if (d) d.death = true;
      }
  }
  let score = -1 + tempo;
  for (const d of adjusted.values()) {
    const killed =
      d.toughness <= 0 ||
      ((d.death || d.damage >= d.toughness) && !hasKeyword(s, d.object, 'indestructible'));
    if (killed) score += (d.object.controller === p ? -1 : 1) * (6 + value(s, d.object));
  }
  return score;
}

function definition(
  s,
  o,
  x = o.zone === 'stack' ? (o.chosenX ?? 0) : 0,
  additionalCost = null,
  bargained = !!o.bargained,
  action = {},
) {
  const d = rawDefinition(s, o),
    entry = {
      controller: o.controller,
      source: { kind: 'object', id: o.id, incarnation: o.incarnation },
      target: action.target,
      targets: action.targets,
      x,
      additionalCost,
      bargained,
    };
  const effects = (list, holder = d) =>
    list
      ? predictedEffects(s, list, {
          ...entry,
          targetKind: holder.target,
          targetGroups: holder.targetGroups,
        })
      : list;
  const activeAttached = (d.conditionalBonuses ?? []).filter(
    (b) => b.affects === 'attached' && meetsCondition(s, o.controller, b.condition, [], o),
  );
  const attachment = activeAttached.length
    ? {
        ...d.attachmentBonus,
        power: numericValue(s, d.attachmentBonus?.power ?? 0, entry),
        toughness: numericValue(s, d.attachmentBonus?.toughness ?? 0, entry),
        keywords: [...(d.attachmentBonus?.keywords ?? [])],
      }
    : null;
  if (attachment)
    for (const bonus of activeAttached) {
      attachment.power += numericValue(s, bonus.power, entry);
      attachment.toughness += numericValue(s, bonus.toughness, entry);
      attachment.keywords.push(...(bonus.keywords ?? []));
    }
  return {
    ...d,
    ...(d.effects ? { effects: effects(d.effects) } : {}),
    ...(d.etb ? { etb: effects(d.etb) } : {}),
    ...(d.activated
      ? { activated: d.activated.map((a) => ({ ...a, effects: effects(a.effects, a) })) }
      : {}),
    ...(d.attachmentBonus
      ? {
          attachmentBonus: {
            ...d.attachmentBonus,
            power: numericValue(s, d.attachmentBonus.power, entry),
            toughness: numericValue(s, d.attachmentBonus.toughness, entry),
          },
        }
      : {}),
    ...(d.static
      ? {
          static: {
            ...d.static,
            power: numericValue(s, d.static.power, entry),
            toughness: numericValue(s, d.static.toughness, entry),
          },
        }
      : {}),
    ...(attachment ? { attachmentBonus: attachment } : {}),
  };
}
const value = (s, o) => {
  const d = definition(s, o);
  return d.type === 'creature'
    ? stats(s, o).power + stats(s, o).toughness + d.keywords.length * 1.2
    : manaValue(d);
};
/** Deterministic, intentionally modest sparring bot. It never reads enemy hands
 * or libraries. No claim of competitive play strength or Monte Carlo search. */
export function chooseBotCommand(s, p) {
  if (s.status === 'finished') return null;
  const c = s.choice;
  if (c) {
    if (c.player !== p) return null;
    switch (c.kind) {
      case 'removeCounter': {
        const canUseTrigger =
          targetPlans(
            s,
            [{ id: 'reflexive', selector: c.reflexive.selector, min: 1, max: 1 }],
            p,
            1,
            c.source,
          ).length > 0;
        return {
          type: 'chooseCounter',
          player: p,
          counter: c.counters.includes('-1/-1')
            ? '-1/-1'
            : c.counters.includes('stun')
              ? 'stun'
              : !canUseTrigger
                ? null
                : c.counters.includes('hexproof')
                  ? 'hexproof'
                  : (c.counters[0] ?? null),
        };
      }
      case 'behold':
        return {
          type: 'chooseResolutionCard',
          player: p,
          card: c.cards.find((id) => s.objects[id].zone === 'battlefield') ?? c.cards[0] ?? null,
        };
      case 'castExiled': {
        if (c.discover === undefined && s.players[opponent(p)].life <= c.amount)
          return { type: 'declineCastExiled', player: p };
        const casts = legalActions(s, p).filter((a) => a.type === 'cast' && actionSafe(s, p, a));
        casts.sort((a, b) => {
          const score = (a) =>
            a.targets
              ? groupedSpellScore(
                  s,
                  p,
                  a,
                  castingProfile(
                    s,
                    p,
                    s.objects[a.card],
                    a.mode,
                    flattenTargets(a.targets),
                    undefined,
                    a.x,
                  ),
                )
              : a.target?.kind === 'player'
                ? a.target.id === opponent(p)
                  ? 4
                  : -4
                : a.target?.kind === 'object'
                  ? s.objects[a.target.id]?.controller === opponent(p)
                    ? 3
                    : 0
                  : 2;
          return score(b) - score(a);
        });
        return { ...(casts[0] ?? { type: 'declineCastExiled' }), player: p };
      }
      case 'manaColor': {
        const need = { W: 0, U: 0, B: 0, R: 0, G: 0 };
        for (const id of s.players[p].hand)
          for (const color of Object.keys(need))
            need[color] += definition(s, s.objects[id]).cost?.[color] ?? 0;
        const color = Object.keys(need).sort((a, b) => need[b] - need[a])[0];
        return { type: 'chooseManaColor', player: p, color };
      }
      case 'exilePlay':
      case 'bindingNegotiation':
      case 'revealDiscard':
      case 'exileToGraveyard': {
        const candidates = c.cards.filter((id) =>
          c.kind === 'revealDiscard'
            ? c.eligibleCards.includes(id)
            : c.kind !== 'bindingNegotiation' || definition(s, s.objects[id]).type !== 'land',
        );
        candidates.sort((a, b) => value(s, s.objects[b]) - value(s, s.objects[a]));
        return { type: 'chooseResolutionCard', player: p, card: candidates[0] ?? null };
      }
      case 'triggerMode': {
        const score = (index) =>
          c.entry.modes[index].effects.reduce((total, effect) => {
            if (effect.op === 'token') return total + 3 * (effect.count ?? 1);
            if (effect.op === 'draw') return total + 2 * (effect.count ?? 1);
            if (effect.op === 'scry') return total + (effect.count ?? 1);
            if (effect.op === 'gainLife')
              return total + (effect.amount ?? 0) * (s.players[p].life < 8 ? 2 : 0.3);
            return total + 1;
          }, 0);
        return {
          type: 'chooseTriggerMode',
          player: p,
          mode: [...c.modes].sort((a, b) => score(b) - score(a) || a - b)[0],
        };
      }
      case 'triggerTargets': {
        const plans = targetPlans(
          s,
          c.entry.targetGroups,
          p,
          256,
          c.entry.targetingSource ?? c.entry.source,
        );
        plans.sort(
          (a, b) =>
            groupedSpellScore(s, p, { targets: b }, c.entry) -
            groupedSpellScore(s, p, { targets: a }, c.entry),
        );
        return { type: 'chooseTriggerTargets', player: p, targets: plans[0] ?? {} };
      }
      case 'landType': {
        const mapping = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
        const score = (type) =>
          s.players[p].hand.reduce(
            (n, id) => n + (definition(s, s.objects[id]).cost?.[mapping[type]] ?? 0),
            0,
          );
        return {
          type: 'chooseLandType',
          player: p,
          landType: [...c.types].sort((a, b) => score(b) - score(a))[0],
        };
      }
      case 'entryLife':
        return {
          type: 'payEntryLife',
          player: p,
          pay: c.payable && !c.forcedTapped && s.players[p].life > c.amount + 3,
        };
      case 'auraEntry': {
        const d = definition(s, s.objects[c.card]);
        const harmful =
          d.aura === 'pacifism' ||
          d.attachmentBonus?.noUntap ||
          (d.attachmentBonus && d.attachmentBonus.power + d.attachmentBonus.toughness < 0);
        const score = (id) =>
          (s.objects[id].controller === p ? (harmful ? -1 : 1) : harmful ? 1 : -1) *
          value(s, s.objects[id]);
        return {
          type: 'chooseAuraAttachment',
          player: p,
          card: [...c.cards].sort((a, b) => score(b) - score(a))[0],
        };
      }
      case 'creatureType': {
        const counts = new Map();
        for (const o of Object.values(s.objects))
          if (o.owner === p && o.name)
            for (const type of subtypesOf(definition(s, o)))
              if (c.types.includes(type)) counts.set(type, (counts.get(type) ?? 0) + 1);
        return {
          type: 'chooseCreatureType',
          player: p,
          creatureType:
            [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'Human',
        };
      }
      case 'empowerJace':
        return {
          type: 'chooseResolutionCard',
          player: p,
          card: [...c.cards].sort(
            (a, b) =>
              (s.objects[b].loyalty ?? 0) - (s.objects[a].loyalty ?? 0) || a.localeCompare(b),
          )[0],
        };
      case 'attackDefenders':
        return {
          type: 'chooseAttackDefenders',
          player: p,
          defenders: plannedAttackDefenders(s, p, c.cards),
        };
      case 'legendRule':
        return {
          type: 'chooseLegend',
          player: p,
          card: [...c.cards].sort(
            (a, b) =>
              value(s, s.objects[b]) - value(s, s.objects[a]) ||
              Number(s.objects[a].tapped) - Number(s.objects[b].tapped) ||
              a.localeCompare(b),
          )[0],
        };
      case 'mulligan': {
        const lands = s.players[p].hand.filter(
          (id) => definition(s, s.objects[id]).type === 'land',
        ).length;
        return {
          type: s.players[p].mulligans < 2 && (lands < 2 || lands > 5) ? 'mulligan' : 'keep',
          player: p,
        };
      }
      case 'effectChoice': {
        const { entry, index } = s.resolving;
        const instruction = entry.effects[index - 1];
        const safe =
          entry.controller !== p
            ? c.options
            : c.options.filter(
                ({ index: option }) =>
                  !resolutionRisk(
                    s,
                    p,
                    [...instruction.options[option].effects, ...entry.effects.slice(index)],
                    entry.target,
                    0,
                    entry.source,
                    entry.eventAmount,
                    entry,
                  ),
              );
        return { type: 'chooseEffect', player: p, option: (safe[0] ?? c.options[0]).index };
      }
      case 'optionalEffect': {
        const entry = s.resolving.entry;
        return {
          type: 'resolveOptional',
          player: p,
          accept:
            acceptLifePayoff(s, entry) ??
            !resolutionRisk(
              s,
              p,
              entry.effects,
              entry.target,
              0,
              entry.source,
              entry.eventAmount,
              entry,
            ),
        };
      }
      case 'payCost':
        return {
          type: 'payCost',
          player: p,
          pay:
            c.payable &&
            !s.stack.find((entry) => entry.id === c.stackId)?.uncounterable &&
            (c.cost.life ?? 0) + (planPayment(s, p, c.cost.mana ?? {})?.life ?? 0) <
              s.players[p].life,
        };
      case 'landName': {
        const candidates = Object.values(s.objects).filter(
          (o) =>
            o.zone === 'battlefield' &&
            o.controller !== p &&
            definition(s, o).type === 'land' &&
            definition(s, o).activated?.length,
        );
        candidates.sort(
          (a, b) =>
            (definition(s, b).activated?.length ?? 0) - (definition(s, a).activated?.length ?? 0) ||
            a.name.localeCompare(b.name),
        );
        return {
          type: 'chooseLandName',
          player: p,
          name: candidates[0]?.name ?? s.choice.names[0],
        };
      }
      case 'librarySearch':
        return { type: 'searchLibrary', player: p, cards: chooseSearchCards(s, p) };
      case 'libraryOrder': {
        const canReanimate = s.players[p].hand.some((id) =>
          definition(s, s.objects[id]).effects?.some(
            (effect) => effect.op === 'moveTarget' && effect.destination === 'battlefield',
          ),
        );
        let rest =
          ['surveil', 'explore'].includes(c.action) && canReanimate
            ? c.cards.filter((id) => {
                const d = definition(s, s.objects[id]);
                return d.type === 'creature' && manaValue(d) >= 5;
              })
            : [];
        let ordered = chooseLibraryOrder(s, p, rest);
        if (c.action === 'lookChooseHand') {
          const count = c.selectCount ?? Math.min(1, c.cards.length);
          ordered = chooseLibrarySelection(s, p, count);
        }
        if (['surveil', 'explore'].includes(c.action)) {
          const entry = s.resolving.entry;
          const remaining = predictedEffects(s, entry.effects.slice(s.resolving.index), entry);
          const draws = drawsFor(remaining, entry.controller, entry.target, p, s);
          rest = ordered.rest.slice(0, Math.max(0, libraryCount(s, p) - draws));
          ordered = {
            top: [...ordered.top, ...ordered.rest.filter((id) => !rest.includes(id))],
            rest,
          };
        }
        return {
          type: 'orderLibrary',
          player: p,
          ...ordered,
        };
      }
      case 'sacrifice':
        return {
          type: 'sacrifice',
          player: p,
          cards: [...c.cards]
            .sort((a, b) => value(s, s.objects[a]) - value(s, s.objects[b]) || a.localeCompare(b))
            .slice(0, c.count),
        };
      case 'discardEffect':
        if (c.optional && libraryCount(s, p) === 0)
          return { type: 'discardEffect', player: p, cards: [] };
      case 'bottom':
      case 'discard': {
        const cards = chooseDiscards(s, p, c.count);
        return { type: c.kind, player: p, cards };
      }
      case 'triggerTarget': {
        const harmful = c.entry.effects.some(
          (effect) =>
            [
              'damage',
              'destroy',
              'bounce',
              'counter',
              'loseLife',
              'discard',
              'mill',
              'sacrifice',
              'exileUntilSourceLeaves',
            ].includes(effect.op) ||
            (effect.op === 'moveTarget' && effect.destination === 'exile') ||
            (effect.op === 'counterOn' && effect.counter === '-1/-1'),
        );
        const untapsTarget = c.entry.effects.some(
          (e) => e.op === 'untap' && e.subject !== 'source',
        );
        const drawsForTarget = c.entry.effects.some(
          (effect) => effect.op === 'draw' && effect.player === 'target',
        );
        const safe = c.targets.filter(
          (target) =>
            canPayTargetWard(s, p, target) &&
            !resolutionRisk(
              s,
              p,
              c.entry.effects,
              target,
              0,
              c.entry.source,
              c.entry.eventAmount,
              c.entry,
            ),
        );
        const targets = [...(safe.length ? safe : c.targets)].sort((a, b) => {
          const score = (target) => {
            const controller =
              target.kind === 'player'
                ? target.id
                : target.kind === 'object'
                  ? s.objects[target.id]?.controller
                  : s.stack.find((entry) => entry.id === target.id)?.controller;
            return (
              (controller === (harmful && !drawsForTarget ? 1 - p : p) ? 10 : 0) +
              (target.kind === 'object'
                ? value(s, s.objects[target.id]) +
                  (untapsTarget ? (s.objects[target.id].tapped ? 12 : -12) : 0) +
                  (c.entry.effects.some((e) => e.op === 'earthbend')
                    ? definition(s, s.objects[target.id]).types?.includes('creature')
                      ? -stats(s, s.objects[target.id]).power
                      : 10
                    : 0)
                : 0)
            );
          };
          return score(b) - score(a);
        });
        return { type: 'chooseTriggerTarget', player: p, target: targets[0] };
      }
      case 'orderTriggers':
        return { type: 'orderTriggers', player: p, ids: orderLifePayoffs(s, c.entries) };
      case 'assignDamage':
        return { type: 'assignDamage', player: p, orders: tacticalDamage(s) };
      case 'attackers': {
        const cards = choosePlannedAttacks(s, p);
        const defenders = plannedAttackDefenders(s, p, cards);
        return {
          type: 'attackers',
          player: p,
          cards,
          ...(Object.keys(defenders).length ? { defenders } : {}),
        };
      }
      case 'blockers':
        return { type: 'blockers', player: p, pairs: chooseBlocks(s, p).pairs };
    }
  }
  if (s.priority !== p) return null;
  const sacrificeValue = (action) =>
    (action.sacrifices ?? []).reduce((n, r) => n + permanentValue(s, s.objects[r.id]), 0);
  const actions = legalActions(s, p)
    .filter((action) => actionSafe(s, p, action))
    .sort((a, b) => sacrificeValue(a) - sacrificeValue(b));
  const saddling = actions.find(
    (a) =>
      a.type === 'saddle' &&
      s.step === 'main1' &&
      s.objects[a.card].saddledTurn !== s.turn &&
      !s.objects[a.card].tapped &&
      !isSick(s, s.objects[a.card]),
  );
  if (saddling) return { ...saddling, player: p };
  const crewing = actions.find(
    (a) =>
      a.type === 'crew' &&
      !definition(s, s.objects[a.card]).types?.includes('creature') &&
      !s.objects[a.card].tapped &&
      !s.stack.some(
        (e) => e.source?.id === a.card && e.effects?.some((x) => x.op === 'animateVehicle'),
      ) &&
      ((s.active === p && s.step === 'beginCombat' && !isSick(s, s.objects[a.card])) ||
        (s.active !== p && s.step === 'attackers' && s.combat.attackers.length)),
  );
  if (crewing) return { ...crewing, player: p };
  const groupedAbility = actions
    .filter((a) => a.type === 'activate' && a.targets)
    .map((a) => {
      const source = s.objects[a.card],
        ability = definition(s, source, undefined, undefined, undefined, a).activated[a.ability];
      return {
        a,
        score:
          groupedSpellScore(s, p, a, ability) -
          (ability.cost.sacrificeSelf ? value(s, source) : 0) -
          sacrificeValue(a) -
          (ability.cost.life ?? 0),
      };
    })
    .sort((a, b) => b.score - a.score)[0];
  if (groupedAbility?.score > 0) return { ...groupedAbility.a, player: p };
  const faceUp = actions.find((a) => a.type === 'turnFaceUp');
  if (faceUp) return { ...faceUp, player: p };
  const lethal = actions.find((action) => directLethal(s, p, action));
  if (lethal) return { ...lethal, player: p };
  const selectedSacrifice = actions
    .filter((a) => a.type === 'activate' && a.sacrifices && !a.targets)
    .map((a) => {
      const source = s.objects[a.card],
        ability = definition(s, source).activated[a.ability];
      const sourceSurvives =
        !ability.cost.sacrificeSelf && !a.sacrifices.some((r) => r.id === source.id);
      const threatened = s.stack.some((e) => e.controller !== p && e.target?.id === source.id);
      const effects = actionEffects(s, a);
      const pendingDraws = s.stack.reduce(
        (n, e) => n + drawsFor(e.effects ?? [], e.controller, e.target, p, s),
        0,
      );
      if (pendingDraws + drawsFor(effects, p, a.target, p, s) > libraryCount(s, p))
        return { a, score: -100 };
      const protectionPending = s.stack.some(
        (entry) =>
          entry.source?.id === source.id &&
          entry.source.incarnation === source.incarnation &&
          entry.effects?.some(
            (e) =>
              e.op === 'modify' &&
              e.subject === 'source' &&
              e.keywords?.some((k) => ['indestructible', 'hexproof'].includes(k)),
          ),
      );
      let score =
        -sacrificeValue(a) -
        (ability.cost.life ?? 0) -
        (ability.cost.sacrificeSelf ? value(s, source) : 0);
      for (const e of effects) {
        if (e.op === 'draw' && !['opponent', 'target'].includes(e.player)) score += e.count * 4;
        if (e.op === 'gainLife' && !['opponent', 'target'].includes(e.player) && canGainLife(s))
          score += e.amount * 0.25;
        if (e.op === 'surveil' || e.op === 'scry') score += 0.75;
        if (e.op === 'token') score += e.count * 3;
        if (
          e.op === 'counterOn' &&
          (e.subject === 'source'
            ? sourceSurvives
            : a.target?.kind === 'object' &&
              s.objects[a.target.id]?.controller === p &&
              !a.sacrifices.some((r) => r.id === a.target.id))
        )
          score += e.amount * 1.5;
        if (
          e.op === 'modify' &&
          sourceSurvives &&
          e.subject === 'source' &&
          threatened &&
          !protectionPending &&
          !e.keywords?.every((k) => hasKeyword(s, source, k)) &&
          e.keywords?.some((k) => ['indestructible', 'hexproof'].includes(k))
        )
          score += value(s, source) + 5;
        if (
          e.op === 'damageOpponent' ||
          (['damage', 'loseLife'].includes(e.op) &&
            (e.player === 'opponent' || (a.target?.kind === 'player' && a.target.id !== p)))
        )
          score += e.amount >= s.players[1 - p].life ? 100 : e.amount * 0.5;
        if (
          e.op === 'moveTarget' &&
          ['hand', 'battlefield'].includes(e.destination) &&
          a.target?.kind === 'object' &&
          s.objects[a.target.id]?.owner === p
        )
          score += value(s, s.objects[a.target.id]) + 3;
      }
      return { a, score };
    })
    .sort((a, b) => b.score - a.score);
  if (selectedSacrifice[0]?.score > 0) return { ...selectedSacrifice[0].a, player: p };
  const landCycling = actions.find(
    (a) =>
      a.type === 'cycle' &&
      ['Basic land', 'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Land'].includes(
        definition(s, s.objects[a.card]).cyclingType,
      ) &&
      !actions.some((cast) => cast.type === 'cast' && cast.card === a.card),
  );
  if (
    landCycling &&
    controlled(s, p).filter((o) => definition(s, o).mana).length < 5 &&
    !s.players[p].hand.some((id) => definition(s, s.objects[id]).type === 'land')
  )
    return { ...landCycling, player: p };
  const land = chooseLandAction(s, p, actions);
  if (land) {
    const landCard = definition(s, s.objects[land.card]);
    const setup = actions.find((action) => {
      if (action.type !== 'cast') return false;
      const card = definition(s, s.objects[action.card]);
      return (card.triggers ?? []).some((trigger) =>
        matchesEvent(
          trigger.event,
          'enter',
          { id: land.card, definition: landCard, controller: p, owner: p },
          { id: action.card, controller: p },
        ),
      );
    });
    if (setup) return { ...setup, player: p };
    return { ...land, player: p };
  }
  const ninjutsu = actions
    .filter((a) => a.type === 'ninjutsu')
    .filter(
      (a) =>
        !s.stack.some(
          (e) => e.source?.id === a.card && e.effects?.some((f) => f.op === 'ninjutsuEnter'),
        ),
    )
    .map((a) => {
      const attacker = s.objects[a.attacker.id];
      const form = definition(s, s.objects[a.card]).turnLoyaltyCreature;
      const threatened = s.stack.some((e) => e.controller !== p && e.target?.id === attacker.id);
      // Prefer converting small evasive bodies, or saving a threatened attacker.
      // After damage there is no immediate damage opportunity to sacrifice.
      const damageRemaining = ['blockers', 'firstDamage'].includes(s.step);
      return {
        a,
        score:
          (threatened ? 15 : 0) +
          5 -
          value(s, attacker) / 3 +
          (damageRemaining ? (form?.power ?? 0) - stats(s, attacker).power : 0),
      };
    })
    .sort((a, b) => b.score - a.score)[0];
  if (ninjutsu?.score > 0) return { ...ninjutsu.a, player: p };
  const loyalty = actions
    .filter(
      (a) =>
        a.type === 'activate' &&
        definition(s, s.objects[a.card]).activated[a.ability].loyalty !== undefined,
    )
    .map((a) => {
      const ability = definition(s, s.objects[a.card]).activated[a.ability];
      let score = 0;
      for (const e of ability.effects) {
        if (e.op === 'castDamageEmblem') score += 20;
        if (e.op === 'anthemEmblem')
          score +=
            4 + controlled(s, p).filter((o) => definition(s, o).subtypes.includes('Ninja')).length;
        if (
          e.op === 'conditional' &&
          e.condition?.kind === 'opponentLostLifeThisTurn' &&
          s.players[opponent(p)].lifeLostTurn === s.turn
        )
          score += 4;
        if (e.op === 'stunOn' && a.target?.kind === 'object') {
          const target = s.objects[a.target.id];
          if (target.controller !== p)
            score += 5 + Math.min(4, value(s, target) / 3) - (target.stunCounters ?? 0);
          else score -= 100;
        }
        if (e.op === 'impulseCastOrDamage')
          score += s.players[opponent(p)].life <= e.amount ? 100 : 6;
        if (e.op === 'draw' || e.op === 'surveil' || e.op === 'scry') score += 3;
        if (e.op === 'damage' && a.target?.kind === 'object') {
          const target = s.objects[a.target.id];
          if (
            target.controller !== p &&
            !hasKeyword(s, target, 'indestructible') &&
            stats(s, target).toughness - target.damage <= e.amount
          )
            score += 10 + value(s, target);
        }
      }
      return { a, score };
    })
    .sort((a, b) => b.score - a.score)[0];
  if (loyalty?.score > 0) return { ...loyalty.a, player: p };
  // Sacrifice is irreversible: preserve development pieces unless trading up,
  // responding to removal, or converting spare resources into cards.
  const sacrifices = actions
    .filter(
      (a) =>
        a.type === 'activate' &&
        !a.targets &&
        !a.sacrifices &&
        definition(s, s.objects[a.card]).activated[a.ability].cost.sacrificeSelf,
    )
    .map((a) => {
      const source = s.objects[a.card],
        d = definition(s, source),
        effect = d.activated[a.ability].effects;
      const target = a.target?.kind === 'object' ? s.objects[a.target.id] : null;
      const threatened = s.stack.some(
        (e) => e.controller !== p && e.target?.kind === 'object' && e.target.id === source.id,
      );
      let score = -100;
      const damage = effect.find((e) => e.op === 'damage');
      if (damage && a.target?.kind === 'player' && a.target.id !== p)
        score =
          s.players[a.target.id].life <= damage.amount
            ? 100
            : threatened
              ? 8
              : d.type === 'creature'
                ? -5
                : 2;
      if (
        damage &&
        target &&
        target.controller !== p &&
        !hasKeyword(s, target, 'indestructible') &&
        stats(s, target).toughness - target.damage <= damage.amount
      )
        score = 8 + value(s, target) - value(s, source) / 2;
      if (
        effect.some((e) => e.op === 'destroy') &&
        target?.controller !== p &&
        target &&
        !hasKeyword(s, target, 'indestructible')
      )
        score = 8 + value(s, target) - value(s, source) / 2;
      const movement = effect.find((e) => e.op === 'moveTarget');
      if (
        movement &&
        target?.zone === 'graveyard' &&
        ['hand', 'battlefield'].includes(movement.destination)
      )
        score = 7 + value(s, target);
      if (effect.some((e) => e.op === 'draw')) {
        const manaSources = controlled(s, p).filter((o) => definition(s, o).mana).length;
        score = threatened
          ? 9
          : d.mana && manaSources < 5
            ? -10
            : d.type === 'creature'
              ? -5
              : s.players[p].hand.length < 4
                ? 4
                : 0;
      }
      const selection = effect.find((e) => e.op === 'lookChooseHand');
      if (selection && !['opponent', 'target'].includes(selection.player)) {
        const gained = selectionYield(s, p, selection, source);
        score = gained
          ? Math.max(score, gained * 3 - (d.activated[a.ability].cost?.discard ?? 0) * 2)
          : -100;
      }
      const search = effect.find((e) => e.op === 'searchLibrary');
      if (search && libraryCount(s, p) > 0) {
        const manaSources = controlled(s, p).filter((o) => definition(s, o).mana).length;
        const reserve = d.type === 'creature' && preserveForDefense(s, source, p) && !threatened;
        score = reserve
          ? -10
          : search.destination === 'battlefield'
            ? manaSources < 7
              ? 12
              : 3
            : manaSources < 5 || s.players[p].hand.length < 4
              ? 6
              : 1;
      }
      const loss = effect.find((e) => e.op === 'loseLife');
      if (loss && (loss.player === 'opponent' || (loss.player === 'target' && a.target?.id !== p)))
        score = s.players[1 - p].life <= loss.amount ? 100 : threatened ? 8 : 2;
      if (
        a.target &&
        s.stack.some(
          (e) =>
            e.controller === p && e.target?.kind === a.target.kind && e.target.id === a.target.id,
        )
      )
        score = -100;
      return { a, score };
    })
    .sort((a, b) => b.score - a.score);
  if (sacrifices[0]?.score > 0) return { ...sacrifices[0].a, player: p };
  const lethalAbility = actions.find((a) => {
    if (a.type !== 'activate') return false;
    const ability = definition(s, s.objects[a.card]).activated[a.ability];
    if ((ability.cost.life ?? 0) >= s.players[p].life) return false;
    return ability.effects.some(
      (e) =>
        (e.op === 'damageOpponent' ||
          (e.op === 'damage' && a.target?.kind === 'player' && a.target.id === 1 - p) ||
          (e.op === 'loseLife' &&
            (e.player === 'opponent' || (e.player === 'target' && a.target?.id === 1 - p)))) &&
        e.amount >= s.players[1 - p].life,
    );
  });
  if (lethalAbility) return { ...lethalAbility, player: p };
  const defenseCache = new Map();
  const keepBlocker = (id) => {
    if (!defenseCache.has(id)) defenseCache.set(id, preserveForDefense(s, s.objects[id], p));
    return defenseCache.get(id);
  };
  const equip = actions
    .filter((action) => {
      if (action.type !== 'activate' || action.target?.kind !== 'object') return false;
      const object = s.objects[action.card],
        d = definition(s, object),
        ability = d.activated[action.ability];
      if (!ability.effects.some((effect) => effect.op === 'attachEquipment')) return false;
      const attached = object.attachedTo && s.objects[object.attachedTo.id];
      if (
        attached?.zone === 'battlefield' &&
        attached.incarnation === object.attachedTo.incarnation
      )
        return false;
      const bonus = d.attachmentBonus;
      return (
        bonus &&
        (bonus.power + bonus.toughness > 0 || bonus.keywords?.length) &&
        stats(s, s.objects[action.target.id]).toughness + bonus.toughness > 0
      );
    })
    .sort((a, b) => value(s, s.objects[b.target.id]) - value(s, s.objects[a.target.id]))[0];
  if (equip) return { ...equip, player: p };
  const ability = actions.find((action) => {
    if (action.type !== 'activate' || action.targets || action.sacrifices) return false;
    const activated = definition(s, s.objects[action.card]).activated[action.ability];
    if (activated.effects.some((e) => e.op === 'earthbend')) {
      const target = s.objects[action.target?.id];
      if (!target || target.controller !== p) return false;
      const amount = activated.effects.find((e) => e.op === 'earthbend').amount;
      const existing = stats(s, target);
      return !definition(s, target).types?.includes('creature') || amount > existing.power;
    }
    if (activated.effects.some((e) => e.op === 'animateLand')) {
      const source = s.objects[action.card];
      const plan = planPayment(s, p, activated.cost.mana ?? {});
      return (
        !source.tapped &&
        !definition(s, source).types?.includes('creature') &&
        !s.stack.some(
          (entry) =>
            entry.source?.id === source.id && entry.effects.some((e) => e.op === 'animateLand'),
        ) &&
        !!plan &&
        !plan.taps.includes(source.id) &&
        ((s.active === p && s.step === 'beginCombat' && !isSick(s, source)) ||
          (s.active !== p && s.step === 'attackers' && s.combat.attackers.length > 0))
      );
    }
    if (activated.effects.some((effect) => effect.op === 'explore'))
      return (
        activated.effects.every((effect) => effect.op === 'explore') &&
        (action.target ? s.objects[action.target.id]?.controller === p : true)
      );
    if (activated.cost.sacrificeSelf || (activated.cost.tap && keepBlocker(action.card)))
      return false;
    // Self-recursion is not a battlefield rescue. Paying again for the same
    // graveyard incarnation while its return is pending only wastes mana.
    if (
      activated.zone === 'graveyard' &&
      activated.effects.length > 0 &&
      activated.effects.every(
        (effect) =>
          effect.op === 'moveTarget' &&
          effect.subject === 'source' &&
          ['hand', 'battlefield'].includes(effect.destination),
      )
    ) {
      const source = s.objects[action.card];
      return !s.stack.some(
        (entry) =>
          entry.source?.id === source.id &&
          entry.source.incarnation === source.incarnation &&
          entry.effects.some(
            (effect) =>
              effect.op === 'moveTarget' &&
              effect.subject === 'source' &&
              ['hand', 'battlefield'].includes(effect.destination),
          ),
      );
    }
    if (
      activated.effects.some(
        (effect) =>
          effect.subject === 'source' &&
          (effect.op === 'bounce' || (effect.op === 'moveTarget' && effect.destination === 'hand')),
      )
    )
      return s.stack.some((entry) => entry.controller !== p && entry.target?.id === action.card);
    if (activated.effects.some((effect) => effect.subject === 'attached')) {
      const source = s.objects[action.card],
        target = source.attachedTo && s.objects[source.attachedTo.id];
      if (
        !target ||
        target.zone !== 'battlefield' ||
        target.incarnation !== source.attachedTo.incarnation
      )
        return false;
      if (
        activated.effects.some((effect) => ['destroy', 'bounce', 'moveTarget'].includes(effect.op))
      )
        return target.controller !== p;
      if (activated.effects.some((effect) => effect.op === 'untap'))
        return target.controller === p && target.tapped;
      if (activated.effects.some((effect) => effect.op === 'tap'))
        return target.controller !== p && !target.tapped;
      return false;
    }
    const selection = activated.effects.find((effect) => effect.op === 'lookChooseHand');
    if (selection)
      return (
        !['opponent', 'target'].includes(selection.player) &&
        selectionYield(s, p, selection, s.objects[action.card]) > 0
      );
    if (activated.effects.some((effect) => effect.op === 'untap' && effect.subject === 'source'))
      return !!s.objects[action.card].tapped;
    if (activated.effects.some((effect) => effect.op === 'combatRestriction'))
      return combatRestrictionScore(s, p, action) > 0;
    if (activated.effects.some((effect) => effect.op === 'modify'))
      return trickScore(s, p, action) > 0;
    return action.target?.kind === 'player' ? action.target.id !== p : !action.target;
  });
  if (ability) return { ...ability, player: p };
  const casts = actions
    .filter((a) => a.type === 'cast')
    .map((a) => {
      const profile = castingProfile(
        s,
        p,
        s.objects[a.card],
        a.mode,
        a.targets ? flattenTargets(a.targets) : a.target,
        definition(
          s,
          s.objects[a.card],
          a.x,
          a.additionalCost,
          !!spellProfile(rawDefinition(s, s.objects[a.card]), a.mode)?.bargained,
          a,
        ),
        a.x,
      );
      const d = { ...profile };
      const valuedEffects =
        a.x === undefined
          ? null
          : d.effects?.map((e) =>
              effectValues(s, e, { controller: p, source: s.objects[a.card], x: a.x ?? 0 }),
            );
      if (valuedEffects) d.effects = valuedEffects;
      let score = -100;
      if (d.targetGroups) return { a, score: groupedSpellScore(s, p, a, d) };
      if (d.type === 'creature' || d.type === 'planeswalker' || d.static || d.mana)
        score = 5 + manaValue(d);
      if (d.type === 'creature') {
        // Printed mana value is a cost, not the amount of board presence gained.
        // Compare actual bodies/abilities; include known cantrip ETBs and mana
        // development without assuming what an unknown draw will contain.
        score = 2 + permanentValue(s, s.objects[a.card]);
        score += (d.etb ?? []).reduce(
          (sum, effect) => sum + (effect.op === 'draw' ? effect.count * 3 : 0),
          0,
        );
        if (d.mana && controlled(s, p).filter((o) => definition(s, o).mana).length < 5) score += 3;
        if (resolutionRisk(s, p, d.etb ?? [], a.target)) score = -100;
      }
      // Sagas are developing permanents, not inert enchantments. Chapter
      // choices still use the same public-information trigger target policies.
      const chapters = (d.triggers ?? []).filter((t) => t.event?.event === 'chapter');
      if (chapters.length) score = Math.max(score, 5 + chapters.length);
      if (d.attachmentBonus)
        score = controlled(s, p).some((o) => definition(s, o).type === 'creature')
          ? 4 + d.attachmentBonus.power + d.attachmentBonus.toughness
          : 0.5;
      if (d.static?.kind === 'anthem')
        score +=
          controlled(s, p).filter((o) => definition(s, o).type === 'creature').length *
          (d.static.power + d.static.toughness);
      if (d.effects?.some((e) => e.op === 'token' && e.player !== 'targetController')) score = 6;
      const search = d.effects?.find((e) => e.op === 'searchLibrary');
      const searchAbility = d.activated?.some((a) =>
        a.effects.some((e) => e.op === 'searchLibrary'),
      );
      if (search && libraryCount(s, p) > 0) score = search.destination === 'battlefield' ? 9 : 6;
      if (searchAbility) score = Math.max(score, 4);
      if (
        d.etb?.some((e) => e.op === 'searchLibrary') ||
        d.triggers?.some((t) =>
          (t.effects ?? t.modes?.flatMap((mode) => mode.effects) ?? []).some(
            (e) => e.op === 'searchLibrary',
          ),
        )
      )
        score = Math.max(score, 6);

      if (d.effects?.some((e) => e.op === 'damageOpponent')) score = Math.max(score, 2);
      if (d.effects?.some((e) => e.op === 'draw')) score = s.players[p].hand.length < 5 ? 5 : 1;
      if (d.type === 'creature' && !s.stack.length && s.active === p && s.step === 'main1') {
        const enables = actions
          .filter((other) => other.type === 'cast' && other.card !== a.card)
          .some((other) => {
            const next = definition(s, s.objects[other.card]);
            const cost = { ...d.cost };
            for (const [color, n] of Object.entries(next.cost))
              cost[color] = (cost[color] ?? 0) + n;
            if (!planPayment(s, p, cost)) return false;
            return (d.triggers ?? []).some((trigger) =>
              matchesEvent(
                trigger.event,
                'cast',
                { definition: next, controller: p, owner: p },
                { id: a.card, controller: p },
              ),
            );
          });
        if (enables) score += 10;
      }
      const target = a.target?.kind === 'object' ? s.objects[a.target.id] : null;
      if (
        target &&
        target.controller !== p &&
        d.effects?.some((e) => ['tap', 'stunOn'].includes(e.op))
      )
        score = (target.stunCounters ?? 0) > 0 ? -1 : 2 + value(s, target) * 0.4;
      const negativeCounters = d.effects?.find(
        (effect) => effect.op === 'counterOn' && effect.counter === '-1/-1',
      );
      if (negativeCounters && target)
        score =
          target.controller === p
            ? -100
            : stats(s, target).toughness <= negativeCounters.amount ||
                (!hasKeyword(s, target, 'indestructible') &&
                  stats(s, target).toughness - target.damage <= negativeCounters.amount)
              ? 8 + value(s, target)
              : negativeCounters.amount;
      const movement = d.effects?.find((effect) => effect.op === 'moveTarget');
      if (movement && target) {
        if (target.zone === 'graveyard' && ['hand', 'battlefield'].includes(movement.destination))
          score = target.owner === p ? 7 + value(s, target) : -100;
        else if (movement.destination === 'exile')
          score = target.controller !== p ? 8 + value(s, target) : -100;
      }
      const selection = d.effects?.find((effect) => effect.op === 'lookChooseHand');
      if (selection) {
        const helpful =
          selection.player !== 'opponent' && (selection.player !== 'target' || a.target?.id === p);
        const gained = selectionYield(s, p, selection, s.objects[a.card]);
        score = helpful && gained ? Math.max(score, 2 + gained * 3) : -100;
      }
      if (d.effects?.some((e) => e.op === 'explore') && target?.controller === p)
        score = Math.max(score, 3 + value(s, target) * 0.2);
      if (d.effects?.some((e) => e.op === 'optionalDiscardDraw'))
        score = s.players[p].hand.length > 0 && libraryCount(s, p) > 0 ? 4 : -1;
      const drawEffect = d.effects?.find((effect) => effect.op === 'draw');
      if (drawEffect?.player === 'target' && a.target?.id !== p) score = -50;
      const discardEffect = d.effects?.find((effect) => effect.op === 'discard');
      if (
        discardEffect &&
        (discardEffect.player === 'opponent' ||
          (discardEffect.player === 'target' && a.target?.id !== p))
      )
        score = (s.players[1 - p].handCount ?? s.players[1 - p].hand.length) ? 7 : -10;
      const lifeLoss = d.effects?.find((effect) => effect.op === 'loseLife');
      if (
        lifeLoss &&
        (lifeLoss.player === 'opponent' || (lifeLoss.player === 'target' && a.target?.id !== p))
      )
        score =
          s.players[1 - p].life <= lifeLoss.amount ? 100 : drawEffect ? score : Math.max(score, 3);
      const dmg = d.effects?.find((e) => e.op === 'damage');
      if (dmg) {
        if (a.target.kind === 'player' && a.target.id !== p)
          score = s.players[a.target.id].life <= dmg.amount ? 100 : 2;
        else if (
          target &&
          target.controller !== p &&
          !hasKeyword(s, target, 'indestructible') &&
          stats(s, target).toughness - target.damage <= dmg.amount
        )
          score = 8 + value(s, target);
      }
      if (d.effects?.some((e) => e.op === 'counter')) {
        const entry = s.stack.find((e) => e.id === a.target.id);
        if (entry?.controller !== p) {
          const counter = d.effects.find((e) => e.op === 'counter');
          score = counter.unlessPay && planPayment(s, entry.controller, counter.unlessPay) ? 3 : 12;
        }
      }
      if (
        target &&
        target.controller !== p &&
        (d.aura === 'pacifism' ||
          d.effects?.some(
            (e) =>
              e.op === 'bounce' || (e.op === 'destroy' && !hasKeyword(s, target, 'indestructible')),
          ))
      )
        score = 6 + value(s, target);
      // A second Pacifism does not neutralize another threat. Existing pacified
      // bodies can still have relevant abilities, so only reject the redundant
      // combat restriction, not all removal targeting those permanents.
      if (d.aura === 'creature' && target) {
        const bonus = d.attachmentBonus;
        const harmful = bonus?.noUntap || (bonus && bonus.power + bonus.toughness < 0);
        score =
          target.controller === p
            ? harmful
              ? -100
              : 3 + value(s, target) * 0.5
            : harmful
              ? 3 + value(s, target)
              : -100;
      }
      if (d.aura === 'pacifism' && target && isPacified(s, target)) score = -100;
      if (d.effects?.some((e) => e.op === 'modify') && target?.controller === p)
        score = Math.max(score, trickScore(s, p, a));
      if (d.effects?.some((e) => e.op === 'combatRestriction'))
        score = Math.max(score, combatRestrictionScore(s, p, a));
      // Do not pile redundant damage/removal on the same target while it waits.
      if (
        a.target &&
        s.stack.some(
          (e) =>
            e.controller === p && e.target?.id === a.target.id && e.target?.kind === a.target.kind,
        )
      )
        score = -100;
      if (
        a.x !== undefined &&
        d.effects?.length === 1 &&
        d.effects[0].op === 'draw' &&
        d.effects[0].count === 0
      )
        score = -100;
      if (a.x !== undefined && score > 0) score += a.x / 1001;
      return { a, score };
    })
    .map(({ a, score }) => ({
      a,
      score:
        score -
        (a.sacrifice ? permanentValue(s, s.objects[a.sacrifice.id]) : 0) -
        (a.additionalCost?.life ? (s.players[p].life <= 5 ? 20 : 1.5) : 0) -
        (a.additionalCost?.discard
          ? value(s, s.objects[a.additionalCost.discard.id]) * 0.5 + 1
          : 0) -
        (a.additionalCost?.blight
          ? stats(s, s.objects[a.additionalCost.blight.id]).toughness <= 1
            ? permanentValue(s, s.objects[a.additionalCost.blight.id]) + 2
            : 0.5
          : 0) -
        (a.additionalCost?.teamwork?.length ?? 0) * 0.5,
    }))
    .sort((a, b) => b.score - a.score);
  const sequence = chooseSequence(s, p, casts);
  const cast =
    casts[0]?.a.targets && casts[0].score > 0
      ? casts[0].a
      : (sequence?.action ?? (casts[0]?.score > 0 ? casts[0].a : null));
  if (cast) {
    const d = definition(s, s.objects[cast.card]);
    // Choose the best play before delaying an ordinary creature until main two.
    // Removing it from scoring would spend its reserved mana on weaker spells.
    // Haste, mana, static effects, ETBs and cast triggers can affect this combat.
    const delay =
      s.active === p &&
      s.step === 'main1' &&
      !s.stack.length &&
      d.type === 'creature' &&
      !d.mana &&
      !d.static &&
      !d.etb?.length &&
      !d.triggers?.length &&
      !d.keywords.includes('haste') &&
      Object.values(s.objects).some((o) => canAttack(s, o, p));
    if (!delay) return { ...cast, player: p };
  }
  const plotting = actions.find(
    (a) => a.type === 'plot' && !actions.some((c) => c.type === 'cast' && c.card === a.card),
  );
  if (plotting) return { ...plotting, player: p };
  return { type: 'pass', player: p };
}
