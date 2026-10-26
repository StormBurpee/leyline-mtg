import { playableZone, playableCards } from '../../packages/engine/src/model.js';
import { castingChoices } from '../../packages/engine/src/spell-modes.js';
import { legalActions, canAttack, canBlock, definition } from '../../packages/engine/src/index.js';

/** A projection of current legal actions, not a second implementation of the rules. */
export function cardDropPlan(state, player, id) {
  const object = state?.objects[id];
  if (!object || state.status !== 'playing' || (state.choice?.player ?? state.priority) !== player)
    return null;
  if (state.choice?.kind === 'attackers' && canAttack(state, object, player))
    return { kind: 'attack', destinations: [{ field: 1 - player, card: id }] };
  if (
    state.choice?.kind === 'blockers' &&
    object.zone === 'battlefield' &&
    object.controller === player
  )
    return {
      kind: 'block',
      destinations: state.combat.attackers
        .filter((attacker) => canBlock(state, object, state.objects[attacker.id], player))
        .map((attacker) => ({ target: attacker, card: id })),
    };
  if (state.choice || !playableZone(state, object, player)) return null;
  if (castingChoices(definition(state, object)))
    return {
      kind: 'chooseMode',
      destinations: legalActions(state, player).some((a) => a.type === 'cast' && a.card === id)
        ? [{ field: player, card: id }]
        : [],
    };
  return {
    kind: 'play',
    destinations: legalActions(state, player)
      .filter((command) => command.card === id && ['playLand', 'cast'].includes(command.type))
      .map((command) => ({ ...command, ...(command.target ? {} : { field: player }) })),
  };
}
