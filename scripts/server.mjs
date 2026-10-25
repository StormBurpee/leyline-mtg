import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
export function startServer({ port = 4173, host = '127.0.0.1' } = {}) {
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let p = decodeURIComponent(url.pathname);
      if (p === '/') p = '/apps/web/index.html';
      if (!['/apps/web/', '/packages/engine/src/'].some((prefix) => p.startsWith(prefix)))
        throw Object.assign(new Error('Not found'), { status: 404 });
      const file = resolve(root, '.' + p);
      if (!file.startsWith(root + sep) && !file.startsWith(root))
        throw Object.assign(new Error('Forbidden'), { status: 403 });
      if (!['GET', 'HEAD'].includes(req.method))
        throw Object.assign(new Error('Method not allowed'), { status: 405 });
      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy':
          "default-src 'self'; img-src 'self' https://cards.scryfall.io data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (e) {
      res.writeHead(e.status ?? 404, { 'Content-Type': 'text/plain' });
      res.end(e.status === 405 ? 'Method not allowed' : 'Not found');
    }
  });
  server.listen(port, host, () => console.log(`Leyline: http://${host}:${port}`));
  return server;
}
