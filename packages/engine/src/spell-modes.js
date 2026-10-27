import { FACE_DOWN } from './disguise.js';
/** Choices announced during casting. Kicker/offspring are additional costs, not modal effects. */
export function castingChoices(card) {
  const twobrid = Object.entries(card.cost)
    .filter(([symbol, amount]) => /^2\/[WUBRG]$/.test(symbol) && amount > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (twobrid.length) {
    let costs = [{ ...card.cost }];
    for (const [symbol, amount] of twobrid) {
      costs = costs.flatMap((cost) =>
        Array.from({ length: amount + 1 }, (_, genericCount) => {
          const chosen = { ...cost };
          delete chosen[symbol];
          if (genericCount) chosen.generic = (chosen.generic ?? 0) + 2 * genericCount;
          if (amount > genericCount)
            chosen[symbol[2]] = (chosen[symbol[2]] ?? 0) + amount - genericCount;
          return chosen;
        }),
      );
    }
    return costs.map((cost) => ({
      label: `Pay ${
        Object.entries(cost)
          .filter(([, n]) => n > 0)
          .map(([symbol, n]) => (symbol === 'generic' ? `{${n}}` : `{${symbol}}`.repeat(n)))
          .join('') || '{0}'
      }`,
      twobridCost: cost,
      effects: card.effects ?? [],
      target: card.target ?? null,
      ...(card.targetGroups ? { targetGroups: card.targetGroups } : {}),
    }));
  }
  if (card.spree)
    return Array.from({ length: 2 ** card.modes.length - 1 }, (_, index) => {
      const selected = card.modes.filter((_, i) => (index + 1) & (1 << i));
      const additionalCost = {};
      for (const mode of selected)
        for (const [symbol, amount] of Object.entries(mode.additionalCost))
          additionalCost[symbol] = (additionalCost[symbol] ?? 0) + amount;
      const targetGroups = selected.flatMap((mode) => mode.targetGroups ?? []);
      return {
        label: selected.map((mode) => mode.label).join(' + '),
        additionalCost,
        effects: selected.flatMap((mode) => mode.effects),
        ...(targetGroups.length ? { targetGroups } : {}),
        spreeModes: selected.map((mode) => card.modes.indexOf(mode)),
      };
    });
  if (card.gift)
    return [
      { label: 'Do not promise a gift', effects: card.effects ?? [], target: card.target ?? null },
      {
        label: 'Promise opponent a Treasure',
        effects: [
          { op: 'token', definition: card.gift.definition, count: 1, player: 'opponent' },
          ...(card.effects ?? []),
          ...card.gift.effects,
        ],
        target: card.target ?? null,
        giftPromised: true,
      },
    ];
  if (card.modes) return card.modes;
  if (card.adventure)
    return [
      {
        label: `Cast ${card.mainName}`,
        effects: card.effects ?? [],
        target: card.target ?? null,
        ...(card.targetGroups ? { targetGroups: card.targetGroups } : {}),
      },
      {
        label: `Adventure: ${card.adventure.name}`,
        effects: card.adventure.effects ?? [],
        target: card.adventure.target ?? null,
        ...(card.adventure.targetGroups ? { targetGroups: card.adventure.targetGroups } : {}),
        adventureCast: true,
      },
    ];
  if (card.warp)
    return [
      { label: 'Cast normally', effects: card.effects ?? [], target: card.target ?? null },
      {
        label: 'Cast for warp cost',
        effects: card.effects ?? [],
        target: card.target ?? null,
        warpPaid: true,
      },
    ];
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
  if (selected.adventureCast)
    return { ...card.adventure, adventureCast: true, castingLabel: selected.label };
  if (selected.faceDownCast)
    return {
      ...FACE_DOWN,
      cost: { generic: 3 },
      faceDownCast: true,
      disguise: card.disguise,
      castingLabel: selected.label,
    };
  const cost = { ...(selected.twobridCost ?? (selected.warpPaid ? card.warp : card.cost)) };
  for (const [symbol, amount] of Object.entries(selected.additionalCost ?? {}))
    cost[symbol] = (cost[symbol] ?? 0) + amount;
  return {
    ...card,
    cost,
    effects: selected.effects,
    target: selected.target ?? null,
    ...(selected.targetGroups ? { targetGroups: selected.targetGroups } : {}),
    ...(selected.warpPaid ? { warpPaid: true } : {}),
    kicked: !!selected.kicked,
    offspringPaid: !!selected.offspringPaid,
    giftPromised: !!selected.giftPromised,
    castingLabel: selected.label,
    ...(selected.additionalCost ? { modeAdditionalMana: selected.additionalCost } : {}),
  };
}
export const spellOptions = (card) =>
  castingChoices(card)
    ? castingChoices(card).map((_, mode) => ({ mode, profile: spellProfile(card, mode) }))
    : [{ profile: card }];
