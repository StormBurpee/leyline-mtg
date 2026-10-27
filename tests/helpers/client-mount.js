import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { createMatchStorage } from '../../apps/web/match-storage.js';
// Headless DOM lifecycle checks, not browser/layout verification.
export async function mount(saved = null, savedStorage = null) {
  const { window, document } = parseHTML(
    await readFile(new URL('../../apps/web/index.html', import.meta.url), 'utf8'),
  );
  const storage = new Map(
    savedStorage ??
      (saved
        ? [
            [
              'leyline.match.v1',
              JSON.stringify({ replay: saved, mode: 'bot', deck: 'storm-rakdos' }),
            ],
          ]
        : []),
  );
  const writes = [];
  let active = document.body;
  Object.defineProperty(document, 'activeElement', { get: () => active, configurable: true });
  window.HTMLElement.prototype.focus = function () {
    active = this;
  };
  window.HTMLElement.prototype.getClientRects = () => [];
  window.HTMLElement.prototype.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
  });
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
    get: () => 0,
    configurable: true,
  });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', {
    get: () => 0,
    configurable: true,
  });
  window.HTMLElement.prototype.setSelectionRange = function () {};
  window.HTMLElement.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {} });
  window.scrollTo = () => {};
  const dialog = document.querySelector('#dialog');
  Object.defineProperty(dialog, 'open', {
    get() {
      return this.hasAttribute('open');
    },
  });
  dialog.showModal = function () {
    this.setAttribute('open', '');
  };
  dialog.close = function () {
    this.removeAttribute('open');
    this.dispatchEvent(new window.Event('close'));
  };
  const old = {};
  const globals = {
    window,
    document,
    HTMLElement: window.HTMLElement,
    CSS: { escape: String },
    localStorage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => {
        writes.push(k);
        storage.set(k, v);
      },
      removeItem: (k) => storage.delete(k),
    },
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ paddingLeft: '0', paddingRight: '0', transform: 'none' }),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout: () => 1,
    clearTimeout() {},
    fetch: async () => ({
      ok: true,
      json: async () =>
        JSON.parse(
          await readFile(new URL('../../apps/web/card-metadata.json', import.meta.url), 'utf8'),
        ),
    }),
  };
  for (const [key, value] of Object.entries(globals)) {
    old[key] = globalThis[key];
    globalThis[key] = value;
  }
  await import(`../../apps/web/app.js?lifecycle=${Math.random()}`);
  const click = (selector) => {
    const el = document.querySelector(selector);
    assert.ok(el, `Missing ${selector}`);
    assert.ok(!el.disabled, `Disabled ${selector}`);
    el.dispatchEvent(new window.Event('click', { bubbles: true }));
    return el;
  };
  return {
    document,
    dialog,
    storage,
    writes,
    readSaved: () => createMatchStorage(() => globals.localStorage).read(),
    click,
    cleanup() {
      for (const [key, value] of Object.entries(old)) globalThis[key] = value;
    },
  };
}
