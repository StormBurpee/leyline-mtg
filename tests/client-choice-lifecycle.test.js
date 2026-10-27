import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import {
  createGame,
  CARDS,
  dispatch,
  exportReplay,
  chooseBotCommand,
} from '../packages/engine/src/index.js';

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
function act(s, type, extra = {}) {
  const r = dispatch(s, { type, player: s.choice?.player ?? s.priority, ...extra });
  assert.ok(r.ok, r.error?.message);
  return r.state;
}
function libraryReplay(name) {
  let s;
  for (let seed = 1; seed < 200; seed++) {
    s = createGame({
      seed,
      mulligan: false,
      decks: [[...Array(56).fill('Island'), ...Array(4).fill(name)], Array(60).fill('Forest')],
    });
    if (s.players[0].hand.some((id) => s.objects[id].name === name)) break;
  }
  while (s.step !== 'main1') s = act(s, 'pass');
  s = act(s, 'playLand', { card: s.players[0].hand.find((id) => s.objects[id].name === 'Island') });
  s = act(s, 'cast', { card: s.players[0].hand.find((id) => s.objects[id].name === name) });
  s = act(s, 'pass');
  s = act(s, 'pass');
  assert.equal(s.choice.kind, 'libraryOrder');
  return exportReplay(s);
}
function fireglassReplay() {
  for (let seed = 1; seed < 30; seed++) {
    let s = createGame({
      seed,
      decks: [
        [
          ...Array(4).fill('Fireglass Mentor'),
          ...Array(28).fill('Mountain'),
          ...Array(28).fill('Swamp'),
        ],
        Array(60).fill('Forest'),
      ],
    });
    for (let i = 0; i < 600 && s.status !== 'finished'; i++) {
      if (s.choice?.kind === 'exilePlay' && s.choice.player === 0) return exportReplay(s);
      const p = s.choice?.player ?? s.priority,
        c = chooseBotCommand(s, p);
      assert.ok(c);
      const r = dispatch(s, c);
      assert.ok(r.ok, r.error?.message);
      s = r.state;
    }
  }
  throw new Error('No Fireglass choice reached');
}

test('opening hand auto-opens large cards, survives View Battlefield, and mulligan resets selection', async () => {
  const h = await mount();
  try {
    h.click('[data-action="start"]');
    assert.equal(h.dialog.open, true);
    assert.ok(h.dialog.classList.contains('choice-stage'));
    assert.equal(h.dialog.querySelectorAll('.decision-card-face').length, 7);
    h.click('#dialog [data-action="closeDialog"]');
    assert.equal(h.dialog.open, false);
    h.click('[data-action="reviewDecision"]');
    assert.equal(h.dialog.open, true);
    h.click('#dialog [data-action="mulligan"]');
    assert.equal(h.dialog.querySelectorAll('.decision-card-face').length, 7);
    h.click('#dialog [data-action="keep"]');
    assert.match(h.dialog.textContent, /Put 1 card back/);
    assert.equal(h.dialog.querySelector('[data-action="confirmDecision"]').disabled, true);
    h.click('#dialog [data-action="selectDecisionCard"]');
    assert.equal(h.dialog.querySelector('[data-action="confirmDecision"]').disabled, false);
    h.click('#dialog [data-action="confirmDecision"]');
    assert.equal(h.dialog.open, false);
  } finally {
    h.cleanup();
  }
});
for (const name of ['Opt', 'Consider'])
  test(`${name} auto-presents destination lanes and keeps the draft after reviewing a card`, async () => {
    const h = await mount(libraryReplay(name));
    try {
      h.click('[data-action="resume"]');
      assert.equal(h.dialog.open, true);
      assert.equal(h.dialog.querySelectorAll('.decision-order-lane').length, 2);
      h.click('#dialog [data-action="readDecisionCard"]');
      assert.ok(h.dialog.querySelector('.decision-reader'));
      h.click('#dialog [data-action="returnDecision"]');
      assert.equal(h.dialog.querySelectorAll('.decision-order-lane').length, 2);
      h.click('#dialog [data-action="libraryMove"]');
      assert.equal(
        h.dialog.querySelector('[data-order-drop="rest"]').querySelectorAll('.decision-card-face')
          .length,
        1,
      );
      h.click('#dialog [data-action="closeDialog"]');
      h.click('[data-action="reviewDecision"]');
      assert.equal(
        h.dialog.querySelector('[data-order-drop="rest"]').querySelectorAll('.decision-card-face')
          .length,
        1,
      );
      h.click('#dialog [data-action="submitLibrary"]');
      assert.equal(h.dialog.open, false);
      const saved = JSON.parse(h.storage.get('leyline.match.v1'));
      assert.equal(saved.replay.commands.at(-1).type, 'orderLibrary');
      assert.equal(saved.replay.commands.at(-1).rest.length, 1);
    } finally {
      h.cleanup();
    }
  });
