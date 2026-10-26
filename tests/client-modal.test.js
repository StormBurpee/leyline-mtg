import test from 'node:test';
import assert from 'node:assert/strict';
import { game, spellModeBody } from '../apps/web/view.js';
import { cardDropPlan } from '../apps/web/drop-plan.js';
import { fixture, put } from '../packages/engine/test/helpers.js';
const ui = {
  mode: 'bot',
  chosen: [],
  blocks: [],
  activation: null,
  spellMode: null,
  controlMode: 'smart',
  stops: {},
  view: 'play',
  sideTab: 'stack',
};
test('modal spell UI lists every mode and disables unavailable choices', () => {
  const s = fixture();
  s.players[0].mana.R = 2;
  const card = put(s, 'Abrade', 0, 'hand');
  put(s, 'Grizzly Bears', 1);
  const html = spellModeBody(s, 0, card.id);
  assert.match(html, /data-mode="0" >/);
  assert.match(html, /data-mode="1" disabled/);
  assert.match(html, /Choose target next/);
  assert.match(game(s, { ...ui, selected: card.id }, {}), /Choose mode/);
});
test('modal dragging requests a deliberate mode instead of choosing the first legal action', () => {
  const s = fixture();
  s.players[0].mana.R = 2;
  const card = put(s, 'Abrade', 0, 'hand');
  put(s, 'Grizzly Bears', 1);
  put(s, 'Expedition Map', 1);
  assert.deepEqual(cardDropPlan(s, 0, card.id), {
    kind: 'chooseMode',
    destinations: [{ field: 0, card: card.id }],
  });
});
test('selected mode drives highlighted targets and supports changing the mode', () => {
  const s = fixture();
  s.players[0].mana.R = 2;
  const card = put(s, 'Abrade', 0, 'hand'),
    artifact = put(s, 'Expedition Map', 1),
    bear = put(s, 'Grizzly Bears', 1);
  const html = game(s, { ...ui, selected: card.id, spellMode: 1, targeting: true }, {});
  assert.match(html, /data-action="spellModes">Change mode/);
  const tags = html.match(/<button class="permanent[^>]+>/g) || [];
  assert.ok(tags.some((t) => t.includes(`data-card="${artifact.id}"`) && t.includes('targetable')));
  assert.ok(tags.some((t) => t.includes(`data-card="${bear.id}"`) && !t.includes('targetable')));
});
