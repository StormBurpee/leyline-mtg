import { matchesFilter } from './selectors.js';
import { battlefield, definition, stats, keywords } from './model.js';
/** Public state conditions, shared by activation restrictions and replacements. */
export function meetsCondition(s, player, value, excludedIds = []) {
  if (!value) return true;
  if (value.kind === 'opponentLostLifeThisTurn')
    return s.players[1 - player].lifeLostTurn === s.turn;
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
            ...stats(s, o),
            keywords: keywords(s, o),
          },
          value.where,
          player,
        );
      }).length >= value.count
    );
  return false;
}
