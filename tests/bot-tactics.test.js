import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseBotCommand, ref, dispatch, playerView } from '../packages/engine/src/index.js';
import { chooseBotCommand as released } from './fixtures/v0.22-policy/bot.js';
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

test('reserve a blocker against a public attack-trigger boost on the return attack', () => {
  const s = fixture();
  const bear = put(s, 'Grizzly Bears', 0);
  const jumbo = put(s, 'Jumbo Cactuar', 1);
  jumbo.tapped = true;
  s.players[0].life = 10;
  s.choice = { kind: 'attackers', player: 0 };
  assert.deepEqual(released(s, 0).cards, [bear.id]);
  assert.deepEqual(chooseBotCommand(s, 0).cards, []);
});

test('tap abilities preserve a blocker against a public attack-trigger lethal', () => {
  const s = fixture();
  put(s, 'Thermo-Alchemist', 0);
  put(s, 'Jumbo Cactuar', 1);
  assert.equal(released(s, 0).type, 'activate');
  assert.notEqual(chooseBotCommand(s, 0).type, 'activate');
});

test('do not spend a second Pacifism on a creature already unable to attack or block', () => {
  const s = fixture();
  lands(s, 'Plains', 2);
  const bear = put(s, 'Grizzly Bears', 1);
  const aura = put(s, 'Pacifism', 0);
  aura.attachedTo = ref(bear);
  put(s, 'Pacifism', 0, 'hand');
  assert.equal(released(s, 0).type, 'cast');
  assert.equal(chooseBotCommand(s, 0).type, 'pass');
});

test('ordinary development waits for main two while a known combat trick stays available', () => {
  const s = fixture();
  lands(s, 'Forest', 2);
  put(s, 'Grizzly Bears', 0);
  put(s, 'Grizzly Bears', 1);
  const handBear = put(s, 'Grizzly Bears', 0, 'hand');
  put(s, 'Giant Growth', 0, 'hand');
  assert.equal(chooseBotCommand(s, 0).type, 'pass');
  s.step = 'main2';
  assert.equal(chooseBotCommand(s, 0).card, handBear.id);
});

test('attack with the entire evasive group on a wide, stalled ground board', () => {
  const s = fixture();
  for (let i = 0; i < 4; i++) put(s, 'Grizzly Bears', 0);
  const flyers = [put(s, 'Stormchaser Mage', 0), put(s, 'Stormchaser Mage', 0)];
  for (let i = 0; i < 3; i++) put(s, 'Colossal Dreadmaw', 1);
  s.players[0].life = 30;
  s.choice = { kind: 'attackers', player: 0 };
  assert.equal(released(s, 0).cards.length, 1);
  assert.deepEqual(
    chooseBotCommand(s, 0).cards,
    flyers.map((o) => o.id),
  );
});

test('attack into a larger blocker when a known affordable trick wins the exchange', () => {
  const s = fixture();
  lands(s, 'Forest', 1);
  const bear = put(s, 'Grizzly Bears', 0);
  put(s, 'Centaur Courser', 1);
  put(s, 'Giant Growth', 0, 'hand');
  s.choice = { kind: 'attackers', player: 0 };
  assert.deepEqual(released(s, 0).cards, []);
  const before = structuredClone(s);
  assert.deepEqual(chooseBotCommand(s, 0).cards, [bear.id]);
  assert.deepEqual(s, before);
  s.objects[
    Object.values(s.objects).find((o) => o.name === 'Forest' && o.zone === 'battlefield').id
  ].tapped = true;
  assert.deepEqual(chooseBotCommand(s, 0).cards, []);
});

test('an attacking mana creature cannot also pay for its forecast combat trick', () => {
  const s = fixture();
  put(s, 'Llanowar Elves', 0);
  put(s, 'Grizzly Bears', 1);
  put(s, 'Giant Growth', 0, 'hand');
  s.choice = { kind: 'attackers', player: 0 };
  assert.deepEqual(chooseBotCommand(s, 0).cards, []);
});
