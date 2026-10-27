import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installCardDrag } from '../apps/web/gestures.js';

class Element extends EventTarget {
  constructor() {
    super();
    this.dataset = {};
    this.children = [];
    this.style = {};
    this.isConnected = true;
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.captures = new Set();
  }
  getBoundingClientRect() {
    return { left: 10, top: 20, width: 100, height: 140 };
  }
  cloneNode() {
    return new Element();
  }
  removeAttribute() {}
  setAttribute() {}
  append(...elements) {
    this.children.push(...elements);
  }
  remove() {
    this.isConnected = false;
  }
  animate() {
    return { finished: Promise.resolve() };
  }
  contains(element) {
    return element === this;
  }
  closest() {
    return this;
  }
  querySelectorAll() {
    return [];
  }
  querySelector() {
    return null;
  }
  setPointerCapture(id) {
    this.captures.add(id);
  }
  hasPointerCapture(id) {
    return this.captures.has(id);
  }
  releasePointerCapture(id) {
    this.captures.delete(id);
  }
}
function setup(
  t,
  { accepted = true, inspection = false, canDrag = true, scrollableHand = true } = {},
) {
  const root = new Element(),
    source = new Element(),
    target = new Element();
  source.dataset.card = 'card-1';
  const rail = new Element();
  rail.scrollWidth = 900;
  rail.clientWidth = 300;
  rail.scrollLeft = 180;
  rail.style.scrollSnapType = 'x proximity';
  source.closest = (selector) => (selector === '.hand' ? (scrollableHand ? rail : null) : source);
  const doc = new Element(),
    win = new Element();
  doc.body = new Element();
  doc.createElement = () => new Element();
  doc.elementFromPoint = (x) => (x > 100 ? target : null);
  for (const [key, value] of Object.entries({
    document: doc,
    window: win,
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    CSS: { escape: (s) => s },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() =>
      descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key],
    );
  }
  let commits = 0,
    ends = 0,
    holdCallback = null;
  const inspections = [];
  const drag = installCardDrag(root, {
    begin: () =>
      canDrag
        ? {
            zones: [{ element: target, command: { type: 'cast' }, label: 'Cast' }],
            label: 'Drag',
          }
        : null,
    inspect: inspection ? (id) => inspections.push(id) : undefined,
    setTimer(callback) {
      holdCallback = callback;
      return 1;
    },
    clearTimer() {
      holdCallback = null;
    },
    commit: () => {
      commits++;
      return accepted;
    },
    end: () => ends++,
    feedback() {},
  });
  function fire(where, type, properties = {}) {
    const event = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries({
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: 10,
      clientY: 20,
      pointerType: 'mouse',
      ...properties,
    }))
      Object.defineProperty(event, key, { value });
    if (type === 'pointerdown') Object.defineProperty(event, 'target', { value: source });
    where.dispatchEvent(event);
    return event;
  }
  return {
    root,
    source,
    inspections,
    rail,
    hold() {
      holdCallback?.();
    },
    doc,
    win,
    drag,
    fire,
    get commits() {
      return commits;
    },
    get ends() {
      return ends;
    },
  };
}
test('a normal click does not capture the pointer or submit a command', (t) => {
  const x = setup(t);
  x.fire(x.root, 'pointerdown');
  assert.equal(x.root.hasPointerCapture(1), false);
  x.fire(x.doc, 'pointerup');
  assert.equal(x.commits, 0);
  assert.equal(x.drag.active, false);
  assert.equal(x.fire(x.doc, 'click').defaultPrevented, false);
});
test('drag threshold, legal drop and synthetic click suppression submit once', (t) => {
  const x = setup(t);
  x.fire(x.root, 'pointerdown');
  x.fire(x.doc, 'pointermove', { clientX: 13 });
  assert.equal(x.root.hasPointerCapture(1), false);
  x.fire(x.doc, 'pointermove', { clientX: 150 });
  assert.equal(x.root.hasPointerCapture(1), true);
  x.fire(x.doc, 'pointerup', { clientX: 150 });
  x.fire(x.doc, 'pointerup', { clientX: 150 });
  assert.equal(x.commits, 1);
  assert.equal(x.ends, 1);
  assert.equal(
    x.fire(x.doc, 'click', { target: new Element(), detail: 1 }).defaultPrevented,
    false,
  );
  assert.equal(x.fire(x.doc, 'click', { target: x.root, detail: 0 }).defaultPrevented, false);
  assert.equal(x.fire(x.doc, 'click', { target: x.root }).defaultPrevented, true);
  assert.equal(x.root.hasPointerCapture(1), false);
});
for (const cancellation of ['pointercancel', 'lostpointercapture', 'blur', 'Escape', 'outside'])
  test(`${cancellation} returns the card without submitting`, (t) => {
    const x = setup(t);
    x.fire(x.root, 'pointerdown');
    x.fire(x.doc, 'pointermove', { clientX: 150 });
    if (cancellation === 'Escape') x.fire(x.doc, 'keydown', { key: 'Escape' });
    else if (cancellation === 'outside') x.fire(x.doc, 'pointerup', { clientX: 0 });
    else x.fire(cancellation === 'blur' ? x.win : x.root, cancellation);
    assert.equal(x.commits, 0);
    assert.equal(x.drag.active, false);
    assert.equal(x.ends, 1);
  });