test('Fireglass uses image choices, preserves selection through Read and View Battlefield, and confirms once', async () => {
  const h = await mount(fireglassReplay());
  try {
    h.click('[data-action="resume"]');
    assert.match(h.dialog.textContent, /Choose one/);
    assert.equal(h.dialog.querySelectorAll('.decision-card-face img').length, 2);
    const button = h.click('#dialog [data-action="selectDecisionCard"]'),
      id = button.dataset.cardid;
    h.click('#dialog [data-action="readDecisionCard"]');
    h.click('#dialog [data-action="returnDecision"]');
    assert.equal(h.dialog.querySelector('.is-selected .decision-card-face').dataset.cardid, id);
    h.click('#dialog [data-action="closeDialog"]');
    h.click('[data-action="reviewDecision"]');
    assert.equal(h.dialog.querySelector('.is-selected .decision-card-face').dataset.cardid, id);
    h.click('#dialog [data-action="confirmDecision"]');
    assert.equal(h.dialog.open, false);
    const saved = JSON.parse(h.storage.get('leyline.match.v1'));
    assert.equal(saved.replay.commands.at(-1).type, 'chooseResolutionCard');
    assert.equal(saved.replay.commands.at(-1).card, id);
  } finally {
    h.cleanup();
  }
});

for (const [scenario, action] of [
  ['search', 'confirmSearch'],
  ['legend', 'confirmDecision'],
  ['optional', 'declineOptional'],
  ['ward', 'declineWard'],
]) {
  test(`${scenario} decision opens automatically and remains actionable after card inspection`, async () => {
    const record = JSON.parse(
      await readFile(
        new URL(`../apps/web/example-${scenario}-replay.json`, import.meta.url),
        'utf8',
      ),
    );
    const h = await mount(record);
    try {
      h.click('[data-action="resume"]');
      assert.equal(h.dialog.open, true);
      assert.ok(h.dialog.classList.contains('choice-stage'));
      const read = h.dialog.querySelector('[data-action="readDecisionCard"]');
      if (read) {
        h.click('#dialog [data-action="readDecisionCard"]');
        h.click('#dialog [data-action="returnDecision"]');
      }
      if (scenario === 'search') h.click('#dialog [data-action="searchAdd"]:not(:disabled)');
      if (scenario === 'legend') h.click('#dialog [data-action="selectDecisionCard"]');
      h.click(`#dialog [data-action="${action}"]`);
      const saved = JSON.parse(h.storage.get('leyline.match.v1'));
      assert.ok(saved.replay.commands.length > record.commands.length);
    } finally {
      h.cleanup();
    }
  });
}

