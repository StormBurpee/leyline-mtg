import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { createMatchStorage } from '../apps/web/match-storage.js';
import {
  createGame,
  CARDS,
  dispatch,
  exportReplay,
  chooseBotCommand,
} from '../packages/engine/src/index.js';

// DOM lifecycle regression tests, not a substitute for browser/layout screenshots.
async function mount(saved = null, savedStorage = null) {
  const { window, document } = parseHTML(
    await readFile(new URL('../apps/web/index.html', import.meta.url), 'utf8'),
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
    writes,
    readSaved: () => createMatchStorage(() => globals.localStorage).read(),
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

test('crew selection supports multiple toggles, inspection/back, cancel/reopen and one activation', async () => {
  const { crewPosition } = await import('./helpers/crew-position.js');
  const s = crewPosition();
  const vehicle = Object.values(s.objects).find(
    (o) => o.name === 'Air Response Unit' && o.zone === 'battlefield',
  );
  const pilot = Object.values(s.objects).find(
    (o) => o.name === 'Savannah Lions' && o.zone === 'battlefield',
  );
  const page = await mount(exportReplay(s));
  try {
    page.click('[data-action="resume"]');
    page.click(`[data-card="${vehicle.id}"]`);
    page.click('[data-action="startCrew"]');
    assert.equal(page.dialog.querySelector('[data-action="confirmCrew"]').disabled, true);
    page.click(`[data-action="toggleCrew"][data-cardid="${pilot.id}"]`);
    assert.equal(page.dialog.querySelector('[data-action="confirmCrew"]').disabled, false);
    page.click(`[data-action="readDecisionCard"][data-cardid="${pilot.id}"]`);
    page.click('[data-action="returnDecision"]');
    assert.equal(
      page.dialog
        .querySelector(`[data-action="toggleCrew"][data-cardid="${pilot.id}"]`)
        .getAttribute('aria-pressed'),
      'true',
    );
    page.click(`[data-action="toggleCrew"][data-cardid="${pilot.id}"]`);
    assert.equal(page.dialog.querySelector('[data-action="confirmCrew"]').disabled, true);
    page.click('[data-action="closeDialog"]');
    assert.equal(page.dialog.open, false);
    page.click(`[data-card="${vehicle.id}"]`);
    page.click('[data-action="startCrew"]');
    assert.equal(page.dialog.querySelector('[data-action="confirmCrew"]').disabled, true);
    page.click(`[data-action="toggleCrew"][data-cardid="${pilot.id}"]`);
    page.click('[data-action="confirmCrew"]');
    const saved = JSON.parse(page.storage.get('leyline.match.v1'));
    assert.equal(saved.replay.commands.filter((c) => c.type === 'crew').length, 1);
    assert.deepEqual(saved.replay.commands.find((c) => c.type === 'crew').cards, [pilot.id]);
    assert.equal(page.dialog.open, false);
  } finally {
    page.cleanup();
  }
});

test('X chooser cancels, reopens, announces once, and rejects a repeated stale click', async () => {
  const catalog = { ...CARDS, 'Mind Spring': { ...CARDS['Mind Spring'], cost: { X: 1 } } };
  let s;
  for (let seed = 1; seed < 100; seed++) {
    s = createGame({
      seed,
      mulligan: false,
      catalog,
      decks: [
        [...Array(4).fill('Mind Spring'), ...Array(56).fill('Island')],
        Array(60).fill('Forest'),
      ],
    });
    if (s.players[0].hand.some((id) => s.objects[id].name === 'Mind Spring')) break;
  }
  while (s.step !== 'main1') s = act(s, 'pass');
  const id = s.players[0].hand.find((id) => s.objects[id].name === 'Mind Spring');
  s = act(s, 'playLand', { card: s.players[0].hand.find((id) => s.objects[id].name === 'Island') });
  const h = await mount(exportReplay(s));
  try {
    h.click('[data-action="resume"]');
    h.click(`[data-card="${id}"]`);
    h.click('[data-action="playSelected"]');
    assert.match(h.dialog.textContent, /Choose X/);
    h.click('#dialog [data-action="closeDialog"]');
    assert.equal(
      JSON.parse(h.storage.get('leyline.match.v1')).replay.commands.filter((c) => c.type === 'cast')
        .length,
      0,
    );
    h.click('[data-action="playSelected"]');
    const stale = h.click('#dialog [data-action="chooseX"][data-x="1"]');
    assert.equal(h.dialog.open, false);
    let saved = JSON.parse(h.storage.get('leyline.match.v1'));
    assert.equal(saved.replay.commands.filter((c) => c.type === 'cast').length, 1);
    assert.equal(saved.replay.commands.find((c) => c.type === 'cast').x, 1);
    stale.dispatchEvent(new window.Event('click', { bubbles: true }));
    saved = JSON.parse(h.storage.get('leyline.match.v1'));
    assert.equal(saved.replay.commands.filter((c) => c.type === 'cast').length, 1);
  } finally {
    h.cleanup();
  }
});

test('numeric X input accepts a payable non-proposed value and rejects out-of-budget input', async () => {
  const catalog = {
    ...CARDS,
    'Mind Spring': {
      ...CARDS['Mind Spring'],
      cost: { X: 1 },
      costModifiers: [{ scope: 'self', change: 'reduce', amount: 40 }],
    },
  };
  let s;
  for (let seed = 1; seed < 100; seed++) {
    s = createGame({
      seed,
      mulligan: false,
      catalog,
      decks: [
        [...Array(4).fill('Mind Spring'), ...Array(56).fill('Island')],
        Array(60).fill('Forest'),
      ],
    });
    if (s.players[0].hand.some((id) => s.objects[id].name === 'Mind Spring')) break;
  }
  while (s.step !== 'main1') s = act(s, 'pass');
  const id = s.players[0].hand.find((id) => s.objects[id].name === 'Mind Spring');
  const h = await mount(exportReplay(s));
  try {
    h.click('[data-action="resume"]');
    h.click(`[data-card="${id}"]`);
    h.click('[data-action="playSelected"]');
    assert.equal(h.dialog.querySelector('[data-x="37"]'), null);
    h.dialog.querySelector('#cast-x-value').value = '1001';
    h.click('#dialog [data-action="chooseX"]:not([data-x])');
    assert.equal(h.dialog.open, true);
    h.dialog.querySelector('#cast-x-value').value = '37';
    h.click('#dialog [data-action="chooseX"]:not([data-x])');
    assert.equal(h.dialog.open, false);
    const saved = JSON.parse(h.storage.get('leyline.match.v1'));
    assert.equal(saved.replay.commands.find((c) => c.type === 'cast').x, 37);
  } finally {
    h.cleanup();
  }
});

test('sacrifice uses large eligible permanent cards and survives Read, Back, dismissal and replay', async () => {
  const catalog = {
    ...CARDS,
    'Sacrifice UI creature': {
      name: 'Sacrifice UI creature',
      type: 'creature',
      cost: {},
      power: 2,
      toughness: 2,
    },
    'Sacrifice UI edict': {
      name: 'Sacrifice UI edict',
      type: 'sorcery',
      cost: {},
      effects: [{ op: 'sacrifice', player: 'controller', count: 1, where: { type: 'creature' } }],
    },
  };
  let s;
  for (let seed = 1; seed < 200; seed++) {
    s = createGame({
      catalog,
      seed,
      mulligan: false,
      decks: [
        [
          ...Array(52).fill('Forest'),
          ...Array(4).fill('Sacrifice UI creature'),
          ...Array(4).fill('Sacrifice UI edict'),
        ],
        Array(60).fill('Forest'),
      ],
    });
    if (
      ['Sacrifice UI creature', 'Sacrifice UI edict'].every((name) =>
        s.players[0].hand.some((id) => s.objects[id].name === name),
      )
    )
      break;
  }
  while (s.step !== 'main1') s = act(s, 'pass');
  const card = s.players[0].hand.find((id) => s.objects[id].name === 'Sacrifice UI creature');
  s = act(s, 'cast', { card });
  s = act(s, 'pass');
  s = act(s, 'pass');
  s = act(s, 'cast', {
    card: s.players[0].hand.find((id) => s.objects[id].name === 'Sacrifice UI edict'),
  });
  s = act(s, 'pass');
  s = act(s, 'pass');
  assert.equal(s.choice.kind, 'sacrifice');
  const ui = await mount(exportReplay(s));
  try {
    ui.click('[data-action="resume"]');
    assert.match(ui.dialog.textContent, /Sacrifice 1 permanent/);
    assert.equal(ui.dialog.querySelectorAll('[data-action="selectDecisionCard"]').length, 1);
    ui.click('[data-action="selectDecisionCard"]');
    ui.click('[data-action="readDecisionCard"]');
    ui.click('[data-action="returnDecision"]');
    assert.match(ui.dialog.textContent, /1 of 1 selected/);
    ui.dialog.close();
    ui.click('[data-action="reviewDecision"]');
    assert.ok(ui.dialog.open);
    ui.click('[data-action="confirmDecision"]');
    assert.ok(!ui.dialog.open);
    const record = JSON.parse(ui.storage.get('leyline.match.v1')).replay;
    assert.equal(record.commands.at(-1).type, 'sacrifice');
  } finally {
    ui.cleanup();
  }
});

test('convoke payment reviews every creature and symbol; cancel, reopen and confirm cast only once', async () => {
  const { convokePosition } = await import('./helpers/convoke-position.js');
  const s = convokePosition();
  const card = s.players[0].hand
    .map((id) => s.objects[id])
    .find((o) => o.name === 'Sun-Dappled Celebrant');
  const h = await mount(exportReplay(s));
  try {
    h.click('[data-action="resume"]');
    h.click(`[data-card="${card.id}"]`);
    h.click('[data-action="playSelected"]');
    assert.match(h.dialog.textContent, /Choose creatures to convoke/);
    assert.match(h.dialog.textContent, /Remaining mana:/);
    assert.ok(h.document.querySelectorAll('[data-action="selectConvoke"]').length >= 2);
    h.click('[data-action="closeDialog"]');
    assert.equal(h.dialog.open, false);
    h.click('[data-action="playSelected"]');
    const option = h.document.querySelector('[data-action="selectConvoke"][data-symbol="generic"]');
    if (option)
      h.click(
        `[data-action="selectConvoke"][data-cardid="${option.dataset.cardid}"][data-symbol="generic"]`,
      );
    const reader = h.dialog.querySelector('[data-action="readDecisionCard"]');
    h.click(`[data-action="readDecisionCard"][data-cardid="${reader.dataset.cardid}"]`);
    h.click('[data-action="returnDecision"]');
    assert.match(h.dialog.textContent, /Remaining mana:/);
    const stale = h.click('[data-action="confirmConvoke"]');
    stale.dispatchEvent(new window.Event('click', { bubbles: true }));
    const saved = JSON.parse(h.storage.get('leyline.match.v1'));
    const casts = saved.replay.commands.filter((c) => c.type === 'cast' && c.card === card.id);
    assert.equal(casts.length, 1);
    assert.ok(Array.isArray(casts[0].convoke));
  } finally {
    h.cleanup();
  }
});

test('additional casting sacrifice reviews choices, retains selection through Read/Back, cancels safely and submits once', async () => {
  const { castingSacrificePosition } = await import('./helpers/casting-sacrifice-position.js');
  const s = castingSacrificePosition();
  const card = s.players[0].hand
    .map((id) => s.objects[id])
    .find((o) => o.name === 'Corrupted Conviction');
  const h = await mount(exportReplay(s));
  try {
    h.click('[data-action="resume"]');
    h.click(`[data-card="${card.id}"]`);
    h.click('[data-action="playSelected"]');
    assert.match(h.dialog.textContent, /Choose additional sacrifice/);
    assert.ok(h.dialog.querySelector('[data-action="confirmCastingSacrifice"]').disabled);
    h.click('[data-action="closeDialog"]');
    assert.equal(h.dialog.open, false);
    h.click('[data-action="playSelected"]');
    const select = h.dialog.querySelector('[data-action="selectCastingSacrifice"]');
    h.click(`[data-action="selectCastingSacrifice"][data-cardid="${select.dataset.cardid}"]`);
    assert.match(h.dialog.textContent, /Payment is available/);
    h.click(`[data-action="readDecisionCard"][data-cardid="${select.dataset.cardid}"]`);
    h.click('[data-action="returnDecision"]');
    assert.equal(
      h.dialog
        .querySelector(
          `[data-action="selectCastingSacrifice"][data-cardid="${select.dataset.cardid}"]`,
        )
        .getAttribute('aria-pressed'),
      'true',
    );
    const stale = h.click('[data-action="confirmCastingSacrifice"]');
    stale.dispatchEvent(new window.Event('click', { bubbles: true }));
    const saved = JSON.parse(h.storage.get('leyline.match.v1'));
    const casts = saved.replay.commands.filter((c) => c.type === 'cast' && c.card === card.id);
    assert.equal(casts.length, 1);
    assert.equal(casts[0].sacrifice.id, select.dataset.cardid);
  } finally {
    h.cleanup();
  }
});

test('Adventure casting previews both faces, survives cancel/reopen, and submits the chosen spell mode', async () => {
  const name = 'Bilbo Baggins, Burglar // Take a Glance';
  let s, id;
  for (let seed = 1; seed < 40; seed++) {
    s = createGame({
      decks: [[...Array(4).fill(name), ...Array(56).fill('Island')], Array(60).fill('Forest')],
      mulligan: false,
      seed,
    });
    id = s.players[0].hand.find((id) => s.objects[id].name === name);
    if (id) break;
  }
  const advance = (command) => {
    const r = dispatch(s, command);
    assert.equal(r.ok, true, r.error?.message);
    s = r.state;
  };
  while (s.step !== 'main1') advance({ type: 'pass', player: s.priority });
  advance({
    type: 'playLand',
    player: 0,
    card: s.players[0].hand.find((id) => s.objects[id].name === 'Island'),
  });
  const h = await mount(exportReplay(s));
  try {
    h.click('[data-action="resume"]');
    h.click(`[data-card="${id}"]`);
    h.click('[data-action="playSelected"]');
    assert.match(h.dialog.textContent, /Adventure: Take a Glance/);
    assert.match(h.dialog.textContent, /Scry 2/);
    assert.match(h.dialog.textContent, /When Bilbo Baggins enters, draw a card/);
    h.click('[data-action="closeDialog"]');
    h.click('[data-action="playSelected"]');
    h.click('[data-action="chooseSpellMode"][data-mode="1"]');
    const record = JSON.parse(h.storage.get('leyline.match.v1')).replay;
    const cast = record.commands.findLast((c) => c.type === 'cast');
    assert.equal(cast.card, id);
    assert.equal(cast.mode, 1);
    assert.equal(record.commands.filter((c) => c.type === 'cast').length, 1);
  } finally {
    h.cleanup();
  }
});

test('shockland entry offers readable life/tapped choices and survives card inspection', async () => {
  let s;
  for (let seed = 1; seed < 100; seed++) {
    s = createGame({
      seed,
      mulligan: false,
      decks: [
        [...Array(56).fill('Mountain'), ...Array(4).fill('Blood Crypt')],
        Array(60).fill('Forest'),
      ],
    });
    if (s.players[0].hand.some((id) => s.objects[id].name === 'Blood Crypt')) break;
  }
  while (s.step !== 'main1') s = act(s, 'pass');
  s = act(s, 'playLand', {
    card: s.players[0].hand.find((id) => s.objects[id].name === 'Blood Crypt'),
  });
  const h = await mount(exportReplay(s));
  try {
    h.click('[data-action="resume"]');
    assert.equal(h.dialog.open, true);
    assert.ok(h.dialog.classList.contains('choice-stage'));
    assert.match(h.dialog.textContent, /Pay 2 life/);
    h.click('#dialog [data-action="readDecisionCard"]');
    h.click('#dialog [data-action="returnDecision"]');
    h.click('#dialog [data-action="payEntryLife"]');
    const saved = JSON.parse(h.storage.get('leyline.match.v1'));
    assert.ok(saved.replay.commands.some((c) => c.type === 'payEntryLife' && c.pay === true));
    assert.equal(h.dialog.open, false);
  } finally {
    h.cleanup();
  }
});

test('Cryomancer graveyard ability is reachable from large-card reader, pays exile once, and remains replayable', async () => {
  const name = 'Seasoned Cryomancer';
  const catalog = {
    ...CARDS,
    [name]: {
      ...CARDS[name],
      cost: {},
      activated: [{ ...CARDS[name].activated[0], cost: { exileSelf: true } }],
    },
  };
  let state, copies;
  for (let seed = 1; seed < 200; seed++) {
    state = createGame({
      catalog,
      seed,
      mulligan: false,
      decks: [[...Array(4).fill(name), ...Array(56).fill('Island')], Array(60).fill('Forest')],
    });
    copies = state.players[0].hand.filter((id) => state.objects[id].name === name);
    if (copies.length >= 2) break;
  }
  assert.ok(copies.length >= 2);
  while (state.step !== 'main1') state = act(state, 'pass');
  state = act(state, 'cast', { card: copies[0] });
  for (let i = 0; i < 4; i++) state = act(state, 'pass');
  state = act(state, 'discardEffect', {
    cards: [copies[1], state.players[0].hand.find((id) => state.objects[id].name === 'Island')],
  });
  state = act(state, 'chooseTriggerTargets', { targets: { chosen: [] } });
  state = act(state, 'pass');
  state = act(state, 'pass');
  const h = await mount(exportReplay(state));
  try {
    h.click('[data-action="resume"]');
    h.click('[data-action="zone"][data-player="0"][data-zone="graveyard"]');
    h.click(`#dialog [data-action="readDecisionCard"][data-cardid="${copies[1]}"]`);
    assert.ok(h.dialog.querySelector('.decision-reader'));
    h.click('[data-action="inspectGraveyardAbilities"]');
    assert.match(h.dialog.textContent, /Exile this card from your graveyard/);
    h.click('[data-action="activateAbility"]');
    const saved = JSON.parse(h.storage.get('leyline.match.v1'));
    assert.equal(saved.replay.commands.at(-1).type, 'activate');
    assert.equal(saved.replay.commands.at(-1).card, copies[1]);
    assert.equal(saved.replay.commands.filter((c) => c.type === 'activate').length, 1);
    assert.equal(h.dialog.open, false);
  } finally {
    h.cleanup();
  }
});

test('multi-card hand selection stage enforces two choices, survives reader, and labels random bottom', async () => {
  for (const name of ['Stock Up', 'Consult the Star Charts']) {
    // Zero-cost fixture isolates the real cards' five-card/two-card choice UI.
    const effect = {
      op: 'lookChooseHand',
      count: 5,
      selectCount: 2,
      ...(name === 'Consult the Star Charts' ? { restOrder: 'random' } : {}),
    };
    const catalog = { ...CARDS, [name]: { ...CARDS[name], cost: {}, effects: [effect] } };
    let s;
    for (let seed = 1; seed < 100; seed++) {
      s = createGame({
        catalog,
        seed,
        mulligan: false,
        decks: [[...Array(4).fill(name), ...Array(56).fill('Island')], Array(60).fill('Forest')],
      });
      if (s.players[0].hand.some((id) => s.objects[id].name === name)) break;
    }
    while (s.step !== 'main1') s = act(s, 'pass');
    s = act(s, 'cast', { card: s.players[0].hand.find((id) => s.objects[id].name === name) });
    s = act(act(s, 'pass'), 'pass');
    const h = await mount(exportReplay(s));
    try {
      h.click('[data-action="resume"]');
      assert.match(h.dialog.textContent, /Choose 2 cards for your hand/);
      assert.equal(h.dialog.querySelectorAll('.decision-card-face').length, 5);
      assert.equal(h.dialog.querySelector('[data-action="submitLibrary"]').disabled, true);
      h.click('[data-order-drop="rest"] [data-action="libraryMove"]');
      assert.equal(h.dialog.querySelector('[data-action="submitLibrary"]').disabled, true);
      h.click('[data-order-drop="rest"] [data-action="libraryMove"]');
      assert.equal(h.dialog.querySelector('[data-action="submitLibrary"]').disabled, false);
      h.click('#dialog [data-action="readDecisionCard"]');
      h.click('#dialog [data-action="returnDecision"]');
      assert.equal(h.dialog.querySelector('[data-action="submitLibrary"]').disabled, false);
      if (name === 'Consult the Star Charts') {
        assert.match(h.dialog.textContent, /in a random order/);
        assert.ok(
          [
            ...h.dialog.querySelectorAll('[data-order-drop="rest"] [data-action="libraryReorder"]'),
          ].every((b) => b.disabled),
        );
      }
      h.click('[data-action="submitLibrary"]');
      const saved = JSON.parse(h.storage.get('leyline.match.v1'));
      const command = saved.replay.commands.at(-1);
      assert.equal(command.type, 'orderLibrary');
      assert.equal(command.top.length, 2);
      assert.equal(command.rest.length, 3);
    } finally {
      h.cleanup();
    }
  }
});

test('counter-unless payment displays both spells, never labels it ward, and remains actionable', async () => {
  const catalog = {
    ...CARDS,
    'Free Bolt': { ...CARDS['Lightning Bolt'], name: 'Free Bolt', cost: {} },
    'Free Counter': { ...CARDS['No More Lies'], name: 'Free Counter', cost: {} },
  };
  let state = createGame({
    mulligan: false,
    catalog,
    minimumDeckSize: 8,
    decks: [
      [...Array(4).fill('Free Bolt'), ...Array(4).fill('Mountain')],
      [...Array(4).fill('Free Counter'), ...Array(4).fill('Island')],
    ],
  });
  const act = (command) => {
    const r = dispatch(state, { player: state.choice?.player ?? state.priority, ...command });
    assert.equal(r.ok, true, r.error?.message);
    state = r.state;
  };
  while (state.step !== 'main1') act({ type: 'pass' });
  const bolt = state.players[0].hand.find((id) => state.objects[id].name === 'Free Bolt');
  act({ type: 'cast', card: bolt, target: { kind: 'player', id: 1 } });
  act({ type: 'pass' });
  const counter = state.players[1].hand.find((id) => state.objects[id].name === 'Free Counter');
  act({ type: 'cast', card: counter, target: { kind: 'stack', id: state.stack[0].id } });
  act({ type: 'pass' });
  act({ type: 'pass' });
  const h = await mount(exportReplay(state));
  try {
    h.click('[data-action="resume"]');
    assert.equal(h.dialog.open, true);
    assert.match(h.dialog.textContent, /Pay to protect your spell/);
    assert.doesNotMatch(h.dialog.textContent, /Pay (for )?ward/);
    assert.equal(h.dialog.querySelectorAll('.decision-card-face').length, 2);
    h.click('#dialog [data-action="readDecisionCard"]');
    h.click('#dialog [data-action="returnDecision"]');
    h.click('#dialog [data-action="declineWard"]');
    const saved = JSON.parse(h.storage.get('leyline.match.v1'));
    assert.equal(saved.replay.commands.at(-1).type, 'payCost');
    assert.equal(saved.replay.commands.at(-1).pay, false);
  } finally {
    h.cleanup();
  }
});

test('explore reveals a large card with graveyard/top destinations and survives review without a hidden tiny prompt', async () => {
  let saved;
  for (let seed = 1; seed < 80 && !saved; seed++) {
    let s = createGame({
      seed,
      mulligan: false,
      decks: [
        [
          ...Array(52).fill('Forest'),
          ...Array(4).fill('Cenote Scout'),
          ...Array(4).fill('Pathfinding Axejaw'),
        ],
        Array(60).fill('Forest'),
      ],
    });
    for (let i = 0; i < 250 && s.status !== 'finished'; i++) {
      if (s.choice?.action === 'explore') {
        saved = exportReplay(s);
        break;
      }
      const c = chooseBotCommand(s, s.choice?.player ?? s.priority);
      if (!c) break;
      s = act(s, c.type, c);
    }
  }
  assert.ok(saved, 'Reached real explore decision');
  const h = await mount(saved);
  try {
    h.click('[data-action="resume"]');
    assert.equal(h.dialog.open, true);
    assert.match(h.dialog.textContent, /Explore/);
    assert.match(h.dialog.textContent, /Graveyard/);
    assert.doesNotMatch(h.dialog.textContent, /Bottom of library/);
    assert.equal(h.dialog.querySelectorAll('.decision-card-face').length, 1);
    h.click('#dialog [data-action="closeDialog"]');
    h.click('[data-action="reviewDecision"]');
    h.click('#dialog [data-action="libraryMove"][data-group="rest"]');
    h.click('#dialog [data-action="submitLibrary"]');
    assert.equal(h.dialog.open, false);
  } finally {
    h.cleanup();
  }
});

test('Multiversal Passage presents land type then life payment, with reader and reopen lifecycle', async () => {
  let s;
  for (let seed = 1; seed < 80; seed++) {
    s = createGame({
      seed,
      mulligan: false,
      decks: [
        [...Array(4).fill('Multiversal Passage'), ...Array(56).fill('Forest')],
        Array(60).fill('Island'),
      ],
    });
    if (s.players[0].hand.some((id) => s.objects[id].name === 'Multiversal Passage')) break;
  }
  while (s.step !== 'main1') s = act(s, 'pass');
  s = act(s, 'playLand', {
    card: s.players[0].hand.find((id) => s.objects[id].name === 'Multiversal Passage'),
  });
  const h = await mount(exportReplay(s));
  try {
    h.click('[data-action="resume"]');
    assert.match(h.dialog.textContent, /Choose a basic land type/);
    assert.equal(h.dialog.querySelectorAll('[data-action="chooseLandType"]').length, 5);
    h.click('#dialog [data-action="readDecisionCard"]');
    h.click('#dialog [data-action="returnDecision"]');
    h.click('#dialog [data-action="chooseLandType"][data-landtype="Forest"]');
    assert.match(h.dialog.textContent, /Pay 2 life/);
    h.click('#dialog [data-action="closeDialog"]');
    h.click('[data-action="reviewDecision"]');
    h.click('#dialog [data-action="declineEntryLife"]');
    assert.equal(h.dialog.open, false);
  } finally {
    h.cleanup();
  }
});

test('Otter Adventure flows mode to X to large-card distribution, preserves draft, and casts once', async () => {
  const name = "Elusive Otter // Grove's Bounty";
  const catalog = {
    ...CARDS,
    [name]: {
      ...CARDS[name],
      adventure: {
        ...CARDS[name].adventure,
        cost: { X: 1 },
        costModifiers: [{ scope: 'self', change: 'reduce', amount: 5 }],
      },
    },
    'Grizzly Bears': { ...CARDS['Grizzly Bears'], cost: {} },
  };
  let s;
  for (let seed = 1; seed < 200; seed++) {
    s = createGame({
      seed,
      mulligan: false,
      catalog,
      decks: [
        [...Array(4).fill(name), ...Array(4).fill('Grizzly Bears'), ...Array(52).fill('Forest')],
        Array(60).fill('Island'),
      ],
    });
    if (
      [name, 'Grizzly Bears'].every((n) => s.players[0].hand.some((id) => s.objects[id].name === n))
    )
      break;
  }
  while (s.step !== 'main1') s = act(s, 'pass');
  const bear = s.players[0].hand.find((id) => s.objects[id].name === 'Grizzly Bears'),
    id = s.players[0].hand.find((id) => s.objects[id].name === name);
  s = act(s, 'cast', { card: bear });
  s = act(s, 'pass');
  s = act(s, 'pass');
  const h = await mount(exportReplay(s));
  try {
    h.click('[data-action="resume"]');
    h.click(`[data-card="${id}"]`);
    h.click('[data-action="playSelected"]');
    h.click('#dialog [data-action="chooseSpellMode"][data-mode="1"]');
    assert.match(h.dialog.textContent, /Choose X/);
    h.click('#dialog [data-action="chooseX"][data-x="2"]');
    assert.match(h.dialog.textContent, /Distribute/);
    assert.equal(h.dialog.querySelector('[data-action="confirmDistribution"]').disabled, true);
    h.click('#dialog [data-action="changeDistribution"][data-delta="1"]');
    h.click('#dialog [data-action="readDecisionCard"]');
    h.click('#dialog [data-action="returnDecision"]');
    assert.match(h.dialog.textContent, /1 of 2 counters/);
    h.click('#dialog [data-action="changeDistribution"][data-delta="1"]');
    const stale = h.click('#dialog [data-action="confirmDistribution"]');
    const saved = JSON.parse(h.storage.get('leyline.match.v1')).replay.commands.filter(
      (c) => c.type === 'cast' && c.card === id,
    );
    assert.equal(saved.length, 1);
    assert.equal(saved[0].mode, 1);
    assert.equal(saved[0].x, 2);
    assert.equal(saved[0].distribution[bear], 2);
    stale.dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(
      JSON.parse(h.storage.get('leyline.match.v1')).replay.commands.filter(
        (c) => c.type === 'cast' && c.card === id,
      ).length,
      1,
    );
  } finally {
    h.cleanup();
  }
});

test('Petrified Hamlet land-name stage is searchable, preserves Read/Back selection and submits guarded replay', async () => {
  let state = createGame({
    mulligan: false,
    minimumDeckSize: 8,
    decks: [
      [
        'Petrified Hamlet',
        'Petrified Hamlet',
        'Petrified Hamlet',
        'Petrified Hamlet',
        'Island',
        'Island',
        'Island',
        'Island',
      ],
      Array(8).fill('Island'),
    ],
  });
  const act = (command) => {
    const r = dispatch(state, { player: state.choice?.player ?? state.priority, ...command });
    assert.equal(r.ok, true, r.error?.message);
    state = r.state;
  };
  while (state.step !== 'main1') act({ type: 'pass' });
  const card = state.players[0].hand.find((id) => state.objects[id].name === 'Petrified Hamlet');
  act({ type: 'playLand', card });
  act({ type: 'pass' });
  act({ type: 'pass' });
  assert.equal(state.choice.kind, 'landName');
  const h = await mount(exportReplay(state));
  try {
    h.click('[data-action="resume"]');
    assert.equal(h.dialog.open, true);
    assert.ok(h.dialog.querySelector('.decision-card-face'));
    const input = h.document.querySelector('#chosen-land-name');
    input.value = "Agna Qel'a";
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    h.click('#dialog [data-action="readDecisionCard"]');
    h.click('#dialog [data-action="returnDecision"]');
    assert.equal(h.document.querySelector('#chosen-land-name').value, "Agna Qel'a");
    h.click('[data-action="chooseLandName"]');
    const saved = JSON.parse(h.storage.get('leyline.match.v1'));
    assert.equal(saved.replay.commands.at(-1).name, "Agna Qel'a");
    assert.equal(saved.replay.commands.at(-1).type, 'chooseLandName');
  } finally {
    h.cleanup();
  }
});

test('ninjutsu hand action presents large return-cost cards, inspect/back, cancel and exactly one activation', async () => {
  const { kaitoPosition } = await import('./helpers/kaito-position.js');
  const { legalActions } = await import('../packages/engine/src/index.js');
  const s = kaitoPosition();
  const command = legalActions(s, 0).find((a) => a.type === 'ninjutsu');
  const page = await mount(exportReplay(s));
  try {
    page.click('[data-action="resume"]');
    page.click(`[data-card="${command.card}"]`);
    page.click('[data-action="ninjutsuSelected"]');
    assert.match(page.dialog.textContent, /return an unblocked attacker/i);
    assert.ok(page.dialog.querySelector('.decision-card-gallery'));
    page.click(`[data-action="readDecisionCard"][data-cardid="${command.attacker.id}"]`);
    page.click('[data-action="returnDecision"]');
    assert.ok(page.dialog.querySelector('[data-action="payNinjutsu"]'));
    page.click('[data-action="closeDialog"]');
    page.click('[data-action="ninjutsuSelected"]');
    page.click('[data-action="payNinjutsu"]');
    const saved = JSON.parse(page.storage.get('leyline.match.v1'));
    const paid = saved.replay.commands.filter((c) => c.type === 'ninjutsu');
    assert.equal(paid.length, 1);
    assert.deepEqual(paid[0].attacker, command.attacker);
    assert.equal(page.dialog.open, false);
  } finally {
    page.cleanup();
  }
});

test('harmonize uses large payment cards, preserves inspect/back choice, cancels safely and casts once', async () => {
  const catalog = {
    ...CARDS,
    'Wild Ride': { ...CARDS['Wild Ride'], cost: {}, harmonize: { generic: 2 } },
    'Grizzly Bears': { ...CARDS['Grizzly Bears'], cost: {} },
  };
  let s;
  for (let seed = 1; seed < 100; seed++) {
    s = createGame({
      seed,
      mulligan: false,
      catalog,
      decks: [
        [
          ...Array(4).fill('Wild Ride'),
          ...Array(4).fill('Grizzly Bears'),
          ...Array(52).fill('Forest'),
        ],
        Array(60).fill('Island'),
      ],
    });
    if (
      ['Wild Ride', 'Grizzly Bears'].every((n) =>
        s.players[0].hand.some((id) => s.objects[id].name === n),
      )
    )
      break;
  }
  while (s.step !== 'main1') s = act(s, 'pass');
  const bear = s.players[0].hand.find((id) => s.objects[id].name === 'Grizzly Bears');
  const spell = s.players[0].hand.find((id) => s.objects[id].name === 'Wild Ride');
  s = act(s, 'cast', { card: bear });
  s = act(s, 'pass');
  s = act(s, 'pass');
  const target = { kind: 'object', id: bear, incarnation: s.objects[bear].incarnation };
  s = act(s, 'cast', { card: spell, target });
  s = act(s, 'pass');
  s = act(s, 'pass');
  assert.equal(s.objects[spell].zone, 'graveyard');
  const h = await mount(exportReplay(s));
  try {
    h.click('[data-action="resume"]');
    assert.match(h.document.querySelector(`[data-card="${spell}"]`).textContent, /Harmonize/);
    h.click(`[data-card="${spell}"]`);
    h.click(`[data-card="${bear}"]`);
    assert.match(h.dialog.textContent, /Harmonize · choose payment/);
    assert.ok(h.dialog.querySelector('.decision-card-face'));
    h.click(`[data-action="selectHarmonize"][data-cardid="${bear}"]`);
    h.click('#dialog [data-action="readDecisionCard"]');
    h.click('#dialog [data-action="returnDecision"]');
    assert.ok(
      h.dialog
        .querySelector(`[data-action="selectHarmonize"][data-cardid="${bear}"]`)
        .classList.contains('primary'),
    );
    h.click('#dialog [data-action="closeDialog"]');
    assert.equal(
      JSON.parse(h.storage.get('leyline.match.v1')).replay.commands.filter(
        (c) => c.type === 'cast' && c.card === spell,
      ).length,
      1,
    );
    h.click(`[data-card="${bear}"]`);
    h.click(`[data-action="selectHarmonize"][data-cardid="${bear}"]`);
    const stale = h.click('[data-action="confirmHarmonize"]');
    stale.dispatchEvent(new window.Event('click', { bubbles: true }));
    const casts = JSON.parse(h.storage.get('leyline.match.v1')).replay.commands.filter(
      (c) => c.type === 'cast' && c.card === spell,
    );
    assert.equal(casts.length, 2);
    assert.deepEqual(casts[1].harmonize, target);
  } finally {
    h.cleanup();
  }
});

test('Bitter Triumph additional cost stage preserves a reviewed discard, supports life payment and records one explicit cost', async () => {
  const catalog = {
    ...CARDS,
    'Bitter Triumph': { ...CARDS['Bitter Triumph'], cost: {} },
    'Llanowar Elves': { ...CARDS['Llanowar Elves'], cost: {} },
  };
  let s;
  for (let seed = 1; seed < 200; seed++) {
    s = createGame({
      seed,
      mulligan: false,
      catalog,
      decks: [
        [
          ...Array(52).fill('Forest'),
          ...Array(4).fill('Bitter Triumph'),
          ...Array(4).fill('Llanowar Elves'),
        ],
        Array(60).fill('Forest'),
      ],
    });
    if (
      ['Bitter Triumph', 'Llanowar Elves'].every((name) =>
        s.players[0].hand.some((id) => s.objects[id].name === name),
      )
    )
      break;
  }
  while (s.step !== 'main1') s = act(s, 'pass');
  const target = s.players[0].hand.find((id) => s.objects[id].name === 'Llanowar Elves');
  s = act(s, 'cast', { card: target });
  s = act(s, 'pass');
  s = act(s, 'pass');
  const card = s.players[0].hand.find((id) => s.objects[id].name === 'Bitter Triumph');
  const h = await mount(exportReplay(s));
  try {
    h.click('[data-action="resume"]');
    h.click(`[data-card="${card}"]`);
    h.click(`[data-card="${target}"]`);
    assert.match(h.dialog.textContent, /Additional casting cost/);
    assert.ok(h.dialog.querySelector('[data-action="confirmAdditionalCost"]').disabled);
    h.click('[data-action="chooseAdditionalCostLife"]');
    assert.match(h.dialog.textContent, /Pay 3 life/);
    const option = h.dialog.querySelector('[data-action="selectAdditionalCostCard"]');
    h.click(`[data-action="selectAdditionalCostCard"][data-cardid="${option.dataset.cardid}"]`);
    h.click(`[data-action="readDecisionCard"][data-cardid="${option.dataset.cardid}"]`);
    h.click('[data-action="returnDecision"]');
    assert.equal(
      h.dialog
        .querySelector(
          `[data-action="selectAdditionalCostCard"][data-cardid="${option.dataset.cardid}"]`,
        )
        .getAttribute('aria-pressed'),
      'true',
    );
    const stale = h.click('[data-action="confirmAdditionalCost"]');
    stale.dispatchEvent(new window.Event('click', { bubbles: true }));
    const record = JSON.parse(h.storage.get('leyline.match.v1')).replay;
    const casts = record.commands.filter((c) => c.type === 'cast' && c.card === card);
    assert.equal(casts.length, 1);
    assert.equal(casts[0].additionalCost.discard.id, option.dataset.cardid);
    const { replay } = await import('../packages/engine/src/index.js');
    assert.doesNotThrow(() => replay(h.readSaved().replay));
  } finally {
    h.cleanup();
  }
});

function modalTriggerReplay() {
  const name = 'Modal trigger stage';
  const catalog = {
    ...CARDS,
    [name]: {
      name,
      type: 'creature',
      cost: {},
      power: 2,
      toughness: 2,
      triggers: [
        {
          event: 'selfEnters',
          modes: [
            { label: 'Gain 3 life', effects: [{ op: 'gainLife', amount: 3 }] },
            { label: 'Destroy an artifact', target: 'artifact', effects: [{ op: 'destroy' }] },
            {
              label: 'Tap up to one creature',
              targetGroups: [{ id: 'chosen', selector: 'creature', min: 0, max: 1 }],
              effects: [{ op: 'tap', targetGroup: 'chosen' }],
            },
          ],
        },
      ],
    },
  };
  const deck = [...Array(4).fill(name), ...Array(3).fill('Forest')];
  let state = createGame({ catalog, mulligan: false, minimumDeckSize: 7, decks: [deck, deck] });
  while (state.step !== 'main1') state = act(state, 'pass');
  state = act(state, 'cast', {
    card: state.players[0].hand.find((id) => state.objects[id].name === name),
  });
  state = act(state, 'pass');
  state = act(state, 'pass');
  return exportReplay(state);
}
test('triggered mode stage labels choices, disables illegal modes, dismisses/reopens, and rejects duplicate stale clicks', async () => {
  const h = await mount(modalTriggerReplay());
  try {
    h.click('[data-action="resume"]');
    assert.equal(h.dialog.open, true);
    assert.match(h.dialog.textContent, /Choose one triggered mode/);
    assert.match(h.dialog.textContent, /Neither player gets priority/);
    assert.equal(h.dialog.querySelector('[data-mode="1"]').disabled, true);
    assert.match(h.dialog.querySelector('[data-mode="1"]').textContent, /No legal targets/);
    h.click('#dialog [data-action="closeDialog"]');
    assert.equal(h.dialog.open, false);
    h.click('[data-action="reviewDecision"]');
    assert.equal(h.dialog.open, true);
    const stale = h.click('#dialog [data-action="chooseTriggerMode"][data-mode="0"]');
    const saved = JSON.parse(h.storage.get('leyline.match.v1'));
    assert.equal(saved.replay.commands.at(-1).type, 'chooseTriggerMode');
    assert.equal(saved.replay.commands.at(-1).mode, 0);
    assert.equal(h.dialog.open, false);
    // A detached former mode option must not dispatch against a subsequent state.
    h.document.body.append(stale);
    stale.dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.equal(
      JSON.parse(h.storage.get('leyline.match.v1')).replay.commands.length,
      saved.replay.commands.length,
    );
  } finally {
    h.cleanup();
  }
});
test('choosing targeted trigger mode advances directly to its target stage with no priority, survives dismissal and reader', async () => {
  const h = await mount(modalTriggerReplay());
  try {
    h.click('[data-action="resume"]');
    h.click('#dialog [data-action="chooseTriggerMode"][data-mode="2"]');
    assert.equal(h.dialog.open, true);
    assert.match(h.dialog.textContent, /Confirm targets/);
    h.click('#dialog [data-action="selectGroupTarget"]');
    h.click('#dialog [data-action="readDecisionCard"]');
    h.click('#dialog [data-action="returnDecision"]');
    assert.ok(h.dialog.querySelector('.is-selected'));
    h.click('#dialog [data-action="closeDialog"]');
    h.click('[data-action="reviewDecision"]');
    h.click('#dialog [data-action="nextTargetGroup"]');
    const commands = JSON.parse(h.storage.get('leyline.match.v1')).replay.commands;
    const modeIndex = commands.findIndex((c) => c.type === 'chooseTriggerMode');
    assert.equal(commands[modeIndex + 1].type, 'chooseTriggerTargets');
    assert.equal(commands[modeIndex + 1].targets.chosen.length, 1);
  } finally {
    h.cleanup();
  }
});

test('bargain casting option can be declined, or reviewed and paid once after cancel/read/back', async () => {
  const { bargainPosition } = await import('./helpers/bargain-position.js');
  const s = bargainPosition();
  const card = s.players[0].hand
    .map((id) => s.objects[id])
    .find((o) => o.name === 'Hamlet Glutton');
  for (const mode of [0, 1]) {
    const h = await mount(exportReplay(s));
    try {
      h.click('[data-action="resume"]');
      h.click(`[data-card="${card.id}"]`);
      h.click('[data-action="playSelected"]');
      assert.match(h.dialog.textContent, /Cast without bargain/);
      h.click(`[data-action="chooseSpellMode"][data-mode="${mode}"]`);
      if (mode === 1) {
        assert.match(h.dialog.textContent, /Choose additional sacrifice/);
        assert.ok(h.dialog.querySelector('[data-action="confirmCastingSacrifice"]').disabled);
        h.click('[data-action="closeDialog"]');
        h.click('[data-action="playSelected"]');
        const select = h.dialog.querySelector('[data-action="selectCastingSacrifice"]');
        h.click(`[data-action="selectCastingSacrifice"][data-cardid="${select.dataset.cardid}"]`);
        h.click(`[data-action="readDecisionCard"][data-cardid="${select.dataset.cardid}"]`);
        h.click('[data-action="returnDecision"]');
        assert.equal(
          h.dialog
            .querySelector(
              `[data-action="selectCastingSacrifice"][data-cardid="${select.dataset.cardid}"]`,
            )
            .getAttribute('aria-pressed'),
          'true',
        );
        const stale = h.click('[data-action="confirmCastingSacrifice"]');
        stale.dispatchEvent(new window.Event('click', { bubbles: true }));
      }
      const saved = JSON.parse(h.storage.get('leyline.match.v1'));
      const casts = saved.replay.commands.filter((c) => c.type === 'cast' && c.card === card.id);
      assert.equal(casts.length, 1);
      assert.equal(casts[0].mode, mode);
      assert.equal(!!casts[0].sacrifice, mode === 1);
    } finally {
      h.cleanup();
    }
  }
});

test('saddle selection retains multiple payers across inspection, cancels, reopens and dispatches once', async () => {
  const { saddlePosition } = await import('./helpers/saddle-catalog.js');
  const s = saddlePosition();
  const mountCard = Object.values(s.objects).find(
    (o) => o.name === 'Brightfield Glider' && o.zone === 'battlefield',
  );
  const pilots = Object.values(s.objects)
    .filter((o) => o.name === 'Savannah Lions' && o.zone === 'battlefield')
    .slice(0, 2);
  assert.equal(pilots.length, 2);
  const page = await mount(exportReplay(s));
  try {
    page.click('[data-action="resume"]');
    page.click(`[data-card="${mountCard.id}"]`);
    page.click('[data-action="startSaddle"]');
    assert.match(page.dialog.textContent, /Saddle only as a sorcery/);
    assert.equal(page.dialog.querySelector('[data-action="confirmCrew"]').disabled, true);
    page.click(`[data-action="toggleCrew"][data-cardid="${pilots[0].id}"]`);
    assert.equal(page.dialog.querySelector('[data-action="confirmCrew"]').disabled, true);
    page.click(`[data-action="toggleCrew"][data-cardid="${pilots[1].id}"]`);
    assert.equal(page.dialog.querySelector('[data-action="confirmCrew"]').disabled, false);
    page.click(`[data-action="readDecisionCard"][data-cardid="${pilots[0].id}"]`);
    page.click('[data-action="returnDecision"]');
    for (const p of pilots)
      assert.equal(
        page.dialog
          .querySelector(`[data-action="toggleCrew"][data-cardid="${p.id}"]`)
          .getAttribute('aria-pressed'),
        'true',
      );
    page.click('[data-action="closeDialog"]');
    assert.equal(page.dialog.open, false);
    page.click(`[data-card="${mountCard.id}"]`);
    page.click('[data-action="startSaddle"]');
    assert.equal(page.dialog.querySelector('[data-action="confirmCrew"]').disabled, true);
    for (const p of pilots) page.click(`[data-action="toggleCrew"][data-cardid="${p.id}"]`);
    page.click('[data-action="confirmCrew"]');
    const saved = JSON.parse(page.storage.get('leyline.match.v1'));
    assert.equal(saved.replay.commands.filter((c) => c.type === 'saddle').length, 1);
    assert.deepEqual(
      saved.replay.commands.find((c) => c.type === 'saddle').cards,
      pilots.map((p) => p.id),
    );
    assert.equal(page.dialog.open, false);
  } finally {
    page.cleanup();
  }
});

test('filtered hand choices keep ineligible faces readable and preserve optional/mandatory decisions through Read, Back and dismissal', async () => {
  for (const optional of [true, false]) {
    const name = 'Sleight of Hand';
    const catalog = {
      ...CARDS,
      [name]: {
        ...CARDS[name],
        cost: {},
        effects: [
          {
            op: 'lookChooseHand',
            count: 5,
            where: { type: 'creature' },
            optional,
            reveal: true,
            restDestination: 'graveyard',
          },
        ],
      },
    };
    let s;
    for (let seed = 1; seed < 100; seed++) {
      s = createGame({
        catalog,
        seed,
        mulligan: false,
        decks: [
          [...Array(4).fill(name), ...Array(4).fill('Grizzly Bears'), ...Array(52).fill('Island')],
          Array(60).fill('Forest'),
        ],
      });
      const top = s.players[0].library.slice(0, 5).map((id) => s.objects[id].name);
      if (
        s.players[0].hand.some((id) => s.objects[id].name === name) &&
        top.includes('Grizzly Bears') &&
        top.includes('Island')
      )
        break;
    }
    while (s.step !== 'main1') s = act(s, 'pass');
    s = act(s, 'cast', { card: s.players[0].hand.find((id) => s.objects[id].name === name) });
    s = act(act(s, 'pass'), 'pass');
    const h = await mount(exportReplay(s));
    try {
      h.click('[data-action="resume"]');
      assert.match(
        h.dialog.textContent,
        optional ? /Choose up to 1 card for your hand/ : /Choose 1 card for your hand/,
      );
      assert.match(h.dialog.textContent, /into your graveyard/);
      assert.match(h.dialog.textContent, /Only selected cards will be revealed/);
      assert.equal(h.dialog.querySelectorAll('.decision-card-face').length, 5);
      assert.equal(h.dialog.querySelector('[data-action="submitLibrary"]').disabled, !optional);
      const id = s.choice.cards.find((id) => !s.choice.eligibleCards.includes(id));
      const button = h.dialog.querySelector(`.decision-card-face[data-cardid="${id}"]`);
      assert.equal(button.disabled, true);
      assert.equal(button.hasAttribute('draggable'), false);
      h.click(`#dialog [data-action="readDecisionCard"][data-cardid="${id}"]`);
      assert.ok(h.dialog.querySelector('.decision-reader'));
      h.click('#dialog [data-action="returnDecision"]');
      h.click('#dialog [data-action="closeDialog"]');
      h.click('[data-action="reviewDecision"]');
      assert.equal(h.dialog.querySelector('[data-action="submitLibrary"]').disabled, !optional);
      h.click(
        `[data-order-drop="rest"] .decision-card-face[data-cardid="${s.choice.eligibleCards[0]}"]`,
      );
      h.click('#dialog [data-action="readDecisionCard"]');
      h.click('#dialog [data-action="returnDecision"]');
      assert.equal(h.dialog.querySelector('[data-action="submitLibrary"]').disabled, false);
      h.click('[data-action="submitLibrary"]');
      const saved = JSON.parse(h.storage.get('leyline.match.v1'));
      assert.equal(saved.replay.commands.filter((c) => c.type === 'orderLibrary').length, 1);
      assert.equal(saved.replay.commands.at(-1).top.length, 1);
    } finally {
      h.cleanup();
    }
  }
});

test('chosen activation sacrifice offers deliberate large-card selection, reader/back, cancel, quantity and one submission', async () => {
  const { activationSacrificePosition } = await import(
    './helpers/activation-sacrifice-position.js'
  );
  for (const count of [1, 2]) {
    const s = activationSacrificePosition(count),
      source = Object.values(s.objects).find(
        (o) => o.zone === 'battlefield' && o.name === 'Chosen Sacrificer',
      );
    const h = await mount(exportReplay(s));
    try {
      h.click('[data-action="resume"]');
      h.click(`[data-card="${source.id}"]`);
      h.click('[data-action="activateAbility"]');
      assert.match(h.dialog.textContent, /Choose activation sacrifice/);
      assert.ok(h.dialog.querySelector('[data-action="confirmActivationSacrifice"]').disabled);
      assert.ok(h.dialog.querySelector('.decision-card-face'));
      h.click('[data-action="closeDialog"]');
      assert.equal(h.dialog.open, false);
      h.click(`[data-card="${source.id}"]`);
      h.click('[data-action="activateAbility"]');
      const ids = [...h.dialog.querySelectorAll('[data-action="selectActivationSacrifice"]')]
        .slice(0, count)
        .map((e) => e.dataset.cardid);
      for (const id of ids)
        h.click(`[data-action="selectActivationSacrifice"][data-cardid="${id}"]`);
      assert.match(h.dialog.textContent, /Payment is available/);
      h.click(`[data-action="readDecisionCard"][data-cardid="${ids[0]}"]`);
      h.click('[data-action="returnDecision"]');
      assert.equal(
        h.dialog
          .querySelector(`[data-action="selectActivationSacrifice"][data-cardid="${ids[0]}"]`)
          .getAttribute('aria-pressed'),
        'true',
      );
      const stale = h.click('[data-action="confirmActivationSacrifice"]');
      stale.dispatchEvent(new window.Event('click', { bubbles: true }));
      const saved = JSON.parse(h.storage.get('leyline.match.v1'));
      const commands = saved.replay.commands.filter((c) => c.type === 'activate');
      assert.equal(commands.length, 1);
      assert.deepEqual(
        commands[0].sacrifices.map((r) => r.id),
        ids,
      );
    } finally {
      h.cleanup();
    }
  }
});

test('grouped activation targets are confirmed before the chosen sacrifice stage and never auto-pay a proposal', async () => {
  const { activationSacrificePosition } = await import(
    './helpers/activation-sacrifice-position.js'
  );
  const s = activationSacrificePosition(1, {
    ability: {
      targetGroups: [{ id: 'chosen', selector: 'creature', min: 1, max: 1 }],
      effects: [{ op: 'counterOn', amount: 1, targetGroup: 'chosen' }],
    },
  });
  const source = Object.values(s.objects).find(
    (o) => o.zone === 'battlefield' && o.name === 'Chosen Sacrificer',
  );
  const h = await mount(exportReplay(s));
  try {
    h.click('[data-action="resume"]');
    h.click(`[data-card="${source.id}"]`);
    h.click('[data-action="activateAbility"]');
    assert.ok(h.dialog.querySelector('[data-action="nextTargetGroup"]').disabled);
    h.click('[data-action="selectGroupTarget"]');
    assert.equal(h.dialog.querySelector('[data-action="nextTargetGroup"]').disabled, false);
    h.click('[data-action="nextTargetGroup"]');
    assert.match(h.dialog.textContent, /Choose activation sacrifice/);
    assert.match(h.dialog.textContent, /0 of 1 selected/);
    assert.ok(h.dialog.querySelector('[data-action="confirmActivationSacrifice"]').disabled);
    h.click('[data-action="selectActivationSacrifice"]');
    h.click('[data-action="confirmActivationSacrifice"]');
    const command = JSON.parse(h.storage.get('leyline.match.v1')).replay.commands.at(-1);
    assert.equal(command.type, 'activate');
    assert.equal(command.targets.chosen.length, 1);
    assert.equal(command.sacrifices.length, 1);
  } finally {
    h.cleanup();
  }
});

test('new app matches save full definitions once, resume after reload, and keep the complete collection', async () => {
  const h = await mount();
  let persisted;
  try {
    h.click('[data-action="start"]');
    const first = JSON.parse(h.storage.get('leyline.match.v1'));
    assert.equal(first.storageVersion, 1);
    assert.equal(first.replay.config.catalog, null);
    assert.ok(h.storage.get(first.catalogKey));
    const complete = h.readSaved();
    assert.equal(Object.keys(complete.replay.config.catalog).length, Object.keys(CARDS).length);
    const writesBefore = h.writes.length;
    h.click('[data-action="keep"]');
    assert.equal(
      h.writes.length,
      writesBefore + 1,
      'one accepted command should write one small snapshot',
    );
    const next = JSON.parse(h.storage.get('leyline.match.v1'));
    assert.equal(next.catalogKey, first.catalogKey);
    assert.ok(next.replay.commands.some((command) => command.type === 'keep'));
    assert.ok(Buffer.byteLength(h.storage.get('leyline.match.v1')) < 10000);
    persisted = new Map(h.storage);
  } finally {
    h.cleanup();
  }
  const resumed = await mount(null, persisted);
  try {
    resumed.click('[data-action="resume"]');
    const { replay } = await import('../packages/engine/src/index.js');
    assert.doesNotThrow(() => replay(resumed.readSaved().replay));
    resumed.click('[data-action="nav"][data-view="cards"]');
    assert.equal(
      resumed.document.querySelectorAll('.catalog-card').length,
      Object.values(CARDS).filter((card) => !card.token).length,
    );
  } finally {
    resumed.cleanup();
  }
});

test('missing split-save definitions fail visibly instead of replacing them with current defaults', async () => {
  const h = await mount(
    null,
    new Map([
      [
        'leyline.match.v1',
        JSON.stringify({
          storageVersion: 1,
          catalogKey: 'leyline.match-catalog.v1.0123456789abcdef',
          replay: { commands: [] },
        }),
      ],
    ]),
  );
  try {
    h.click('[data-action="resume"]');
    assert.match(h.document.querySelector('#toast').textContent, /missing its card definitions/);
    assert.equal(h.storage.size, 1);
  } finally {
    h.cleanup();
  }
});

test('a damaged cached catalog reports save failure without overwriting the prior snapshot', async () => {
  const h = await mount();
  try {
    h.click('[data-action="start"]');
    const prior = h.storage.get('leyline.match.v1');
    const saved = JSON.parse(prior);
    h.storage.set(saved.catalogKey, '{}');
    h.click('[data-action="keep"]');
    assert.match(
      h.document.querySelector('#toast').textContent,
      /Could not save.*definitions conflict.*Export a replay/,
    );
    assert.equal(h.storage.get('leyline.match.v1'), prior);
  } finally {
    h.cleanup();
  }
});
