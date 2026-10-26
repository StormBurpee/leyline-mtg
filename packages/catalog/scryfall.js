/** Maintenance-only Scryfall ingestion. The game engine never calls the network. */
export const QUERIES = Object.freeze({
  standard: 'legal:standard',
  arena: 'game:arena -is:alchemy -is:rebalanced',
});
export function searchURL(query, asOf) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf))
    throw new Error('Expected an explicit YYYY-MM-DD snapshot date.');
  const url = new URL('https://api.scryfall.com/cards/search');
  for (const [key, value] of Object.entries({
    q: `${query} date<=${asOf}`,
    unique: 'cards',
    order: 'name',
    include_extras: 'false',
  }))
    url.searchParams.set(key, value);
  return url.href;
}
export function normalizeCard(card) {
  if (!card || typeof card.oracle_id !== 'string' || typeof card.name !== 'string')
    throw new Error('Card lacks an Oracle identity.');
  return {
    oracleId: card.oracle_id,
    printingId: card.id,
    name: card.name,
    layout: card.layout,
    typeLine: card.type_line,
    manaCost: card.mana_cost ?? null,
    keywords: card.keywords ?? [],
    games: card.games ?? [],
    digital: card.digital === true,
    set: card.set,
    setType: card.set_type,
    promoTypes: card.promo_types ?? [],
    legalities: card.legalities ?? {},
    releasedAt: card.released_at,
    source: card.scryfall_uri,
    faces: card.card_faces?.map((f) => ({
      name: f.name,
      typeLine: f.type_line,
      manaCost: f.mana_cost ?? null,
    })),
  };
}
export function validatePage(page) {
  if (
    page?.object !== 'list' ||
    !Array.isArray(page.data) ||
    !Number.isSafeInteger(page.total_cards)
  )
    throw new Error('Invalid Scryfall search response.');
  if (page.warnings?.length) throw new Error(`Search warnings: ${page.warnings.join('; ')}`);
  if (page.has_more) {
    const next = new URL(page.next_page);
    if (next.origin !== 'https://api.scryfall.com' || next.pathname !== '/cards/search')
      throw new Error('Unexpected pagination destination.');
  }
  return page;
}
