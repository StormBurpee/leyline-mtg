import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARDS,
  createRegistry,
  dispatch,
  isSick,
  canTapForMana,
  legalActions,
} from '../src/index.js';
import { nextTurn } from '../src/turn.js';
import { fixture, put, act } from './helpers.js';

test('a creature remains summoning-sick throughout the opponent’s intervening turn', () => {
  const state = fixture(),
    elf = put(state, 'Llanowar Elves', 0, 'battlefield', { ready: false });
  assert.equal(isSick(state, elf), true);
  nextTurn(state);
  assert.equal(state.active, 1);
  assert.equal(state.turn, 4);
  state.priority = 0;
  assert.equal(isSick(state, elf), true);
  assert.equal(canTapForMana(state, elf, 0), false);
  assert.equal(dispatch(state, { type: 'tapMana', player: 0, card: elf.id }).ok, false);
  nextTurn(state);
  assert.equal(state.active, 0);
  assert.equal(isSick(state, elf), false);
  assert.equal(canTapForMana(state, elf, 0), true);
});
test('a flashed-in creature becomes ready at its controller’s immediately following turn', () => {
  const state = fixture();
  state.active = 1;
  state.turn = 4;
  const elf = put(state, 'Llanowar Elves', 0, 'battlefield', { ready: false });
  assert.equal(isSick(state, elf), true);
  nextTurn(state);
  assert.equal(state.active, 0);
  assert.equal(isSick(state, elf), false);
});
test('tap-cost non-mana abilities obey the same controller-turn boundary', () => {
  const state = fixture(),
    looter = put(state, 'Merfolk Looter', 0, 'battlefield', { ready: false });
  nextTurn(state);
  state.priority = 0;
  assert.equal(
    legalActions(state, 0).some((a) => a.type === 'activate' && a.card === looter.id),
    false,
  );
  assert.equal(
    dispatch(state, { type: 'activate', player: 0, card: looter.id, ability: 0 }).ok,
    false,
  );
  nextTurn(state);
  assert.equal(
    legalActions(state, 0).some((a) => a.type === 'activate' && a.card === looter.id),
    true,
  );
});
test('haste permits tapping on either turn without changing control timestamps', () => {
  const state = fixture();
  state.catalog = createRegistry({
    ...CARDS,
    Hasty: {
      name: 'Hasty',
      type: 'creature',
      cost: {},
      power: 1,
      toughness: 1,
      keywords: ['haste'],
      mana: 'G',
    },
  });
  const source = put(state, 'Hasty', 0, 'battlefield', { ready: false });
  assert.equal(canTapForMana(state, source, 0), true);
  nextTurn(state);
  assert.equal(canTapForMana(state, source, 0), true);
});
test('noncreature mana artifacts are not constrained by summoning sickness', () => {
  const state = fixture(),
    stone = put(state, 'Darksteel Ingot', 0, 'battlefield', { ready: false });
  assert.equal(canTapForMana(state, stone, 0), true);
  const next = act(state, 'tapMana', { card: stone.id, color: 'U' });
  assert.equal(next.players[0].mana.U, 1);
});
