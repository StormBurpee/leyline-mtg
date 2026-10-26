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
        const drawCount = s.resolving.entry.effects
          .filter((e) => e.op === 'draw')
          .reduce((n, e) => n + e.count, 0);
        const libraryCount = s.players[p].libraryCount ?? s.players[p].library.length;
        return { type: 'resolveOptional', player: p, accept: drawCount <= libraryCount };
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
        const rest =
          c.action === 'surveil' && canReanimate
            ? c.cards.filter((id) => {
                const d = definition(s, s.objects[id]);
                return (
                  d.type === 'creature' && Object.values(d.cost).reduce((a, b) => a + b, 0) >= 5
                );
              })
            : [];
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
        const targets = [...c.targets].sort((a, b) => {
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
        return { type: 'orderTriggers', player: p, ids: c.entries.map((e) => e.id) };
      case 'assignDamage':
        return { type: 'assignDamage', player: p, orders: suggestedDamage(s) };
      case 'attackers': {
        const defenders = controlled(s, opponent(p)).filter(
          (o) => definition(s, o).type === 'creature' && !o.tapped,
        );
        const cards = controlled(s, p)
          .filter((o) => canAttack(s, o, p))
          .filter((a) => {
            const possible = defenders.filter((b) => canBlock(s, b, a, opponent(p)));
            return (
              !possible.length ||
              hasKeyword(s, a, 'vigilance') ||
              hasKeyword(s, a, 'trample') ||
              possible.every(
                (b) =>
                  stats(s, a).power >= stats(s, b).toughness &&
                  stats(s, a).toughness > stats(s, b).power,
              ) ||
              s.players[opponent(p)].life <= stats(s, a).power
            );
          })
          .map((o) => o.id);
        return { type: 'attackers', player: p, cards };
      }
      case 'blockers': {
        const available = controlled(s, p).filter(
          (o) => definition(s, o).type === 'creature' && !o.tapped,
        );
        const pairs = [];
        for (const ar of s.combat.attackers) {
          const a = s.objects[ar.id];
          if (a?.zone !== 'battlefield') continue;
          const blockers = available
            .filter((b) => canBlock(s, b, a, p))
            .sort((a, b) => value(s, a) - value(s, b));
          if (hasKeyword(s, a, 'menace')) {
            if (blockers.length >= 2) {
              for (const b of blockers.slice(0, 2)) {
                pairs.push({ blocker: b.id, attacker: a.id });
                available.splice(available.indexOf(b), 1);
              }
            }
            continue;
          }
          const b = blockers.find(
            (b) =>
              stats(s, b).toughness > stats(s, a).power ||
              stats(s, b).power >= stats(s, a).toughness ||
              hasKeyword(s, b, 'deathtouch') ||
              s.players[p].life <= stats(s, a).power + 3,
          );
          if (b) {
            pairs.push({ blocker: b.id, attacker: a.id });
            available.splice(available.indexOf(b), 1);
          }
        }
        return { type: 'blockers', player: p, pairs };
      }
    }
  }
  if (s.priority !== p) return null;
  const actions = legalActions(s, p);
  const land = actions.find((a) => a.type === 'playLand');
  if (land) return { ...land, player: p };
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
        stats(s, target).toughness - target.damage <= damage.amount
      )
        score = 8 + value(s, target) - value(s, source) / 2;
      if (effect.some((e) => e.op === 'destroy') && target?.controller !== p && target)
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
  const ability = actions.find(
    (a) =>
      a.type === 'activate' &&
      !definition(s, s.objects[a.card]).activated[a.ability].cost.sacrificeSelf &&
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
      if (d.effects?.some((e) => e.op === 'draw')) score = s.players[p].hand.length < 5 ? 5 : 1;
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
          stats(s, target).toughness - target.damage <= dmg.amount
        )
          score = 8 + value(s, target);
      }
      if (d.effects?.some((e) => e.op === 'counter')) {
        const entry = s.stack.find((e) => e.id === a.target.id);
        if (entry?.controller !== p) score = 12;
      }
      if (
        (d.aura || d.effects?.some((e) => ['destroy', 'bounce'].includes(e.op))) &&
        target?.controller !== p
      )
        score = target ? 6 + value(s, target) : -100;
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
