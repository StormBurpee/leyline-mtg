import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
async function scripts(dir) {
  const result = [];
  for (const e of await readdir(root + dir, { withFileTypes: true })) {
    if (e.isDirectory()) result.push(...(await scripts(dir + e.name + '/')));
    else if (/\.(m?js)$/.test(e.name)) result.push(dir + e.name);
  }
  return result;
}
for (const dir of ['packages/', 'apps/', 'scripts/'])
  for (const file of await scripts(dir)) {
    const r = spawnSync(process.execPath, ['--check', root + file], { stdio: 'inherit' });
    if (r.status) process.exit(r.status);
  }
const tests = spawnSync(
  process.execPath,
  [
    '--test',
    ...(await scripts('packages/engine/test/').then((xs) =>
      xs.filter((x) => x.endsWith('.test.js')),
    )),
  ],
  { cwd: root, stdio: 'inherit' },
);
process.exit(tests.status ?? 1);
