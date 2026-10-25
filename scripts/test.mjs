import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) files.push(...(await collect(path)));
    else if (entry.name.endsWith('.test.js')) files.push(fileURLToPath(path));
  }
  return files;
}
const files = [
  ...(await collect(new URL('../packages/engine/test/', import.meta.url))),
  ...(await collect(new URL('../packages/forge-import/test/', import.meta.url))),
  ...(await collect(new URL('../tests/', import.meta.url))),
].sort();
const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
