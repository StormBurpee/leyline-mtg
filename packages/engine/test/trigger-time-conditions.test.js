import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CARDS, CARD_IDS, createRegistry, stats, keywords } from '../src/index.js';
import { move } from '../src/model.js';
import { compileCard, canonical } from '../../cards/compiler.js';
import { sourceFromDefinition } from '../../cards/from-native.js';
import { fixture, put, act, resolve } from './helpers.js';

const mechanics = JSON.parse(
  readFileSync(new URL('../../cards/mechanics.json', import.meta.url), 'utf8'),
);
function ready() {
  const s = fixture();
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: 0 };
  return s;
}

// Foundations release notes (2024-11-08), Courageous Goblin: its "while"
// restriction is part of the trigger event, not a CR 603.4 intervening-if.
// https://magic.wizards.com/en/news/feature/foundations-release-notes
test('Courageous Goblin only checks the four-power restriction when it attacks', () => {
  let s = ready();
  const goblin = put(s, 'Courageous Goblin');
  const large = put(s, 'Serra Angel');
  s = act(s, 'attackers', { cards: [goblin.id] });
  assert.equal(s.stack.length, 1);
  move(s, s.objects[large.id], 'graveyard');
  s = resolve(s);
  assert.deepEqual(stats(s, s.objects[goblin.id]), { power: 3, toughness: 2 });
  assert.ok(keywords(s, s.objects[goblin.id]).includes('menace'));
});

test('Courageous Goblin does not trigger without a qualifying creature at declaration', () => {
  let s = ready();
  const goblin = put(s, 'Courageous Goblin');
  put(s, 'Serra Angel', 1);
  s = act(s, 'attackers', { cards: [goblin.id] });
  assert.equal(s.stack.length, 0);
  put(s, 'Serra Angel');
  assert.deepEqual(stats(s, s.objects[goblin.id]), { power: 2, toughness: 2 });
});

test('Courageous Goblin counts its own effective power for its trigger restriction', () => {
  let s = ready();
  const goblin = put(s, 'Courageous Goblin');
  goblin.plusCounters = 2;
  s = act(s, 'attackers', { cards: [goblin.id] });
  assert.equal(s.stack.length, 1);
  s.objects[goblin.id].plusCounters = 0;
  s = resolve(s);
  assert.deepEqual(stats(s, s.objects[goblin.id]), { power: 3, toughness: 2 });
});

test('Crypt Feaster still rechecks its intervening-if threshold on resolution', () => {
  let s = ready();
  const feaster = put(s, 'Crypt Feaster');
  const grave = Array.from({ length: 7 }, () => put(s, 'Forest', 0, 'graveyard'));
  s = act(s, 'attackers', { cards: [feaster.id] });
  assert.equal(s.stack.length, 1);
  move(s, s.objects[grave[0].id], 'exile');
  s = resolve(s);
  assert.deepEqual(stats(s, s.objects[feaster.id]), { power: 3, toughness: 4 });
});

test('trigger-only conditions survive compiler roundtrip and native validation', () => {
  const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
  const original = CARDS['Courageous Goblin'];
  const source = sourceFromDefinition(original, { id: idsByName[original.name], idsByName });
  assert.ok(source.abilities[0].triggerCondition);
  assert.equal(source.abilities[0].condition, undefined);
  const compiled = compileCard(source, { identities: CARD_IDS, mechanics });
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  assert.deepEqual(canonical(compiled.definition), canonical(original));
  const invalid = structuredClone(original);
  invalid.triggers[0].triggerCondition = { kind: 'not-a-supported-condition' };
  assert.throws(() => createRegistry([invalid]));
});

test('trigger-time conditions on self-entry are not folded into unconditional ETB instructions', () => {
  const source = JSON.parse(
    readFileSync(new URL('../../cards/cards/courageous-goblin.json', import.meta.url), 'utf8'),
  );
  source.abilities[0].on = { event: 'enter', object: 'source' };
  const compiled = compileCard(source, { identities: CARD_IDS, mechanics });
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  assert.equal(compiled.definition.etb, undefined);
  assert.ok(compiled.definition.triggers[0].triggerCondition);
  assert.doesNotThrow(() => createRegistry([compiled.definition]));
  source.abilities[0].triggerCondition = { kind: 'not-a-supported-condition' };
  assert.equal(compileCard(source, { identities: CARD_IDS, mechanics }).ok, false);
});

test('native landfall shorthand never discards a trigger-time restriction', () => {
  const definition = structuredClone(CARDS['Courageous Goblin']);
  definition.triggers[0].event = 'controllerLandEnters';
  delete definition.triggers[0].effects[0].keywords;
  const idsByName = Object.fromEntries(Object.entries(CARD_IDS).map(([id, name]) => [name, id]));
  const source = sourceFromDefinition(definition, { id: idsByName[definition.name], idsByName });
  assert.equal(source.abilities[0].kind, 'triggered');
  assert.ok(source.abilities[0].triggerCondition);
  const compiled = compileCard(source, { identities: CARD_IDS, mechanics });
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  assert.deepEqual(canonical(compiled.definition), canonical(definition));
});
