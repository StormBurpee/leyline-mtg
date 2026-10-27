import { effectValues } from './numeric-values.js';
import { actionEffects } from './decision-safety.js';
import { combatOutcome, permanentValue } from './combat-policy.js';
import { legalTarget, resolveEffects } from './effects.js';
import { definition, hasKeyword, ref, stats } from './model.js';

export function projectedModifiers(s, p, action) {
  const card = s.objects[action.card];
  const lifeCost =
    action.type === 'activate' ? (definition(s, card).activated[action.ability].cost.life ?? 0) : 0;
  const projected = {
    ...s,
    modifiers: [...s.modifiers],
    players: s.players.map((player, index) =>
      index === p ? { ...player, life: player.life - lifeCost } : player,
    ),
  };
  // Resolve only the known modifier instructions. Never follow draw instructions
  // into hidden libraries while scoring a trick.
  resolveEffects(projected, {
    controller: p,
    source: ref(card),
    target: action.target,
    effects: actionEffects(s, action).filter((effect) => effect.op === 'modify'),
  });
  return projected;
}
function threatens(s, entry, target) {
  if (!legalTarget(s, entry.targetKind, entry.target, entry.controller)) return false;
  const effects =
    entry.x === undefined
      ? (entry.effects ?? [])
      : (entry.effects ?? []).map((e) => effectValues(s, e, entry));
  if (entry.kind === 'spell' && s.catalog[entry.name]?.aura === 'pacifism') return true;
  if (
    effects.some(
      (effect) =>
        effect.op === 'bounce' ||
        (effect.op === 'moveTarget' && effect.destination !== 'battlefield'),
    )
  )
    return true;
  if (hasKeyword(s, target, 'indestructible')) return false;
  if (effects.some((effect) => effect.op === 'destroy')) return true;
  const damage = effects.reduce(
    (sum, effect) => sum + (effect.op === 'damage' ? effect.amount : 0),
    0,
  );
  const source = s.objects[entry.source?.id];
  const deathtouch =
    source &&
    source.incarnation === entry.source.incarnation &&
    source.zone === (entry.kind === 'spell' ? 'stack' : 'battlefield')
      ? hasKeyword(s, source, 'deathtouch')
      : entry.sourceKeywords?.includes('deathtouch');
  return damage > 0 && (damage >= stats(s, target).toughness - target.damage || deathtouch);
}
function boardValue(s, result, p) {
  return result.alive.reduce((sum, id) => {
    const object = s.objects[id];
    return sum + (object.controller === p ? 1 : -1) * permanentValue(s, object);
  }, 0);
}
/** Spend a temporary buff to save a threatened creature, change a combat trade,
 * survive known combat lethal or win now. Extra nonlethal face damage alone is
 * not valued as enough reason to spend a card; mana-only pump abilities can
 * convert spare mana into damage. This is not full stack search.
 */
export function trickScore(s, p, action) {
  const target =
    action.target?.kind === 'object'
      ? s.objects[action.target.id]
      : actionEffects(s, action).some((effect) => effect.subject === 'source')
        ? s.objects[action.card]
        : null;
  if (!target || target.zone !== 'battlefield' || target.controller !== p) return -100;
  const projected = projectedModifiers(s, p, action);
  let score = -100;
  for (const entry of s.stack) {
    if (
      entry.controller !== p &&
      entry.target?.kind === 'object' &&
      entry.target.id === target.id &&
      entry.target.incarnation === target.incarnation &&
      threatens(s, entry, target) &&
      !threatens(projected, entry, target)
    )
      score = Math.max(score, 12 + permanentValue(s, target));
  }
  // Do not ignore unresolved spells when forecasting combat.
  if (s.stack.length || s.step !== 'blockers') return score;
  const attackers = s.combat.attackers
    .filter(
      (r) =>
        s.objects[r.id]?.zone === 'battlefield' && s.objects[r.id].incarnation === r.incarnation,
    )
    .map((r) => r.id);
  const pairs = Object.entries(s.combat.blocks).flatMap(([attacker, blockers]) =>
    attackers.includes(attacker)
      ? blockers
          .filter(
            (r) =>
              s.objects[r.id]?.zone === 'battlefield' &&
              s.objects[r.id].incarnation === r.incarnation,
          )
          .map((r) => ({ attacker, blocker: r.id }))
      : [],
  );
  const options = {
    attackers,
    blocked: s.combat.blocked.filter((id) => attackers.includes(id)),
  };
  const before = combatOutcome(s, pairs, options);
  const after = combatOutcome(projected, pairs, options);
  if (before.status === 'finished' && before.winner === p) return score;
  if (after.status === 'finished' && after.winner === p) return 10_000;
  if (after.status === 'finished' && after.winner === null && before.winner === 1 - p) return 8_000;
  if (after.status === 'finished' && after.winner !== p) return score;
  if (before.status === 'finished' && before.winner === 1 - p) return 9_000;
  // Evaluate surviving original permanents, not the inflated temporary stats.
  const improvement = boardValue(s, after, p) - boardValue(s, before, p);
  if (improvement > 0) score = Math.max(score, 8 + improvement);
  if (action.type === 'activate' && after.life[1 - p] < before.life[1 - p])
    score = Math.max(score, 4 + before.life[1 - p] - after.life[1 - p]);
  return score;
}
