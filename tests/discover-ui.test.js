import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import {
  createGame,
  CARDS,
  dispatch,
  exportReplay,
  replay,
  chooseBotCommand,
} from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
// DOM lifecycle regression tests, not a substitute for browser/layout screenshots.
async function mount(saved = null) {
  const { window, document } = parseHTML(
    await readFile(new URL('../apps/web/index.html', import.meta.url), 'utf8'),
  );
  const storage = new Map(
    saved
      ? [['leyline.match.v1', JSON.stringify({ replay: saved, mode: 'bot', deck: 'storm-rakdos' })]]
      : [],
  );
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
      setItem: (k, v) => storage.set(k, v),
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
          await readFile(new URL('../apps/web/card-metadata.json', import.meta.url), 'utf8'),
        ),
    }),
  };
  for (const [key, value] of Object.entries(globals)) {
    old[key] = globalThis[key];
    globalThis[key] = value;
  }
  await import(`../apps/web/app.js?lifecycle=${Math.random()}`);
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
    click,
    cleanup() {
      for (const [key, value] of Object.entries(old)) globalThis[key] = value;
    },
  };
}
async function pendingReplay(foundName = 'Shock') {
  const source = JSON.parse(
    await readFile(new URL('../packages/cards/cards/geological-appraiser.json', import.meta.url)),
  );
  const compiled = compileCard(source);
  assert.equal(compiled.ok, true);
  const catalog = { ...CARDS, [source.name]: compiled.definition };
  const deck = [
    ...Array(20).fill('Mountain'),
    ...Array(4).fill('Geological Appraiser'),
    ...Array(4).fill(foundName),
  ];
  let s = createGame({
    catalog,
    decks: [deck, deck],
    seed: 42,
    mulligan: false,
    minimumDeckSize: 28,
  });
  for (let i = 0; i < 650 && s.status === 'playing'; i++) {
    if (s.choice?.discover !== undefined && s.choice.player === 0) return exportReplay(s);
    const r = dispatch(s, chooseBotCommand(s, s.choice?.player ?? s.priority));
    assert.equal(r.ok, true, JSON.stringify(r.error));
    s = r.state;
  }
  throw new Error('Expected a pending actual Appraiser discover');
}
test('Discover card dialog offers no-mana-cost cast or hand, survives cancellation, and rejects repeated stale choice clicks', async () => {
  const saved = await pendingReplay();
  const m = await mount(saved);
  try {
    m.click('[data-action="resume"]');
    assert.match(m.dialog.textContent, /Discover 3/);
    assert.match(m.dialog.textContent, /without paying its mana cost/);
    assert.match(m.dialog.textContent, /Put into hand/);
    const pending = replay(saved);
    for (const ref of pending.resolving.discover.exiled)
      assert.ok(m.dialog.textContent.includes(pending.objects[ref.id].name));
    assert.match(m.dialog.textContent, /Discovered card/);
    assert.doesNotMatch(m.dialog.textContent, /deal undefined|pay costs/);
    m.click('[data-action="beginResolutionCast"]');
    m.click('[data-action="spellTargets"]');
    assert.ok(m.dialog.open, 'target button opens the casting decision');
    m.click('[data-action="closeDialog"]');
    m.click('[data-action="cancelSelection"]');
    const review = m.document.querySelector('[data-action="reviewDecision"]');
    if (review) m.click('[data-action="reviewDecision"]');
    assert.match(m.dialog.textContent, /Put into hand/);
    const oldButton = m.document.querySelector('[data-action="declineResolutionCast"]');
    m.click('[data-action="declineResolutionCast"]');
    const after = m.storage.get('leyline.match.v1');
    oldButton.dispatchEvent(new m.document.defaultView.Event('click', { bubbles: true }));
    assert.equal(m.storage.get('leyline.match.v1'), after);
    const record = JSON.parse(after).replay;
    assert.equal(record.commands.at(-1).type, 'declineCastExiled');
  } finally {
    m.cleanup();
  }
});

test('Discover X dialog permits only X=0 and retains the pending parent on an invalid custom X', async () => {
  const saved = await pendingReplay('Mind Spring');
  const m = await mount(saved);
  try {
    m.click('[data-action="resume"]');
    m.click('[data-action="beginResolutionCast"]');
    assert.match(m.dialog.textContent, /X must be 0/);
    const input = m.document.querySelector('#cast-x-value');
    assert.equal(input.getAttribute('max'), '0');
    input.value = '1';
    m.click('[data-action="chooseX"]');
    assert.match(m.dialog.textContent, /X must be 0/);
    assert.equal(
      JSON.parse(m.storage.get('leyline.match.v1')).replay.commands.at(-1).type,
      saved.commands.at(-1).type,
    );
    m.click('[data-action="chooseX"][data-x="0"]');
    const last = JSON.parse(m.storage.get('leyline.match.v1')).replay.commands.at(-1);
    assert.equal(last.type, 'cast');
    assert.equal(last.x, 0);
  } finally {
    m.cleanup();
  }
});
