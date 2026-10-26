import { FACE_DOWN } from './disguise.js';
/** Choices announced during casting. Kicker/offspring are additional costs, not modal effects. */
export function castingChoices(card) {
  if (card.modes) return card.modes;
  if (card.disguise)
    return [
      { label: 'Cast face up', effects: card.effects ?? [], target: card.target ?? null },
      { label: 'Cast face down for {3}', faceDownCast: true },
    ];
  const extra = card.kicker ?? (card.offspring ? { cost: card.offspring } : null);
  if (!extra) return null;
  const keyword = card.kicker ? 'kicker' : 'offspring';
  return [
    { label: `Cast without ${keyword}`, effects: card.effects ?? [], target: card.target ?? null },
    {
      label: `Pay ${keyword}`,
      effects: extra.effects ?? card.effects ?? [],
      target: card.target ?? null,
      additionalCost: extra.cost,
      kicked: !!card.kicker,
      offspringPaid: !!card.offspring,
    },
  ];
}
export function spellProfile(card, mode) {
  const choices = castingChoices(card);
  if (!choices) return mode === undefined ? card : null;
  if (!card.modes && mode === undefined) mode = 0;
  if (!Number.isSafeInteger(mode) || mode < 0 || mode >= choices.length) return null;
  const selected = choices[mode];
  if (selected.faceDownCast)
    return {
      ...FACE_DOWN,
      cost: { generic: 3 },
      faceDownCast: true,
      disguise: card.disguise,
      castingLabel: selected.label,
    };
  const cost = { ...card.cost };
  for (const [symbol, amount] of Object.entries(selected.additionalCost ?? {}))
    cost[symbol] = (cost[symbol] ?? 0) + amount;
  return {
    ...card,
    cost,
    effects: selected.effects,
    target: selected.target ?? null,
    kicked: !!selected.kicked,
    offspringPaid: !!selected.offspringPaid,
    castingLabel: selected.label,
  };
}
export const spellOptions = (card) =>
  castingChoices(card)
    ? castingChoices(card).map((_, mode) => ({ mode, profile: spellProfile(card, mode) }))
    : [{ profile: card }];
