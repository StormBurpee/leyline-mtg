import test from 'node:test';
import assert from 'node:assert/strict';
import { autoCommand, updateYield, stopKey, advanceLabel } from '../apps/web/priority-policy.js';
import { fixture, put, lands } from '../packages/engine/test/helpers.js';
const ui = () => ({
  autoYield: true,
  controlMode: 'smart',
  stops: {},
  autoOrderTriggers: true,
  autoDamage: true,
});
test('main phases remain deliberate; empty upkeep can advance', () => {
  const s = fixture();
  assert.equal(autoCommand(s, 0, ui()), null);
  s.step = 'upkeep';
  assert.equal(autoCommand(s, 0, ui()).type, 'pass');
});
test('full control, selection and newly placed stops override every automated pass', () => {
  const s = fixture();
  s.step = 'upkeep';
  for (const extra of [
    { controlMode: 'full' },
    { selected: 'c1' },
    { targeting: true },
    { stops: { [stopKey(s, 0)]: true } },
  ])
    assert.equal(autoCommand(s, 0, { ...ui(), ...extra }), null);
});
test('an actual response window is preserved even when mana abilities are plentiful', () => {
  const s = fixture();
  s.active = 1;
  s.step = 'main1';
  put(s, 'Shock', 0, 'hand');
  lands(s, 'Mountain', 1);
  s.stack = [{ id: 'pending', controller: 1 }];
  assert.equal(autoCommand(s, 0, ui()), null);
});
test('pass-until-response stops on a new opposing stack entry, not on ordinary priority changes', () => {
  const s = fixture(),
    u = { ...ui(), yieldMode: 'response', yieldTurn: s.turn };
  const next = structuredClone(s);
  next.stack = [{ id: 'incoming', controller: 1 }];
  updateYield(s, next, 0, u);
  assert.equal(u.yieldMode, null);
});
test('pass turn ignores new responses but expires at the next turn', () => {
  const s = fixture(),
    u = { ...ui(), yieldMode: 'turn', yieldTurn: s.turn };
  const next = structuredClone(s);
  next.stack = [{ id: 'incoming', controller: 1 }];
  updateYield(s, next, 0, u);
  assert.equal(u.yieldMode, 'turn');
  next.turn++;
  updateYield(s, next, 0, u);
  assert.equal(u.yieldMode, null);
});
test('automatic ordering never makes target or optional-effect choices', () => {
  const s = fixture();
  for (const kind of [
    'triggerTarget',
    'optionalEffect',
    'effectChoice',
    'attackers',
    'blockers',
    'discardEffect',
  ]) {
    s.choice = { kind, player: 0 };
    assert.equal(autoCommand(s, 0, ui()), null);
  }
  s.choice = { kind: 'orderTriggers', player: 0, entries: [{ id: 'one' }, { id: 'two' }] };
  assert.deepEqual(autoCommand(s, 0, ui()), { type: 'orderTriggers', ids: ['one', 'two'] });
});
test('contextual advance labels distinguish combat, end turn and response', () => {
  const s = fixture();
  assert.equal(advanceLabel(s, 0), 'To combat');
  s.step = 'main2';
  assert.equal(advanceLabel(s, 0), 'End turn');
  s.stack = [{ controller: 1 }];
  assert.equal(advanceLabel(s, 0), 'Resolve opponent’s effect');
});
