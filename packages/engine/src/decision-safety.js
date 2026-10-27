import { castingPayment } from './casting-sacrifice.js';
import { predictedEffects } from './conditional-effects.js';
import { flattenTargets } from './target-groups.js';
import { castingProfile } from './casting-costs.js';
import { effectValues } from './numeric-values.js';
import { spellProfile } from './spell-modes.js';
import { definition, battlefield } from './model.js';
import { canGainLife } from './effects.js';
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

export function drawsFor(effects, controller, target, player = controller, state = null) {
  let count = 0,
    hand = state ? (state.players[player].handCount ?? state.players[player].hand.length) : 0;
  const bonuses = state
    ? battlefield(state)
        .filter((o) => o.controller === player)
        .map((o) => definition(state, o).drawBonus)
        .filter(Boolean)
    : [];
  for (const effect of effects) {
    if (recipient(effect, controller, target) !== player) continue;
    if (effect.op === 'draw') {
      const amount =
        effect.count +
        (effect.count > 0
          ? bonuses.filter((b) => hand <= b.handAtMost).reduce((n, b) => n + b.amount, 0)
          : 0);
      count += amount;
      hand += amount;
    } else if (effect.op === 'discard') hand = Math.max(0, hand - effect.count);
  }
  return count;
}

/** A bounded check of known effects, not a claim to solve every triggered interaction.
 * Life may reach zero during one resolution and recover before state-based actions.
 */
export function resolutionRisk(
  state,
  player,
  effects,
  target,
  lifeCost = 0,
  source = null,
  eventAmount = 0,
) {
  effects = predictedEffects(state, effects, { controller: player, source, target, eventAmount });
  let life = state.players[player].life - lifeCost;
  for (const effect of effects) {
    if (effect.op === 'damage' && target?.kind === 'player' && target.id === player)
      life -= effect.amount;
    if (recipient(effect, player, target) !== player) continue;
    if (effect.op === 'loseLife') life -= effect.amount;
    if (effect.op === 'gainLife' && canGainLife(state)) life += effect.amount;
  }
  if (life <= 0) return 'life';
  if (drawsFor(effects, player, target, player, state) > libraryCount(state, player))
    return 'library';
  return null;
}

export function actionEffects(state, action) {
  const object = state.objects[action.card];
  if (!object) return [];
  const card = definition(state, object);
  if (action.type === 'plot' || action.type === 'ninjutsu') return [];
  if (action.type === 'cycle') return [{ op: 'draw', count: 1 }];
  const effects =
    action.type === 'activate'
      ? card.activated[action.ability].effects
      : (spellProfile(card, action.mode)?.effects ?? []);
  const entry = {
    controller:
      action.type === 'cast' ? (object.playPermission?.player ?? object.owner) : object.controller,
    source: { id: object.id, incarnation: object.incarnation },
    target: action.target,
    x: action.x ?? 0,
    additionalCost: action.additionalCost,
  };
  return predictedEffects(state, effects, entry);
}

function actionCost(state, player, action) {
  if (!action.card) return {};
  const card = definition(state, state.objects[action.card]);
  if (action.type === 'plot') return { mana: card.plot };
  if (action.type === 'ninjutsu') return { mana: card.ninjutsu };
  if (action.type === 'cycle') return { mana: card.cycling };
  if (action.type === 'activate') {
    const cost = card.activated[action.ability].cost;
    const payment = planPayment(state, player, cost.mana ?? {}, {
      excludeSources: cost.tap ? [action.card] : [],
    });
    return { ...cost, manaLife: payment?.life ?? 0 };
  }
  const profile = castingProfile(
    state,
    player,
    state.objects[action.card],
    action.mode,
    action.targets ? flattenTargets(action.targets) : action.target,
    undefined,
    action.x,
  );
  const plan = profile && castingPayment(state, player, profile, action);
  return {
    mana: plan?.cost ?? profile?.cost ?? card.cost,
    excludeSources: plan?.excludeSources ?? [],
    sacrifice: plan?.sacrifice,
    life: plan?.additionalCost?.life ? profile.additionalCost.life : 0,
    manaLife: plan?.mana?.life ?? 0,
    purpose: { type: 'cast', card: profile },
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
  let life = state.players[player].life - (cost.life ?? 0);
  const payment = planPayment(state, player, cost.mana ?? {}, {
    excludeSources: [...(cost.excludeSources ?? []), ...(cost.tap ? [sourceId] : [])],
    purpose: cost.purpose,
  });
  if (!payment) return false;
  life -= payment.life ?? 0;
  if ((ward.life ?? 0) >= life) return false;
  const objects = { ...state.objects };
  for (const id of [...payment.taps, ...(cost.excludeSources ?? [])])
    objects[id] = { ...objects[id], tapped: true };
  if (sourceId && cost.tap) objects[sourceId] = { ...objects[sourceId], tapped: true };
  if (sourceId && cost.sacrificeSelf)
    objects[sourceId] = { ...objects[sourceId], zone: 'graveyard' };
  if (cost.sacrifice)
    objects[cost.sacrifice.id] = { ...objects[cost.sacrifice.id], zone: 'graveyard' };
  const projected = {
    ...state,
    objects,
    players: state.players.map((entry, index) =>
      index === player ? { ...entry, life, mana: payment.remaining } : entry,
    ),
  };
  const wardPayment = planPayment(projected, player, ward.mana ?? {});
  return !!wardPayment && (wardPayment.life ?? 0) + (ward.life ?? 0) < life;
}

export function actionSafe(state, player, action) {
  if (!['cast', 'activate'].includes(action.type)) return true;
  const cost = actionCost(state, player, action);
  if (action.type === 'cast' && state.objects[action.card]?.zone === 'hand')
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === player
          ? {
              ...p,
              hand: p.hand.filter((id) => id !== action.card),
              ...(p.handCount !== undefined ? { handCount: p.handCount - 1 } : {}),
            }
          : p,
      ),
    };
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
    const payment = planPayment(state, player, mana, { excludeSources: cost.excludeSources ?? [] });
    life += payment?.life ?? 0;
    return (
      life < state.players[player].life &&
      !!payment &&
      !resolutionRisk(state, player, actionEffects(state, action), null, life)
    );
  }

  const totalLife = (cost.life ?? 0) + (cost.manaLife ?? 0);
  if (totalLife >= state.players[player].life) return false;
  return (
    !resolutionRisk(state, player, actionEffects(state, action), action.target, totalLife) &&
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
