import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizePaired } from '../packages/simulation/evaluation.js';
const record = (pair, seat, winner, termination = 'finished') => ({
  pair,
  candidateSeat: seat,
  winner,
  termination,
  decks: ['ember', 'ember'],
});
test('invalid games and incomplete seat pairs never become wins, draws or interval observations', () => {
  const result = summarizePaired([
    record('a', 0, 0),
    record('a', 1, 0),
    record('b', 0, 0, 'decision_limit'),
    record('b', 1, 1),
    record('c', 0, null),
  ]);
  assert.equal(result.invalid, 1);
  assert.equal(result.wins, 2);
  assert.equal(result.losses, 1);
  assert.equal(result.draws, 1);
  assert.equal(result.completePairs, 1);
  assert.equal(result.excludedPairs, 2);
  assert.equal(result.pairedScore, 0.5);
  assert.equal(result.pairedNormal95, null);
});
test('pair summaries distinguish swept pairs from split seats', () => {
  const result = summarizePaired([
    record('a', 0, 0),
    record('a', 1, 1),
    record('b', 0, 1),
    record('b', 1, 0),
    record('c', 0, 0),
    record('c', 1, 0),
  ]);
  assert.equal(result.swept, 1);
  assert.equal(result.sweptAgainst, 1);
  assert.equal(result.pairedScore, 0.5);
});

test('confidence blocks keep both starting-player variants of a shuffle together', () => {
  const records = [
    record('a0', 0, 0),
    record('a0', 1, 1),
    record('a1', 0, 0),
    record('a1', 1, 1),
    record('b0', 0, 1),
    record('b0', 1, 0),
    record('b1', 0, 1),
    record('b1', 1, 0),
  ].map((r, i) => ({ ...r, seed: i < 4 ? 7 : 8 }));
  const result = summarizePaired(records);
  assert.equal(result.completePairs, 4);
  assert.equal(result.completeBlocks, 2);
  assert.equal(result.blockScore, 0.5);
  assert.deepEqual(result.blockNormal95, [0, 1]);
  records[0].termination = 'wall_time_limit';
  assert.equal(summarizePaired(records).excludedBlocks, 1);
  assert.equal(summarizePaired(records).completeBlocks, 1);
});
