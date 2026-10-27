import { predictedEffects } from './conditional-effects.js';
import { flattenTargets } from './target-groups.js';
import { castingProfile } from './casting-costs.js';
import { effectValues } from './numeric-values.js';
import { spellProfile } from './spell-modes.js';
import { definition } from './model.js';
import { planPayment } from './mana.js';

const recipient = (effect, controller, target) =>
  effect.player === 'opponent'
    ? 1 - controller
    : effect.player === 'target'
      ? target?.kind === 'player'
        ? target.id
        : null
      : controller;

export const libraryCount = (state, player) =>
  state.players[player].libraryCount ?? state.players[player].library?.length ?? Infinity;

export function drawsFor(effects, controller, target, player = controller) {
  return effects.reduce(
    (count, effect) =>
      count +
      (effect.op === 'draw' && recipient(effect, controller, target) === player ? effect.count : 0),
    0,
  );
}

/** A bounded check of known effects, not a claim to solve every triggered interaction.
 * Life may reach zero during one resolution and recover before state-based actions.
 */
export function resolutionRisk(state, player, effects, target, lifeCost = 0, source = null) {
  effects = predictedEffects(state, effects, { controller: player, source, target });
  let life = state.players[player].life - lifeCost;
  for (const effect of effects) {
    if (effect.op === 'damage' && target?.kind === 'player' && target.id === player)
      life -= effect.amount;
    if (recipient(effect, player, target) !== player) continue;
    if (effect.op === 'loseLife') life -= effect.amount;
    if (effect.op === 'gainLife') life += effect.amount;
  }
  if (life <= 0) return 'life';
  if (drawsFor(effects, player, target) > libraryCount(state, player)) return 'library';
  return null;
}

export function actionEffects(state, action) {
  const object = state.objects[action.card];
  if (!object) return [];
  const card = definition(state, object);
  if (action.type === 'cycle') return [{ op: 'draw', count: 1 }];
  const effects =
    action.type === 'activate'
      ? card.activated[action.ability].effects
      : (spellProfile(card, action.mode)?.effects ?? []);
  const entry = {
    controller: object.controller,
    source: { id: object.id, incarnation: object.incarnation },
    target: action.target,
  };
  return predictedEffects(state, effects, entry);
}

function actionCost(state, player, action) {
  if (!action.card) return {};
  const card = definition(state, state.objects[action.card]);
  if (action.type === 'cycle') return { mana: card.cycling };
  return action.type === 'activate'
    ? card.activated[action.ability].cost
    : {
        mana:
          castingProfile(
            state,
            player,
            state.objects[action.card],
            action.mode,
            action.targets ? flattenTargets(action.targets) : action.target,
          )?.cost ?? card.cost,
      };
}

/** Check ward after the actual automatic base-payment plan, not against mana that
 * will already have been spent. Graveyard cards do not ward. The input is untouched.
 */
export function canPayTargetWard(state, player, target, cost = {}, sourceId = null) {
  const object = target?.kind === 'object' ? state.objects[target.id] : null;
  if (!object || object.zone !== 'battlefield' || object.controller === player) return true;
  const ward = definition(state, object).ward;
  if (!ward) return true;
  const life = state.players[player].life - (cost.life ?? 0);
  if ((ward.life ?? 0) >= life) return false;
  const payment = planPayment(state, player, cost.mana ?? {}, {
    excludeSources: cost.tap ? [sourceId] : [],
  });
  if (!payment) return false;
  const objects = { ...state.objects };
  for (const id of payment.taps) objects[id] = { ...objects[id], tapped: true };
  if (sourceId && cost.tap) objects[sourceId] = { ...objects[sourceId], tapped: true };
  if (sourceId && cost.sacrificeSelf)
    objects[sourceId] = { ...objects[sourceId], zone: 'graveyard' };
  const projected = {
    ...state,
    objects,
    players: state.players.map((entry, index) =>
      index === player ? { ...entry, life, mana: payment.remaining } : entry,
    ),
  };
  return !!planPayment(projected, player, ward.mana ?? {});
}

export function actionSafe(state, player, action) {
  if (!['cast', 'activate'].includes(action.type)) return true;
  const cost = actionCost(state, player, action);
  if (action.targets) {
    const seen = new Set();
    const mana = { ...(cost.mana ?? {}) };
    let life = cost.life ?? 0;
    for (const target of flattenTargets(action.targets)) {
      if (target.kind !== 'object' || seen.has(target.id)) continue;
      seen.add(target.id);
      const object = state.objects[target.id];
      if (object?.zone !== 'battlefield' || object.controller === player) continue;
      const ward = definition(state, object).ward;
      if (!ward) continue;
      life += ward.life ?? 0;
      for (const [symbol, amount] of Object.entries(ward.mana ?? {}))
        mana[symbol] = (mana[symbol] ?? 0) + amount;
    }
    return (
      life < state.players[player].life &&
      !!planPayment(state, player, mana) &&
      !resolutionRisk(state, player, actionEffects(state, action), null, life)
    );
  }

  if ((cost.life ?? 0) >= state.players[player].life) return false;
  return (
    !resolutionRisk(state, player, actionEffects(state, action), action.target, cost.life ?? 0) &&
    canPayTargetWard(state, player, action.target, cost, action.card)
  );
}

export function directLethal(state, player, action) {
  if (!['cast', 'activate'].includes(action.type)) return false;
  const amount = actionEffects(state, action).reduce((total, effect) => {
    const enemyDamage =
      effect.op === 'damageOpponent' ||
      (effect.op === 'damage' &&
        action.target?.kind === 'player' &&
        action.target.id === 1 - player);
    const enemyLoss =
      effect.op === 'loseLife' && recipient(effect, player, action.target) === 1 - player;
    return total + (enemyDamage || enemyLoss ? effect.amount : 0);
  }, 0);
  return amount >= state.players[1 - player].life && actionSafe(state, player, action);
}
