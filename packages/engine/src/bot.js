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
  chooseAttacks,
  preserveForDefense,
  tacticalDamage,
} from './combat-policy.js';
import { orderLifePayoffs, acceptLifePayoff } from './combat-payoffs.js';
import { chooseLandAction } from './development-policy.js';
import { planPayment } from './mana.js';
import { matchesEvent } from './events.js';
import { legalActions } from './engine.js';
import { canAttack, canBlock, suggestedDamage } from './combat.js';
import { controlled, definition, hasKeyword, opponent, stats } from './model.js';
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
          accept: acceptLifePayoff(s, entry) ?? !resolutionRisk(s, p, entry.effects, entry.target),
        };
      }
      case 'payCost':
        return {
          type: 'payCost',
          player: p,
          pay: c.payable && (c.cost.life ?? 0) < s.players[p].life,
        };
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
        if (c.action === 'surveil') {
          const entry = s.resolving.entry;
          const remaining = entry.effects.slice(s.resolving.index);
          const draws = drawsFor(remaining, entry.controller, entry.target, p);
          rest = rest.slice(0, Math.max(0, libraryCount(s, p) - draws));
        }
        return {
          type: 'orderLibrary',
          player: p,
          top: c.cards.filter((id) => !rest.includes(id)),
          rest,
        };
      }
      case 'discardEffect':
      case 'bottom':
      case 'discard': {
        const cards = [...s.players[p].hand]
          .sort((a, b) => {
            const da = definition(s, s.objects[a]),
              db = definition(s, s.objects[b]);
            const landCount = s.players[p].hand.filter(
              (id) => definition(s, s.objects[id]).type === 'land',
            ).length;
            const score = (d) =>
              d.type === 'land'
                ? landCount > 3
                  ? -10
                  : 10
                : 8 - Object.values(d.cost).reduce((a, b) => a + b, 0);
            return score(da) - score(db);
          })
          .slice(0, c.count);
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
        const drawsForTarget = c.entry.effects.some(
          (effect) => effect.op === 'draw' && effect.player === 'target',
        );
        const safe = c.targets.filter(
          (target) =>
            canPayTargetWard(s, p, target) && !resolutionRisk(s, p, c.entry.effects, target),
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
              (target.kind === 'object' ? value(s, s.objects[target.id]) : 0)
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
        return { type: 'attackers', player: p, cards: chooseAttacks(s, p) };
      case 'blockers':
        return { type: 'blockers', player: p, pairs: chooseBlocks(s, p).pairs };
    }
  }
  if (s.priority !== p) return null;
  const actions = legalActions(s, p).filter((action) => actionSafe(s, p, action));
  const lethal = actions.find((action) => directLethal(s, p, action));
  if (lethal) return { ...lethal, player: p };
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
  const ability = actions.find(
    (a) =>
      a.type === 'activate' &&
      !definition(s, s.objects[a.card]).activated[a.ability].cost.sacrificeSelf &&
      !(definition(s, s.objects[a.card]).activated[a.ability].cost.tap && keepBlocker(a.card)) &&
      (a.target?.kind === 'player' ? a.target.id !== p : !a.target) &&
      (!definition(s, s.objects[a.card]).activated[a.ability].effects.some(
        (e) => e.op === 'modify',
      ) ||
        ['blockers', 'firstDamage'].includes(s.step)),
  );
  if (ability) return { ...ability, player: p };
  const casts = actions
    .filter((a) => a.type === 'cast')
    .map((a) => {
      const d = definition(s, s.objects[a.card]);
      let score = -100;
      if (d.type === 'creature' || d.static || d.mana)
        score = 5 + Object.values(d.cost).reduce((a, b) => a + b, 0);
      if (d.effects?.some((e) => e.op === 'token')) score = 6;
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
        (d.aura ||
          d.effects?.some(
            (e) =>
              e.op === 'bounce' || (e.op === 'destroy' && !hasKeyword(s, target, 'indestructible')),
          ))
      )
        score = 6 + value(s, target);
      if (d.effects?.some((e) => e.op === 'modify') && target?.controller === p) {
        const inCombat =
          s.combat.attackers.some((r) => r.id === target.id) ||
          Object.values(s.combat.blocks)
            .flat()
            .some((r) => r.id === target.id);
        if (inCombat && s.step === 'blockers') score = 9;
      }
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
  if (casts[0]?.score > 0) return { ...casts[0].a, player: p };
  return { type: 'pass', player: p };
}
