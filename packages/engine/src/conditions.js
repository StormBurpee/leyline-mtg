import { matchesFilter } from './selectors.js';
import { numericValue } from './numeric-values.js';
import { battlefield, definition, stats, keywords, isAttacking, isBlocking } from './model.js';
const uses = (filter, keys) =>
  !!filter &&
  Object.entries(filter).some(
    ([key, value]) =>
      keys.includes(key) ||
      (['all', 'any'].includes(key)
        ? value.some((v) => uses(v, keys))
        : key === 'not' && uses(value, keys)),
  );
/** Public conditions; derived facts are evaluated only when the predicate needs them. */
export function meetsCondition(s, player, value, excludedIds = [], source = null) {
  if (!value) return true;
  if (value.kind === 'opponentLostLifeThisTurn')
    return s.players[1 - player].lifeLostTurn === s.turn;
  if (value.kind === 'controllerLostLifeThisTurn') return s.players[player].lifeLostTurn === s.turn;
  if (value.kind === 'controllerTurn') return s.active === player;
  if (value.kind === 'opponentTurn') return s.active !== player;
  if (['sourceAttacking', 'sourceEnteredThisTurn'].includes(value.kind)) {
    const object = source && s.objects[source.id];
    if (!object || object.zone !== 'battlefield' || object.incarnation !== source.incarnation)
      return false;
    return value.kind === 'sourceAttacking'
      ? isAttacking(s, object)
      : object.enteredTurn === s.turn;
  }
  if (value.kind === 'all')
    return value.conditions.every((c) => meetsCondition(s, player, c, excludedIds, source));
  if (value.kind === 'any')
    return value.conditions.some((c) => meetsCondition(s, player, c, excludedIds, source));
  if (value.kind === 'compare') {
    const context = { controller: player, source, excludedIds },
      a = numericValue(s, value.left, context),
      b = numericValue(s, value.right, context);
    return (
      { eq: a === b, ne: a !== b, lt: a < b, lte: a <= b, gt: a > b, gte: a >= b }[
        value.operator
      ] ?? false
    );
  }
  if (value.kind === 'controlAtLeast')
    return (
      battlefield(s).filter((o) => {
        if (o.controller !== player || excludedIds.includes(o.id)) return false;
        const d = definition(s, o);
        return matchesFilter(
          {
            definition: d,
            controller: o.controller,
            owner: o.owner,
            token: o.token,
            tapped: o.tapped,
            attacking: isAttacking(s, o),
            blocking: isBlocking(s, o),
            ...(uses(value.where, ['power', 'toughness']) ? stats(s, o) : {}),
            ...(uses(value.where, ['keyword']) ? { keywords: keywords(s, o) } : {}),
          },
          value.where,
          player,
        );
      }).length >= value.count
    );
  return false;
}
