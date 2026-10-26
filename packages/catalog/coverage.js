const AUXILIARY = new Set(['token', 'double_faced_token', 'emblem', 'art_series']);
export function classifyInventoryCard(card, asOf) {
  if (
    card.promoTypes?.some((p) => ['alchemy', 'rebalanced'].includes(p)) ||
    card.name.startsWith('A-') ||
    card.setType === 'alchemy'
  )
    return 'excluded_alchemy';
  if (
    AUXILIARY.has(card.layout) ||
    /^(Token|Emblem|Plane |Phenomenon|Scheme|Vanguard)/.test(card.typeLine ?? '')
  )
    return 'auxiliary';
  if (card.releasedAt > asOf) return 'future_printing_review';
  return 'in_scope';
}
export function cardCoverage(card, catalog, forgeByName) {
  if (Object.hasOwn(catalog, card.name) && !catalog[card.name].token)
    return { status: 'curated', diagnostics: [] };
  const scripts = forgeByName.get(card.name) ?? [];
  if (scripts.length !== 1)
    return {
      status: scripts.length ? 'ambiguous_forge_match' : 'no_exact_forge_match',
      diagnostics: [],
    };
  const script = scripts[0];
  if (script.status === 'candidate') return { status: 'compiler_candidate', diagnostics: [] };
  return { status: 'unsupported', diagnostics: script.diagnostics };
}
