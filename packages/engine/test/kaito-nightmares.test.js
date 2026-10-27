import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, legalActions, chooseBotCommand, playerView, CARDS } from '../src/index.js';
import { move, ref, definition, stats, keywords, loseLife, addModifier } from '../src/model.js';
import { resolveTop, stabilize, dealDamage, legalTarget } from '../src/effects.js';
import { declareAttackers, declareBlockers, beginDamage, attackDefender } from '../src/combat.js';
import { fixture, put, act, lands, resolve } from './helpers.js';
const NAME = 'Kaito, Bane of Nightmares';
function setup() {
  const s = fixture();
  const kaito = put(s, NAME, 0, 'hand'),
    attacker = put(s, 'Savannah Lions');
  lands(s, 'Island', 1);
  lands(s, 'Swamp', 2);
  s.step = 'attackers';
  declareAttackers(s, [attacker.id]);
  s.step = 'blockers';
  declareBlockers(s, []);
  return { s, kaito, attacker };
}
function activate(s, k, a) {
  return act(s, 'ninjutsu', { card: k.id, attacker: ref(a) });
}
function settle(s) {
  resolveTop(s);
  stabilize(s);
}
test('Kaito enters as a legendary 3/4 Ninja only during controller turn, with four loyalty and hexproof', () => {
  const s = fixture(),
    k = put(s, NAME);
  assert.deepEqual(definition(s, k).types, ['creature']);
  assert.deepEqual(definition(s, k).subtypes, ['Ninja']);
  assert.equal(k.loyalty, 4);
  assert.deepEqual(stats(s, k), { power: 3, toughness: 4 });
  assert.ok(keywords(s, k).includes('hexproof'));
  assert.equal(legalTarget(s, 'creature', ref(k), 1), false);
  dealDamage(s, { controller: 1, keywords: [] }, ref(k), 2);
  assert.equal(k.loyalty, 4);
  assert.equal(k.damage, 2);
  s.active = 1;
  assert.deepEqual(definition(s, k).types, ['planeswalker']);
  assert.deepEqual(stats(s, k), { power: 0, toughness: 0 });
  dealDamage(s, { controller: 1, keywords: [] }, ref(k), 2);
  assert.equal(k.loyalty, 2);
  s.active = 0;
  k.loyalty = 0;
  stabilize(s);
  assert.equal(k.zone, 'graveyard');
});
test('ninjutsu is a hand activation, pays return immediately, reveals source, enters tapped attacking, never casts', () => {
  let { s, kaito: k, attacker: a } = setup();
  const handInc = k.incarnation;
  s = activate(s, k, a);
  assert.equal(s.objects[a.id].zone, 'hand');
  assert.equal(s.objects[k.id].zone, 'hand');
  assert.equal(s.stack.at(-1).kind, 'ability');
  assert.equal(playerView(s, 1).objects[k.id].name, NAME);
  assert.equal(
    s.events.some((e) => e.type === 'cast'),
    false,
  );
  settle(s);
  k = s.objects[k.id];
  assert.equal(k.zone, 'battlefield');
  assert.equal(k.incarnation, handInc + 1);
  assert.equal(k.tapped, true);
  assert.ok(s.combat.attackers.some((r) => r.id === k.id));
  assert.equal(k.loyalty, 4);
  assert.deepEqual(attackDefender(s, k.id), { kind: 'player', id: 1 });
  assert.equal(
    s.events.some((e) => e.type === 'attack' && e.objectId === k.id),
    false,
  );
});
test('blocked attacker never becomes eligible when blockers leave; blockers-choice and preblock timing reject atomically', () => {
  let { s, kaito: k, attacker: a } = setup();
  const before = structuredClone(s);
  for (const step of ['attackers', 'beginCombat', 'main2']) {
    s.step = step;
    assert.equal(
      dispatch(s, { type: 'ninjutsu', player: 0, card: k.id, attacker: ref(a) }).ok,
      false,
    );
  }
  s.step = 'blockers';
  s.choice = { kind: 'blockers', player: 1 };
  assert.equal(
    dispatch(s, { type: 'ninjutsu', player: 0, card: k.id, attacker: ref(a) }).ok,
    false,
  );
  s.choice = null;
  const blocker = put(s, 'Savannah Lions', 1);
  declareBlockers(s, [{ attacker: a.id, blocker: blocker.id }]);
  move(s, blocker, 'graveyard');
  const snapshot = structuredClone(s);
  assert.equal(
    dispatch(s, { type: 'ninjutsu', player: 0, card: k.id, attacker: ref(a) }).ok,
    false,
  );
  assert.deepEqual(s, snapshot);
  s = before;
  const stale = ref(s.objects[a.id]);
  move(s, s.objects[a.id], 'hand');
  move(s, s.objects[a.id], 'battlefield');
  assert.equal(dispatch(s, { type: 'ninjutsu', player: 0, card: k.id, attacker: stale }).ok, false);
});
test('source leaving and returning to hand cannot satisfy an old ninjutsu activation', () => {
  let { s, kaito: k, attacker: a } = setup();
  s = activate(s, k, a);
  k = s.objects[k.id];
  move(s, k, 'exile');
  move(s, k, 'hand');
  settle(s);
  assert.equal(k.zone, 'hand');
});
test('ninjutsu preserves exact planeswalker defender even when it leaves and returns', () => {
  let { s, kaito: k, attacker: a } = setup();
  const pw = put(s, 'The Theorist, Jace Beleren', 1),
    old = ref(pw);
  s.combat.defenders = { [a.id]: old };
  s = activate(s, k, a);
  move(s, s.objects[pw.id], 'exile');
  move(s, s.objects[pw.id], 'battlefield');
  settle(s);
  assert.equal(s.objects[k.id].zone, 'battlefield');
  assert.equal(s.objects[k.id].tapped, true);
  assert.equal(
    s.combat.attackers.some((r) => r.id === k.id),
    false,
  );
});
test('first strike attacker can deal damage then be returned; ninjutsu entrant deals normal combat damage', () => {
  let { s, kaito: k, attacker: a } = setup();
  addModifier(s, {
    objectId: a.id,
    incarnation: a.incarnation,
    keywords: ['first strike'],
    permanent: true,
  });
  s.step = 'firstDamage';
  beginDamage(s, true);
  s = dispatch(s, chooseBotCommand(s, 0)).state;
  assert.equal(s.players[1].life, 18);
  s = activate(s, k, a);
  settle(s);
  s.step = 'damage';
  beginDamage(s, false);
  s = dispatch(s, chooseBotCommand(s, 0)).state;
  assert.equal(s.players[1].life, 15);
});
test('Kaito emblem is persistent, cumulative, Ninja-only and does not trigger Chandra spell damage', () => {
  let s = fixture();
  let k = put(s, NAME),
    non = put(s, 'Savannah Lions');
  s = act(s, 'activate', { card: k.id, ability: 0 });
  settle(s);
  k = s.objects[k.id];
  assert.deepEqual(stats(s, k), { power: 4, toughness: 5 });
  assert.equal(stats(s, s.objects[non.id]).power, 2);
  s.turn++;
  s = act(s, 'activate', { card: k.id, ability: 0 });
  settle(s);
  k = s.objects[k.id];
  assert.equal(stats(s, k).power, 5);
  move(s, k, 'graveyard');
  const fresh = put(s, NAME);
  assert.equal(stats(s, fresh).power, 5);
  const spell = put(s, 'Opt', 0, 'hand');
  lands(s, 'Island', 1);
  s = act(s, 'cast', { card: spell.id });
  assert.equal(s.pendingTriggers.length, 0);
  assert.equal(s.stack.length, 1);
});
test('ability loss retains Kaito layer4 and7 creature characteristics but strips hexproof and loyalty abilities', () => {
  const s = fixture(),
    k = put(s, NAME);
  addModifier(s, {
    objectId: k.id,
    incarnation: k.incarnation,
    removeAbilities: true,
    permanent: true,
  });
  assert.equal(definition(s, k).type, 'creature');
  assert.deepEqual(stats(s, k), { power: 3, toughness: 4 });
  assert.equal(keywords(s, k).includes('hexproof'), false);
  assert.equal(definition(s, k).activated, undefined);
  s.active = 1;
  assert.equal(definition(s, k).type, 'planeswalker');
  s.active = 0;
  assert.equal(definition(s, k).type, 'creature');
});
test('surveil pauses before draw, draws only for actual life loss this turn, and stun ability adds exactly two', () => {
  for (const lost of [false, true]) {
    let s = fixture();
    const k = put(s, NAME);
    if (lost) loseLife(s, 1, 1);
    const before = s.players[0].hand.length;
    s = act(s, 'activate', { card: k.id, ability: 1 });
    settle(s);
    assert.equal(s.choice.kind, 'libraryOrder');
    assert.equal(s.players[0].hand.length, before);
    s = act(s, 'orderLibrary', { top: s.choice.cards, rest: [] });
    assert.equal(s.players[0].hand.length, before + (lost ? 1 : 0));
  }
  let s = fixture();
  const k = put(s, NAME),
    victim = put(s, 'Savannah Lions', 1);
  s = act(s, 'activate', { card: k.id, ability: 2, target: ref(victim) });
  settle(s);
  assert.equal(s.objects[victim.id].tapped, true);
  assert.equal(s.objects[victim.id].stunCounters, 2);
  assert.equal(s.objects[k.id].loyalty, 2);
});
test('bot uses real ninjutsu and prioritizes an enemy stun target over friendly creatures', () => {
  let { s, kaito: k } = setup();
  assert.equal(chooseBotCommand(s, 0).type, 'ninjutsu');
  s = fixture();
  k = put(s, NAME);
  const enemy = put(s, 'Serra Angel', 1);
  const action = chooseBotCommand(s, 0);
  assert.equal(action.type, 'activate');
  assert.equal(action.ability, 2);
  assert.equal(action.target.id, enemy.id);
});

