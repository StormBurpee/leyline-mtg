import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  dispatch,
  chooseBotCommand,
  assertInvariants,
  exportReplay,
  replay,
} from '../src/index.js';
test('bots complete seeded matches using only accepted commands', () => {
  for (const seed of [1, 17, 31, 731, 2026]) {
    let s = createGame({ seed });
    let steps = 0;
    while (s.status !== 'finished' && steps++ < 2500) {
      const player = s.choice?.player ?? s.priority,
        c = chooseBotCommand(s, player);
      assert.ok(c);
      const r = dispatch(s, c);
      assert.equal(r.ok, true, JSON.stringify(r.error));
      s = r.state;
      assertInvariants(s);
    }
    assert.equal(s.status, 'finished', `seed ${seed} stalled at ${s.step}`);
    assert.deepEqual(replay(exportReplay(s)), s);
  }
});
