/** CR 716 (2026-09-25): Class levels are noncopiable designations, not counters. */
export const classLevel = (object) => object.classLevel ?? 1;
export const CLASS_ABILITY_FIELDS = [
  'etb',
  'triggers',
  'activated',
  'static',
  'costModifiers',
  'damageBonus',
];
const ARRAY_FIELDS = new Set(['etb', 'triggers', 'activated', 'costModifiers']);
export function classDefinition(card, object) {
  if (!card.classLevels) return card;
  // Keep printed activations and both level bars in fixed slots. Acquired
  // activations append in ascending level order, never renumber earlier slots.
  const result = {
    ...card,
    activated: [
      ...(card.activated ?? []),
      ...card.classLevels.map(({ level, cost }) => ({
        cost: { mana: cost },
        timing: 'sorcery',
        classLevel: level,
        text: `${manaText(cost)}: Level ${level}`,
        effects: [{ op: 'setClassLevel', level }],
      })),
    ],
  };
  for (const grant of card.classLevels) {
    if (classLevel(object) < grant.level) continue;
    for (const [field, value] of Object.entries(grant.abilities))
      result[field] = ARRAY_FIELDS.has(field) ? [...(result[field] ?? []), ...value] : value;
  }
  return result;
}
function manaText(cost) {
  return (
    Object.entries(cost)
      .map(([symbol, count]) => (symbol === 'generic' ? `{${count}}` : `{${symbol}}`.repeat(count)))
      .join('') || '{0}'
  );
}
