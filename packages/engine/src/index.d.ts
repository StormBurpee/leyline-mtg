/** Public types for the dependency-free JavaScript engine. */
export type PlayerId = 0 | 1;
export type Color = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
export type ManaCost = Partial<Record<Color | 'generic', number>>;
export type Zone = 'library' | 'hand' | 'battlefield' | 'stack' | 'graveyard' | 'exile' | 'void';
export type Step =
  | 'upkeep'
  | 'draw'
  | 'main1'
  | 'beginCombat'
  | 'attackers'
  | 'blockers'
  | 'firstDamage'
  | 'damage'
  | 'endCombat'
  | 'main2'
  | 'end'
  | 'cleanup';
export type ObjectTarget = { kind: 'object'; id: string; incarnation: number };
export type Target =
  | ObjectTarget
  | { kind: 'player'; id: PlayerId }
  | { kind: 'stack'; id: string };
export type TargetKind =
  | 'any'
  | 'player'
  | 'opponent'
  | 'creature'
  | 'nonblackCreature'
  | 'spell'
  | 'noncreatureSpell';
export type Effect =
  | { op: 'damage' | 'damageOpponent' | 'gainLife'; amount: number }
  | { op: 'draw' | 'scry' | 'surveil' | 'discard'; count: number }
  | { op: 'counter' | 'bounce' | 'destroy' }
  | { op: 'untap'; subject: 'source' }
  | { op: 'counterOn'; subject: 'source'; amount: number }
  | { op: 'modify'; subject?: 'source'; power: number; toughness: number; keywords?: string[] }
  | { op: 'token'; definition: string; count: number };
export interface CardDefinition {
  readonly name: string;
  readonly type: 'land' | 'creature' | 'instant' | 'sorcery' | 'enchantment' | 'artifact';
  readonly cost: ManaCost;
  readonly text: string;
  readonly color: readonly string[];
  readonly keywords: readonly string[];
  readonly subtypes: readonly string[];
  readonly power?: number;
  readonly toughness?: number;
  readonly basic?: boolean;
  readonly token?: boolean;
  readonly mana?: Color;
  readonly target?: TargetKind | null;
  readonly effects?: readonly Effect[];
  readonly etb?: readonly Effect[];
  readonly aura?: 'pacifism';
  readonly static?: { kind: 'anthem'; power: number; toughness: number };
  readonly triggers?: readonly {
    event: 'otherCreatureEnters' | 'controllerCastsNoncreature' | 'controllerCastsInstantOrSorcery';
    effects: readonly Effect[];
  }[];
  readonly activated?: readonly {
    cost: { mana?: ManaCost; tap?: boolean };
    target?: TargetKind | null;
    effects: readonly Effect[];
    text: string;
  }[];
}
export type CardSpec = Omit<CardDefinition, 'text' | 'color' | 'keywords' | 'subtypes'> &
  Partial<Pick<CardDefinition, 'text' | 'color' | 'keywords' | 'subtypes'>>;
export interface GameObject {
  id: string;
  name: string;
  owner: PlayerId;
  controller: PlayerId;
  zone: Zone;
  incarnation: number;
  tapped: boolean;
  plusCounters: number;
  damage: number;
  deathtouchDamage: boolean;
  controlledSince: number;
  token: boolean;
  attachedTo: ObjectTarget | null;
}
export interface PlayerState {
  id: PlayerId;
  name: string;
  life: number;
  mana: Record<Color, number>;
  hand: string[];
  library: string[];
  graveyard: string[];
  exile: string[];
  failedDraw: boolean;
  landsPlayed: number;
  mulligans: number;
  kept: boolean;
}
export interface StackEntry {
  id: string;
  kind: 'spell' | 'ability';
  name: string;
  controller: PlayerId;
  source: ObjectTarget;
  sourceKeywords: string[];
  effects: Effect[];
  targetKind?: TargetKind | null;
  target?: Target | null;
  label?: string;
}
export interface DamageOrder {
  source: string;
  assignments: { target: Target; amount: number }[];
}
export interface DamageSource {
  source: ObjectTarget;
  controller: PlayerId;
  power: number;
  targets: Target[];
  trample: boolean;
  blockers: ObjectTarget[];
  keywords: string[];
}
export type Choice =
  | { kind: 'mulligan' | 'attackers' | 'blockers'; player: PlayerId }
  | { kind: 'libraryOrder'; player: PlayerId; action: 'scry' | 'surveil'; cards: string[] }
  | { kind: 'bottom' | 'discard' | 'discardEffect'; player: PlayerId; count: number }
  | {
      kind: 'orderTriggers';
      player: PlayerId;
      entries: StackEntry[];
      remaining: { player: PlayerId; entries: StackEntry[] }[];
    }
  | {
      kind: 'assignDamage';
      player: PlayerId;
      sources: DamageSource[];
      remaining: { player: PlayerId; sources: DamageSource[] }[];
      packets: DamagePacket[];
    };
