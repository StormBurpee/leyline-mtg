import test from 'node:test';
import assert from 'node:assert/strict';
import { combatOutcome } from '../packages/engine/src/combat-policy.js';
import { combatOutcome as reference } from './fixtures/v0.22-policy/combat-policy.js';
import { ref } from '../packages/engine/src/index.js';
import { fixture, put, lands } from '../packages/engine/test/helpers.js';

test('compact combat boards preserve full outcomes, land identities, anthems and death payoffs', () => {
  for (const attackerName of [
    'Grizzly Bears',
    'Youthful Knight',
    'Sire of Seven Deaths',
    'Colossal Dreadmaw',
  ]) {
    for (const blockerName of [
      'Soul Warden',
      'Giant Spider',
      'Vampire Nighthawk',
      'Grizzly Bears',
    ]) {
      const s = fixture();
      lands(s, 'Forest', 12, 0);
      lands(s, 'Plains', 12, 1);
      put(s, 'Glorious Anthem', 1);
      put(s, 'Blood Artist', 0);
      const a = put(s, attackerName, 0);
      const blockers = Array.from({ length: 3 }, () => put(s, blockerName, 1));
      s.combat.attackers = [ref(a)];
      for (const count of [0, 1, 2, 3]) {
        const pairs = blockers.slice(0, count).map((b) => ({ blocker: b.id, attacker: a.id }));
        const before = structuredClone(s);
        assert.deepEqual(combatOutcome(s, pairs), reference(s, pairs));
        assert.deepEqual(s, before);
      }
    }
  }
});
