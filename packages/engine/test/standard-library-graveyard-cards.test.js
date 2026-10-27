import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { CARDS, keywords, playerView } from '../src/index.js';
import { move } from '../src/model.js';
import { finishCleanup } from '../src/turn.js';
import { compileCard } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, lands, act, resolve } from './helpers.js';

const names = ['Codecracker Hound', 'Commune with Evil', 'Confounding Riddle', 'Faerie Snoop'];
function rich() {
  const s = fixture();
  for (const name of ['Island', 'Swamp']) lands(s, name, 8);
  return s;
}
function finish(s) {
  const chosen = s.choice.cards[0],
    rest = s.choice.cards.slice(1);
  s = act(s, 'orderLibrary', { top: [chosen], rest });
  assert.equal(s.objects[chosen].zone, 'hand');
  assert.ok(rest.every((id) => s.objects[id].zone === 'graveyard'));
  assert.equal(playerView(s, 1).objects[chosen], undefined);
  return s;
}
test('four graveyard-remainder sources retain full text, validate and roundtrip', async () => {
  const schema = JSON.parse(
    await readFile(new URL('../../cards/schema/card.schema.json', import.meta.url)),
  );
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  for (const name of names) {
    const slug = name.toLowerCase().replaceAll(' ', '-');
    const source = JSON.parse(
      await readFile(new URL(`../../cards/cards/${slug}.json`, import.meta.url)),
    );
    assert.ok(validate(source), JSON.stringify(validate.errors));
    const result = compileCard(source);
    assert.ok(result.ok, JSON.stringify(result.diagnostics));
    assert.equal(result.definition.text, source.rulesText);
    assert.deepEqual(result.definition, CARDS[name]);
    const roundtrip = compileCard(sourceFromDefinition(CARDS[name], { id: source.id }));
    assert.ok(roundtrip.ok, JSON.stringify(roundtrip.diagnostics));
    assert.deepEqual(roundtrip.definition, CARDS[name]);
  }
});
test('Commune with Evil gains life only after its mandatory choice and mills no cards', () => {
  let s = rich();
  const card = put(s, 'Commune with Evil', 0, 'hand');
  s = resolve(act(s, 'cast', { card: card.id }));
  assert.equal(s.choice.cards.length, 4);
  assert.equal(s.choice.selectCount, 1);
  assert.equal(s.choice.restDestination, 'graveyard');
  assert.equal(s.players[0].life, 20);
  assert.throws(() => act(s, 'orderLibrary', { top: [], rest: s.choice.cards }), /exactly 1/);
  const events = s.events.length;
  s = finish(s);
  assert.equal(s.players[0].life, 23);
  assert.ok(!s.events.slice(events).some((e) => ['draw', 'mill'].includes(e.type)));
});
test('Commune with Evil still gains life from an empty library without a draw loss', () => {
  let s = rich();
  for (const id of [...s.players[0].library]) move(s, s.objects[id], 'exile');
  const card = put(s, 'Commune with Evil', 0, 'hand');
  s = resolve(act(s, 'cast', { card: card.id }));
  assert.equal(s.choice, null);
  assert.equal(s.winner, null);
  assert.equal(s.players[0].life, 23);
});
test('Confounding Riddle selection mode requires no target and puts one of four into hand', () => {
  let s = rich();
  const card = put(s, 'Confounding Riddle', 0, 'hand');
  s = resolve(act(s, 'cast', { card: card.id, mode: 0 }));
  assert.equal(s.choice.cards.length, 4);
  s = finish(s);
  assert.equal(s.players[0].hand.length, 1);
});
test('Confounding Riddle counter mode offers the spell controller exactly four mana and no library selection', () => {
  for (const pay of [false, true]) {
    let s = fixture();
    lands(s, 'Mountain', 5);
    lands(s, 'Island', 3, 1);
    const spell = put(s, 'Lightning Bolt', 0, 'hand'),
      riddle = put(s, 'Confounding Riddle', 1, 'hand');
    s = act(s, 'cast', { card: spell.id, target: { kind: 'player', id: 1 } });
    const target = { kind: 'stack', id: s.stack.at(-1).id };
    s = act(s, 'pass');
    s = act(s, 'cast', { card: riddle.id, mode: 1, target });
    s = resolve(s);
    assert.equal(s.choice.kind, 'payCost');
    assert.equal(s.choice.player, 0);
    assert.deepEqual(s.choice.cost, { mana: { generic: 4 } });
    s = act(s, 'payCost', { pay });
    assert.equal(s.choice, null);
    assert.equal(s.objects[spell.id].zone, pay ? 'stack' : 'graveyard');
    assert.equal(s.players[1].hand.length, 0);
  }
});
test('Faerie Snoop has flying face up, not face down, and inspects only when turned face up', () => {
  for (const disguise of [false, true]) {
    let s = rich();
    const card = put(s, 'Faerie Snoop', 0, 'hand');
    s = resolve(act(s, 'cast', { card: card.id, mode: disguise ? 1 : 0 }));
    assert.equal(s.choice, null);
    assert.equal(s.stack.length, 0);
    assert.equal(keywords(s, s.objects[card.id]).includes('flying'), !disguise);
    if (!disguise) continue;
    s = act(s, 'turnFaceUp', { card: card.id });
    assert.ok(keywords(s, s.objects[card.id]).includes('flying'));
    s = resolve(s);
    assert.equal(s.choice.cards.length, 2);
    s = finish(s);
    assert.equal(s.players[0].hand.length, 1);
  }
});
test('Codecracker Hound selects on normal and warped entry, exiles at end step and casts normally on a later turn', () => {
  for (const warp of [false, true]) {
    let s = rich();
    const card = put(s, 'Codecracker Hound', 0, 'hand');
    s = resolve(act(s, 'cast', { card: card.id, mode: warp ? 1 : 0 }));
    s = resolve(s);
    assert.equal(s.choice.cards.length, 2);
    s = finish(s);
    assert.equal(s.delayedTriggers?.length ?? 0, warp ? 1 : 0);
    if (!warp) continue;
    s.step = 'main2';
    s = resolve(s);
    assert.equal(s.stack.at(-1).rule, 'warpExile');
    s = resolve(s);
    assert.equal(s.objects[card.id].zone, 'exile');
    assert.throws(() => act(s, 'cast', { card: card.id, mode: 0 }));
    finishCleanup(s);
    finishCleanup(s);
    s.step = 'main1';
    s = resolve(act(s, 'cast', { card: card.id, mode: 0 }));
    s = resolve(s);
    assert.equal(s.choice.cards.length, 2);
    s = finish(s);
    assert.equal(s.objects[card.id].zone, 'battlefield');
    assert.equal(s.delayedTriggers?.length ?? 0, 0);
  }
});
