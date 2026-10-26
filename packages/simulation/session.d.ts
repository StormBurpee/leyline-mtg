import type {
  GameConfig,
  GameState,
  PlayerId,
  PlayerState,
  GameObject,
  LegalAction,
  Command,
  Replay,
} from '../engine/src/index.js';
export type Observation = Omit<
  GameState,
  | 'seed'
  | 'rng'
  | 'config'
  | 'history'
  | 'events'
  | 'nextId'
  | 'eventSeq'
  | 'pendingTriggers'
  | 'players'
  | 'objects'
  | 'choice'
> & {
  players: (Omit<PlayerState, 'library' | 'hand'> & {
    libraryCount: number;
    handCount: number;
    hand?: string[];
  })[];
  objects: Record<string, GameObject>;
  choice: null | { kind: string; player: PlayerId; [key: string]: unknown };
};
export interface AgentContext {
  readonly schemaVersion: 1;
  readonly player: PlayerId;
  readonly revision: number;
  readonly observation: Observation;
  readonly actions: readonly (LegalAction & { player: PlayerId })[];
}
export interface Summary {
  engineVersion: string;
  status: GameState['status'];
  winner: PlayerId | null;
  turn: number;
  decisions: number;
}
export interface Session {
  context(): AgentContext | null;
  step(
    command: Command,
  ):
    | { ok: true; revision: number; terminal: boolean }
    | { ok: false; error: { code: string; message: string } };
  summary(): Summary;
  exportReplay(): Replay;
}
export function createSession(config?: GameConfig): Session;
