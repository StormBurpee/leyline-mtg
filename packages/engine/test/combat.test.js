import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatch, stats, ref, canAttack, canBlock, suggestedDamage } from '../src/index.js';
import { beginDamage } from '../src/combat.js';
import { move } from '../src/model.js';
import { stabilize } from '../src/effects.js';
import { fixture, put, act, resolve } from './helpers.js';
function attack(s, ids) {
  s.step = 'attackers';
  s.choice = { kind: 'attackers', player: 0 };
  return act(s, 'attackers', { cards: ids });
}
function block(s, pairs) {
  s = resolve(s);
  assert.equal(s.choice.kind, 'blockers');
  return act(s, 'blockers', { pairs });
}
function damage(s) {
  while (s.choice?.kind === 'assignDamage')
    s = act(s, 'assignDamage', { orders: suggestedDamage(s) });
  return s;
}
test('summoning sickness prevents attacking; haste bypasses it', () => {
  const s = fixture(),
    bear = put(s, 'Grizzly Bears', 0, 'battlefield', { ready: false }),
    goblin = put(s, 'Raging Goblin', 0, 'battlefield', { ready: false });
  assert.equal(canAttack(s, bear, 0), false);
  assert.equal(canAttack(s, goblin, 0), true);
});
test('vigilance leaves attacker untapped', () => {
  let s = fixture();
  const angel = put(s, 'Serra Angel');
  s = attack(s, [angel.id]);
  assert.equal(s.objects[angel.id].tapped, false);
});
test('Pacifism prevents attacks and blocks', () => {
  const s = fixture(),
    bear = put(s, 'Grizzly Bears'),
    aura = put(s, 'Pacifism', 1);
  aura.attachedTo = ref(bear);
  assert.equal(canAttack(s, bear, 0), false);
  const enemy = put(s, 'Grizzly Bears', 1);
  assert.equal(canBlock(s, bear, enemy, 0), false);
});
test('flying needs flying or reach to block', () => {
  const s = fixture(),
    drake = put(s, 'Wind Drake'),
    bear = put(s, 'Grizzly Bears', 1),
    spider = put(s, 'Giant Spider', 1);
  assert.equal(canBlock(s, bear, drake, 1), false);
  assert.equal(canBlock(s, spider, drake, 1), true);
});
test('tapped blockers forbidden; fresh creatures can block', () => {
  const s = fixture(),
    a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears', 1, 'battlefield', { ready: false });
  assert.equal(canBlock(s, b, a, 1), true);
  b.tapped = true;
  assert.equal(canBlock(s, b, a, 1), false);
});
test('unblocked combat damage is a turn-based action, no stack', () => {
  let s = fixture();
  const a = put(s, 'Grizzly Bears');
  s = attack(s, [a.id]);
  s = block(s, []);
  s = resolve(s);
  s = damage(s);
  assert.equal(s.players[1].life, 18);
  assert.equal(s.stack.length, 0);
  assert.equal(s.priority, 0);
});
test('ordinary combat damage is simultaneous, both creatures die', () => {
  let s = fixture();
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears', 1);
  s = attack(s, [a.id]);
  s = block(s, [{ attacker: a.id, blocker: b.id }]);
  s = resolve(s);
  s = damage(s);
  assert.equal(s.objects[a.id].zone, 'graveyard');
  assert.equal(s.objects[b.id].zone, 'graveyard');
});
test('first strike damage has a priority window and prevents dead blocker damage', () => {
  let s = fixture();
  const a = put(s, 'Youthful Knight'),
    b = put(s, 'Grizzly Bears', 1);
  s = attack(s, [a.id]);
  s = block(s, [{ attacker: a.id, blocker: b.id }]);
  s = resolve(s);
  assert.equal(s.step, 'firstDamage');
  s = damage(s);
  assert.equal(s.objects[b.id].zone, 'graveyard');
  assert.equal(s.objects[a.id].zone, 'battlefield');
  s = resolve(s);
  assert.equal(s.step, 'damage');
  assert.equal(s.choice, null);
  assert.equal(s.objects[a.id].damage, 0);
});
test('double strike deals damage twice when unblocked', () => {
  let s = fixture();
  const a = put(s, 'Fencing Ace');
  s = attack(s, [a.id]);
  s = block(s, []);
  s = damage(resolve(s));
  assert.equal(s.players[1].life, 19);
  s = damage(resolve(s));
  assert.equal(s.players[1].life, 18);
});
test('blocked creature stays blocked when blocker disappears', () => {
  let s = fixture();
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears', 1);
  s = attack(s, [a.id]);
  s = block(s, [{ attacker: a.id, blocker: b.id }]);
  move(s, s.objects[b.id], 'graveyard');
  s = damage(resolve(s));
  assert.equal(s.players[1].life, 20);
});
test('trample goes through when last blocker leaves', () => {
  let s = fixture();
  const a = put(s, 'Colossal Dreadmaw'),
    b = put(s, 'Grizzly Bears', 1);
  s = attack(s, [a.id]);
  s = block(s, [{ attacker: a.id, blocker: b.id }]);
  move(s, s.objects[b.id], 'graveyard');
  s = damage(resolve(s));
  assert.equal(s.players[1].life, 14);
});
test('trample must assign lethal before player damage', () => {
  let s = fixture();
  const a = put(s, 'Colossal Dreadmaw'),
    b = put(s, 'Grizzly Bears', 1);
  s = attack(s, [a.id]);
  s = block(s, [{ attacker: a.id, blocker: b.id }]);
  s = resolve(s);
  assert.equal(
    dispatch(s, {
      type: 'assignDamage',
      player: 0,
      orders: [
        {
          source: a.id,
          assignments: [
            { target: ref(s.objects[b.id]), amount: 1 },
            { target: { kind: 'player', id: 1 }, amount: 5 },
          ],
        },
      ],
    }).ok,
    false,
  );
  s = damage(s);
  assert.equal(s.players[1].life, 16);
});
test('multiple blockers can receive any distribution under current rules', () => {
  let s = fixture();
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears', 1),
    c = put(s, 'Grizzly Bears', 1);
  s = attack(s, [a.id]);
  s = block(s, [
    { attacker: a.id, blocker: b.id },
    { attacker: a.id, blocker: c.id },
  ]);
  s = resolve(s);
  s = act(s, 'assignDamage', {
    orders: [
      {
        source: a.id,
        assignments: [
          { target: ref(s.objects[b.id]), amount: 1 },
          { target: ref(s.objects[c.id]), amount: 1 },
        ],
      },
    ],
  });
  s = damage(s);
  assert.equal(s.objects[a.id].zone, 'graveyard');
  assert.equal(s.objects[b.id].damage, 1);
  assert.equal(s.objects[c.id].damage, 1);
});
test('a blocker cannot block twice in this supported pool', () => {
  let s = fixture();
  const a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears'),
    c = put(s, 'Grizzly Bears', 1);
  s = attack(s, [a.id, b.id]);
  s = resolve(s);
  assert.equal(
    dispatch(s, {
      type: 'blockers',
      player: 1,
      pairs: [
        { attacker: a.id, blocker: c.id },
        { attacker: b.id, blocker: c.id },
      ],
    }).ok,
    false,
  );
});
test('lifelink and deathtouch use the damage source', () => {
  let s = fixture();
  const a = put(s, 'Vampire Nighthawk'),
    b = put(s, 'Air Elemental', 1);
  s.players[0].life = 9;
  s = attack(s, [a.id]);
  s = block(s, [{ attacker: a.id, blocker: b.id }]);
  s = damage(resolve(s));
  assert.equal(s.players[0].life, 11);
  assert.equal(s.objects[b.id].zone, 'graveyard');
  assert.equal(s.objects[a.id].zone, 'graveyard');
});
test('zero attackers skips blockers and damage', () => {
  let s = fixture();
  s = attack(s, []);
  s = resolve(s);
  assert.equal(s.step, 'endCombat');
  assert.equal(s.choice, null);
});
