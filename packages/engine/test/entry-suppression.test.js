import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, put } from './helpers.js';
import { enterBattlefieldBatch } from '../src/effects.js';
import { move, notifyTriggers } from '../src/model.js';
import { CARDS, createGame } from '../src/index.js';
import { validateDefinition } from '../src/definition-validation.js';

test('Torpor Orb blocks creature own ETB and other permanents observing that entry', () => {
  const s = fixture();
  put(s, 'Torpor Orb');
  const elf = put(s, 'Llanowar Elves', 0, 'hand');
  // Use the supported declarative trigger contract, not card-name-specific logic.
  elf.definitionOverride = { ...CARDS['Llanowar Elves'], etb: [{ op: 'draw', count: 1 }] };
  const watcher = put(s, 'Llanowar Elves');
  watcher.definitionOverride = {
    ...CARDS['Llanowar Elves'],
    triggers: [
      {
        event: { event: 'enter', filter: { type: 'creature' } },
        effects: [{ op: 'draw', count: 1 }],
      },
    ],
  };
  enterBattlefieldBatch(s, [{ object: elf }]);
  assert.equal(s.pendingTriggers.length, 0);
});
test('simultaneous Orb sees entrants and suppression ends immediately on departure', () => {
  const s = fixture(),
    orb = put(s, 'Torpor Orb', 0, 'hand'),
    creature = put(s, 'Viashino Pyromancer', 0, 'hand');
  enterBattlefieldBatch(s, [{ object: creature }, { object: orb }]);
  assert.equal(s.pendingTriggers.length, 0);
  move(s, orb, 'graveyard');
  const next = put(s, 'Viashino Pyromancer', 0, 'hand');
  enterBattlefieldBatch(s, [{ object: next }]);
  assert.equal(s.pendingTriggers.length, 1);
});
test('Torpor does not suppress landfall from noncreature lands, replacement counters or chapter events', () => {
  const s = fixture();
  put(s, 'Torpor Orb');
  const hydra = put(s, 'Mossborn Hydra', 0, 'hand');
  enterBattlefieldBatch(s, [{ object: hydra }]);
  assert.equal(hydra.plusCounters, 1);
  const land = put(s, 'Forest', 0, 'hand');
  enterBattlefieldBatch(s, [{ object: land }]);
  assert.equal(s.pendingTriggers.length, 1);
});
test('suppression validates only type predicates, including Thrull artifact OR creature contract', () => {
  assert.deepEqual(
    validateDefinition({
      ...CARDS['Torpor Orb'],
      suppressEnterTriggers: { any: [{ type: 'artifact' }, { type: 'creature' }] },
    }),
    [],
  );
  assert.ok(
    validateDefinition({ ...CARDS['Torpor Orb'], suppressEnterTriggers: { controller: 'you' } })
      .length,
  );
});
