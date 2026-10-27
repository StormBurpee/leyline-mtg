import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CARDS,
  CARD_IDS,
  definition,
  dispatch,
  chooseBotCommand,
  keywords,
  stats,
} from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { draw, move, notifyTriggers } from '../packages/engine/src/model.js';
import { stabilize, enterBattlefield } from '../packages/engine/src/effects.js';
import { fixture, put } from '../packages/engine/test/helpers.js';
const names = [
  'Homunculus Horde',
  'Atlantean Cavalry',
  'Clinquant Skymage',
  'Erudite Wizard',
  'Lakeshore Apothecary',
  'Ravenhill Flock',
  'Bard the Bowman',
  'Knowledge Seeker',
  'Loxodon Eavesdropper',
  'Mischievous Mystic',
  'Otter-Penguin',
  'Private Eye',
  'Thopter Fabricator',
  'Tiger-Seal',
  'Razorkin Needlehead',
];
const mechanics = JSON.parse(
  await readFile(new URL('../packages/cards/mechanics.json', import.meta.url)),
);
const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
function settle(s) {
  stabilize(s);
  for (
    let i = 0;
    i < 100 && (s.choice || s.stack.length || s.resolving || s.pendingTriggers.length);
    i++
  ) {
    const p = s.choice?.player ?? s.priority;
    const r = dispatch(s, s.choice ? chooseBotCommand(s, p) : { type: 'pass', player: p });
    assert.equal(r.ok, true, r.error?.message);
    s = r.state;
  }
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 0);
  return s;
}
test('fifteen full draw-payoff Oracle sources and blue-only Faerie compile and round-trip', async () => {
  for (const name of [...names, 'Blue Faerie Token']) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const source = JSON.parse(
      await readFile(new URL(`../packages/cards/cards/${slug}.json`, import.meta.url)),
    );
    const c = compileCard(source, { identities: CARD_IDS, mechanics });
    assert.equal(c.ok, true, JSON.stringify(c.diagnostics));
    assert.deepEqual(c.definition, CARDS[name]);
    assert.equal(c.definition.text, source.rulesText);
    const round = compileCard(sourceFromDefinition(c.definition, { id: source.id, idsByName }), {
      identities: CARD_IDS,
      mechanics,
    });
    assert.equal(round.ok, true, JSON.stringify(round.diagnostics));
    assert.deepEqual(round.definition, c.definition);
  }
});
for (const name of names)
  test(`${name}: real draw triggers resolve with full card definition`, () => {
    let s = fixture();
    const o = put(s, name);
    put(s, 'Grizzly Bears');
    put(s, 'Private Eye', 1);
    draw(s, name === 'Razorkin Needlehead' ? 1 : 0, 2);
    assert.ok(s.pendingTriggers.length);
    s = settle(s);
    assert.equal(s.status, 'playing');
    assert.equal(s.objects[o.id].zone, 'battlefield');
  });
test('Mystic creates a blue (not blue-black) Faerie; Fabricator creates artifact flying Thopter', () => {
  for (const [name, tokenName, colors, types] of [
    ['Mischievous Mystic', 'Blue Faerie Token', ['U'], ['creature']],
    ['Thopter Fabricator', 'Flying Thopter Token', [], ['artifact', 'creature']],
  ]) {
    let s = fixture();
    put(s, name);
    draw(s, 0, 2);
    s = settle(s);
    const token = Object.values(s.objects).find((o) => o.token && o.zone === 'battlefield');
    assert.equal(token.name, tokenName);
    assert.deepEqual(definition(s, token).color, colors);
    assert.deepEqual(definition(s, token).types, types);
    assert.ok(keywords(s, token).includes('flying'));
  }
});
test('Knowledge Seeker death and Loxodon entry investigate in addition to draw payoffs', () => {
  for (const name of ['Knowledge Seeker', 'Loxodon Eavesdropper']) {
    let s = fixture();
    const o = put(s, name);
    draw(s, 0, 2);
    s = settle(s);
    assert.equal(stats(s, s.objects[o.id]).power, CARDS[name].power + 1);
    if (name === 'Knowledge Seeker') move(s, s.objects[o.id], 'graveyard');
    else {
      move(s, s.objects[o.id], 'hand');
      enterBattlefield(s, s.objects[o.id]);
    }
    s = settle(s);
    assert.ok(
      Object.values(s.objects).some((o) => o.name === 'Clue Token' && o.zone === 'battlefield'),
    );
  }
});
test('Tiger-Seal upkeep tapping and second-draw untap respect stun replacement', () => {
  let s = fixture();
  const o = put(s, 'Tiger-Seal');
  notifyTriggers(s, 'step', { step: 'upkeep', player: 0 });
  s = settle(s);
  assert.equal(s.objects[o.id].tapped, true);
  s.objects[o.id].stunCounters = 1;
  draw(s, 0, 2);
  s = settle(s);
  assert.equal(s.objects[o.id].stunCounters, 0);
  assert.equal(s.objects[o.id].tapped, true);
});
test('Razorkin has first strike only on its controller turn and damages drawing opponent once per card', () => {
  let s = fixture();
  const o = put(s, 'Razorkin Needlehead');
  assert.ok(keywords(s, o).includes('first strike'));
  s.active = 1;
  assert.ok(!keywords(s, o).includes('first strike'));
  draw(s, 1, 3);
  s = settle(s);
  assert.equal(s.players[1].life, 17);
  assert.equal(s.players[0].life, 20);
});
