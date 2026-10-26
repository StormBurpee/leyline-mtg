import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGame, dispatch } from '../packages/engine/src/index.js';
import { chooseBotCommand } from './fixtures/pre-tactical-policy.js';
test('the frozen policy preserves twenty released v0.5 game traces through the current engine', async () => {
  const baseline = JSON.parse(
    await readFile(new URL('./fixtures/v05-simulation-contracts.json', import.meta.url), 'utf8'),
  );
  for (const expected of baseline.records) {
    let state = createGame({ seed: expected.seed });
    while (state.status !== 'finished' && state.revision < 3000) {
      const r = dispatch(state, chooseBotCommand(state, state.choice?.player ?? state.priority));
      assert.equal(r.ok, true, JSON.stringify(r.error));
      state = r.state;
    }
    assert.deepEqual(
      {
        seed: expected.seed,
        status: state.status,
        winner: state.winner,
        turn: state.turn,
        decisions: state.revision,
        commandsSha256: createHash('sha256').update(JSON.stringify(state.history)).digest('hex'),
      },
      expected,
      `seed ${expected.seed}`,
    );
  }
});
