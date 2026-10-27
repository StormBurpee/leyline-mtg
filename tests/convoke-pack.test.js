import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CARDS,
  CARD_IDS,
  exportReplay,
  replay,
  dispatch,
  legalActions,
  chooseBotCommand,
  castingProfile,
  convokePayment,
  stats,
  keywords,
  ref,
} from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { fixture, put, act, resolve } from '../packages/engine/test/helpers.js';
import { convokePosition } from './helpers/convoke-position.js';
const names = [
  'Appeal to Eirdu',
  'Lofty Dreams',
  'Merrow Skyswimmer',
  'Protective Response',
  'Sun-Dappled Celebrant',
  'The Wandering Rescuer',
  'Unexpected Assistance',
  'Vote Out',
  'Winter, Team Player',
];
const mechanics = JSON.parse(
  await readFile(new URL('../packages/cards/mechanics.json', import.meta.url)),
);
test('nine complete convoke sources compile and round trip all additional clauses', async () => {
  const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
  for (const name of names) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const source = JSON.parse(
      await readFile(new URL(`../packages/cards/cards/${slug}.json`, import.meta.url)),
    );
    const compiled = compileCard(source, { identities: CARD_IDS, mechanics });
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    assert.deepEqual(compiled.definition, CARDS[name]);
    assert.match(source.rulesText, /Convoke/);
    const round = compileCard(
      sourceFromDefinition(compiled.definition, { id: source.id, idsByName }),
      { identities: CARD_IDS, mechanics },
    );
    assert.equal(round.ok, true, JSON.stringify(round.diagnostics));
    assert.deepEqual(round.definition, compiled.definition);
  }
});
test('convoke replay preserves explicit payment, tap state and history', () => {
  const s = convokePosition(),
    a = legalActions(s, 0).find(
      (a) => a.type === 'cast' && s.objects[a.card].name === 'Sun-Dappled Celebrant',
    );
  const profile = castingProfile(s, 0, s.objects[a.card]);
  const payment = convokePayment(s, 0, profile);
  const command = { ...a, player: 0, convoke: payment.choices };
  const r = dispatch(s, command);
  assert.equal(r.ok, true, r.error?.message);
  const replayed = replay(exportReplay(r.state));
  assert.deepEqual(exportReplay(replayed), exportReplay(r.state));
  assert.deepEqual(replayed.stack.at(-1).convoke, payment.choices);
  assert.ok(payment.choices.every((c) => replayed.objects[c.card].tapped));
  const bot = chooseBotCommand(s, 0);
  assert.equal(dispatch(s, bot).ok, true);
});
test('Appeal buffs one or two targets; Lofty Dreams draws and grants both bonuses', () => {
  let s = fixture();
  s.players[0].mana.W = 20;
  s.players[0].mana.U = 20;
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears'),
    appeal = put(s, 'Appeal to Eirdu', 0, 'hand');
  s = act(s, 'cast', { card: appeal.id, targets: { creatures: [ref(a), ref(b)] }, convoke: [] });
  s = resolve(s);
  assert.equal(stats(s, s.objects[a.id]).power, 4);
  assert.equal(stats(s, s.objects[b.id]).toughness, 3);
  const aura = put(s, 'Lofty Dreams', 0, 'hand'),
    before = s.players[0].hand.length;
  s = act(s, 'cast', { card: aura.id, target: ref(s.objects[a.id]), convoke: [] });
  s = resolve(s);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, before);
  assert.equal(stats(s, s.objects[a.id]).power, 6);
  assert.ok(keywords(s, s.objects[a.id]).includes('flying'));
});
test('Unexpected Assistance draws three then requires the discard choice', () => {
  let s = fixture();
  s.players[0].mana.U = 5;
  const card = put(s, 'Unexpected Assistance', 0, 'hand');
  const before = s.players[0].hand.length;
  s = act(s, 'cast', { card: card.id, convoke: [] });
  s = resolve(s);
  assert.equal(s.players[0].hand.length, before + 2);
  assert.equal(s.choice.kind, 'discardEffect');
  s = act(s, 'discardEffect', { cards: [s.players[0].hand[0]] });
  assert.equal(s.players[0].hand.length, before + 1);
});
