import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseBotCommand, ref, dispatch, playerView } from '../packages/engine/src/index.js';
import { chooseBlocks, combatOutcome } from '../packages/engine/src/combat-policy.js';
import { fixture, put, lands } from '../packages/engine/test/helpers.js';
test('menace blocking searches beyond two creatures when survival requires it', () => {
  const s = fixture();
  s.active = 0;
  s.priority = 1;
  s.players[1].life = 3;
  const sire = put(s, 'Sire of Seven Deaths', 0);
  for (let i = 0; i < 6; i++) put(s, 'Soldier Token', 1);
  s.combat.attackers = [ref(sire)];
  s.choice = { kind: 'blockers', player: 1 };
  const cmd = chooseBotCommand(s, 1);
  assert.ok(cmd.pairs.length >= 5);
  assert.ok(combatOutcome(s, cmd.pairs).life[1] > 0);
  assert.equal(dispatch(s, cmd).ok, true);
});
test('Thermo-Alchemist preserves the only blocker that prevents lethal next turn', () => {
  const s = fixture();
  s.players[0].life = 3;
  put(s, 'Thermo-Alchemist', 0);
  put(s, 'Centaur Courser', 1);
  const command = chooseBotCommand(s, 0);
  assert.notEqual(command.type, 'activate');
});
test('a lethal ping is still taken instead of preserving a blocker', () => {
  const s = fixture();
  s.players[0].life = 3;
  s.players[1].life = 1;
  put(s, 'Thermo-Alchemist', 0);
  put(s, 'Centaur Courser', 1);
  const command = chooseBotCommand(s, 0);
  assert.equal(command.type, 'activate');
});
test('deploy a prowess threat before a nonlethal Shock when both are affordable', () => {
  const s = fixture();
  lands(s, 'Mountain', 2);
  const spear = put(s, 'Monastery Swiftspear', 0, 'hand');
  put(s, 'Shock', 0, 'hand');
  put(s, 'Grizzly Bears', 1);
  assert.equal(chooseBotCommand(s, 0).card, spear.id);
});
test('take lethal Shock rather than spending mana on Swiftspear first', () => {
  const s = fixture();
  lands(s, 'Mountain', 2);
  put(s, 'Monastery Swiftspear', 0, 'hand');
  const shock = put(s, 'Shock', 0, 'hand');
  s.players[1].life = 2;
  assert.equal(chooseBotCommand(s, 0).card, shock.id);
});
