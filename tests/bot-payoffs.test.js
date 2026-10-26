import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseBotCommand, ref } from '../packages/engine/src/index.js';
import { combatOutcome } from '../packages/engine/src/combat-policy.js';
import { fixture, put } from '../packages/engine/test/helpers.js';

test('block with Blood Artist when its death drain wins the game', () => {
  const s = fixture();
  s.players[0].life = 1;
  const attacker = put(s, 'Grizzly Bears', 0);
  const artist = put(s, 'Blood Artist', 1);
  s.combat.attackers = [ref(attacker)];
  s.choice = { kind: 'blockers', player: 1 };
  const before = structuredClone(s);
  const command = chooseBotCommand(s, 1);
  assert.deepEqual(command.pairs, [{ blocker: artist.id, attacker: attacker.id }]);
  const result = combatOutcome(s, command.pairs);
  assert.equal(result.winner, 1);
  assert.deepEqual(result.life, [0, 21]);
  assert.deepEqual(s, before, 'search must not mutate the live game');
});

test('simultaneous token and Artist deaths each contribute their drain', () => {
  const s = fixture();
  s.players[0].life = 2;
  const attacker = put(s, 'Centaur Courser', 0);
  const artist = put(s, 'Blood Artist', 1);
  const token = put(s, 'Soldier Token', 1);
  s.combat.attackers = [ref(attacker)];
  const result = combatOutcome(s, [
    { blocker: artist.id, attacker: attacker.id },
    { blocker: token.id, attacker: attacker.id },
  ]);
  assert.deepEqual(result.life, [0, 22]);
  assert.equal(result.winner, 1);
});

test('death lifegain cannot rescue a player already killed by combat damage', () => {
  const s = fixture();
  s.players[1].life = 1;
  const attacker = put(s, 'Grizzly Bears', 0);
  const unblocked = put(s, 'Raging Goblin', 0);
  const artist = put(s, 'Blood Artist', 1);
  s.combat.attackers = [ref(attacker), ref(unblocked)];
  const result = combatOutcome(s, [{ blocker: artist.id, attacker: attacker.id }]);
  assert.equal(result.life[1], 0);
  assert.equal(result.winner, 0);
});

test('first-strike death drain resolves before the normal combat damage step', () => {
  const s = fixture();
  s.players[0].life = 1;
  const knight = put(s, 'Youthful Knight', 0);
  const other = put(s, 'Grizzly Bears', 0);
  const cutthroat = put(s, 'Zulaport Cutthroat', 1);
  s.combat.attackers = [ref(knight), ref(other)];
  const result = combatOutcome(s, [{ blocker: cutthroat.id, attacker: knight.id }]);
  assert.deepEqual(result.life, [0, 21], 'unblocked Bears never deal normal damage');
  assert.equal(result.winner, 1);
});

test('APNAP puts the defending Cutthroat death payoff on top', () => {
  const s = fixture();
  s.players[0].life = 1;
  s.players[1].life = 1;
  const attacker = put(s, 'Zulaport Cutthroat', 0);
  const blocker = put(s, 'Zulaport Cutthroat', 1);
  s.combat.attackers = [ref(attacker)];
  const result = combatOutcome(s, [{ blocker: blocker.id, attacker: attacker.id }]);
  assert.equal(result.winner, 1);
  assert.deepEqual(result.life, [0, 2]);
});

test('draw death triggers are explicitly outside the life-only forecast', () => {
  const s = fixture();
  const attacker = put(s, 'Grizzly Bears', 0);
  const blocker = put(s, 'Novice Occultist', 1);
  s.combat.attackers = [ref(attacker)];
  const pairs = [{ blocker: blocker.id, attacker: attacker.id }];
  const result = combatOutcome(s, pairs);
  assert.equal(result.status, 'playing');
  assert.equal(result.omittedTriggers, 1);
  assert.deepEqual(result.life, [20, 20], 'omit the whole draw/life-loss entry');
  assert.equal(result.payoffLimitReached, false);
  // Neither hidden identity nor actual draw order can influence this projection.
  s.players[1].library.reverse();
  s.players[0].library.length = 0;
  assert.deepEqual(combatOutcome(s, pairs), result);
});

test('player-targeted death payoff respects controller target selection', () => {
  const s = fixture();
  s.players[0].life = 5;
  s.players[1].life = 7;
  const attacker = put(s, 'Grizzly Bears', 0);
  const artist = put(s, 'Blood Artist', 1);
  s.combat.attackers = [ref(attacker)];
  const result = combatOutcome(s, [{ blocker: artist.id, attacker: attacker.id }]);
  assert.deepEqual(result.life, [4, 8]);
  assert.equal(result.omittedTriggers, 0);
});

test('optional self-lethal life payoff is declined in the forecast', () => {
  const s = fixture();
  const name = 'Zulaport Cutthroat';
  const definition = structuredClone(s.catalog[name]);
  definition.triggers = [
    {
      event: 'controllerCreatureDies',
      optional: true,
      effects: [{ op: 'loseLife', amount: 2 }],
    },
  ];
  s.catalog = { ...s.catalog, [name]: definition };
  s.players[1].life = 1;
  const attacker = put(s, 'Grizzly Bears', 0);
  const blocker = put(s, name, 1);
  s.combat.attackers = [ref(attacker)];
  const result = combatOutcome(s, [{ blocker: blocker.id, attacker: attacker.id }]);
  assert.equal(result.life[1], 1);
  assert.equal(result.status, 'playing');
});

test('actual policy puts immediate lethal life payoff above routine lifegain', () => {
  const s = fixture();
  s.players[1].life = 1;
  s.choice = {
    kind: 'orderTriggers',
    player: 0,
    entries: [
      { id: 'lethal', controller: 0, effects: [{ op: 'loseLife', player: 'opponent', amount: 1 }] },
      { id: 'gain', controller: 0, effects: [{ op: 'gainLife', amount: 3 }] },
    ],
  };
  assert.deepEqual(chooseBotCommand(s, 0).ids, ['gain', 'lethal']);
});

test('actual policy declines an optional life loss even when it is not lethal', () => {
  const s = fixture();
  s.choice = { kind: 'optionalEffect', player: 0 };
  s.resolving = {
    entry: { controller: 0, effects: [{ op: 'loseLife', amount: 1 }] },
    index: 0,
  };
  assert.equal(chooseBotCommand(s, 0).accept, false);
});
