import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { replay, assertInvariants } from '../packages/engine/src/index.js';
for (const filename of [
  'example-replay.json',
  'example-search-replay.json',
  'example-legend-replay.json',
  'example-attack-replay.json',
  'example-burial-replay.json',
  'example-sacrifice-replay.json',
  'example-target-replay.json',
  'example-interaction-replay.json',
  'example-ward-replay.json',
  'example-optional-replay.json',
])
  test(`shipped ${filename} replays only accepted commands`, async () => {
    const record = JSON.parse(
      await readFile(new URL(`../apps/web/${filename}`, import.meta.url), 'utf8'),
    );
    const s = replay(record);
    assert.equal(assertInvariants(s), true);
    if (filename.includes('attack')) {
      assert.equal(s.step, 'attackers');
      assert.equal(s.choice.kind, 'orderTriggers');
    }
    if (filename.includes('legend')) assert.equal(s.choice.kind, 'legendRule');
    if (filename.includes('search')) assert.equal(s.choice.kind, 'librarySearch');
    if (filename.includes('target')) assert.equal(s.choice.kind, 'triggerTarget');
    if (filename.includes('optional')) assert.equal(s.choice.kind, 'optionalEffect');
    if (filename.includes('ward')) {
      assert.equal(s.choice.kind, 'payCost');
      assert.equal(s.choice.payable, true);
      assert.ok(s.turn <= 15);
    }
  });