test('horizontal touch scrolling never becomes a card drop', (t) => {
  const x = setup(t);
  x.fire(x.root, 'pointerdown', { pointerType: 'touch' });
  x.fire(x.doc, 'pointermove', { clientX: 150, clientY: 22 });
  x.fire(x.doc, 'pointerup', { clientX: 150 });
  assert.equal(x.commits, 0);
  assert.equal(x.drag.active, false);
});
test('a rejected drop cleans up and allows a later drag', (t) => {
  const x = setup(t, { accepted: false });
  for (let i = 0; i < 2; i++) {
    x.fire(x.root, 'pointerdown');
    x.fire(x.doc, 'pointermove', { clientX: 150 });
    x.fire(x.doc, 'pointerup', { clientX: 150 });
    assert.equal(x.drag.active, false);
  }
  assert.equal(x.commits, 2);
  assert.equal(x.ends, 2);
});

test('holding an unplayable card inspects it without submitting or clicking it', (t) => {
  const x = setup(t, { inspection: true, canDrag: false });
  x.fire(x.root, 'pointerdown', { pointerType: 'touch' });
  x.hold();
  assert.deepEqual(x.inspections, ['card-1']);
  assert.equal(x.drag.active, false);
  x.fire(x.doc, 'pointerup');
  assert.equal(x.commits, 0);
  assert.equal(x.ends, 1);
  assert.equal(x.fire(x.doc, 'click', { target: x.source, detail: 1 }).defaultPrevented, true);
});
test('a short tap clears inspection without suppressing the normal click', (t) => {
  const x = setup(t, { inspection: true });
  x.fire(x.root, 'pointerdown');
  x.fire(x.doc, 'pointerup');
  x.hold();
  assert.deepEqual(x.inspections, []);
  assert.equal(x.fire(x.doc, 'click', { target: x.source, detail: 1 }).defaultPrevented, false);
});
test('touch scrolling cancels inspection and suppresses a delayed synthetic card click', (t) => {
  const x = setup(t, { inspection: true });
  x.fire(x.root, 'pointerdown', { pointerType: 'touch' });
  x.fire(x.doc, 'pointermove', { clientX: 150, clientY: 22 });
  x.hold();
  x.fire(x.doc, 'pointerup');
  assert.deepEqual(x.inspections, []);
  assert.equal(x.commits, 0);
  assert.equal(x.fire(x.doc, 'click', { target: x.source, detail: 1 }).defaultPrevented, true);
});
test('a real drag cancels the inspection timer and still commits once', (t) => {
  const x = setup(t, { inspection: true });
  x.fire(x.root, 'pointerdown');
  x.fire(x.doc, 'pointermove', { clientX: 150 });
  x.hold();
  x.fire(x.doc, 'pointerup', { clientX: 150 });
  assert.deepEqual(x.inspections, []);
  assert.equal(x.commits, 1);
});
for (const reason of ['blur', 'pointercancel', 'removed'])
  test(reason + ' prevents a delayed inspection', (t) => {
    const x = setup(t, { inspection: true });
    x.fire(x.root, 'pointerdown');
    if (reason === 'removed') x.source.isConnected = false;
    else x.fire(reason === 'blur' ? x.win : x.root, reason);
    x.hold();
    assert.deepEqual(x.inspections, []);
    assert.equal(x.drag.active, false);
  });
test('the card context menu reads rather than submits', (t) => {
  const x = setup(t, { inspection: true });
  const event = x.fire(x.root, 'contextmenu', { target: x.source, button: 2 });
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(x.inspections, ['card-1']);
  assert.equal(x.commits, 0);
});

