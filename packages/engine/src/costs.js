import { activationSacrificeProblem, costManaExclusions } from './activation-sacrifice.js';
import { tapObjects } from './model.js';
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
export function costProblem(
  s,
  p,
  cost,
  { sourceId, autoTap = true, discardCard, sacrifices } = {},
) {
  const selectedProblem = activationSacrificeProblem(s, p, cost, sourceId, sacrifices);
  if (selectedProblem) return selectedProblem;
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
    excludeSources: costManaExclusions(s, cost, { sourceId, sacrifices }),
  });
  if (!manaPlan) return 'Not enough available mana.';
  if ((cost.life ?? 0) + (manaPlan.life ?? 0) > s.players[p].life)
    return 'Not enough life for mana abilities and this cost.';
  if (cost.sacrifice && manaPlan.activations.length) {
    // Mana activations can change the chosen permanents' public eligibility
    // (tapped state, life-dependent P/T, or a departed anthem source). Use the
    // same payment implementation on a disposable state, not a second rules model.
    const projected = structuredClone({
      ...s,
      catalog: null,
      config: null,
      events: [],
      history: [],
    });
    projected.catalog = s.catalog;
    projected.config = s.config;
    pay(
      projected,
      p,
      cost.mana ?? {},
      autoTap,
      costManaExclusions(s, cost, { sourceId, sacrifices }),
    );
    const afterMana = activationSacrificeProblem(projected, p, cost, sourceId, sacrifices);
    if (afterMana) return afterMana;
  }
  return null;
}
export function payCost(s, p, cost, options = {}) {
  const problem = costProblem(s, p, cost, options);
  requireRule(!problem, 'COST', problem);
  pay(s, p, cost.mana ?? {}, options.autoTap !== false, costManaExclusions(s, cost, options));
  // A mana ability can remove a continuous-effect source before the sacrifice.
  // Recheck current characteristics after mana payment; dispatch rolls back failures.
  const selectedProblem = activationSacrificeProblem(
    s,
    p,
    cost,
    options.sourceId,
    options.sacrifices,
  );
  requireRule(!selectedProblem, 'COST', selectedProblem);
  if (cost.discard) {
    move(s, s.objects[options.discardCard], 'graveyard');
    emit(s, 'discard', { player: p, count: 1 });
  }
  if (cost.exileSelf) {
    const object = s.objects[options.sourceId];
    move(s, object, 'exile');
    emit(s, 'exiledAsCost', { player: p, objectId: object.id, name: object.name });
  }
  if (cost.tap) tapObjects(s, [s.objects[options.sourceId]]);
  if (cost.sacrificeSelf || cost.sacrifice) {
    sacrificePermanents(s, [
      ...(cost.sacrificeSelf ? [s.objects[options.sourceId]] : []),
      ...(options.sacrifices ?? []).map((r) => s.objects[r.id]),
    ]);
  }
  if (cost.life) {
    loseLife(s, p, cost.life);
    emit(s, 'lifePaid', { player: p, amount: cost.life });
  }
}

/** Power-up reduction uses current mana cost, never mana spent casting (CR 702.193). */
export function activationCost(s, object, ability) {
  if (!ability.powerUp || object.enteredTurn !== s.turn) return ability.cost;
  const cost = structuredClone(ability.cost),
    reduction = definition(s, object).cost;
  for (const [symbol, amount] of Object.entries(reduction)) {
    if (symbol === 'X') continue;
    cost.mana[symbol] = Math.max(0, (cost.mana[symbol] ?? 0) - amount);
    if (!cost.mana[symbol]) delete cost.mana[symbol];
  }
  return cost;
}