export interface DamagePacket {
  source: { id: string; controller: PlayerId; keywords: string[] };
  target: Target;
  amount: number;
}
export interface GameConfig {
  catalog?: Readonly<Record<string, CardSpec>> | readonly CardSpec[];
  decks?: string[][];
  seed?: number;
  startingPlayer?: PlayerId;
  names?: string[];
  mulligan?: boolean;
  minimumDeckSize?: number;
}
export interface GameEvent {
  readonly seq: number;
  readonly turn: number;
  readonly step: Step;
  readonly type: string;
  readonly [key: string]: unknown;
}
export interface GameState {
  catalog: Readonly<Record<string, CardDefinition>>;
  version: string;
  seed: number;
  rng: number;
  nextId: number;
  eventSeq: number;
  revision: number;
  turn: number;
  active: PlayerId;
  startingPlayer: PlayerId;
  step: Step;
  priority: PlayerId;
  passes: number;
  status: 'mulligan' | 'playing' | 'finished';
  winner: PlayerId | null;
  objects: Record<string, GameObject>;
  stack: StackEntry[];
  pendingTriggers: StackEntry[];
  modifiers: {
    objectId: string;
    incarnation: number;
    power?: number;
    toughness?: number;
    keywords?: string[];
    expires: number;
  }[];
  choice: Choice | null;
  resolving: { entry: StackEntry; index: number } | null;
  combat: {
    attackers: ObjectTarget[];
    blocks: Record<string, ObjectTarget[]>;
    blocked: string[];
    firstEligible: string[];
    hasFirst: boolean;
  };
  events: readonly GameEvent[];
  history: readonly Command[];
  config: GameConfig;
  players: PlayerState[];
}
export type Action =
  | { type: 'pass' | 'concede' | 'keep' | 'mulligan' }
  | { type: 'playLand' | 'tapMana'; card: string }
  | { type: 'cast'; card: string; target?: Target; autoTap?: boolean }
  | { type: 'activate'; card: string; ability: number; target?: Target }
  | { type: 'bottom' | 'discard' | 'discardEffect' | 'attackers'; cards: string[] }
  | { type: 'blockers'; pairs: { blocker: string; attacker: string }[] }
  | { type: 'assignDamage'; orders: DamageOrder[] }
  | { type: 'orderTriggers'; ids: string[] }
  | { type: 'orderLibrary'; top: string[]; rest: string[] };
export type Command = Action & { player: PlayerId; expectedRevision?: number };
export type LegalAction =
  | { type: 'pass' | 'concede' }
  | Extract<Action, { type: 'pass' | 'concede' | 'playLand' | 'tapMana' | 'cast' | 'activate' }>
  | { type: 'choice'; kind: Choice['kind'] };
export type DispatchResult =
  | { ok: true; state: GameState; events: readonly GameEvent[] }
  | {
      ok: false;
      state: GameState;
      error: { code: string; message: string };
      events: readonly GameEvent[];
    };
