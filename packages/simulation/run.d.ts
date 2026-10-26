import type { Command, GameConfig, Replay, PlayerId } from '../engine/src/index.js';
import type { AgentContext, Summary } from './session.js';
export type Policy = (context: AgentContext) => Command | null | Promise<Command | null>;
export const heuristicPolicy: Policy;
export interface EpisodeResult extends Summary {
  schemaVersion: 1;
  termination: 'finished' | 'decision_limit' | 'aborted' | 'policy_error' | 'illegal_command';
  error: null | { player: PlayerId; message: string; code?: string };
  replay?: Replay;
}
export function runEpisode(options?: {
  config?: GameConfig;
  policies?: [Policy, Policy];
  maxDecisions?: number;
  signal?: AbortSignal;
  includeReplay?: boolean;
}): Promise<EpisodeResult>;
