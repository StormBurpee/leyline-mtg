import { chooseBotCommand } from '../src/index.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, put, act } from './helpers.js';
import { enterBattlefieldBatch, resolveEffects, stabilize } from '../src/effects.js';
import { keywords, ref, notifyTriggers, move, addModifier } from '../src/model.js';
const name = 'Leatherhead, Swamp Stalker';
function setup() {
  const s = fixture(),
    o = put(s, name, 0, 'hand');
  enterBattlefieldBatch(s, [{ object: o }]);
  return [s, o];
}
test('Leatherhead enters with real hexproof counter; removal opens separate targeted reflexive ability', () => {
  let [s, o] = setup();
  assert.equal(o.keywordCounters.hexproof, 1);
  assert.ok(keywords(s, o).includes('hexproof'));
  const target = put(s, 'Torpor Orb', 1);
  notifyTriggers(s, 'combatDamagePlayer', { object: o, amount: 5, damagedPlayer: 1 });
  const trigger = s.pendingTriggers.pop();
  resolveEffects(s, trigger);
  assert.equal(s.choice.kind, 'removeCounter');
  assert.deepEqual(s.choice.counters, ['hexproof']);
  s = act(s, 'chooseCounter', { counter: 'hexproof' });
  assert.equal(s.objects[o.id].keywordCounters.hexproof, 0);
  assert.ok(!keywords(s, s.objects[o.id]).includes('hexproof'));
  assert.equal(s.choice.kind, 'triggerTarget');
  assert.ok(s.choice.targets.some((r) => r.id === target.id));
});
test('remove any counter including +1/+1 or stun; decline keeps counters and does not trigger', () => {
  for (const counter of [null, '+1/+1', 'stun']) {
    let [s, o] = setup();
    o.plusCounters = 2;
    o.stunCounters = 1;
    resolveEffects(s, {
      controller: 0,
      source: ref(o),
      effects: s.catalog[name].triggers[0].effects,
    });
    s = act(s, 'chooseCounter', { counter });
    assert.equal(s.objects[o.id].plusCounters, counter === '+1/+1' ? 1 : 2);
    assert.equal(s.objects[o.id].stunCounters, counter === 'stun' ? 0 : 1);
    assert.equal(s.objects[o.id].keywordCounters.hexproof, 1);
  }
});
test('counter cannot be removed from returned incarnation; old hexproof counter obeys later ability stripping', () => {
  const [s, o] = setup();
  const source = ref(o);
  addModifier(s, {
    objectId: o.id,
    incarnation: o.incarnation,
    removeAbilities: true,
    expires: s.turn,
  });
  assert.ok(!keywords(s, o).includes('hexproof'));
  move(s, o, 'hand');
  enterBattlefieldBatch(s, [{ object: o }]);
  resolveEffects(s, { controller: 0, source, effects: s.catalog[name].triggers[0].effects });
  assert.equal(s.choice, null);
  assert.equal(o.keywordCounters.hexproof, 1);
});

test('bot keeps useful counters when the reflexive trigger has no legal target', () => {
  const [s, o] = setup();
  resolveEffects(s, {
    controller: 0,
    source: ref(o),
    effects: s.catalog[name].triggers[0].effects,
  });
  assert.equal(chooseBotCommand(s, 0).counter, null);
  o.stunCounters = 1;
  s.choice.counters.push('stun');
  assert.equal(chooseBotCommand(s, 0).counter, 'stun');
});
