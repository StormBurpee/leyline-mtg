import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseBotCommand, ref, dispatch } from '../packages/engine/src/index.js';
import { move } from '../packages/engine/src/model.js';
import { fixture, put, lands, act } from '../packages/engine/test/helpers.js';

function combat({ attacker = 'Grizzly Bears', blocker = null, life = 20 } = {}) {
  const s = fixture();
  lands(s, 'Forest', 2);
  const a = put(s, attacker, 0);
  const b = blocker ? put(s, blocker, 1) : null;
  s.players[1].life = life;
  s.step = 'blockers';
  s.combat = {
    attackers: [ref(a)],
    blocks: b ? { [a.id]: [ref(b)] } : {},
    blocked: b ? [a.id] : [],
    firstEligible: [],
    hasFirst: false,
  };
  return { s, a, b };
}

test('spend Giant Growth when it turns a losing combat into a winning trade', () => {
  const { s, a } = combat({ blocker: 'Centaur Courser' });
  const growth = put(s, 'Giant Growth', 0, 'hand');
  const before = structuredClone(s);
  const command = chooseBotCommand(s, 0);
  assert.equal(command.card, growth.id);
  assert.equal(command.target.id, a.id);
  assert.equal(dispatch(s, command).ok, true);
  assert.deepEqual(s, before);
});

test('hold a pump spell when the same creatures survive either way', () => {
  const { s } = combat({ attacker: 'Centaur Courser', blocker: 'Soldier Token' });
  put(s, 'Giant Growth', 0, 'hand');
  assert.equal(chooseBotCommand(s, 0).type, 'pass');
});

test('use a pump spell for immediate unblocked lethal', () => {
  const { s } = combat({ life: 5 });
  const growth = put(s, 'Giant Growth', 0, 'hand');
  assert.equal(chooseBotCommand(s, 0).card, growth.id);
});

test('do not spend a pump spell on a combat that is already lethal', () => {
  const { s } = combat({ life: 2 });
  put(s, 'Giant Growth', 0, 'hand');
  assert.equal(chooseBotCommand(s, 0).type, 'pass');
});

test('extra nonlethal face damage alone does not justify spending a trick', () => {
  const { s } = combat();
  put(s, 'Giant Growth', 0, 'hand');
  assert.equal(chooseBotCommand(s, 0).type, 'pass');
});

test('a removed blocker does not make its blocked attacker unblocked', () => {
  const { s, b } = combat({ blocker: 'Soldier Token', life: 5 });
  move(s, b, 'graveyard');
  put(s, 'Giant Growth', 0, 'hand');
  assert.equal(chooseBotCommand(s, 0).type, 'pass');
});

test('granting trample can make lethal through a removed blocker', () => {
  const { s, b } = combat({ blocker: 'Soldier Token', life: 5 });
  move(s, b, 'graveyard');
  const size = put(s, 'Staggering Size', 0, 'hand');
  assert.equal(chooseBotCommand(s, 0).card, size.id);
});

function removal(spell, trick, creature = 'Grizzly Bears') {
  let s = fixture();
  s.active = 1;
  s.priority = 1;
  lands(s, 'Forest', 1, 0);
  const color = { Fell: 'Swamp', Shock: 'Mountain', Pacifism: 'Plains' }[spell];
  lands(s, color, 2, 1);
  const target = put(s, creature, 0);
  const response = put(s, trick, 0, 'hand');
  const threat = put(s, spell, 1, 'hand');
  s = act(s, 'cast', { card: threat.id, target: ref(target) }, 1);
  s = act(s, 'pass', {}, 1);
  return { s, target, response };
}

test('respond with toughness when it saves the creature from lethal damage', () => {
  const { s, response } = removal('Shock', 'Giant Growth');
  assert.equal(chooseBotCommand(s, 0).card, response.id);
});

test('toughness alone is not protection from destroy removal', () => {
  const { s } = removal('Fell', 'Giant Growth');
  assert.equal(chooseBotCommand(s, 0).type, 'pass');
});

test('hexproof is protection from targeted destroy removal', () => {
  const { s, response } = removal('Fell', 'Blossoming Defense');
  assert.equal(chooseBotCommand(s, 0).card, response.id);
});

test('hold protection against damage the creature already survives', () => {
  const { s } = removal('Shock', 'Giant Growth', 'Centaur Courser');
  assert.equal(chooseBotCommand(s, 0).type, 'pass');
});

test('activate Wildheart Invoker on the attacker to produce lethal', () => {
  const { s, a } = combat({ life: 7 });
  lands(s, 'Forest', 6);
  const invoker = put(s, 'Wildheart Invoker', 0);
  const command = chooseBotCommand(s, 0);
  assert.equal(command.type, 'activate');
  assert.equal(command.card, invoker.id);
  assert.equal(command.target.id, a.id);
  assert.equal(dispatch(s, command).ok, true);
});

test('mana-only pump can add pressure without spending a card', () => {
  const { s, a } = combat();
  lands(s, 'Forest', 6);
  const invoker = put(s, 'Wildheart Invoker', 0);
  const command = chooseBotCommand(s, 0);
  assert.equal(command.type, 'activate');
  assert.equal(command.card, invoker.id);
  assert.equal(command.target.id, a.id);
});

test('protect a creature from a targeted Pacifism with hexproof', () => {
  const { s, response } = removal('Pacifism', 'Blossoming Defense');
  assert.equal(chooseBotCommand(s, 0).card, response.id);
});
