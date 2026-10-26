import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VERSION } from '../packages/engine/src/index.js';
const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
test('release metadata never trails the executable engine and card pack versions', async () => {
  const root = await json('../package.json');
  const engine = await json('../packages/engine/package.json');
  const pack = await json('../packages/cards/pack.json');
  const parts = (v) => v.split('.').map(Number);
  const rootParts = parts(root.version),
    engineParts = parts(VERSION);
  const firstDifference = rootParts.findIndex((n, i) => n !== engineParts[i]);
  assert.ok(
    firstDifference === -1 || rootParts[firstDifference] > engineParts[firstDifference],
    'Root release version cannot trail the engine',
  );
  assert.equal(engine.version, VERSION);
  assert.equal(pack.version, VERSION);
});
