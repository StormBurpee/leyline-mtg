import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { CARDS, VERSION } from '../packages/engine/src/index.js';
const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
test('support manifest matches the executable registry and engine version', async () => {
  const report = await json('../docs/support.json');
  assert.equal(report.version, VERSION);
  assert.deepEqual(
    report.cards.map((c) => c.name).sort(),
    Object.values(CARDS)
      .filter((c) => !c.token)
      .map((c) => c.name)
      .sort(),
  );
});
test('Forge inventory identifies the exact checked-in compiler source', async () => {
  const report = await json('../docs/forge-audit.json');
  const source = await readFile(new URL('../packages/forge-import/compile.js', import.meta.url));
  assert.equal(report.compilerSourceSha256, createHash('sha256').update(source).digest('hex'));
  for (const path of [
    'packages/forge-import/compile.js',
    'packages/engine/src/registry.js',
    'packages/engine/src/definition-validation.js',
    'packages/engine/src/condition-schema.js',
    'packages/engine/src/selectors.js',
    'packages/engine/src/events.js',
    'packages/engine/src/types.js',
  ]) {
    const source = await readFile(new URL(`../${path}`, import.meta.url));
    assert.equal(
      report.compilerInputs[path],
      createHash('sha256').update(source).digest('hex'),
      path,
    );
  }
  assert.equal(report.compilerCandidates + report.rejectedFiles, report.totalFiles);
});
for (const pool of ['standard', 'arena'])
  test(`${pool} inventory shards agree with counts and curated status`, async () => {
    const dir = new URL(`../docs/card-pools/${pool}-2026-10-26/`, import.meta.url);
    const report = JSON.parse(await readFile(new URL('summary.json', dir), 'utf8'));
    const cards = [];
    for (const file of await readdir(dir))
      if (file.endsWith('.json') && file !== 'summary.json')
        cards.push(...JSON.parse(await readFile(new URL(file, dir), 'utf8')));
    assert.equal(cards.length, report.inScopeCount);
    assert.equal(new Set(cards.map((c) => c.oracleId)).size, cards.length);
    const counts = {};
    for (const c of cards) {
      counts[c.status] = (counts[c.status] ?? 0) + 1;
      assert.equal(
        c.status === 'curated',
        Object.hasOwn(CARDS, c.name) && !CARDS[c.name].token,
        c.name,
      );
    }
    assert.deepEqual(counts, report.coverage);
  });
