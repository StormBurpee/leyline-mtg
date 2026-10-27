import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, put } from './helpers.js';
import { enterBattlefieldBatch, resolveEffects } from '../src/effects.js';
import { stats, ref, move, maximumBlockers } from '../src/model.js';
import { declareBlockers } from '../src/combat.js';
import { chooseBlocks } from '../src/combat-policy.js';
function setup() {
  const s = fixture(),
    elf = put(s, 'Llanowar Elves'),
    aura = put(s, "Meltstrider's Resolve", 0, 'hand');
  enterBattlefieldBatch(s, [{ object: aura, attachment: ref(elf) }]);
  return [s, elf, aura];
}
test('Aura grants toughness immediately, ETB fights with attached creature rather than Aura', () => {
  const [s, elf, aura] = setup(),
    enemy = put(s, 'Llanowar Elves', 1);
  assert.equal(stats(s, elf).toughness, 3);
  const trigger = s.pendingTriggers.pop();
  trigger.targets = { victim: [ref(enemy)] };
  resolveEffects(s, trigger);
  assert.equal(elf.damage, 1);
  assert.equal(enemy.damage, 1);
  assert.equal(aura.damage, 0);
});
test('fight remembers attached incarnation if Aura leaves but never fights using returned creature', () => {
  const [s, elf, aura] = setup(),
    enemy = put(s, 'Llanowar Elves', 1);
  const trigger = s.pendingTriggers.pop();
  trigger.targets = { victim: [ref(enemy)] };
  move(s, aura, 'graveyard');
  resolveEffects(s, trigger);
  assert.equal(enemy.damage, 1);
  enemy.damage = 0;
  move(s, elf, 'hand');
  move(s, elf, 'battlefield');
  resolveEffects(s, trigger);
  assert.equal(enemy.damage, 0);
});
test('one-blocker restriction is enforced by engine and bot and disappears when Aura leaves', () => {
  const [s, elf, aura] = setup(),
    a = put(s, 'Llanowar Elves', 1),
    b = put(s, 'Llanowar Elves', 1);
  s.combat.attackers = [ref(elf)];
  assert.equal(maximumBlockers(s, elf), 1);
  assert.throws(
    () =>
      declareBlockers(s, [
        { attacker: elf.id, blocker: a.id },
        { attacker: elf.id, blocker: b.id },
      ]),
    /many creatures/,
  );
  assert.ok(chooseBlocks(s, 1).pairs.length <= 1);
  move(s, aura, 'graveyard');
  assert.equal(maximumBlockers(s, elf), Infinity);
  assert.doesNotThrow(() =>
    declareBlockers(s, [
      { attacker: elf.id, blocker: a.id },
      { attacker: elf.id, blocker: b.id },
    ]),
  );
});
