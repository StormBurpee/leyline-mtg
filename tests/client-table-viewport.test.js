import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installTableViewport } from '../apps/web/table-viewport.js';

function fixture(viewport = { height: 664, scale: 1 }) {
  const properties = new Map(),
    listeners = new Map(),
    viewportListeners = new Map();
  const frames = new Map();
  let next = 0;
  const root = {
    style: {
      setProperty: (k, v) => properties.set(k, v),
      removeProperty: (k) => properties.delete(k),
    },
  };
  const view = {
    innerHeight: 844,
    addEventListener: (k, v) => listeners.set(k, v),
    removeEventListener: (k) => listeners.delete(k),
    requestAnimationFrame: (fn) => {
      frames.set(++next, fn);
      return next;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    ...(viewport
      ? {
          visualViewport: {
            ...viewport,
            addEventListener: (k, v) => viewportListeners.set(k, v),
            removeEventListener: (k) => viewportListeners.delete(k),
          },
        }
      : {}),
  };
  return {
    root,
    view,
    properties,
    listeners,
    viewportListeners,
    frames,
    flush() {
      const fs = [...frames.values()];
      frames.clear();
      fs.forEach((fn) => fn());
    },
  };
}
test('table uses the visible Safari viewport instead of larger layout height', () => {
  const f = fixture();
  const dispose = installTableViewport(f.root, f.view);
  assert.equal(f.properties.get('--table-viewport-height'), '664px');
  f.view.visualViewport.height = 720;
  f.viewportListeners.get('resize')();
  f.listeners.get('resize')();
  assert.equal(f.frames.size, 1);
  f.flush();
  assert.equal(f.properties.get('--table-viewport-height'), '720px');
  dispose();
  assert.equal(f.listeners.size, 0);
  assert.equal(f.viewportListeners.size, 0);
  assert.equal(f.properties.size, 0);
});
test('orientation, toolbar collapse and back-forward restore refresh without disabling zoom', () => {
  const f = fixture();
  installTableViewport(f.root, f.view);
  f.view.visualViewport.height = 320;
  f.listeners.get('orientationchange')();
  f.flush();
  assert.equal(f.properties.get('--table-viewport-height'), '320px');
  f.view.visualViewport.scale = 2;
  f.view.visualViewport.height = 160;
  f.viewportListeners.get('resize')();
  f.flush();
  assert.equal(f.properties.get('--table-viewport-height'), '320px');
  f.view.visualViewport.scale = 1;
  f.view.visualViewport.height = 664;
  f.listeners.get('pageshow')();
  f.flush();
  assert.equal(f.properties.get('--table-viewport-height'), '664px');
});
test('fallback works without VisualViewport and cleanup cancels scheduled work', () => {
  const f = fixture(null);
  const dispose = installTableViewport(f.root, f.view);
  assert.equal(f.properties.get('--table-viewport-height'), '844px');
  f.listeners.get('resize')();
  dispose();
  assert.equal(f.frames.size, 0);
});
test('mobile layout removes legacy vh minimum and reserves primary actions', async () => {
  const css = await readFile(new URL('../apps/web/mobile-table.css', import.meta.url), 'utf8');
  assert.match(
    css,
    /\.shell:has\(\.game-layout\)\s*\{[^}]*height: var\(--table-viewport-height, 100dvh\);[^}]*min-height: 0;/,
  );
  assert.match(css, /\.game-layout \.action-buttons \.primary\s*\{[^}]*order: -1;/);
  assert.match(css, /\.game-layout \.priority-controls\s*\{[^}]*display: none;/);
  const html = await readFile(new URL('../apps/web/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/);
});
