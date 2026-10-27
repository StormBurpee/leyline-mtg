import { controlled, definition } from './model.js';
import { hasType } from './types.js';
import { planPayment } from './mana.js';

export function convokeCandidates(s, p) {
  return controlled(s, p).filter((o) => !o.tapped && hasType(definition(s, o), 'creature'));
}
/** Explicit assignments are validated independently of the bounded automatic witness. */
export function convokePayment(s, p, profile, choices, autoTap = true) {
  const enabled = profile.keywords?.includes('convoke');
  const purpose = { type: 'cast', card: profile };
  if (!enabled) {
    if (choices !== undefined && (!Array.isArray(choices) || choices.length)) return null;
    const mana = planPayment(s, p, profile.cost, { autoTap, purpose });
    return mana ? { cost: profile.cost, choices: [], excludeSources: [], mana } : null;
  }
  if (choices === undefined) {
    const plan = planPayment(s, p, profile.cost, { autoTap, purpose, convoke: enabled });
    if (!plan) return null;
    choices = plan.convoked;
  }
  if (
    !Array.isArray(choices) ||
    (!enabled && choices.length) ||
    new Set(choices.map((c) => c?.card)).size !== choices.length
  )
    return null;
  const eligible = new Set(convokeCandidates(s, p).map((o) => o.id));
  const cost = { ...profile.cost };
  for (const choice of choices) {
    if (
      !choice ||
      typeof choice !== 'object' ||
      !eligible.has(choice.card) ||
      Object.keys(choice).some((k) => !['card', 'symbol'].includes(k))
    )
      return null;
    const { card, symbol } = choice;
    if (typeof symbol !== 'string' || symbol === 'C' || symbol === 'X' || !(cost[symbol] > 0))
      return null;
    if (
      symbol !== 'generic' &&
      !symbol
        .split('/')
        .some(
          (c) =>
            ['W', 'U', 'B', 'R', 'G'].includes(c) &&
            definition(s, s.objects[card]).color?.includes(c),
        )
    )
      return null;
    cost[symbol]--;
  }
  const excludeSources = choices.map((c) => c.card);
  const mana = planPayment(s, p, cost, { autoTap, purpose, excludeSources });
  return mana ? { cost, choices, excludeSources, mana } : null;
}
