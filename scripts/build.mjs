import { mkdir, readdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
const root = new URL('../', import.meta.url),
  out = new URL('dist/', root);
await mkdir(out, { recursive: true });
for (const f of await readdir(new URL('apps/web/', root))) {
  if (f === 'fonts' || f === 'tokens') {
    await cp(new URL(`apps/web/${f}/`, root), new URL(`${f}/`, out), { recursive: true });
    continue;
  }
  let body = await readFile(new URL(`apps/web/${f}`, root));
  if (f.endsWith('.js'))
    body = Buffer.from(body.toString().replaceAll('../../packages/engine/src/', './engine/'));
  await writeFile(new URL(f, out), body);
}
await cp(new URL('packages/engine/src/', root), new URL('engine/', out), { recursive: true });
console.log('Built static client in dist/');