test('public graveyard and exile viewers use large cards and return from the reader', async () => {
  const h = await mount(libraryReplay('Consider'));
  try {
    h.click('[data-action="resume"]');
    h.click('#dialog [data-action="libraryMove"]');
    h.click('#dialog [data-action="submitLibrary"]');
    h.click('[data-action="zone"][data-player="0"][data-zone="graveyard"]');
    assert.ok(h.dialog.querySelector('.decision-card-grid'));
    assert.ok(h.dialog.querySelector('.decision-card-face'));
    h.click('#dialog [data-action="readDecisionCard"]');
    assert.ok(h.dialog.querySelector('.decision-reader'));
    h.click('#dialog [data-action="returnDecision"]');
    assert.ok(h.dialog.querySelector('.decision-card-grid'));
  } finally {
    h.cleanup();
  }
});

test('graveyard spell targets use card images and an explicit guarded confirmation', async () => {
  const record = JSON.parse(
    await readFile(new URL('../apps/web/example-burial-replay.json', import.meta.url), 'utf8'),
  );
  const h = await mount(record);
  try {
    h.click('[data-action="resume"]');
    h.click('.hand-card[data-card="c27"]');
    h.click('[data-action="spellTargets"]');
    assert.ok(h.dialog.classList.contains('choice-stage'));
    assert.ok(h.dialog.querySelector('.decision-card-face img'));
    assert.equal(h.dialog.querySelector('[data-action="confirmTargetChoice"]').disabled, true);
    h.click('#dialog [data-action="selectTargetCard"]');
    h.click('#dialog [data-action="confirmTargetChoice"]');
    assert.equal(h.dialog.open, false);
    const saved = JSON.parse(h.storage.get('leyline.match.v1')),
      command = saved.replay.commands.at(-1);
    assert.equal(command.type, 'cast');
    assert.equal(command.card, 'c27');
    assert.equal(command.target.id, 'c43');
    assert.equal(command.target.incarnation, 1);
  } finally {
    h.cleanup();
  }
});

test('noncast Aura attachment uses the shared card stage and preserves a reviewed selection', async () => {
  const catalog = {
    ...CARDS,
    'Aura entry guide': {
      name: 'Aura entry guide',
      type: 'creature',
      cost: {},
      power: 1,
      toughness: 1,
    },
    'Aura entry search': {
      name: 'Aura entry search',
      type: 'sorcery',
      cost: {},
      effects: [
        {
          op: 'searchLibrary',
          count: 1,
          where: { type: 'enchantment' },
          destination: 'battlefield',
        },
      ],
    },
  };
  let state;
  for (let seed = 1; seed < 200; seed++) {
    state = createGame({
      seed,
      mulligan: false,
      catalog,
      decks: [
        [
          ...Array(4).fill('Aura entry guide'),
          ...Array(4).fill('Aura entry search'),
          ...Array(4).fill('Frantic Strength'),
          ...Array(48).fill('Forest'),
        ],
        Array(60).fill('Forest'),
      ],
    });
    const names = state.players[0].hand.map((id) => state.objects[id].name);
    if (names.includes('Aura entry guide') && names.includes('Aura entry search')) break;
  }
  while (state.step !== 'main1') state = act(state, 'pass');
  for (const name of ['Aura entry guide', 'Aura entry search']) {
    state = act(state, 'cast', {
      card: state.players[0].hand.find((id) => state.objects[id].name === name),
    });
    state = act(state, 'pass');
    state = act(state, 'pass');
  }
  state = act(state, 'searchLibrary', {
    cards: [state.choice.cards.find((id) => state.objects[id].name === 'Frantic Strength')],
  });
  assert.equal(state.choice.kind, 'auraEntry');
  const h = await mount(exportReplay(state));
  try {
    h.click('[data-action="resume"]');
    assert.ok(h.dialog.classList.contains('choice-stage'));
    assert.equal(h.dialog.querySelector('[data-action="confirmDecision"]').disabled, true);
    h.click('#dialog [data-action="selectDecisionCard"]');
    h.click('#dialog [data-action="readDecisionCard"]');
    h.click('#dialog [data-action="returnDecision"]');
    assert.ok(h.dialog.querySelector('.is-selected'));
    h.click('#dialog [data-action="confirmDecision"]');
    const saved = JSON.parse(h.storage.get('leyline.match.v1'));
    assert.equal(saved.replay.commands.at(-1).type, 'chooseAuraAttachment');
    assert.equal(h.dialog.open, false);
  } finally {
    h.cleanup();
  }
});

