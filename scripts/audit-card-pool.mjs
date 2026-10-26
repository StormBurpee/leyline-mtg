import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { CARDS } from '../packages/engine/src/cards.js';
import { classifyInventoryCard, cardCoverage } from '../packages/catalog/coverage.js';
const [poolPath, forgePath, destination] = process.argv.slice(2);
if (!destination)
  throw new Error(
    'Usage: node scripts/audit-card-pool.mjs <snapshot.json> <forge-report.json> <new-output-directory>',
  );
const raw = await readFile(poolPath, 'utf8'),
  pool = JSON.parse(raw),
  forge = JSON.parse(await readFile(forgePath, 'utf8'));
const byName = new Map();
for (const script of forge.results) {
  if (!byName.has(script.name)) byName.set(script.name, []);
  byName.get(script.name).push(script);
}
const counts = {},
  excluded = {},
  layouts = {},
  keywords = {},
  reasons = {},
  shards = new Map();
for (const card of pool.cards) {
  const scope = classifyInventoryCard(card, pool.asOf);
  if (scope !== 'in_scope') {
    excluded[scope] = (excluded[scope] ?? 0) + 1;
    continue;
  }
  const result = cardCoverage(card, CARDS, byName);
  counts[result.status] = (counts[result.status] ?? 0) + 1;
  layouts[card.layout] = (layouts[card.layout] ?? 0) + 1;
  if (result.status !== 'curated')
    for (const k of card.keywords) keywords[k] = (keywords[k] ?? 0) + 1;
  for (const reason of result.diagnostics) {
    const category = reason.replace(/^Line \d+: /, '').split(':')[0];
    reasons[category] = (reasons[category] ?? 0) + 1;
  }
  const shard = /^[a-z]/i.test(card.name) ? card.name[0].toLowerCase() : 'other';
  if (!shards.has(shard)) shards.set(shard, []);
  shards.get(shard).push({ oracleId: card.oracleId, name: card.name, status: result.status });
}
const output = resolve(destination);
await mkdir(output, { recursive: false });
for (const [shard, cards] of shards)
  await writeFile(join(output, `${shard}.json`), JSON.stringify(cards, null, 2) + '\n', {
    flag: 'wx',
  });
const sorted = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
const summary = {
  schemaVersion: 1,
  compilerVersion: forge.compilerVersion ?? null,
  compilerInputs: forge.compilerInputs ?? null,
  compilerSourceSha256: forge.compilerSourceSha256 ?? null,
  asOf: pool.asOf,
  query: pool.query,
  provider: pool.provider,
  startedAt: pool.startedAt,
  completedAt: pool.completedAt,
  snapshotSha256: createHash('sha256').update(raw).digest('hex'),
  catalogCount: pool.total,
  inScopeCount: Object.values(counts).reduce((a, b) => a + b, 0),
  excluded,
  coverage: counts,
  layouts: sorted(layouts),
  keywordsOnUnimplementedCards: sorted(keywords),
  diagnostics: sorted(reasons),
  meaning:
    'Curated means a built-in executable definition, not universal interaction certification. Compiler candidates are not supported cards. Exact-name matches are deliberately conservative. Inventory is not an Arena-client availability attestation.',
  pages: pool.pages,
};
await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', {
  flag: 'wx',
});
console.log(
  JSON.stringify(
    {
      inScope: summary.inScopeCount,
      excluded,
      coverage: counts,
      keywordsOnUnimplementedCards: Object.entries(summary.keywordsOnUnimplementedCards).slice(
        0,
        15,
      ),
    },
    null,
    2,
  ),
);
