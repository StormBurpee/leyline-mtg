import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { QUERIES, searchURL, normalizeCard, validatePage } from '../packages/catalog/scryfall.js';
const [pool, output] = process.argv.slice(2);
if (!Object.hasOwn(QUERIES, pool) || !output)
  throw new Error('Usage: node scripts/snapshot-card-pool.mjs <standard|arena> <new-output.json>');
const asOf = new Date().toISOString().slice(0, 10);
const query = QUERIES[pool],
  cache = resolve(
    'research',
    `scryfall-${pool}-${asOf}-${createHash('sha256')
      .update(query + asOf)
      .digest('hex')
      .slice(0, 10)}`,
  );
await mkdir(cache, { recursive: true });
let url = searchURL(query, asOf),
  index = 0,
  expected;
const cards = [],
  pages = [];
while (url) {
  const path = join(cache, `${++index}.json`);
  let raw, fetchedAt;
  try {
    const cached = JSON.parse(await readFile(path, 'utf8'));
    if (cached.url !== url) throw new Error('Cached page belongs to a different query.');
    ({ raw, fetchedAt } = cached);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    await new Promise((r) => setTimeout(r, 1700));
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'LeylineMTG/0.2 (open-source rules engine)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(
        `Scryfall returned ${response.status}; stopped without retry. Cached pages are retained.`,
      );
    raw = await response.text();
    fetchedAt = new Date().toISOString();
    validatePage(JSON.parse(raw));
    await writeFile(path, JSON.stringify({ url, fetchedAt, raw }), { flag: 'wx' });
  }
  const page = validatePage(JSON.parse(raw));
  expected ??= page.total_cards;
  if (page.total_cards !== expected)
    throw new Error('Inventory changed during pagination; start a fresh snapshot.');
  pages.push({ url, fetchedAt, sha256: createHash('sha256').update(raw).digest('hex') });
  cards.push(...page.data.map(normalizeCard));
  console.log(`${pool}: ${cards.length}/${expected}`);
  url = page.has_more ? page.next_page : null;
}
if (cards.length !== expected || new Set(cards.map((c) => c.oracleId)).size !== expected)
  throw new Error('Incomplete or duplicate inventory.');
const result = {
  schemaVersion: 1,
  provider: 'Scryfall',
  asOf,
  query,
  startedAt: pages[0].fetchedAt,
  completedAt: pages.at(-1).fetchedAt,
  total: cards.length,
  meaning:
    'Catalog inventory only. Presence does not imply executable card support or a format-complete simulator.',
  pages,
  cards,
};
await writeFile(resolve(output), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(`Saved ${output}`);