test('grouped spell targets use large sequential choices and preserve selection through Read and Back', async () => {
  const catalog = {
    ...CARDS,
    'Group guide': { name: 'Group guide', type: 'creature', cost: {}, power: 2, toughness: 2 },
    'Group spell': { ...CARDS['Assert Perfection'], name: 'Group spell', cost: {} },
  };
  let state;
  for (let seed = 1; seed < 200; seed++) {
    state = createGame({
      seed,
      mulligan: false,
      catalog,
      decks: [
        [
          ...Array(4).fill('Group guide'),
          ...Array(4).fill('Group spell'),
          ...Array(52).fill('Forest'),
        ],
        Array(60).fill('Forest'),
      ],
    });
    const names = state.players[0].hand.map((id) => state.objects[id].name);
    if (names.includes('Group guide') && names.includes('Group spell')) break;
  }
  while (state.step !== 'main1') state = act(state, 'pass');
  state = act(state, 'cast', {
    card: state.players[0].hand.find((id) => state.objects[id].name === 'Group guide'),
  });
  state = act(state, 'pass');
  state = act(state, 'pass');
  const spell = state.players[0].hand.find((id) => state.objects[id].name === 'Group spell');
  const h = await mount(exportReplay(state));
  try {
    h.click('[data-action="resume"]');
    h.click(`[data-card="${spell}"]`);
    h.click('[data-action="playSelected"]');
    assert.ok(h.dialog.classList.contains('choice-stage'));
    assert.equal(h.dialog.querySelector('[data-action="nextTargetGroup"]').disabled, true);
    h.click('[data-action="selectGroupTarget"]');
    h.click('#dialog [data-action="readDecisionCard"]');
    h.click('#dialog [data-action="returnDecision"]');
    assert.ok(h.dialog.querySelector('.is-selected'));
    h.click('[data-action="nextTargetGroup"]');
    assert.match(h.dialog.textContent, /Step 2 of 2/);
    h.click('[data-action="previousTargetGroup"]');
    assert.ok(h.dialog.querySelector('.is-selected'));
    h.click('[data-action="nextTargetGroup"]');
    h.click('[data-action="nextTargetGroup"]');
    const saved = JSON.parse(h.storage.get('leyline.match.v1'));
    assert.equal(saved.replay.commands.at(-1).type, 'cast');
    assert.deepEqual(saved.replay.commands.at(-1).targets.victims, []);
    assert.equal(h.dialog.open, false);
  } finally {
    h.cleanup();
  }
});

