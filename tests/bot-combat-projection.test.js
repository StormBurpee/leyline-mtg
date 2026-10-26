import test from 'node:test';
import assert from 'node:assert/strict';
import { combatOutcome } from '../packages/engine/src/combat-policy.js';
import { combatOutcome as reference } from './fixtures/v0.22-policy/combat-policy.js';
import {
  ref,
  chooseBotCommand,
  dispatch,
  DECKS,
  expandDeck,
} from '../packages/engine/src/index.js';
import { runEpisode } from '../packages/simulation/run.js';
import { move } from '../packages/engine/src/model.js';
import { chooseReleasedSafe } from '../packages/simulation/reference-policies.js';
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

test('a real sacrifice-after-attacking episode completes through the opaque session', async () => {
  const deck = expandDeck(DECKS.roots.cards);
  const result = await runEpisode({
    config: { decks: [deck, deck], seed: 32452843 },
    policies: [
      ({ observation, player }) => chooseReleasedSafe(observation, player),
      ({ observation, player }) => chooseBotCommand(observation, player),
    ],
  });
  assert.equal(result.termination, 'finished', JSON.stringify(result.error));
});

test('a departed attacker is ignored by blocking forecasts and the named reference adapter', () => {
  for (const destination of ['graveyard', 'hand', 'battlefield']) {
    const s = fixture();
    const departed = put(s, 'Llanowar Elves', 0);
    const live = put(s, 'Grizzly Bears', 0);
    put(s, 'Centaur Courser', 1);
    s.combat.attackers = [ref(departed), ref(live)];
    move(s, departed, destination);
    s.choice = { kind: 'blockers', player: 1 };
    const before = structuredClone(s);
    for (const policy of [chooseBotCommand, chooseReleasedSafe]) {
      const command = policy(s, 1);
      assert.equal(command.type, 'blockers');
      assert.ok(command.pairs.every((pair) => pair.attacker === live.id));
      assert.equal(dispatch(s, command).ok, true);
    }
    assert.deepEqual(s, before);
  }
});
