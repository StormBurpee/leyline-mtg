import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from './server.mjs';
import { createGame, dispatch, exportReplay, legalActions } from '../packages/engine/src/index.js';

function command(state, action) {
  const result = dispatch(state, { player: state.choice?.player ?? state.priority, ...action });
  assert.equal(result.ok, true, result.error?.message);
  return result.state;
}
function opening() {
  for (let seed = 1; seed <= 200; seed++) {
    let state = createGame({ seed, mulligan: false });
    const names = state.players[0].hand.map((id) => state.objects[id].name);
    if (!names.includes('Mountain') || !names.includes('Shock')) continue;
    while (state.step !== 'main1') state = command(state, { type: 'pass' });
    return state;
  }
  throw new Error('No deterministic opening fixture found.');
}
function largeHand() {
  let state = createGame({
    seed: 31,
    mulligan: false,
    decks: [
      [...Array(56).fill('Island'), ...Array(4).fill('Overflowing Insight')],
      Array(60).fill('Forest'),
    ],
  });
  for (let i = 0; i < 1800; i++) {
    if (state.players[0].hand.length > 10 && !state.choice && !state.stack.length && state.priority === 0)
      return state;
    const player = state.choice?.player ?? state.priority;
    const choice = state.choice;
    let action = { type: 'pass' };
    if (choice?.kind === 'attackers') action = { type: 'attackers', cards: [] };
    else if (choice?.kind === 'blockers') action = { type: 'blockers', pairs: [] };
    else if (choice?.kind === 'discard') {
      const cards = [...state.players[player].hand]
        .sort((a, b) => Number(state.objects[a].name === 'Overflowing Insight') -
          Number(state.objects[b].name === 'Overflowing Insight'))
        .slice(0, choice.count);
      action = { type: 'discard', cards };
    } else if (choice) throw new Error('Unexpected fixture choice: ' + choice.kind);
    else if (player === 0 && state.active === 0 && state.step === 'main1' && !state.stack.length) {
      const actions = legalActions(state, player);
      action = actions.find((candidate) => candidate.type === 'playLand') ??
        actions.find((candidate) => candidate.type === 'cast' && candidate.target?.id === 0) ??
        action;
    }
    state = command(state, action);
  }
  throw new Error('Large hand fixture did not converge.');
}
function saved(state) {
  return {
    replay: exportReplay(state),
    mode: 'hotseat',
    deck: 'ember',
    autoYield: false,
    holdPriority: true,
    controls: { controlMode: 'full', handExpanded: true, stops: {} },
  };
}
const server = startServer({ port: 4173 });
if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
const browser = await chromium.launch();
const errors = [];
async function load(state, width, reducedMotion = 'reduce') {
  const context = await browser.newContext({
    viewport: { width, height: width < 800 ? 900 : 1000 },
    hasTouch: width < 800,
    isMobile: width < 800,
    reducedMotion,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((value) => {
    localStorage.setItem('leyline.match.v1', JSON.stringify(value));
  }, saved(state));
  await page.goto('http://127.0.0.1:4173/');
  await page.locator('[data-action="resume"]').click();
  await page.locator('.hand[data-layout]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  return { page, context };
}
async function screenshot(page, name) {
  const buffer = await page.screenshot({ type: 'jpeg', quality: 62, fullPage: true });
  console.log('SCREENSHOT_BEGIN ' + name);
  const encoded = buffer.toString('base64');
  for (let i = 0; i < encoded.length; i += 2048) console.log(encoded.slice(i, i + 2048));
  console.log('SCREENSHOT_END ' + name);
}
async function reachEnds(page) {
  const hand = page.locator('.hand');
  await hand.scrollIntoViewIfNeeded();
  const mode = await hand.getAttribute('data-layout');
  if (mode === 'rail') {
    await hand.evaluate((element) => { element.scrollLeft = 0; });
    await page.waitForTimeout(100);
    let visible = await hand.evaluate((element) =>
      element.firstElementChild.getBoundingClientRect().left >= element.getBoundingClientRect().left - 2);
    assert.ok(visible, 'first rail card is reachable');
    await hand.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    await page.waitForTimeout(150);
    visible = await hand.evaluate((element) =>
      element.lastElementChild.getBoundingClientRect().right <= element.getBoundingClientRect().right + 2);
    assert.ok(visible, 'last rail card is reachable');
  } else {
    const visible = await hand.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return [...element.children].every((card) => {
        const rect = card.getBoundingClientRect();
        return rect.left >= bounds.left - 2 && rect.right <= bounds.right + 2;
      });
    });
    assert.ok(visible, 'all fan cards fit within the hand');
  }
  return mode;
}
try {
  const initial = opening();
  for (const width of [320, 375, 768, 1440]) {
    const { page, context } = await load(initial, width);
    const mode = await reachEnds(page);
    const hand = page.locator('.hand');
    const scroll = await hand.evaluate((element) => element.scrollLeft);
    await hand.locator('.hand-card').last().click();
    if (mode === 'rail') {
      const after = await hand.evaluate((element) => element.scrollLeft);
      assert.ok(Math.abs(after - scroll) <= 3, 'hand scroll survives selection rerender');
    }
    await page.locator('[data-action="readHandCard"]').click();
    await page.locator('#dialog[open]').waitFor();
    await page.locator('#dialog .dialog-head [data-action="closeDialog"]').click();
    assert.equal(await page.locator('#dialog[open]').count(), 0);
    const history = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('leyline.match.v1')).replay.commands.length);
    assert.equal(history, initial.history.length, 'reading does not play the card');
    await page.locator('[data-action="handSize"]').click();
    await reachEnds(page);
    await page.locator('[data-action="handSize"]').click();
    await reachEnds(page);
    if (width === 375 || width === 1440) await screenshot(page, 'hand-' + width);
    console.log(JSON.stringify({ case: 'opening', width, mode, passed: true }));
    await context.close();
  }
  const { page, context } = await load(largeHand(), 375);
  assert.equal(await reachEnds(page), 'rail');
  await screenshot(page, 'large-hand-375');
  console.log(JSON.stringify({ case: 'large hand', cards: await page.locator('.hand-card').count(), passed: true }));
  await context.close();
  assert.deepEqual(errors, [], 'browser JavaScript errors');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
