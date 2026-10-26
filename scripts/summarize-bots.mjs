import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { summarizePaired, summarizeSeeds } from '../packages/simulation/evaluation.js';

const [source, output] = process.argv.slice(2);
if (!source || !output)
  throw new Error('Usage: node scripts/summarize-bots.mjs experiment.jsonl analysis.json');
const bytes = readFileSync(source);
const [header, ...records] = bytes.toString('utf8').trim().split('\n').map(JSON.parse);
if (!header.metadata || records.length !== header.metadata.games)
  throw new Error('Incomplete or malformed experiment');
const timing = {};
for (const record of records)
  for (const entry of record.policyTiming ?? []) {
    const aggregate = (timing[entry.policy] ??= { calls: 0, totalMs: 0, maxMs: 0 });
    aggregate.calls += entry.calls;
    aggregate.totalMs += entry.totalMs;
    aggregate.maxMs = Math.max(aggregate.maxMs, entry.maxMs);
  }
for (const aggregate of Object.values(timing))
  aggregate.meanMs = aggregate.totalMs / aggregate.calls;
const analysis = {
  source,
  sourceSha256: createHash('sha256').update(bytes).digest('hex'),
  metadata: header.metadata,
  paired: summarizePaired(records),
  bySeed: summarizeSeeds(records),
  timing,
};
writeFileSync(output, JSON.stringify(analysis, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ paired: analysis.paired, bySeed: analysis.bySeed, timing }, null, 2));
