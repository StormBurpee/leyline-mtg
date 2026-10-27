import {
  definition,
  isSick,
  requireRule,
  emit,
  move,
  loseLife,
  sacrificePermanents,
} from './model.js';
import { planPayment, pay } from './mana.js';
/** Pure affordability check. No partial payment mutates the game. */
export function costProblem(s, p, cost, { sourceId, autoTap = true, discardCard } = {}) {
  if (cost.discard && !s.players[p].hand.includes(discardCard))
    return 'Choose a card in your hand to discard as a cost.';
  const source = sourceId ? s.objects[sourceId] : null;
  if (
    cost.tap &&
    (!source ||
      source.zone !== 'battlefield' ||
      source.controller !== p ||
      source.tapped ||
      (definition(s, source).type === 'creature' && isSick(s, source)))
  )
    return 'The source cannot pay a tap cost now.';
  if (cost.sacrificeSelf && (!source || source.zone !== 'battlefield' || source.controller !== p))
    return 'The source cannot be sacrificed now.';
  if (cost.exileSelf && (!source || source.zone !== 'graveyard' || source.owner !== p))
    return 'The source cannot be exiled from your graveyard now.';
  if ((cost.life ?? 0) > s.players[p].life) return 'Not enough life to pay this cost.';
  const manaPlan = planPayment(s, p, cost.mana ?? {}, {
    autoTap,
    excludeSources:
      cost.tap || (cost.sacrificeSelf && source && definition(s, source).manaSacrifice)
        ? [sourceId]
        : [],
  });
  if (!manaPlan) return 'Not enough available mana.';
  if ((cost.life ?? 0) + (manaPlan.life ?? 0) > s.players[p].life)
    return 'Not enough life for mana abilities and this cost.';
  return null;
}
export function payCost(s, p, cost, options = {}) {
  const problem = costProblem(s, p, cost, options);
  requireRule(!problem, 'COST', problem);
  pay(
    s,
    p,
    cost.mana ?? {},
    options.autoTap !== false,
    cost.tap ||
      (cost.sacrificeSelf &&
        s.objects[options.sourceId] &&
        definition(s, s.objects[options.sourceId]).manaSacrifice)
      ? [options.sourceId]
      : [],
  );
  if (cost.discard) {
    move(s, s.objects[options.discardCard], 'graveyard');
    emit(s, 'discard', { player: p, count: 1 });
  }
  if (cost.exileSelf) {
    const object = s.objects[options.sourceId];
    move(s, object, 'exile');
    emit(s, 'exiledAsCost', { player: p, objectId: object.id, name: object.name });
  }
  if (cost.tap) s.objects[options.sourceId].tapped = true;
  if (cost.sacrificeSelf) {
    const object = s.objects[options.sourceId];
    sacrificePermanents(s, [object]);
  }
  if (cost.life) {
    loseLife(s, p, cost.life);
    emit(s, 'lifePaid', { player: p, amount: cost.life });
  }
}
