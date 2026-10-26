import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  replay,
  createGame,
  legalActions,
  dispatch,
  chooseBotCommand,
  canAttack,
  canBlock,
} from '../packages/engine/src/index.js';
import { cardDropPlan } from '../apps/web/drop-plan.js';
const record = JSON.parse(
  await readFile(new URL('../apps/web/example-interaction-replay.json', import.meta.url), 'utf8'),
);

test('drop destinations are exactly engine-legal commands with incarnation-bound targets', () => {
  const state = replay(record),
    player = state.priority;
  const before = JSON.stringify(state);
  for (const id of state.players[player].hand) {
    const plan = cardDropPlan(state, player, id);
    const commands = plan.destinations.map(({ field, ...command }) => command);
    assert.deepEqual(
      commands,
      legalActions(state, player).filter(
        (a) => a.card === id && ['cast', 'playLand'].includes(a.type),
      ),
    );
    for (const command of commands)
      assert.equal(
        dispatch(state, { player, expectedRevision: state.revision, ...command }).ok,
        true,
      );
  }
  assert.equal(JSON.stringify(state), before);
  const bolt = state.players[player].hand.find((id) => state.objects[id].name === 'Shock');
  const plan = cardDropPlan(state, player, bolt);
  assert.ok(plan.destinations.some((d) => d.target.kind === 'player'));
  assert.ok(plan.destinations.some((d) => d.target.kind === 'object'));
  assert.equal(
    plan.destinations.some((d) => state.objects[d.target.id]?.name === 'Glorious Anthem'),
    false,
  );
});
test('opponent cards, out-of-priority inputs and missing objects cannot be dragged', () => {
  const state = replay(record),
    player = state.priority;
  assert.equal(cardDropPlan(state, 1 - player, state.players[1 - player].hand[0]), null);
  assert.equal(cardDropPlan(state, player, state.players[1 - player].hand[0]), null);
  assert.equal(cardDropPlan(state, player, 'missing'), null);
});
test('a legal drop from an older revision is rejected without altering current state', () => {
  const state = replay(record),
    player = state.priority;
  const bolt = state.players[player].hand.find((id) => state.objects[id].name === 'Shock');
  const { field, ...command } = cardDropPlan(state, player, bolt).destinations[0];
  const next = dispatch(state, { type: 'pass', player }).state;
  const before = JSON.stringify(next);
  assert.equal(dispatch(next, { ...command, player, expectedRevision: state.revision }).ok, false);
  assert.equal(JSON.stringify(next), before);
});
test('combat drag plans select only engine-legal attackers and blockers without committing combat', () => {
  let state = createGame(record.config),
    attacks = 0,
    blocks = 0;
  for (let i = 0; i < 900 && state.status !== 'finished'; i++) {
    const player = state.choice?.player ?? state.priority;
    if (['attackers', 'blockers'].includes(state.choice?.kind)) {
      const before = JSON.stringify(state);
      for (const object of Object.values(state.objects)) {
        const plan = cardDropPlan(state, player, object.id);
        if (!plan) continue;
        if (plan.kind === 'attack') {
          assert.equal(canAttack(state, object, player), true);
          attacks++;
          assert.equal(plan.destinations[0].field, 1 - player);
        }
        if (plan.kind === 'block')
          for (const destination of plan.destinations) {
            assert.equal(
              canBlock(state, object, state.objects[destination.target.id], player),
              true,
            );
            blocks++;
          }
      }
      assert.equal(JSON.stringify(state), before);
    }
    const command = chooseBotCommand(state, player);
    if (!command) break;
    const result = dispatch(state, command);
    assert.equal(result.ok, true);
    state = result.state;
  }
  assert.ok(attacks > 0);
  assert.ok(blocks > 0);
});
