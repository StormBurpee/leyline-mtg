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
      case 'libraryOrder':
        return { type: 'orderLibrary', player: p, top: [...c.cards], rest: [] };
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
  const ability = actions.find(
    (a) =>
      a.type === 'activate' &&
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
      if (d.type === 'creature' || d.static)
        score = 5 + Object.values(d.cost).reduce((a, b) => a + b, 0);
      if (d.effects?.some((e) => e.op === 'token')) score = 6;
      if (d.effects?.some((e) => e.op === 'draw')) score = s.players[p].hand.length < 5 ? 5 : 1;
      const target = a.target?.kind === 'object' ? s.objects[a.target.id] : null;
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
