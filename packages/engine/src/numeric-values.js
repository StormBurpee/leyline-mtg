import { definition, isAttacking, isBlocking, requireRule } from './model.js';
import { matchesFilter } from './selectors.js';
/** Resolve public-state values once per instruction or continuous-characteristic query. */
export function numericValue(state, value, { controller, source = null, excludedIds = [] } = {}) {
  if (typeof value === 'number') return value;
  let result = 0;
  const players =
    value.player === 'all' ? [0, 1] : [value.player === 'opponent' ? 1 - controller : controller];
  switch (value.kind) {
    case 'life':
      result = state.players[players[0]].life;
      break;
    case 'sum':
      result = value.values.reduce(
        (n, v) => n + numericValue(state, v, { controller, source, excludedIds }),
        0,
      );
      break;
    case 'scale':
      result = value.factor * numericValue(state, value.value, { controller, source, excludedIds });
      break;
    case 'count':
      if (['hand', 'library'].includes(value.zone)) {
        result = players.reduce(
          (n, p) =>
            n +
            (state.players[p][value.zone]?.filter((id) => !state.objects[id]?.token).length ??
              state.players[p][`${value.zone}Count`] ??
              0),
          0,
        );
        break;
      }
      result = Object.values(state.objects).filter((o) => {
        if (excludedIds.includes(o.id) || (value.zone !== 'battlefield' && o.token)) return false;
        if (
          o.zone !== value.zone ||
          !players.includes(value.zone === 'battlefield' ? o.controller : o.owner)
        )
          return false;
        if (value.excludeSource && source?.id === o.id && source.incarnation === o.incarnation)
          return false;
        if (!value.where) return true;
        if (o.hidden) return false;
        const d = definition(state, o);
        return matchesFilter(
          {
            definition: d,
            controller: o.controller,
            owner: o.owner,
            token: o.token,
            tapped: o.tapped,
            attacking: isAttacking(state, o),
            blocking: isBlocking(state, o),
            manaValue: Object.values(d.cost).reduce((a, b) => a + b, 0),
          },
          value.where,
          controller,
        );
      }).length;
      break;
    default:
      throw new Error('Unsupported numeric value.');
  }
  requireRule(
    Number.isSafeInteger(result),
    'VALUE_RANGE',
    'A numeric result exceeds the safe integer range.',
  );
  return result;
}
export function effectValues(state, effect, entry) {
  const context = { controller: entry.controller, source: entry.source };
  let result = effect;
  for (const key of ['amount', 'count', 'power', 'toughness'])
    if (effect[key] !== null && typeof effect[key] === 'object') {
      if (result === effect) result = { ...effect };
      const value = numericValue(state, effect[key], context);
      result[key] = ['amount', 'count'].includes(key) ? Math.max(0, value) : value;
      if (key === 'count' && effect.op === 'token')
        requireRule(
          result[key] <= 1000,
          'VALUE_BUDGET',
          'A single token instruction is limited to 1000 objects.',
        );
    }
  return result;
}
