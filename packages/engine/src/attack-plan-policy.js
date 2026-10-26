import { chooseAttacks, combatOutcome } from './combat-policy.js';
import { legalActions } from './engine.js';
import { actionEffects, actionSafe, libraryCount } from './decision-safety.js';
import { projectedModifiers, trickScore } from './trick-policy.js';
import { definition, ref, hasKeyword } from './model.js';

export const ATTACK_TRICK_BUDGET = 48;

/** Search one affordable known modifier spell after the public blocker reply.
 * Opponent cards are never sampled or inspected. This assumes the trick resolves;
 * unknown opposing interaction and alternative blocker policies remain risks.
 * The actual policy replans after blocks and can hold the card if the line changed.
 */
export function choosePlannedAttacks(s, p) {
  const hand = s.players[p].hand;
  if (
    !hand.some((id) => {
      const d = definition(s, s.objects[id]);
      return (
        d.type === 'instant' &&
        [d, ...(d.modes ?? [])].some((profile) => profile.effects?.some((e) => e.op === 'modify'))
      );
    })
  )
    return chooseAttacks(s, p);
  let remaining = ATTACK_TRICK_BUDGET;
  return chooseAttacks(s, p, {
    improveOutcome: ({ state, cards, response, evaluate }) => {
      if (remaining <= 0) return null;
      const objects = Object.fromEntries(
        Object.values(state.objects)
          .filter((o) => o.zone === 'battlefield')
          .map((o) => [o.id, o]),
      );
      for (const id of hand) objects[id] = s.objects[id];
      for (const id of cards)
        if (!hasKeyword(state, objects[id], 'vigilance'))
          objects[id] = { ...objects[id], tapped: true };
      const blocks = {};
      for (const { blocker, attacker } of response.pairs)
        (blocks[attacker] ??= []).push(ref(objects[blocker]));
      const forecast = {
        ...state,
        objects,
        catalog: s.catalog,
        step: 'blockers',
        choice: null,
        priority: p,
        stack: [],
        players: state.players.map((entry, i) =>
          i === p
            ? { ...entry, hand, mana: s.players[p].mana, libraryCount: libraryCount(s, p) }
            : entry,
        ),
        combat: { ...state.combat, blocks, blocked: Object.keys(blocks) },
      };
      const candidates = legalActions(forecast, p)
        .filter((a) => {
          if (a.type !== 'cast' || a.target?.kind !== 'object' || !cards.includes(a.target.id))
            return false;
          const effects = actionEffects(forecast, a);
          return (
            effects.length && effects.every((e) => e.op === 'modify') && actionSafe(forecast, p, a)
          );
        })
        .slice(0, 8);
      let best = null,
        bestScore = evaluate(response.outcome);
      for (const action of candidates) {
        if (remaining <= 0) break;
        remaining--;
        if (trickScore(forecast, p, action) <= 0) continue;
        const projected = projectedModifiers(forecast, p, action);
        const outcome = combatOutcome(projected, response.pairs, {
          attackers: cards,
          blocked: Object.keys(blocks),
        });
        // Charge a card rather than crediting temporary power as lasting material.
        const expense = 5;
        const score = evaluate(outcome) - expense;
        if (score > bestScore) {
          best = { outcome, expense };
          bestScore = score;
        }
      }
      return best;
    },
  });
}