test('touch captures at contact, tolerates finger jitter, and vertical drag commits once', (t) => {
  const x = setup(t);
  x.fire(x.root, 'pointerdown', { pointerType: 'touch' });
  assert.equal(x.source.hasPointerCapture(1), true);
  x.fire(x.doc, 'pointermove', { pointerType: 'touch', clientX: 14, clientY: 24 });
  assert.equal(x.commits, 0);
  const move = x.fire(x.doc, 'pointermove', { pointerType: 'touch', clientX: 150, clientY: 240 });
  assert.equal(move.defaultPrevented, true);
  x.fire(x.doc, 'pointerup', { pointerType: 'touch', clientX: 150, clientY: 240 });
  assert.equal(x.commits, 1);
  assert.equal(x.source.hasPointerCapture(1), false);
});
test('ordinary diagonal touch movement is a card drag, not a cancelled horizontal scroll', (t) => {
  const x = setup(t);
  x.fire(x.root, 'pointerdown', { pointerType: 'touch' });
  x.fire(x.doc, 'pointermove', { pointerType: 'touch', clientX: 150, clientY: 140 });
  x.fire(x.doc, 'pointerup', { pointerType: 'touch', clientX: 150, clientY: 140 });
  assert.equal(x.commits, 1);
  assert.equal(x.rail.scrollLeft, 180);
});
test('sideways hand scrolling stays locked and restores rail snapping without casting', (t) => {
  const x = setup(t, { inspection: true });
  x.fire(x.root, 'pointerdown', { pointerType: 'touch' });
  x.fire(x.doc, 'pointermove', { pointerType: 'touch', clientX: 80, clientY: 22 });
  assert.equal(x.rail.scrollLeft, 110);
  assert.equal(x.rail.style.scrollSnapType, 'none');
  x.fire(x.doc, 'pointermove', { pointerType: 'touch', clientX: 150, clientY: 180 });
  assert.equal(x.rail.scrollLeft, 40);
  x.hold();
  x.fire(x.doc, 'pointerup', { pointerType: 'touch', clientX: 150, clientY: 180 });
  assert.equal(x.rail.style.scrollSnapType, 'x proximity');
  assert.equal(x.commits, 0);
  assert.deepEqual(x.inspections, []);
});
test('battlefield and nonoverflowing-hand cards can drag horizontally on touch', (t) => {
  const x = setup(t, { scrollableHand: false });
  x.fire(x.root, 'pointerdown', { pointerType: 'touch' });
  x.fire(x.doc, 'pointermove', { pointerType: 'touch', clientX: 150, clientY: 22 });
  x.fire(x.doc, 'pointerup', { pointerType: 'touch', clientX: 150, clientY: 22 });
  assert.equal(x.commits, 1);
});
test('unrelated pointer cancellation cannot abort the active finger', (t) => {
  const x = setup(t);
  x.fire(x.root, 'pointerdown', { pointerType: 'touch' });
  x.fire(x.doc, 'pointermove', { pointerType: 'touch', clientX: 150, clientY: 200 });
  x.fire(x.root, 'pointercancel', { pointerId: 2 });
  x.fire(x.root, 'lostpointercapture', { pointerId: 2 });
  assert.equal(x.drag.active, true);
  x.fire(x.doc, 'pointerup', { pointerType: 'touch', clientX: 150, clientY: 200 });
  assert.equal(x.commits, 1);
});
test('a synthesized click on the drop target is suppressed but keyboard activation remains', (t) => {
  const x = setup(t);
  x.fire(x.root, 'pointerdown', { pointerType: 'touch' });
  x.fire(x.doc, 'pointermove', { pointerType: 'touch', clientX: 150, clientY: 200 });
  x.fire(x.doc, 'pointerup', { pointerType: 'touch', clientX: 150, clientY: 200 });
  const target = new Element();
  assert.equal(
    x.fire(x.doc, 'click', { target, detail: 1, clientX: 150, clientY: 200 }).defaultPrevented,
    true,
  );
  assert.equal(
    x.fire(x.doc, 'click', { target, detail: 0, clientX: 150, clientY: 200 }).defaultPrevented,
    false,
  );
});

test('touch taps keep capture on the card so native click targets are not redirected to the table', (t) => {
  const x = setup(t);
  x.fire(x.root, 'pointerdown', { pointerType: 'touch' });
  assert.equal(x.source.hasPointerCapture(1), true);
  assert.equal(x.root.hasPointerCapture(1), false);
  x.fire(x.doc, 'pointerup', { pointerType: 'touch' });
  assert.equal(x.source.hasPointerCapture(1), false);
  assert.equal(x.fire(x.doc, 'click', { target: x.source, detail: 1 }).defaultPrevented, false);
  assert.equal(x.commits, 0);
});

test('touch preview is larger, above the finger, and inside viewport edges', (t) => {
  const x = setup(t);
  x.fire(x.root, 'pointerdown', { pointerType: 'touch' });
  x.fire(x.doc, 'pointermove', { pointerType: 'touch', clientX: 150, clientY: 260 });
  const ghost = x.doc.body.children.find((e) => e.className?.includes('touch-drag-ghost'));
  assert.ok(ghost);
  assert.ok(parseFloat(ghost.style.width) > 100);
  assert.ok(parseFloat(ghost.style.top) + parseFloat(ghost.style.height) < 260);
  x.fire(x.doc, 'pointermove', { pointerType: 'touch', clientX: 1, clientY: 5 });
  assert.ok(parseFloat(ghost.style.top) >= 8);
  assert.ok(parseFloat(ghost.style.left) >= 8);
  x.drag.cancel();
});
test('card touch-action is reserved before pointer movement, not applied after cancellation', async () => {
  const css = await readFile(new URL('../apps/web/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.hand-card\s*\{[^}]*touch-action: none/s);
  assert.match(
    css,
    /\.permanent\[data-card\],\s*\.land-card\[data-card\]\s*\{[^}]*touch-action: none/s,
  );
});