export interface Replay {
  schemaVersion?: number;
  version: string;
  config: GameConfig;
  commands: readonly Command[];
}
export interface RedactedObject {
  id: string;
  zone: Zone;
  owner: PlayerId;
  hidden: true;
}
export type PlayerView = Omit<
  GameState,
  'rng' | 'seed' | 'config' | 'history' | 'objects' | 'choice'
> & {
  objects: Record<string, GameObject | RedactedObject>;
  choice: Choice | { kind: 'opponentChoice'; player: PlayerId } | null;
};
export const VERSION: string;
export const REPLAY_SCHEMA_VERSION: number;
export const CARDS: Readonly<Record<string, CardDefinition>>;
export const DECKS: Readonly<
  Record<
    string,
    { name: string; colors: Color[]; description: string; cards: Record<string, number> }
  >
>;
export class RuleError extends Error {
  code: string;
  constructor(code: string, message: string);
}
export function createGame(config?: GameConfig): GameState;
export function dispatch(state: GameState, command: Command): DispatchResult;
export function legalActions(state: GameState, player: PlayerId): LegalAction[];
export function cardDefinition(
  name: string,
  catalog?: Readonly<Record<string, CardDefinition>>,
): CardDefinition;
export function definition(object: GameObject): CardDefinition;
export function definition(state: GameState, object: GameObject): CardDefinition;
export function expandDeck(list: Record<string, number>): string[];
export function validateDeck(
  names: string[],
  options?: { minimum?: number; catalog?: Readonly<Record<string, CardDefinition>> },
): string[];
export function parseDeck(
  text: string,
  options?: { catalog?: Readonly<Record<string, CardDefinition>> },
): { names: string[]; errors: string[] };
export function stats(state: GameState, object: GameObject): { power: number; toughness: number };
export function keywords(state: GameState, object: GameObject): string[];
export function hasKeyword(state: GameState, object: GameObject, keyword: string): boolean;
export function isSick(state: GameState, object: GameObject): boolean;
export function isPacified(state: GameState, object: GameObject): boolean;
export function ref(object: GameObject): ObjectTarget;
export function controlled(state: GameState, player: PlayerId): GameObject[];
export function battlefield(state: GameState): GameObject[];
export function canAttack(state: GameState, object: GameObject, player: PlayerId): boolean;
export function canBlock(
  state: GameState,
  blocker: GameObject,
  attacker: GameObject,
  player: PlayerId,
): boolean;
export function canTapForMana(state: GameState, object: GameObject, player: PlayerId): boolean;
export function canPlayLand(state: GameState, player: PlayerId, id: string): boolean;
export function castProblem(
  state: GameState,
  player: PlayerId,
  id: string,
  target?: Target,
  options?: { autoTap?: boolean },
): string | null;
export function abilityProblem(
  state: GameState,
  player: PlayerId,
  id: string,
  index: number,
  target?: Target,
): string | null;
export function legalTarget(
  state: GameState,
  kind: TargetKind | null,
  target: Target | null,
  controller: PlayerId,
): boolean;
export function targetsFor(state: GameState, kind: TargetKind, player: PlayerId): Target[];
export function planPayment(
  state: GameState,
  player: PlayerId,
  cost: ManaCost,
  options?: { autoTap?: boolean },
): { taps: string[]; spent: Record<Color, number>; remaining: Record<Color, number> } | null;
export function suggestedDamage(
  state: GameState,
  choice?: Extract<Choice, { kind: 'assignDamage' }>,
): DamageOrder[];
export function chooseBotCommand(state: GameState, player: PlayerId): Command | null;
export function assertInvariants(state: GameState): true;
export function exportReplay(state: GameState): Replay;
export function replay(record: Replay): GameState;
export function playerView(state: GameState, viewer: PlayerId): PlayerView;

export class RegistryError extends Error {
  diagnostics: string[];
  constructor(diagnostics: string[]);
}
export function validateDefinition(card: unknown): string[];
export function createRegistry(
  input?: Readonly<Record<string, CardSpec>> | readonly CardSpec[],
): Readonly<Record<string, CardDefinition>>;