test('optional trigger groups auto-open and preserve an empty choice through Read and Back', async () => {
  const catalog = {
    ...CARDS,
    'Optional stage guide': {
      name: 'Optional stage guide',
      type: 'creature',
      cost: {},
      power: 2,
      toughness: 2,
      triggers: [
        {
          event: 'selfEnters',
          targetGroups: [{ id: 'chosen', selector: 'creature', min: 0, max: 1 }],
          effects: [{ op: 'tap', targetGroup: 'chosen' }],
        },
      ],
    },
  };
  let state;
  for (let seed = 1; seed < 100; seed++) {
    state = createGame({
      seed,
      mulligan: false,
      catalog,
      decks: [
        [...Array(4).fill('Optional stage guide'), ...Array(56).fill('Forest')],
        Array(60).fill('Forest'),
      ],
    });
    if (state.players[0].hand.some((id) => state.objects[id].name === 'Optional stage guide'))
      break;
  }
  while (state.step !== 'main1') state = act(state, 'pass');
  state = act(state, 'cast', {
    card: state.players[0].hand.find((id) => state.objects[id].name === 'Optional stage guide'),
  });
  state = act(state, 'pass');
  state = act(state, 'pass');
  assert.equal(state.choice.kind, 'triggerTargets');
  const h = await mount(exportReplay(state));
  try {
    h.click('[data-action="resume"]');
    assert.equal(h.dialog.open, true);
    assert.equal(h.dialog.querySelector('[data-action="nextTargetGroup"]').disabled, false);
    h.click('[data-action="selectGroupTarget"]');
    h.click('#dialog [data-action="readDecisionCard"]');
    h.click('#dialog [data-action="returnDecision"]');
    assert.ok(h.dialog.querySelector('.is-selected'));
    h.click('[data-action="selectGroupTarget"]');
    h.click('#dialog [data-action="closeDialog"]');
    h.click('[data-action="reviewDecision"]');
    h.click('[data-action="nextTargetGroup"]');
    const saved = JSON.parse(h.storage.get('leyline.match.v1'));
    assert.equal(saved.replay.commands.at(-1).type, 'chooseTriggerTargets');
    assert.deepEqual(saved.replay.commands.at(-1).targets.chosen, []);
    assert.equal(h.dialog.open, false);
  } finally {
    h.cleanup();
  }
});

test('landcycling hand action cancels safely; search survives Read, Back, dismissal, and resume', async () => {
  const catalog = { ...CARDS, 'Bedhead Beastie': { ...CARDS['Bedhead Beastie'], cycling: {} } };
  let state;
  for (let seed = 1; seed < 100; seed++) {
    state = createGame({
      seed,
      mulligan: false,
      catalog,
      decks: [
        [...Array(4).fill('Bedhead Beastie'), ...Array(56).fill('Mountain')],
        Array(60).fill('Forest'),
      ],
    });
    if (state.players[0].hand.some((id) => state.objects[id].name === 'Bedhead Beastie')) break;
  }
  while (state.step !== 'main1') state = act(state, 'pass');
  const id = state.players[0].hand.find((id) => state.objects[id].name === 'Bedhead Beastie');
  let h = await mount(exportReplay(state));
  try {
    h.click('[data-action="resume"]');
    h.click(`[data-card="${id}"]`);
    assert.match(
      h.document.querySelector('[data-action="cycleSelected"]').textContent,
      /Mountaincycling/,
    );
    h.click('[data-action="cancelSelection"]');
    assert.equal(h.document.querySelector('[data-action="cycleSelected"]'), null);
    h.click(`[data-card="${id}"]`);
    h.click('[data-action="cycleSelected"]');
    assert.equal(h.document.querySelector('[data-action="cycleSelected"]'), null);
    const saved = JSON.parse(h.storage.get('leyline.match.v1'));
    assert.equal(saved.replay.commands.at(-1).type, 'cycle');
  } finally {
    h.cleanup();
  }
  state = act(state, 'cycle', { card: id });
  state = act(state, 'pass');
  state = act(state, 'pass');
  assert.equal(state.choice.kind, 'librarySearch');
  h = await mount(exportReplay(state));
  try {
    h.click('[data-action="resume"]');
    h.click('#dialog [data-action="searchAdd"]:not(:disabled)');
    h.click('#dialog [data-action="readDecisionCard"]');
    h.click('#dialog [data-action="returnDecision"]');
    assert.ok(h.dialog.querySelector('[data-action="searchRemove"]'));
    h.dialog.close();
    h.click('[data-action="reviewDecision"]');
    assert.ok(h.dialog.querySelector('[data-action="searchRemove"]'));
    h.click('#dialog [data-action="confirmSearch"]');
    assert.equal(h.dialog.open, false);
    const saved = JSON.parse(h.storage.get('leyline.match.v1'));
    assert.equal(saved.replay.commands.at(-1).type, 'searchLibrary');
    assert.equal(saved.replay.commands.at(-1).cards.length, 1);
  } finally {
    h.cleanup();
  }
});
