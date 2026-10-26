import { definition, isSick, requireRule, emit } from './model.js';
import { planPayment, pay } from './mana.js';
/** Pure affordability check. No partial payment mutates the game. */
export function costProblem(s, p, cost, { sourceId, autoTap = true } = {}) {
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
  if ((cost.life ?? 0) > s.players[p].life) return 'Not enough life to pay this cost.';
  if (!planPayment(s, p, cost.mana ?? {}, { autoTap, excludeSources: cost.tap ? [sourceId] : [] }))
    return 'Not enough available mana.';
  return null;
}
export function payCost(s, p, cost, options = {}) {
  const problem = costProblem(s, p, cost, options);
  requireRule(!problem, 'COST', problem);
  pay(s, p, cost.mana ?? {}, options.autoTap !== false, cost.tap ? [options.sourceId] : []);
  if (cost.tap) s.objects[options.sourceId].tapped = true;
  if (cost.life) {
    s.players[p].life -= cost.life;
    emit(s, 'lifePaid', { player: p, amount: cost.life });
  }
}
