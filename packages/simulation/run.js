import { createSession } from './session.js';
import { chooseBotCommand } from '../engine/src/index.js';

export const heuristicPolicy = ({ observation, player }) => chooseBotCommand(observation, player);

/** Policies receive only their immutable perspective. Limits are truncations, not draws. */
export async function runEpisode({
  config = {},
  policies = [heuristicPolicy, heuristicPolicy],
  maxDecisions = 3000,
  signal,
  includeReplay = false,
} = {}) {
  if (!Number.isSafeInteger(maxDecisions) || maxDecisions < 1 || maxDecisions > 10000)
    throw new Error('maxDecisions must be from 1 to 10000.');
  if (
    !Array.isArray(policies) ||
    policies.length !== 2 ||
    policies.some((p) => typeof p !== 'function')
  )
    throw new Error('Provide two policy functions.');
  const session = createSession(config);
  let termination = 'decision_limit',
    error = null;
  for (let i = 0; i < maxDecisions; i++) {
    if (signal?.aborted) {
      termination = 'aborted';
      break;
    }
    const context = session.context();
    if (!context) {
      termination = 'finished';
      break;
    }
    let command;
    try {
      command = await policies[context.player](context);
    } catch (e) {
      termination = 'policy_error';
      error = { player: context.player, message: String(e.message ?? e) };
      break;
    }
    if (signal?.aborted) {
      termination = 'aborted';
      break;
    }
    const result = session.step(command);
    if (!result.ok) {
      termination = 'illegal_command';
      error = { player: context.player, ...result.error };
      break;
    }
    if (result.terminal) {
      termination = 'finished';
      break;
    }
  }
  return {
    schemaVersion: 1,
    termination,
    ...session.summary(),
    error,
    ...(includeReplay ? { replay: session.exportReplay() } : {}),
  };
}
