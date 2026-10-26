import {
  stabilize,
  resolveTop,
  resolveEffects,
  finishTriggerOrder,
  finishTriggerTarget,
  finishResolutionChoice,
  targetsFor,
} from './effects.js';
import { targetSpec } from './selectors.js';

/** Only life-total effects are forecast here. In particular, do not resolve draw
 * effects against the deliberately empty hidden zones in a public-board copy.
 * An unsupported entry is omitted whole, never partially executed.
 */
function supported(entry) {
  if (entry.targetKind && targetSpec(entry.targetKind)?.scope !== 'player') return false;
  return entry.effects.every(
    (effect) =>
      ['gainLife', 'loseLife', 'damageOpponent'].includes(effect.op) ||
      (effect.op === 'damage' && !!entry.targetKind),
  );
}
function lifeValue(life, player) {
  return (
    (life[player] <= 0 ? -1_000_000 : 0) +
    (life[1 - player] <= 0 ? 1_000_000 : 0) +
    Math.min(30, life[player]) * 2.3 -
    Math.min(30, life[1 - player]) * 1.5
  );
}
function valueAfter(s, entry, target) {
  // Whitelisted operations only mutate players and append events. Shared objects
  // are read for last-known damage keywords, never changed by this projection.
  const copy = {
    ...s,
    players: s.players.map((player) => ({ ...player })),
    events: [],
  };
  resolveEffects(copy, { ...entry, target });
  return lifeValue(
    copy.players.map((player) => player.life),
    entry.controller,
  );
}
function bestTarget(s, entry, targets) {
  return [...targets].sort((a, b) => valueAfter(s, entry, b) - valueAfter(s, entry, a))[0];
}
function orderingValue(s, entry) {
  const targets = entry.targetKind
    ? targetsFor(s, entry.targetKind, entry.controller)
    : [undefined];
  return Math.max(...targets.map((target) => valueAfter(s, entry, target)));
}
/** Resolve supported combat death payoffs with the real stack, APNAP placement,
 * target validation, last-known information and state-based actions. This is a
 * no-response tactical forecast, not a claim to search every possible response.
 */
export function settleCombatPayoffs(s) {
  let omitted = 0;
  const eligible = s.pendingTriggers.filter((entry) => {
    if (supported(entry)) return true;
    omitted++;
    return false;
  });
  s.pendingTriggers = eligible;
  if (!eligible.length) return { omitted, limited: false };
  // Life-only effects cannot create more triggers or resolution-time choices
  // beyond optionalEffect. Bound work on unusually large simultaneous deaths.
  for (let decisions = 0; decisions < 512; decisions++) {
    if (s.status === 'finished') return { omitted, limited: false };
    if (!s.choice) stabilize(s);
    if (s.status === 'finished') return { omitted, limited: false };
    if (s.choice?.kind === 'orderTriggers') {
      const entries = [...s.choice.entries].sort(
        (a, b) => orderingValue(s, a) - orderingValue(s, b),
      );
      finishTriggerOrder(
        s,
        entries.map((entry) => entry.id),
      );
    } else if (s.choice?.kind === 'triggerTarget') {
      finishTriggerTarget(s, bestTarget(s, s.choice.entry, s.choice.targets));
    } else if (s.choice?.kind === 'optionalEffect') {
      const entry = s.resolving.entry;
      finishResolutionChoice(s, {
        type: 'resolveOptional',
        accept:
          valueAfter(s, entry, entry.target) >=
          lifeValue(
            s.players.map((player) => player.life),
            entry.controller,
          ),
      });
    } else if (s.stack.length) resolveTop(s);
    else return { omitted, limited: false };
  }
  return { omitted, limited: true };
}
