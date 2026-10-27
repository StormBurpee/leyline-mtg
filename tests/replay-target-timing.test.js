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
  assert.equal(state.rulesRevision, 2);
  const record = exportReplay(state);
  assert.equal(record.rulesRevision, 2);
  assert.deepEqual(replay(record), state);
  assert.deepEqual(replay({ ...record, version: '0.3.0' }), state);
  assert.throws(() => replay({ ...record, rulesRevision: 3 }), /Unsupported replay rules revision/);
});
