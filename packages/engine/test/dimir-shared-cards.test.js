import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, dispatch, ref, stats, chooseBotCommand, legalActions } from '../src/index.js';
import { notifyTriggers, move } from '../src/model.js';
import { enterBattlefield, stabilize, legalTarget } from '../src/effects.js';
import { fixture, put, lands, act, resolve } from './helpers.js';

test('Duress reveals but never offers creatures or lands, and bot selects a legal card', () => {
  let s = fixture();
  const d = put(s, 'Duress', 0, 'hand');
  const creature = put(s, 'Llanowar Elves', 1, 'hand');
  const land = put(s, 'Forest', 1, 'hand');
  const spell = put(s, 'Unsummon', 1, 'hand');
  lands(s, 'Swamp', 1);
  s = act(s, 'cast', { card: d.id, target: { kind: 'player', id: 1 } });
  s = resolve(s);
  assert.deepEqual(s.choice.eligibleCards, [spell.id]);
  assert.ok(s.choice.cards.includes(creature.id) && s.choice.cards.includes(land.id));
  assert.equal(
    dispatch(s, { type: 'chooseResolutionCard', player: 0, card: creature.id }).ok,
    false,
  );
  const cmd = chooseBotCommand(s, 0);
  assert.equal(cmd.card, spell.id);
  s = act(s, 'chooseResolutionCard', { card: spell.id });
  assert.equal(s.objects[spell.id].zone, 'graveyard');
});

test('Wan Shi Tong uses chosen X across entry, rounds down draws, and no X when returned', () => {
  let s = fixture();
  const w = put(s, 'Wan Shi Tong, Librarian', 0, 'hand');
  lands(s, 'Island', 7);
  s = act(s, 'cast', { card: w.id, x: 5 });
  s = resolve(s);
  assert.equal(s.stack.length, 1);
  s = resolve(s);
  assert.equal(s.objects[w.id].plusCounters, 5);
  assert.equal(s.players[0].hand.length, 2);
  assert.equal(stats(s, s.objects[w.id]).power, 6);
  const o = s.objects[w.id];
  move(s, o, 'exile');
  enterBattlefield(s, o, 0);
  stabilize(s);
  s = resolve(s);
  assert.equal(s.objects[w.id].plusCounters, 0);
  assert.equal(s.players[0].hand.length, 2);
});

test('Wan Shi Tong observes opponent searches even when no card is found, not its controller searches', () => {
  let s = fixture();
  const w = put(s, 'Wan Shi Tong, Librarian');
  notifyTriggers(s, 'librarySearch', { player: 0 });
  assert.equal(s.pendingTriggers.length, 0);
  notifyTriggers(s, 'librarySearch', { player: 1 });
  stabilize(s);
  s = resolve(s);
  assert.equal(s.objects[w.id].plusCounters, 1);
  assert.equal(s.players[0].hand.length, 1);
});

test('Theorist triggers at opponent draw step and creates the correct nonflying Illusion', () => {
  let s = fixture();
  const j = put(s, 'The Theorist, Jace Beleren');
  notifyTriggers(s, 'step', { player: 0, step: 'draw' });
  assert.equal(s.pendingTriggers.length, 0);
  notifyTriggers(s, 'step', { player: 1, step: 'draw' });
  stabilize(s);
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 1);
  s = act(s, 'activate', { card: j.id, ability: 0 });
  s = resolve(s);
  const token = Object.values(s.objects).find((o) => o.name === 'Jace Illusion Token');
  assert.equal(stats(s, token).power, 1);
  assert.deepEqual(CARDS[token.name].color, ['U']);
  assert.equal(CARDS[token.name].keywords?.includes('flying') ?? false, false);
});

test('Theorist ultimate counts hand after drawing three for all friendly creatures', () => {
  let s = fixture();
  const j = put(s, 'The Theorist, Jace Beleren');
  j.loyalty = 6;
  const elf = put(s, 'Llanowar Elves'),
    enemy = put(s, 'Llanowar Elves', 1);
  put(s, 'Forest', 0, 'hand');
  s = act(s, 'activate', { card: j.id, ability: 2 });
  s = resolve(s);
  assert.equal(s.players[0].hand.length, 4);
  assert.equal(s.objects[elf.id].plusCounters, 4);
  assert.equal(s.objects[enemy.id].plusCounters, 0);
});

test('Shoot the Sheriff excludes every outlaw subtype, not just Rogues', () => {
  const s = fixture();
  const selector = CARDS['Shoot the Sheriff'].target;
  const elf = put(s, 'Llanowar Elves', 1),
    rogue = put(s, 'Audacious Thief', 1);
  assert.equal(legalTarget(s, selector, ref(elf), 0), true);
  assert.equal(legalTarget(s, selector, ref(rogue), 0), false);
});
