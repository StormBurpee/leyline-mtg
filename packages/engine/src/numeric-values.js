import { typesOf } from './types.js';
import { spellsCastCount } from './spell-history.js';
import { manaValue } from './mana-value.js';
import { definition, isAttacking, isBlocking, stats, requireRule } from './model.js';
import { matchesFilter } from './selectors.js';
/** Resolve public-state values once per instruction or continuous-characteristic query. */
export function numericValue(
  state,
  value,
  { controller, source = null, excludedIds = [], x = 0, sourceStats = null, effect = false } = {},
) {
  if (typeof value === 'number') return value;
  let result = 0;
  const players =
    value.player === 'all' ? [0, 1] : [value.player === 'opponent' ? 1 - controller : controller];
  switch (value.kind) {
    // CR 608.2h / 208.3: read this incarnation's effective characteristics,
    // otherwise its last public-zone snapshot, never a newly returned object.
    case 'sourceStat': {
      requireRule(effect, 'VALUE_CONTEXT', 'Source statistics require a resolving effect.');
      const object = state.objects[source?.id];
      const current =
        object &&
        object.incarnation === source?.incarnation &&
        !object.hidden &&
        ['battlefield', 'stack', 'graveyard', 'exile'].includes(object.zone);
      result = (current ? stats(state, object) : sourceStats)?.[value.stat] ?? 0;
      break;
    }
    case 'spellsCast':
      result = spellsCastCount(state, players, value.where, controller);
      break;
    case 'x':
      result = x;
      break;
    case 'life':
      result = state.players[players[0]].life;
      break;
    case 'sum':
      result = value.values.reduce(
        (n, v) =>
          n + numericValue(state, v, { controller, source, excludedIds, x, sourceStats, effect }),
        0,
      );
      break;
    case 'floorDivide':
      result = Math.floor(
        numericValue(state, value.value, {
          controller,
          source,
          excludedIds,
          x,
          sourceStats,
          effect,
        }) / value.divisor,
      );
      break;
    case 'scale':
      result =
        value.factor *
        numericValue(state, value.value, {
          controller,
          source,
          excludedIds,
          x,
          sourceStats,
          effect,
        });
      break;
    case 'maxManaValue':
      result = Math.max(
        0,
        ...Object.values(state.objects)
          .filter(
            (o) =>
              o.zone === 'battlefield' &&
              players.includes(o.controller) &&
              !excludedIds.includes(o.id) &&
              matchesFilter(
                {
                  definition: definition(state, o),
                  controller: o.controller,
                  owner: o.owner,
                  token: o.token,
                  tapped: o.tapped,
                  stunCounters: o.stunCounters ?? 0,
                  attacking: isAttacking(state, o),
                  blocking: isBlocking(state, o),
                  manaValue: manaValue(definition(state, o)),
                },
                value.where,
                controller,
              ),
          )
          .map((o) => manaValue(definition(state, o))),
      );
      break;
    case 'graveyardCardTypes': {
      // CR 205.2b: union card types, not cards, subtypes or supertypes.
      // CR 715.4: definition() reads the main Adventure face off the stack.
      const types = new Set();
      for (const object of Object.values(state.objects)) {
        if (
          object.zone !== 'graveyard' ||
          !players.includes(object.owner) ||
          object.hidden ||
          object.token ||
          object.spellCopy ||
          excludedIds.includes(object.id)
        )
          continue;
        for (const type of typesOf(definition(state, object))) types.add(type);
      }
      result = types.size;
      break;
    }
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
            stunCounters: o.stunCounters ?? 0,
            attacking: isAttacking(state, o),
            blocking: isBlocking(state, o),
            manaValue: manaValue(d),
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
  if (effect.op === 'drawEventAmount')
    return { op: 'draw', count: Math.max(0, entry.eventAmount ?? 0) };
  if (effect.op === 'damageEachPlayer') return effect;
  const context = {
    controller:
      effect.op === 'damageEventPlayer'
        ? (entry.eventSource?.controller ?? entry.controller)
        : entry.controller,
    source: entry.source,
    x: entry.x ?? 0,
    sourceStats: entry.sourceStats,
    effect: true,
  };
  let result = effect;
  for (const key of ['amount', 'count', 'selectCount', 'power', 'toughness'])
    if (effect[key] !== null && typeof effect[key] === 'object') {
      if (result === effect) result = { ...effect };
      const value = numericValue(state, effect[key], context);
      result[key] = ['amount', 'count', 'selectCount'].includes(key) ? Math.max(0, value) : value;
      if (key === 'count' && ['token', 'mobilize'].includes(effect.op))
        requireRule(
          result[key] <= 1000,
          'VALUE_BUDGET',
          'A single token instruction is limited to 1000 objects.',
        );
    }
  if (effect.op === 'lookChooseHand')
    requireRule(
      (result.selectCount ?? 1) <= 1000,
      'VALUE_BUDGET',
      'Selection is limited to 1000 cards.',
    );
  return result;
}
