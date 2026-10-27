import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, legalTarget, ref, targetsFor } from '../src/index.js';
import { move } from '../src/model.js';
import { fixture, put, lands, act, resolve } from './helpers.js';

test('attacking-or-blocking targets use combat membership, not tapped state, and reject new incarnations', () => {
  const s = fixture(),
    attacker = put(s, 'Grizzly Bears'),
    blocker = put(s, 'Grizzly Bears', 1),
    idle = put(s, 'Grizzly Bears', 1);
  s.combat.attackers = [ref(attacker)];
  s.combat.blocks = { [attacker.id]: [ref(blocker)] };
  idle.tapped = true;
  const target = CARDS['Cosmium Blast'].target;
  assert.deepEqual(targetsFor(s, target, 0), [ref(attacker), ref(blocker)]);
  move(s, attacker, 'hand');
  assert.equal(legalTarget(s, target, ref(blocker), 0), true);
  move(s, blocker, 'hand');
  move(s, blocker, 'battlefield');
  assert.equal(legalTarget(s, target, ref(blocker), 0), false);
  assert.equal(legalTarget(s, target, ref(idle), 0), false);
});

test('Cosmium Blast resolves against a blocking creature and rejects an idle creature', () => {
  let s = fixture();
  lands(s, 'Plains', 2);
  const attacker = put(s, 'Grizzly Bears'),
    blocker = put(s, 'Grizzly Bears', 1),
    spell = put(s, 'Cosmium Blast', 0, 'hand');
  s.combat.attackers = [ref(attacker)];
  s.combat.blocks = { [attacker.id]: [ref(blocker)] };
  s = act(s, 'cast', { card: spell.id, target: ref(blocker) });
  s = resolve(s);
  assert.equal(s.objects[blocker.id].zone, 'graveyard');
});

test('Repel Calamity accepts either current power or toughness threshold without accepting smaller creatures', () => {
  const s = fixture(),
    small = put(s, 'Grizzly Bears', 1),
    large = put(s, 'Colossal Dreadmaw', 1);
  assert.equal(legalTarget(s, CARDS['Repel Calamity'].target, ref(small), 0), false);
  assert.equal(legalTarget(s, CARDS['Repel Calamity'].target, ref(large), 0), true);
  s.modifiers.push({
    objectId: small.id,
    incarnation: small.incarnation,
    power: 0,
    toughness: 2,
    expiresTurn: s.turn,
  });
  assert.equal(legalTarget(s, CARDS['Repel Calamity'].target, ref(small), 0), true);
});
