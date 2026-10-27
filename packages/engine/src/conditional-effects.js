import { meetsCondition } from './conditions.js';
import { effectValues } from './numeric-values.js';
/** Policy preview only: the engine checks each branch at its actual resolution position. */
export function predictedEffects(state, effects, entry) {
  return effects.flatMap((effect) =>
    effect.op === 'conditional'
      ? predictedEffects(
          state,
          meetsCondition(state, entry.controller, effect.condition, [], entry.source)
            ? effect.then
            : (effect.else ?? []),
          entry,
        )
      : [effectValues(state, effect, entry)],
  );
}
