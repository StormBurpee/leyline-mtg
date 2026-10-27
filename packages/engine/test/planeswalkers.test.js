import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, createRegistry, dispatch, createGame, exportReplay, replay } from '../src/index.js';
import { abilityProblem } from '../src/engine.js';
import { dealDamage, legalTarget, resolveTop, stabilize } from '../src/effects.js';
import { ref, move } from '../src/model.js';
import { fixture, put, lands, act, resolve } from './helpers.js';

test('No Admittance resolves all text: damage, blue nonlegendary Jace, and loyalty', () => {
  let s = fixture();
  const spell = put(s, 'No Admittance', 0, 'hand');
  lands(s, 'Mountain', 2);
  s = act(s, 'cast', { card: spell.id, target: { kind: 'player', id: 1 } });
  s = resolve(s);
  const j = Object.values(s.objects).find((o) => o.name === 'Jace Token');
  assert.equal(s.players[1].life, 17);
  assert.equal(j.loyalty, 1);
  assert.equal(j.zone, 'battlefield');
  assert.equal(CARDS[j.name].legendary, undefined);
  assert.equal(abilityProblem(s, 0, j.id, 1, null), 'Not enough loyalty counters.');
  s = act(s, 'activate', { card: j.id, ability: 0 });
  assert.equal(s.objects[j.id], undefined);
  s = resolve(s);
  assert.equal(s.choice.kind, 'libraryOrder');
});
test('loyalty abilities are sorcery-speed, once per permanent per turn across indices; damage removes loyalty', () => {
  let s = fixture();
  let j = put(s, 'Jace Token');
  j.loyalty = 6;
  s = act(s, 'activate', { card: j.id, ability: 1 });
  s = resolve(s);
  assert.equal(s.objects[j.id].loyalty, 3);
  assert.match(abilityProblem(s, 0, j.id, 0, null), /already/);
  s.turn++;
  s.step = 'upkeep';
  assert.match(abilityProblem(s, 0, j.id, 0, null), /sorcery/);
  s.step = 'main1';
  assert.equal(abilityProblem(s, 0, j.id, 0, null), null);
  j = s.objects[j.id];
  dealDamage(s, { id: 'burn', controller: 1, keywords: ['deathtouch'] }, ref(j), 1);
  stabilize(s);
  assert.equal(j.loyalty, 2);
  assert.equal(j.damage, 0);
  assert.equal(j.zone, 'battlefield');
  dealDamage(s, { id: 'burn', controller: 1, keywords: [] }, ref(j), 2);
  stabilize(s);
  assert.equal(j.zone, 'graveyard');
});
test('Empower chooses among tokens, ignores non-token Jaces, rejects invalid selections', () => {
  let s = fixture();
  const a = put(s, 'Jace Token'),
    b = put(s, 'Jace Token');
  a.loyalty = 2;
  b.loyalty = 3;
  const spell = put(s, 'No Admittance', 0, 'hand');
  lands(s, 'Mountain', 2);
  s = act(s, 'cast', { card: spell.id, target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.choice.kind, 'empowerJace');
  assert.equal(s.choice.cards.length, 2);
  assert.equal(dispatch(s, { type: 'chooseResolutionCard', player: 0, card: null }).ok, false);
  s = act(s, 'chooseResolutionCard', { card: b.id });
  assert.equal(s.objects[a.id].loyalty, 2);
  assert.equal(s.objects[b.id].loyalty, 4);
});
test('any target and player-or-planeswalker accept only appropriate objects and exact incarnations', () => {
  const s = fixture(),
    j = put(s, 'Jace Token', 1),
    creature = put(s, 'Llanowar Elves', 1),
    land = put(s, 'Forest', 1);
  j.loyalty = 2;
  assert.ok(legalTarget(s, 'any', ref(j), 0));
  assert.ok(legalTarget(s, { scope: 'playerOrPlaneswalker' }, ref(j), 0));
  assert.equal(legalTarget(s, { scope: 'playerOrPlaneswalker' }, ref(creature), 0), false);
  assert.equal(legalTarget(s, 'any', ref(land), 0), false);
  const old = ref(j);
  move(s, j, 'exile');
  move(s, j, 'battlefield');
  assert.equal(legalTarget(s, 'any', old, 0), false);
  assert.equal(j.loyalty, 0);
});
test('all illegal targets fizzle No Admittance including Empower', () => {
  let s = fixture();
  const target = put(s, 'Llanowar Elves', 1),
    spell = put(s, 'No Admittance', 0, 'hand');
  lands(s, 'Mountain', 2);
  s = act(s, 'cast', { card: spell.id, target: ref(target) });
  move(s, s.objects[target.id], 'graveyard');
  s = resolve(s);
  assert.equal(
    Object.values(s.objects).some((o) => o.name === 'Jace Token'),
    false,
  );
});
test('printed loyalty enters, zero loyalty ignores indestructible, legendary names not subtype apply', () => {
  const d = {
    name: 'Test Jace',
    type: 'planeswalker',
    cost: { U: 1 },
    loyalty: 3,
    legendary: true,
    subtypes: ['Jace'],
    keywords: ['indestructible'],
    activated: [{ cost: {}, loyalty: 1, effects: [{ op: 'draw', count: 1 }], text: '+1: Draw' }],
  };
  const s = fixture();
  s.catalog = createRegistry({ ...CARDS, [d.name]: d });
  const a = put(s, d.name),
    b = put(s, d.name);
  assert.equal(a.loyalty, 3);
  stabilize(s);
  assert.equal(s.choice.kind, 'legendRule');
  s.choice = null;
  move(s, b, 'graveyard');
  a.loyalty = 0;
  stabilize(s);
  assert.equal(a.zone, 'graveyard');
});

test('Empower ignores nontoken Jaces and existing token copies use subtype rather than name', () => {
  let s = fixture();
  const native = { ...CARDS['Jace Token'], name: 'Nontoken Jace', token: false, loyalty: 4 };
  const copy = { ...CARDS['Jace Token'], name: 'Copied Jace', loyalty: 2 };
  s.catalog = createRegistry({ ...CARDS, [native.name]: native, [copy.name]: copy });
  const n = put(s, native.name),
    j = put(s, copy.name);
  const card = put(s, 'No Admittance', 0, 'hand');
  lands(s, 'Mountain', 2);
  s = act(s, 'cast', { card: card.id, target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.equal(s.objects[n.id].loyalty, 4);
  assert.equal(s.objects[j.id].loyalty, 3);
  assert.equal(Object.values(s.objects).filter((o) => o.name === 'Jace Token').length, 0);
});
test('loyalty paid on activation remains paid when countered, and blink resets activation allowance', () => {
  const d = {
    name: 'Test Walker',
    type: 'planeswalker',
    cost: { U: 1 },
    loyalty: 2,
    activated: [
      { cost: {}, loyalty: 1, effects: [{ op: 'draw', count: 1 }], text: '+1: Draw' },
      { cost: {}, loyalty: 0, effects: [{ op: 'draw', count: 1 }], text: '0: Draw' },
    ],
  };
  let s = fixture();
  s.catalog = createRegistry({ ...CARDS, [d.name]: d });
  const j = put(s, d.name);
  s = act(s, 'activate', { card: j.id, ability: 0 });
  assert.equal(s.objects[j.id].loyalty, 3);
  s.stack.pop();
  assert.match(abilityProblem(s, 0, j.id, 1, null), /already/);
  move(s, s.objects[j.id], 'exile');
  move(s, s.objects[j.id], 'battlefield');
  assert.equal(s.objects[j.id].loyalty, 2);
  assert.equal(abilityProblem(s, 0, j.id, 1, null), null);
});
test('player-or-planeswalker damage and ETB any-target damage remove loyalty without hurting its controller', () => {
  const burn = {
    name: 'Walker Burn',
    type: 'instant',
    cost: { R: 1 },
    target: { scope: 'playerOrPlaneswalker' },
    effects: [{ op: 'damage', amount: 4 }],
  };
  let s = fixture();
  s.catalog = createRegistry({ ...CARDS, [burn.name]: burn });
  const j = put(s, 'Jace Token', 1);
  j.loyalty = 9;
  let card = put(s, burn.name, 0, 'hand');
  lands(s, 'Mountain', 2);
  s = act(s, 'cast', { card: card.id, target: ref(j) });
  s = resolve(s);
  assert.equal(s.objects[j.id].loyalty, 5);
  assert.equal(s.players[1].life, 20);
  card = put(s, 'Viashino Pyromancer', 0, 'hand');
  lands(s, 'Mountain', 2);
  s = act(s, 'cast', { card: card.id });
  s = resolve(s);
  assert.equal(s.choice.kind, 'triggerTarget');
  s = act(s, 'chooseTriggerTarget', { target: ref(s.objects[j.id]) });
  s = resolve(s);
  assert.equal(s.objects[j.id].loyalty, 3);
  assert.equal(s.players[1].life, 20);
});

test('planeswalker creation, loyalty costs and resolving choice replay exactly', () => {
  const spell = { ...CARDS['No Admittance'], cost: {} };
  const catalog = createRegistry({ ...CARDS, [spell.name]: spell });
  let s = createGame({
    catalog,
    mulligan: false,
    minimumDeckSize: 8,
    decks: [
      [...Array(4).fill(spell.name), ...Array(4).fill('Mountain')],
      Array(8).fill('Mountain'),
    ],
  });
  for (let i = 0; i < 8 && s.step !== 'main1'; i++) s = act(s, 'pass');
  const card = s.players[0].hand.find((id) => s.objects[id].name === spell.name);
  s = act(s, 'cast', { card, target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.deepEqual(replay(exportReplay(s)), s);
  const j = Object.values(s.objects).find((o) => o.name === 'Jace Token');
  s = act(s, 'activate', { card: j.id, ability: 0 });
  assert.deepEqual(replay(exportReplay(s)), s);
  s = resolve(s);
  assert.equal(s.choice.kind, 'libraryOrder');
  assert.deepEqual(replay(exportReplay(s)), s);
});
