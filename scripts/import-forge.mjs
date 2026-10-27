import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { compileForgeCard } from '../packages/forge-import/compile.js';
const args = process.argv.slice(2),
  input = args[0];
if (!input) {
  console.error('Usage: node scripts/import-forge.mjs <file-or-directory> [new-report.json]');
  process.exit(2);
}
async function collect(path) {
  const { stat } = await import('node:fs/promises');
  const s = await stat(path);
  if (s.isFile()) return extname(path) === '.txt' ? [path] : [];
  const result = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    result.push(...(await collect(join(path, entry.name))));
  }
  return result;
}
const files = (await collect(resolve(input))).sort();
const results = [];
for (const file of files)
  results.push(compileForgeCard(await readFile(file, 'utf8'), { source: file }));
const compilerPackage = JSON.parse(
  await readFile(new URL('../packages/forge-import/package.json', import.meta.url), 'utf8'),
);
const compilerSource = await readFile(
  new URL('../packages/forge-import/compile.js', import.meta.url),
);
const compilerInputs = {};
for (const path of [
  'packages/forge-import/compile.js',
  'packages/engine/src/registry.js',
  'packages/engine/src/definition-validation.js',
  'packages/engine/src/condition-schema.js',
  'packages/engine/src/target-group-schema.js',
  'packages/engine/src/selectors.js',
  'packages/engine/src/value-schema.js',
  'packages/engine/src/events.js',
  'packages/engine/src/types.js',
  'packages/engine/src/creature-types.js',
])
  compilerInputs[path] = createHash('sha256')
    .update(await readFile(new URL(`../${path}`, import.meta.url)))
    .digest('hex');
const report = {
  compilerInputs,
  compilerVersion: compilerPackage.version,
  compilerSourceSha256: createHash('sha256').update(compilerSource).digest('hex'),
  purpose: 'Migration candidates only. No cards were registered or game code changed.',
  total: results.length,
  candidates: results.filter((r) => r.status === 'candidate').length,
  unsupported: results.filter((r) => r.status === 'unsupported').length,
  results,
};
const json = JSON.stringify(report, null, 2) + '\n';
if (args[1]) await writeFile(resolve(args[1]), json, { flag: 'wx' });
else process.stdout.write(json);
