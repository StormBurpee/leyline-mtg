import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createGame,
  createRegistry,
  dispatch,
  exportReplay,
  replay,
  chooseBotCommand,
  VERSION,
} from '../packages/engine/src/index.js';

const legacyWard = JSON.parse(
  await readFile(new URL('../apps/web/example-ward-replay.json', import.meta.url)),
);

test('unmodified published ward save retains original trigger IDs and reaches its payment choice', () => {
  assert.equal(legacyWard.version, '0.3.0');
  assert.equal(legacyWard.rulesRevision, undefined);
  const state = replay(legacyWard);
  assert.equal(state.rulesRevision, 1);
  assert.equal(state.choice.kind, 'payCost');
  assert.equal(state.resolving.entry.label, 'Tomakul Honor Guard · ward');
  assert.deepEqual(
    state.stack.filter((e) => e.kind === 'ability').map((e) => e.id),
    ['s153', 's154', 's155', 's156', 's157'],
  );
  assert.deepEqual(
    state.config.catalog,
    structuredClone(createRegistry(legacyWard.config.catalog)),
  );
});

test('legacy ward resume, decisions, export and replay preserve compatibility across the new envelope version', () => {
  let state = replay(legacyWard);
  const decision = dispatch(state, { type: 'payCost', player: state.choice.player, pay: false });
  assert.equal(decision.ok, true, decision.error?.message);
  state = decision.state;
  assert.ok(
    state.events.some((event) => event.type === 'countered' && event.name === 'Lightning Bolt'),
  );
  for (let i = 0; i < 10; i++) {
    const record = exportReplay(state);
    assert.equal(record.rulesRevision, 1);
    assert.notEqual(record.version, legacyWard.version);
    assert.deepEqual(replay(record), state);
    const command = chooseBotCommand(state, state.choice?.player ?? state.priority);
    const result = dispatch(state, command);
    assert.equal(result.ok, true, result.error?.message);
    state = result.state;
  }
  assert.deepEqual(replay(exportReplay(state)), state);
});

test('new games explicitly export announcement-time rules even under older envelope aliases', () => {
  const state = createGame({ mulligan: false });
  assert.equal(state.rulesRevision, 4);
  const record = exportReplay(state);
  assert.equal(record.rulesRevision, 4);
  assert.deepEqual(replay(record), state);
  assert.deepEqual(replay({ ...record, version: '0.3.0' }), state);
  assert.throws(() => replay({ ...record, rulesRevision: 5 }), /Unsupported replay rules revision/);
});

// These versions were published before the simultaneous-token-entry revision.
// Keep aliases explicit when VERSION advances so unmarked saved games remain valid.
test('published v0.55–v0.57 envelopes preserve revision 3 with and without explicit marker', () => {
  const state = createGame({ mulligan: false });
  state.rulesRevision = 3;
  const record = exportReplay(state);
  for (const version of ['0.55.0', '0.56.0', '0.57.0']) {
    assert.deepEqual(replay({ ...record, version }), state);
    const unmarked = { ...record, version };
    delete unmarked.rulesRevision;
    assert.deepEqual(replay(unmarked), state);
  }
});

test('published v0.58 envelopes preserve revision 4 with and without explicit marker', () => {
  const state = createGame({ mulligan: false });
  const record = { ...exportReplay(state), version: '0.58.0' };
  assert.deepEqual(replay(record), state);
  delete record.rulesRevision;
  assert.deepEqual(replay(record), state);
});

// Each release must continue admitting the just-published predecessor, not only
// earlier hard-coded aliases. This catches a version bump without its save migration.
test('the previous minor release envelope preserves revision 4 and its cached catalog', () => {
  const [major, minor] = VERSION.split('.').map(Number);
  const state = createGame({ mulligan: false });
  const record = { ...exportReplay(state), version: `${major}.${minor - 1}.0` };
  assert.deepEqual(replay(record), state);
  delete record.rulesRevision;
  assert.deepEqual(replay(record), state);
});
