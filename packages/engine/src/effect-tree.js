/** Traverse a validated effect graph, including every unselected alternative.
 * Cross-reference validation must not skip instructions merely because they are
 * conditional or deferred until a player makes a resolution-time choice.
 */
export function* effectInstructions(effects) {
  for (const effect of effects) {
    yield effect;
    if (effect.op === 'conditional') {
      yield* effectInstructions(effect.then);
      yield* effectInstructions(effect.else ?? []);
    } else if (effect.op === 'behold') yield* effectInstructions(effect.then);
    else if (effect.op === 'chooseEffect')
      for (const option of effect.options) yield* effectInstructions(option.effects);
    else if (['questCounterTrigger', 'removeCounterTrigger', 'discardTrigger'].includes(effect.op))
      yield* effectInstructions(effect.effects);
  }
}
