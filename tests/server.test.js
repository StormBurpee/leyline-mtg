import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { startServer } from '../scripts/server.mjs';

test('local launcher serves the client with explicit content types and boundaries', async (t) => {
  const server = startServer({ port: 0 });
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  await t.test('entry point and engine are available', async () => {
    const r = await fetch(base);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.match(await r.text(), /Leyline/);
    const engine = await fetch(base + '/packages/engine/src/index.js');
    assert.equal(engine.status, 200);
    assert.match(engine.headers.get('content-type'), /javascript/);
  });
  await t.test('security headers are present', async () => {
    const r = await fetch(base);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  });
  await t.test('HEAD has no response body', async () => {
    const r = await fetch(base, { method: 'HEAD' });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), '');
  });
  await t.test('source outside allowed asset roots cannot be read', async () => {
    for (const path of [
      '/README.md',
      '/.git/config',
      '/apps/web/..%2f..%2fpackage.json',
      '/apps/web/..%2f..%2f.env',
    ]) {
      const r = await fetch(base + path);
      assert.ok([403, 404].includes(r.status), path);
    }
  });
  await t.test('non-asset extensions are rejected even inside the web root', async () => {
    const r = await fetch(base + '/apps/web/fonts/README.md');
    assert.equal(r.status, 403);
  });
  await t.test('POST is rejected', async () => {
    const r = await fetch(base, { method: 'POST' });
    assert.equal(r.status, 405);
  });
  await t.test('missing assets do not leak filesystem paths', async () => {
    const r = await fetch(base + '/apps/web/missing.js');
    assert.equal(r.status, 404);
    assert.equal(await r.text(), 'Not found');
  });
});
