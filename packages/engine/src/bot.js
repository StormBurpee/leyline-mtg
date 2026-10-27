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
  canPayTargetWard,
  directLethal,
  drawsFor,
  libraryCount,
  resolutionRisk,
} from './decision-safety.js';
import {
  chooseBlocks,
  preserveForDefense,
  tacticalDamage,
  permanentValue,
} from './combat-policy.js';
import { orderLifePayoffs, acceptLifePayoff } from './combat-payoffs.js';
import { trickScore } from './trick-policy.js';
import { chooseLandAction } from './development-policy.js';
import { chooseDiscards, chooseLibraryOrder } from './hand-policy.js';
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
  opponent,
  stats,
} from './model.js';
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
  for (const raw of card.effects ?? []) {
    const effect = effectValues(s, raw, {
      controller: p,
      source: card.source ?? { id: action.card, incarnation: s.objects[action.card]?.incarnation },
    });
    const targets = action.targets[effect.targetGroup] ?? [];
    if (effect.op === 'draw' && effect.player !== 'opponent') tempo += effect.count * 3;
    if (effect.op === 'token') tempo += effect.count * 2;
    if (effect.op === 'gainLife' && effect.player !== 'opponent') tempo += effect.amount * 0.25;
    if (['bounce', 'moveTarget'].includes(effect.op)) {
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
    if (effect.op === 'modify' || effect.op === 'counterOn') {
      for (const t of targets) {
        const d = data(t);
        if (!d) continue;
        if (d.object.controller === p)
          tempo +=
            effect.op === 'modify'
              ? Math.max(0, effect.power + effect.toughness) * 0.25 + (effect.keywords?.length ?? 0)
              : effect.amount;
        d.power += effect.op === 'modify' ? effect.power : effect.amount;
        d.toughness += effect.op === 'modify' ? effect.toughness : effect.amount;
      }
    }
    if (effect.op === 'fight' || effect.op === 'bite') {
      const actor = data(action.targets[effect.sourceGroup]?.[0]);
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

function definition(s, o) {
  const d = rawDefinition(s, o),
    entry = { controller: o.controller, source: { id: o.id, incarnation: o.incarnation } };
  const effects = (list) => (list ? predictedEffects(s, list, entry) : list);
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
      ? { activated: d.activated.map((a) => ({ ...a, effects: effects(a.effects) })) }
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
    : Object.values(d.cost).reduce((a, b) => a + b, 0);
};
/** Deterministic, intentionally modest sparring bot. It never reads enemy hands
 * or libraries. No claim of competitive play strength or Monte Carlo search. */
export function chooseBotCommand(s, p) {
  if (s.status === 'finished') return null;
  const c = s.choice;
  if (c) {
    if (c.player !== p) return null;
    switch (c.kind) {
      case 'exilePlay':
      case 'bindingNegotiation':
      case 'exileToGraveyard': {
        const candidates = c.cards.filter(
          (id) => c.kind !== 'bindingNegotiation' || definition(s, s.objects[id]).type !== 'land',
        );
        candidates.sort((a, b) => value(s, s.objects[b]) - value(s, s.objects[a]));
        return { type: 'chooseResolutionCard', player: p, card: candidates[0] ?? null };
      }
      case 'triggerTargets': {
        const plans = targetPlans(s, c.entry.targetGroups, p);
        plans.sort(
          (a, b) =>
            groupedSpellScore(s, p, { targets: b }, c.entry) -
            groupedSpellScore(s, p, { targets: a }, c.entry),
        );
        return { type: 'chooseTriggerTargets', player: p, targets: plans[0] ?? {} };
      }
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
      case 'optionalEffect': {
        const entry = s.resolving.entry;
        return {
          type: 'resolveOptional',
          player: p,
          accept:
            acceptLifePayoff(s, entry) ??
            !resolutionRisk(s, p, entry.effects, entry.target, 0, entry.source, entry.eventAmount),
        };
      }
      case 'payCost':
        return {
          type: 'payCost',
          player: p,
          pay: c.payable && (c.cost.life ?? 0) < s.players[p].life,
        };
      case 'librarySearch':
        return { type: 'searchLibrary', player: p, cards: chooseSearchCards(s, p) };
      case 'libraryOrder': {
        const canReanimate = s.players[p].hand.some((id) =>
          definition(s, s.objects[id]).effects?.some(
            (effect) => effect.op === 'moveTarget' && effect.destination === 'battlefield',
          ),
        );
        let rest =
          c.action === 'surveil' && canReanimate
            ? c.cards.filter((id) => {
                const d = definition(s, s.objects[id]);
                return (
                  d.type === 'creature' && Object.values(d.cost).reduce((a, b) => a + b, 0) >= 5
                );
              })
            : [];
        let ordered = chooseLibraryOrder(s, p, rest);
        if (c.action === 'surveil') {
          const entry = s.resolving.entry;
          const remaining = predictedEffects(s, entry.effects.slice(s.resolving.index), entry);
          const draws = drawsFor(remaining, entry.controller, entry.target, p);
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
      case 'discardEffect':
      case 'bottom':
      case 'discard': {
        const cards = chooseDiscards(s, p, c.count);
        return { type: c.kind, player: p, cards };
      }
      case 'triggerTarget': {
        const harmful = c.entry.effects.some(
          (effect) =>
            ['damage', 'destroy', 'bounce', 'counter', 'loseLife', 'discard', 'mill'].includes(
              effect.op,
            ) ||
            (effect.op === 'moveTarget' && effect.destination === 'exile'),
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
            !resolutionRisk(s, p, c.entry.effects, target, 0, c.entry.source),
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
                  (untapsTarget ? (s.objects[target.id].tapped ? 12 : -12) : 0)
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
      case 'attackers':
        return { type: 'attackers', player: p, cards: choosePlannedAttacks(s, p) };
      case 'blockers':
        return { type: 'blockers', player: p, pairs: chooseBlocks(s, p).pairs };
    }
  }
  if (s.priority !== p) return null;
  const actions = legalActions(s, p).filter((action) => actionSafe(s, p, action));
  const groupedAbility = actions
    .filter((a) => a.type === 'activate' && a.targets)
    .map((a) => {
      const source = s.objects[a.card],
        ability = definition(s, source).activated[a.ability];
      return {
        a,
        score:
          groupedSpellScore(s, p, a, ability) -
          (ability.cost.sacrificeSelf ? value(s, source) : 0) -
          (ability.cost.life ?? 0),
      };
    })
    .sort((a, b) => b.score - a.score)[0];
  if (groupedAbility?.score > 0) return { ...groupedAbility.a, player: p };
  const faceUp = actions.find((a) => a.type === 'turnFaceUp');
  if (faceUp) return { ...faceUp, player: p };
  const lethal = actions.find((action) => directLethal(s, p, action));
  if (lethal) return { ...lethal, player: p };
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
  // Sacrifice is irreversible: preserve development pieces unless trading up,
  // responding to removal, or converting spare resources into cards.
  const sacrifices = actions
    .filter(
      (a) =>
        a.type === 'activate' &&
        !a.targets &&
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
    if (action.type !== 'activate' || action.targets) return false;
    const activated = definition(s, s.objects[action.card]).activated[action.ability];
    if (activated.cost.sacrificeSelf || (activated.cost.tap && keepBlocker(action.card)))
      return false;
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
    if (activated.effects.some((effect) => effect.op === 'untap' && effect.subject === 'source'))
      return !!s.objects[action.card].tapped;
    if (activated.effects.some((effect) => effect.op === 'modify'))
      return trickScore(s, p, action) > 0;
    return action.target?.kind === 'player' ? action.target.id !== p : !action.target;
  });
  if (ability) return { ...ability, player: p };
  const casts = actions
    .filter((a) => a.type === 'cast')
    .map((a) => {
      const d = castingProfile(
        s,
        p,
        s.objects[a.card],
        a.mode,
        a.targets ? flattenTargets(a.targets) : a.target,
        definition(s, s.objects[a.card]),
      );
      let score = -100;
      if (d.targetGroups) return { a, score: groupedSpellScore(s, p, a, d) };
      if (d.type === 'creature' || d.static || d.mana)
        score = 5 + Object.values(d.cost).reduce((a, b) => a + b, 0);
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
      if (d.attachmentBonus)
        score = controlled(s, p).some((o) => definition(s, o).type === 'creature')
          ? 4 + d.attachmentBonus.power + d.attachmentBonus.toughness
          : 0.5;
      if (d.static?.kind === 'anthem')
        score +=
          controlled(s, p).filter((o) => definition(s, o).type === 'creature').length *
          (d.static.power + d.static.toughness);
      if (d.effects?.some((e) => e.op === 'token')) score = 6;
      const search = d.effects?.find((e) => e.op === 'searchLibrary');
      const searchAbility = d.activated?.some((a) =>
        a.effects.some((e) => e.op === 'searchLibrary'),
      );
      if (search && libraryCount(s, p) > 0) score = search.destination === 'battlefield' ? 9 : 6;
      if (searchAbility) score = Math.max(score, 4);
      if (
        d.etb?.some((e) => e.op === 'searchLibrary') ||
        d.triggers?.some((t) => t.effects.some((e) => e.op === 'searchLibrary'))
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
      const movement = d.effects?.find((effect) => effect.op === 'moveTarget');
      if (movement && target) {
        if (target.zone === 'graveyard' && ['hand', 'battlefield'].includes(movement.destination))
          score = target.owner === p ? 7 + value(s, target) : -100;
        else if (movement.destination === 'exile')
          score = target.controller !== p ? 8 + value(s, target) : -100;
      }
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
        if (entry?.controller !== p) score = 12;
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
      // Do not pile redundant damage/removal on the same target while it waits.
      if (
        a.target &&
        s.stack.some(
          (e) =>
            e.controller === p && e.target?.id === a.target.id && e.target?.kind === a.target.kind,
        )
      )
        score = -100;
      return { a, score };
    })
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
  return { type: 'pass', player: p };
}
