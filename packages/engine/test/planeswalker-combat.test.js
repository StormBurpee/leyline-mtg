import test from 'node:test';
import assert from 'node:assert/strict';
import { definition, ref, move } from '../src/model.js';
import {
  attackDefenders,
  attackDefender,
  declareAttackers,
  declareBlockers,
  beginDamage,
  assignDamage,
  suggestedDamage,
} from '../src/combat.js';
import { plannedAttackDefenders, tacticalDamage } from '../src/combat-policy.js';
import { resolveTop, stabilize, finishResolutionChoice } from '../src/effects.js';
import { cardDropPlan } from '../../../apps/web/drop-plan.js';
import { fixture, put } from './helpers.js';
function walker(s, player = 1) {
  const o = put(s, 'Grizzly Bears', player);
  o.definitionOverride = {
    ...definition(s, o),
    name: 'Combat Walker',
    type: 'planeswalker',
    types: ['planeswalker'],
    keywords: ['hexproof', 'shroud'],
  };
  o.loyalty = 3;
  return o;
}
function attack(s, a, w) {
  s.step = 'attackers';
  declareAttackers(s, [a.id], w ? { [a.id]: ref(w) } : {});
}
function damage(s) {
  s.step = 'damage';
  beginDamage(s, false);
}
test('planeswalkers are independent attack destinations, not spell targets', () => {
  const s = fixture(),
    a = put(s, 'Grizzly Bears'),
    w = walker(s),
    own = walker(s, 0);
  assert.deepEqual(attackDefenders(s), [{ kind: 'player', id: 1 }, ref(w)]);
  assert.throws(() => attack(s, a, own));
  assert.throws(() =>
    declareAttackers(s, [a.id], { [a.id]: { ...ref(w), incarnation: w.incarnation + 1 } }),
  );
  assert.throws(() => declareAttackers(s, [a.id], { other: ref(w) }));
  attack(s, a, w);
  damage(s);
  assert.deepEqual(s.choice.sources[0].targets, [ref(w)]);
  assert.deepEqual(suggestedDamage(s)[0].assignments, [{ target: ref(w), amount: 2 }]);
});
test('default attackers still attack the opponent and leave no defender map', () => {
  const s = fixture(),
    a = put(s, 'Grizzly Bears');
  attack(s, a);
  damage(s);
  assert.equal(s.combat.defenders, undefined);
  assert.deepEqual(s.choice.sources[0].targets, [{ kind: 'player', id: 1 }]);
});
test('departed planeswalker never redirects combat damage to its controller', () => {
  const s = fixture(),
    a = put(s, 'Grizzly Bears'),
    w = walker(s);
  attack(s, a, w);
  move(s, w, 'graveyard');
  damage(s);
  assert.equal(s.choice, null);
  assert.equal(s.players[1].life, 20);
  assert.equal(s.combat.attackers.length, 1);
  move(s, w, 'battlefield');
  assert.equal(attackDefender(s, a.id), null);
});
test('a planeswalker changing controller ceases to be the defender', () => {
  const s = fixture(),
    a = put(s, 'Grizzly Bears'),
    w = walker(s);
  attack(s, a, w);
  w.controller = 0;
  assert.equal(attackDefender(s, a.id), null);
});
test('ordinary blocks and combat continue when attacked planeswalker leaves', () => {
  const s = fixture(),
    a = put(s, 'Grizzly Bears'),
    b = put(s, 'Grizzly Bears', 1),
    w = walker(s);
  attack(s, a, w);
  declareBlockers(s, [{ attacker: a.id, blocker: b.id }]);
  move(s, w, 'graveyard');
  damage(s);
  assert.deepEqual(s.choice.sources[0].targets, [ref(b)]);
  assert.deepEqual(s.choice.remaining[0].sources[0].targets, [ref(a)]);
});
test('trample must assign lethal to blockers before planeswalker damage', () => {
  const s = fixture(),
    a = put(s, 'Colossal Dreadmaw'),
    b = put(s, 'Grizzly Bears', 1),
    w = walker(s);
  attack(s, a, w);
  declareBlockers(s, [{ attacker: a.id, blocker: b.id }]);
  damage(s);
  const assignments = [
    { target: ref(b), amount: 2 },
    { target: ref(w), amount: 4 },
  ];
  assert.deepEqual(suggestedDamage(s)[0].assignments, assignments);
  assert.deepEqual(tacticalDamage(s)[0].assignments, assignments);
  assert.throws(
    () =>
      assignDamage(s, [
        {
          source: a.id,
          assignments: [
            { target: ref(b), amount: 0 },
            { target: ref(w), amount: 6 },
          ],
        },
      ]),
    /lethal/,
  );
});
test('bot takes a free walker kill but prioritizes player lethal', () => {
  const s = fixture(),
    a = put(s, 'Colossal Dreadmaw'),
    w = walker(s);
  assert.deepEqual(plannedAttackDefenders(s, 0, [a.id]), { [a.id]: ref(w) });
  s.players[1].life = 6;
  assert.deepEqual(plannedAttackDefenders(s, 0, [a.id]), {});
  s.players[1].life = 20;
  put(s, 'Grizzly Bears', 1);
  assert.deepEqual(plannedAttackDefenders(s, 0, [a.id]), {});
});
test('planeswalker drag destination is more specific than enemy battlefield', () => {
  const s = fixture(),
    a = put(s, 'Grizzly Bears'),
    w = walker(s);
  s.choice = { kind: 'attackers', player: 0 };
  assert.deepEqual(cardDropPlan(s, 0, a.id).destinations, [
    { target: ref(w), defender: ref(w), card: a.id },
    { field: 1, card: a.id },
  ]);
});
test('mobilized tokens independently choose planeswalker or player during resolution', () => {
  const s = fixture(),
    a = put(s, 'Dalkovan Packbeasts'),
    w = walker(s);
  attack(s, a);
  stabilize(s);
  resolveTop(s);
  assert.equal(s.choice.kind, 'attackDefenders');
  assert.equal(s.choice.cards.length, 3);
  const [first, second] = s.choice.cards;
  finishResolutionChoice(s, { type: 'chooseAttackDefenders', defenders: { [first]: ref(w) } });
  assert.equal(s.choice, null);
  assert.equal(s.resolving, null);
  assert.deepEqual(attackDefender(s, first), ref(w));
  assert.deepEqual(attackDefender(s, second), { kind: 'player', id: 1 });
});
