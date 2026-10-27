import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import {
  CARDS,
  createRegistry,
  ref,
  dispatch,
  chooseBotCommand,
  playerView,
} from '../packages/engine/src/index.js';
import { compileCard } from '../packages/cards/compiler.js';
import { sourceFromDefinition } from '../packages/cards/from-native.js';
import { fixture, put, act, resolve } from '../packages/engine/test/helpers.js';
import { move } from '../packages/engine/src/model.js';
const source = JSON.parse(
  readFileSync(new URL('../packages/cards/cards/formidable-speaker.json', import.meta.url)),
);
const result = compileCard(source);
assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
const catalog = createRegistry({ ...CARDS, [source.name]: result.definition });
function setup() {
  let s = fixture();
  s.catalog = catalog;
  s.players[0].mana.G = 10;
  const card = put(s, source.name, 0, 'hand');
  return [s, card];
}
test('Formidable Speaker schema and native round trip retain both full printed clauses', () => {
  const schema = JSON.parse(
    readFileSync(new URL('../packages/cards/schema/card.schema.json', import.meta.url)),
  );
  const validate = new Ajv({ strict: true }).compile(schema);
  assert.equal(validate(source), true, JSON.stringify(validate.errors));
  const round = compileCard(sourceFromDefinition(result.definition, { id: source.id }));
  assert.equal(round.ok, true, JSON.stringify(round.diagnostics));
  assert.deepEqual(round.definition, result.definition);
});
test('discard payment gates a private creature search, retains parent continuation, and survives source departure', () => {
  let [s, card] = setup();
  const payment = put(s, 'Shock', 0, 'hand'),
    bear = put(s, 'Grizzly Bears', 0, 'library');
  s = act(s, 'cast', { card: card.id });
  s = resolve(s);
  move(s, s.objects[card.id], 'graveyard');
  s = resolve(s);
  assert.equal(s.choice.kind, 'discardEffect');
  assert.equal(s.choice.optional, true);
  s = act(s, 'discardEffect', { cards: [payment.id] });
  assert.equal(s.choice.kind, 'librarySearch');
  assert.equal(playerView(s, 1).choice.kind, 'opponentChoice');
  assert.equal(playerView(s, 1).objects[bear.id], undefined);
  assert.ok(!s.choice.cards.some((id) => s.objects[id].name === 'Island'));
  s = act(s, 'searchLibrary', { cards: [bear.id] });
  assert.equal(s.objects[bear.id].zone, 'hand');
  assert.equal(s.choice, null);
  assert.equal(s.stack.length, 0);
});
test('declining or lacking a discard skips the search; bot is allowed to search with an empty library', () => {
  for (const hand of [true, false]) {
    let [s, card] = setup();
    if (hand) put(s, 'Shock', 0, 'hand');
    s = act(s, 'cast', { card: card.id });
    s = resolve(s);
    s = resolve(s);
    if (hand) s = act(s, 'discardEffect', { cards: [] });
    assert.equal(s.choice, null);
  }
  let [s, card] = setup();
  for (const id of [...s.players[0].library]) move(s, s.objects[id], 'exile');
  put(s, 'Shock', 0, 'hand');
  s = act(s, 'cast', { card: card.id });
  s = resolve(s);
  s = resolve(s);
  const command = chooseBotCommand(s, 0);
  assert.equal(command.cards.length, 1);
  s = act(s, 'discardEffect', command);
  if (s.choice) s = act(s, 'searchLibrary', { cards: [] });
  assert.equal(s.status, 'playing');
});
test('activation pays mana and tap, targets another permanent of either controller, and rejects stale targets', () => {
  let [s, card] = setup();
  move(s, s.objects[card.id], 'battlefield');
  s.objects[card.id].controlledSince = s.turn - 1;
  const enemy = put(s, 'Island', 1);
  enemy.tapped = true;
  assert.equal(
    dispatch(s, {
      type: 'activate',
      player: 0,
      card: card.id,
      ability: 0,
      target: ref(s.objects[card.id]),
    }).ok,
    false,
  );
  s = act(s, 'activate', { card: card.id, ability: 0, target: ref(enemy) });
  assert.equal(s.objects[card.id].tapped, true);
  assert.equal(s.players[0].mana.G, 9);
  s = resolve(s);
  assert.equal(s.objects[enemy.id].tapped, false);
  s.objects[card.id].tapped = false;
  s.objects[enemy.id].tapped = true;
  s = act(s, 'activate', { card: card.id, ability: 0, target: ref(s.objects[enemy.id]) });
  move(s, s.objects[enemy.id], 'hand');
  move(s, s.objects[enemy.id], 'battlefield');
  s.objects[enemy.id].tapped = true;
  s = resolve(s);
  assert.equal(s.objects[enemy.id].tapped, true);
});
