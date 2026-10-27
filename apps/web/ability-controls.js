import { abilityProblem, definition } from '../../packages/engine/src/index.js';
import { escape } from './view.js';

/** The command boundary owns legality; the client only explains disabled actions. */
export function activatedAbilityButtons(state, player, object, legal) {
  return (definition(state, object).activated ?? [])
    .map((ability, index) => {
      const enabled = legal.some(
        (action) =>
          action.type === 'activate' && action.card === object.id && action.ability === index,
      );
      const reason =
        !enabled && (ability.exhaust || ability.classLevel !== undefined)
          ? abilityProblem(
              state,
              player,
              object.id,
              index,
              undefined,
              undefined,
              undefined,
              undefined,
              ability.cost.mana?.X ? 0 : undefined,
            )
          : null;
      const description = `ability-problem-${index}`;
      return `<button class="btn primary" data-action="activateAbility" data-ability="${index}" ${enabled ? '' : 'disabled'}${reason ? ` aria-describedby="${description}"` : ''}>${ability.cost.sacrificeSelf ? `<span>⚑ Sacrifice ${escape(object.name)} · </span>` : ''}${escape((ability.text ?? 'Activate ability').replaceAll('CARDNAME', object.name))}</button>${reason ? `<small id="${description}" class="muted">${escape(reason)}</small>` : ''}`;
    })
    .join('');
}
