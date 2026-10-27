import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createGame, exportReplay } from '../packages/engine/src/index.js';
import { act, resolve } from '../packages/engine/test/helpers.js';
import { mount } from './helpers/client-mount.js';
function position() {
  const catalog = {
    ...CARDS,
    'Review Adept': {
      name: 'Review Adept',
      type: 'creature',
      cost: {},
      power: 1,
      toughness: 3,
      activated: [{ cost: { mana: { X: 1 } }, effects: [{ op: 'draw', count: { kind: 'x' } }] }],
    },
    'Review Mind': {
      name: 'Review Mind',
      type: 'sorcery',
      cost: { X: 1 },
      effects: [{ op: 'draw', count: { kind: 'x' } }],
    },
  };
  let s;
  for (let seed = 1; seed < 100; seed++) {
    s = createGame({
      seed,
      mulligan: false,
      catalog,
      decks: [
        [
          ...Array(4).fill('Review Adept'),
          ...Array(4).fill('Review Mind'),
          ...Array(52).fill('Island'),
        ],
        Array(60).fill('Forest'),
      ],
    });
    const hand = s.players[0].hand.map((id) => s.objects[id].name);
    if (hand.includes('Review Adept') && hand.includes('Review Mind')) break;
  }
  while (s.step !== 'main1') s = act(s, 'pass');
  const adept = s.players[0].hand.find((id) => s.objects[id].name === 'Review Adept');
  const spell = s.players[0].hand.find((id) => s.objects[id].name === 'Review Mind');
  s = act(s, 'cast', { card: adept });
  s = resolve(s);
  s = act(s, 'playLand', { card: s.players[0].hand.find((id) => s.objects[id].name === 'Island') });
  return { s, adept, spell };
}
test('canceling activated X must not change a newly selected X spell into an activation', async () => {
  const { s, adept, spell } = position();
  const h = await mount(exportReplay(s));
  try {
    h.click('[data-action="resume"]');
    h.click(`[data-card="${adept}"]`);
    h.click('[data-action="activateAbility"]');
    assert.match(h.dialog.textContent, /Cancel activation/);
    h.click('#dialog [data-action="closeDialog"]');
    h.click(`[data-card="${spell}"]`);
    h.click('[data-action="playSelected"]');
    assert.match(h.dialog.textContent, /Cancel casting/);
    h.click('[data-action="chooseX"][data-x="1"]');
    const commands = JSON.parse(h.storage.get('leyline.match.v1')).replay.commands;
    assert.equal(commands.filter((c) => c.type === 'activate').length, 0);
    assert.equal(commands.at(-1).type, 'cast');
    assert.equal(commands.at(-1).card, spell);
    assert.equal(commands.at(-1).x, 1);
  } finally {
    h.cleanup();
  }
});