test('Kaito compiler roundtrip, replayed ninjutsu, player observations and loyalty emblem remain deterministic', async () => {
  const { compileCard, canonical } = await import('../../cards/compiler.js');
  const { sourceFromDefinition } = await import('../../cards/from-native.js');
  const { exportReplay, replay } = await import('../src/index.js');
  const { kaitoPosition } = await import('../../../tests/helpers/kaito-position.js');
  const compiled = compileCard(sourceFromDefinition(CARDS[NAME], { id: 'test:kaito' }));
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  assert.deepEqual(canonical(compiled.definition), canonical(CARDS[NAME]));
  let s = kaitoPosition();
  const action = legalActions(s, 0).find((a) => a.type === 'ninjutsu');
  s = act(s, 'ninjutsu', action);
  const before = exportReplay(s);
  assert.deepEqual(playerView(replay(before), 1), playerView(s, 1));
  s = resolve(s);
  while (s.choice || s.step !== 'main2' || s.stack.length) {
    const p = s.choice?.player ?? s.priority;
    const command = s.choice ? chooseBotCommand(s, p) : { type: 'pass', player: p };
    const r = dispatch(s, command);
    assert.equal(r.ok, true);
    s = r.state;
  }
  s = act(s, 'activate', { card: action.card, ability: 0 }, 0);
  s = resolve(s);
  assert.equal(s.emblems.at(-1).kind, 'anthem');
  assert.deepEqual(playerView(replay(exportReplay(s)), 0), playerView(s, 0));
});
test('countered ninjutsu keeps the paid attacker in hand; insufficient mana rejects without revealing or returning', () => {
  let { s, kaito: k, attacker: a } = setup();
  for (const o of Object.values(s.objects))
    if (['Island', 'Swamp'].includes(o.name)) o.tapped = true;
  const before = structuredClone(s);
  assert.equal(
    dispatch(s, { type: 'ninjutsu', player: 0, card: k.id, attacker: ref(a) }).ok,
    false,
  );
  assert.deepEqual(s, before);
  for (const o of Object.values(s.objects))
    if (['Island', 'Swamp'].includes(o.name)) o.tapped = false;
  s = activate(s, k, a);
  s.stack.pop();
  stabilize(s);
  assert.equal(s.objects[k.id].zone, 'hand');
  assert.equal(s.objects[a.id].zone, 'hand');
  assert.equal(playerView(s, 1).objects[k.id], undefined);
});

test('a Kaito returned after first strike and ninjutsu-ed back is a new object eligible for normal damage', () => {
  let s = fixture();
  const a = put(s, NAME),
    b = put(s, NAME, 0, 'hand');
  lands(s, 'Island', 4);
  lands(s, 'Swamp', 4);
  addModifier(s, {
    objectId: a.id,
    incarnation: a.incarnation,
    keywords: ['first strike'],
    permanent: true,
  });
  s.step = 'attackers';
  declareAttackers(s, [a.id]);
  s.step = 'blockers';
  declareBlockers(s, []);
  s.step = 'firstDamage';
  beginDamage(s, true);
  s = dispatch(s, chooseBotCommand(s, 0)).state;
  assert.equal(s.players[1].life, 17);
  s = activate(s, s.objects[b.id], s.objects[a.id]);
  settle(s);
  s = activate(s, s.objects[a.id], s.objects[b.id]);
  settle(s);
  s.step = 'damage';
  beginDamage(s, false);
  s = dispatch(s, chooseBotCommand(s, 0)).state;
  assert.equal(s.players[1].life, 14);
});
