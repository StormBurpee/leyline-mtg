import test from 'node:test';
import assert from 'node:assert/strict';
import { installCardDrag } from '../apps/web/gestures.js';

class Element extends EventTarget {
  constructor() {
    super();
    this.dataset = {};
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
  append() {}
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
function setup(t, { accepted = true } = {}) {
  const root = new Element(),
    source = new Element(),
    target = new Element();
  source.dataset.card = 'card-1';
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
    ends = 0;
  const drag = installCardDrag(root, {
    begin: () => ({
      zones: [{ element: target, command: { type: 'cast' }, label: 'Cast' }],
      label: 'Drag',
    }),
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
