/** Public types for the dependency-free JavaScript engine. */
export type CardType = 'land' | 'creature' | 'instant' | 'sorcery' | 'artifact' | 'enchantment';
export type PlayerId = 0 | 1;
export type Color = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
export type HybridSymbol = `${Exclude<Color, 'C'>}/${Exclude<Color, 'C'>}`;
export type ManaCost = Partial<Record<Color | 'generic' | 'X' | HybridSymbol, number>>;
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
export type LegacyTargetKind =
  | 'any'
  | 'player'
  | 'opponent'
  | 'creature'
  | 'nonblackCreature'
  | 'spell'
  | 'noncreatureSpell'
  | 'artifact'
  | 'enchantment'
  | 'artifactOrEnchantment'
  | 'permanent';
export type NumericComparison =
  | { eq: number }
  | { ne: number }
  | { lt: number }
  | { lte: number }
  | { gt: number }
  | { gte: number };
export type CardPredicate =
  | { all: readonly CardPredicate[] }
  | { any: readonly CardPredicate[] }
  | { not: CardPredicate }
  | { type: CardType }
  | { color: 'W' | 'U' | 'B' | 'R' | 'G' | 'colorless' }
  | { controller: 'you' | 'opponent' }
  | { owner: 'you' | 'opponent' }
  | { tapped: boolean }
  | { token: boolean }
  | { basic: boolean }
  | { legendary: boolean }
  | { attacking: boolean }
  | { blocking: boolean }
  | { subtype: string }
  | { keyword: string }
  | { power: NumericComparison }
  | { toughness: NumericComparison }
  | { manaValue: NumericComparison };
export interface TargetSpec {
  scope: 'permanent' | 'spell' | 'player' | 'damageable' | 'graveyard' | 'playerOrPlaneswalker';
  where?: CardPredicate;
}
export type TargetKind = LegacyTargetKind | TargetSpec;
export interface EventSpec {
  event:
    | 'enter'
    | 'cast'
    | 'dies'
    | 'attack'
    | 'step'
    | 'attackGroup'
    | 'noncombatDamageToPlayer'
    | 'combatDamagePlayer'
    | 'lifeGain'
    | 'faceUp';
  step?: 'upkeep' | 'beginCombat' | 'end' | 'main1' | 'main2';
  object?: 'source';
  controller?: 'you' | 'opponent';
  filter?: CardPredicate;
  excludeSource?: boolean;
  spellNumber?: number;
}
export type SpellHistoryPredicate =
  | { type: CardType }
  | { color: Exclude<Color, 'C'> | 'colorless' }
  | { subtype: string }
  | { all: SpellHistoryPredicate[] }
  | { any: SpellHistoryPredicate[] }
  | { not: SpellHistoryPredicate };
export type NumericValue =
  | { kind: 'x' }
  | number
  | {
      kind: 'count';
      zone: 'battlefield' | 'graveyard' | 'exile' | 'hand' | 'library';
      player: 'you' | 'opponent' | 'all';
      where?: CardPredicate;
      excludeSource?: boolean;
    }
  | { kind: 'spellsCast'; player: 'you' | 'opponent' | 'all'; where?: SpellHistoryPredicate }
  | { kind: 'life'; player: 'you' | 'opponent' }
  | { kind: 'sum'; values: NumericValue[] }
  | { kind: 'scale'; value: NumericValue; factor: number };
export interface TargetGroup {
  id: string;
  label?: string;
  selector: TargetKind;
  min: number;
  max: number;
  excludeFrom?: string[];
}
export type TargetPlan = Record<string, Target[]>;
export type Effect = EffectInstruction & { targetGroup?: string };
type EffectInstruction =
  | { op: 'sacrificeSelf' }
  | {
      op: 'sacrifice';
      count: number;
      player: 'controller' | 'opponent' | 'target' | 'all';
      where?: CardPredicate;
    }
  | { op: 'drawEventAmount' }
  | { op: 'conditional'; condition: StateCondition; then: Effect[]; else?: Effect[] }
  | { op: 'stunOn'; amount: NumericValue; subject?: 'source' | 'attached' }
  | { op: 'fight' | 'bite'; sourceGroup: string; victimGroup: string }
  | { op: 'damageEventPowerOpponent' }
  | { op: 'impulseChoose'; count: number }
  | { op: 'bindingNegotiation' }
  | { op: 'addMana'; mana: ManaCost }
  | { op: 'damageEventOpponent'; amount: NumericValue }
  | { op: 'damage' | 'damageOpponent'; amount: NumericValue }
  | {
      op: 'gainLife' | 'loseLife';
      amount: NumericValue;
      player?: 'controller' | 'opponent' | 'target';
    }
  | {
      op: 'moveTarget';
      subject?: 'source' | 'attached';
      destination: 'hand' | 'battlefield' | 'exile';
      controller?: 'owner' | 'you';
      tapped?: boolean;
    }
  | {
      op: 'draw' | 'scry' | 'surveil' | 'discard';
      count: NumericValue;
      player?: 'controller' | 'opponent' | 'target';
    }
  | {
      op: 'searchLibrary';
      count: number;
      where?: CardPredicate;
      destination: 'hand' | 'battlefield' | 'top' | 'graveyard';
      tapped?: boolean;
      reveal?: boolean;
    }
  | { op: 'mill'; count: NumericValue; player: 'controller' | 'opponent' | 'target' }
  | { op: 'counter' | 'attachEquipment' }
  | { op: 'bounce' | 'destroy'; subject?: 'source' | 'attached' }
  | { op: 'untap' | 'tap'; subject?: 'source' | 'attached' }
  | {
      op: 'destroyAll' | 'exileAll' | 'tapAll' | 'untapAll';
      where: CardPredicate;
      excludeSource?: boolean;
    }
  | { op: 'counterAll'; where: CardPredicate; amount: NumericValue; excludeSource?: boolean }
  | {
      op: 'modifyAll';
      where: CardPredicate;
      power: NumericValue;
      toughness: NumericValue;
      keywords?: readonly string[];
      excludeSource?: boolean;
    }
  | {
      op: 'damageAll';
      where?: CardPredicate;
      amount: NumericValue;
      players?: 'none' | 'controller' | 'opponent' | 'all';
      excludeSource?: boolean;
    }
  | { op: 'counterOn'; subject?: 'source' | 'attached'; amount: NumericValue }
  | {
      op: 'modify';
      subject?: 'source' | 'attached';
      power: NumericValue;
      toughness: NumericValue;
      keywords?: string[];
    }
  | {
      op: 'token';
      definition: string;
      count: NumericValue;
      temporaryKeywords?: string[];
      player?: 'controller' | 'opponent' | 'target' | 'targetController';
      tapped?: boolean;
    };
export type StateCondition =
  | {
      kind:
        | 'opponentLostLifeThisTurn'
        | 'controllerLostLifeThisTurn'
        | 'controllerTurn'
        | 'opponentTurn';
    }
  | { kind: 'controlAtLeast'; count: number; where: CardPredicate }
  | {
      kind: 'compare';
      left: NumericValue;
      right: NumericValue;
      operator: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte';
    }
  | { kind: 'all' | 'any'; conditions: StateCondition[] };
export type ContinuousCondition =
  | StateCondition
  | { kind: 'sourceAttacking' | 'sourceEnteredThisTurn' }
  | { kind: 'all' | 'any'; conditions: ContinuousCondition[] };

export interface CardDefinition {
  readonly name: string;
  readonly type: CardType;
  readonly types?: readonly CardType[];
  readonly cost: ManaCost;
  readonly text: string;
  readonly color: readonly string[];
  readonly keywords: readonly string[];
  readonly subtypes: readonly string[];
  readonly power?: number;
  readonly toughness?: number;
  readonly basic?: boolean;
  readonly legendary?: boolean;
  readonly token?: boolean;
  readonly mana?: Color | readonly Color[];
  readonly manaSacrifice?: boolean;
  readonly chooseCreatureType?: boolean;
  readonly manaRestrictions?: Partial<Record<Color, 'creature' | 'chosenCreatureType'>>;
  readonly entersTapped?: boolean;
  readonly entersTappedUnless?: StateCondition;
  readonly manaConditions?: Partial<Record<Color, StateCondition>>;
  readonly targetGroups?: readonly TargetGroup[];
  readonly target?: TargetKind | null;
  readonly effects?: readonly Effect[];
  readonly crew?: number;
  readonly cycling?: ManaCost;
  readonly cyclingType?: string;
  readonly flashback?: ManaCost;
  readonly kicker?: { cost: ManaCost; effects: readonly Effect[] };
  readonly offspring?: ManaCost;
  readonly disguise?: ManaCost;
  readonly startEngines?: boolean;
  readonly maxSpeedKeywords?: readonly string[];
  readonly entryStunCounters?: number;
  readonly entryCounterBonus?: { amount: number; condition: StateCondition };
  readonly damageBonus?: { amount: number; where: CardPredicate };
  readonly cannotAttack?: boolean;
  readonly cannotBlock?: boolean;
  readonly unblockable?: boolean;
  readonly uncounterable?: boolean;
  readonly modes?: readonly {
    label: string;
    target?: TargetKind;
    targetGroups?: readonly TargetGroup[];
    effects: readonly Effect[];
  }[];
  readonly etb?: readonly Effect[];
  readonly ward?: { mana?: ManaCost; life?: number };
  readonly baseStats?: { power?: NumericValue; toughness?: NumericValue };
  readonly costModifiers?: readonly {
    scope: 'self' | 'you' | 'opponent' | 'all';
    change: 'reduce' | 'increase';
    amount: NumericValue;
    where?: CardPredicate;
    targetWhere?: CardPredicate;
    condition?: StateCondition;
  }[];
  readonly conditionalBonuses?: readonly {
    affects: 'self' | 'attached';
    condition: ContinuousCondition;
    power: NumericValue;
    toughness: NumericValue;
    keywords?: readonly string[];
  }[];
  readonly selfBonus?: { power: NumericValue; toughness: NumericValue };
  readonly aura?: 'pacifism' | 'creature';
  readonly attachmentBonus?: {
    noUntap?: boolean;
    power: NumericValue;
    toughness: NumericValue;
    keywords?: readonly string[];
  };
  readonly static?: {
    kind: 'anthem';
    power: NumericValue;
    toughness: NumericValue;
    where?: CardPredicate;
    excludeSource?: boolean;
    keywords?: readonly string[];
  };
  readonly triggers?: readonly {
    event:
      | EventSpec
      | 'selfEnters'
      | 'selfAttacks'
      | 'selfDies'
      | 'otherCreatureDies'
      | 'controllerCreatureDies'
      | 'controllerLandEnters'
      | 'controllerCastsArtifact'
      | 'controllerCastsEnchantment'
      | 'controllerCastsCreature'
      | 'otherCreatureEnters'
      | 'controllerCastsNoncreature'
      | 'controllerCastsInstantOrSorcery';
    effects: readonly Effect[];
    target?: TargetKind;
    targetGroups?: readonly TargetGroup[];
    optional?: boolean;
    condition?: StateCondition;
  }[];
  readonly activated?: readonly {
    cost: { mana?: ManaCost; tap?: boolean; life?: number; sacrificeSelf?: boolean; discard?: 1 };
    target?: TargetKind | null;
    targetGroups?: readonly TargetGroup[];
    effects: readonly Effect[];
    text: string;
    timing?: 'sorcery';
    condition?: StateCondition;
    oncePerTurn?: boolean;
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
  stunCounters?: number;
  damage: number;
  deathtouchDamage: boolean;
  controlledSince: number;
  enteredTurn?: number;
  token: boolean;
  attachedTo: ObjectTarget | null;
  faceDown?: boolean;
  flashbackPaid?: boolean;
  definitionOverride?: CardDefinition;
  chosenCreatureType?: string;
  chosenX?: number;
  abilityUses?: Record<number, string>;
  playPermission?: { player: PlayerId; turn: number; incarnation: number };
}
export interface PlayerState {
  id: PlayerId;
  name: string;
  life: number;
  mana: Record<Color, number>;
  restrictedMana?: {
    color: Color;
    restriction: 'creature' | 'chosenCreatureType';
    creatureType?: string;
    uncounterable: boolean;
  }[];
  speed?: number;
  speedTriggeredTurn?: number;
  lifeLostTurn?: number;
  spellsCast?: {
    turn: number;
    profiles: {
      definition: {
        type: CardType;
        types: CardType[];
        color: Color[];
        subtypes: string[];
        keywords: string[];
      };
      count: number;
    }[];
  };
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
  source: ObjectTarget | null;
  sourceDefinition?: CardDefinition;
  x?: number;
  castingCost?: ManaCost;
  rule?: 'increaseSpeed';
  flashbackPaid?: boolean;
  kicked?: boolean;
  offspringPaid?: boolean;
  uncounterable?: boolean;
  condition?: StateCondition;
  sourceKeywords: string[];
  sourceController?: PlayerId;
  eventAmount?: number;
  damagedPlayer?: PlayerId;
  sourceAttachment?: ObjectTarget | null;
  effects: (
    | Effect
    | { op: 'animateVehicle' }
    | { op: 'wardPayment'; cost: { mana?: ManaCost; life?: number } }
  )[];
  targetGroups?: TargetGroup[];
  targets?: TargetPlan;
  targetKind?: TargetKind | null;
  target?: Target | null;
  label?: string;
  mode?: number;
  modeLabel?: string;
  relatedStackId?: string;
  optional?: boolean;
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
  | {
      kind: 'exilePlay' | 'bindingNegotiation' | 'exileToGraveyard';
      player: PlayerId;
      cards: string[];
      targetPlayer?: PlayerId;
    }
  | {
      kind: 'auraEntry';
      player: PlayerId;
      card: string;
      cards: string[];
      targets: ObjectTarget[];
      typeChoices: Record<string, string>;
      auraChoices: Record<string, ObjectTarget>;
      entries: {
        object: ObjectTarget;
        controller?: PlayerId;
        attachment?: ObjectTarget | null;
        tapped?: boolean;
      }[];
    }
  | {
      kind: 'creatureType';
      auraChoices?: Record<string, ObjectTarget>;
      player: PlayerId;
      card: string;
      types: readonly string[];
      typeChoices: Record<string, string>;
      entries: {
        object: ObjectTarget;
        controller?: PlayerId;
        attachment?: ObjectTarget | null;
        tapped?: boolean;
      }[];
    }
  | {
      kind: 'legendRule';
      player: PlayerId;
      name: string;
      cards: string[];
      remaining: { player: PlayerId; name: string; cards: string[] }[];
      toGrave: string[];
    }
  | {
      kind: 'triggerTarget';
      player: PlayerId;
      entry: StackEntry;
      targets: Target[];
      remainingEntries: StackEntry[];
      remaining: { player: PlayerId; entries: StackEntry[] }[];
    }
  | {
      kind: 'triggerTargets';
      player: PlayerId;
      entry: StackEntry;
      remainingEntries: StackEntry[];
      remaining: { player: PlayerId; entries: StackEntry[] }[];
    }
  | { kind: 'optionalEffect'; player: PlayerId; name: string }
  | {
      kind: 'payCost';
      player: PlayerId;
      cost: { mana?: ManaCost; life?: number };
      stackId: string;
      reason: 'ward';
      payable: boolean;
    }
  | { kind: 'mulligan' | 'attackers' | 'blockers'; player: PlayerId }
  | {
      kind: 'librarySearch';
      player: PlayerId;
      cards: string[];
      min: number;
      max: number;
      destination: 'hand' | 'battlefield' | 'top' | 'graveyard';
      tapped: boolean;
      reveal: boolean;
      where: CardPredicate | null;
    }
  | { kind: 'libraryOrder'; player: PlayerId; action: 'scry' | 'surveil'; cards: string[] }
  | {
      kind: 'sacrifice';
      player: PlayerId;
      count: number;
      cards: string[];
      refs: ObjectTarget[];
      remaining: Array<{ player: PlayerId; count: number; cards: string[]; refs: ObjectTarget[] }>;
      selected: Array<ObjectTarget & { player: PlayerId }>;
    }
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
    addTypes?: CardType[];
    expires: number;
  }[];
  choice: Choice | null;
  resolving: { entry: StackEntry; index: number; revealedPlayer?: PlayerId } | null;
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
  | { type: 'turnFaceUp'; card: string }
  | { type: 'chooseCreatureType'; creatureType: string }
  | { type: 'chooseAuraAttachment'; card: string }
  | { type: 'chooseResolutionCard'; card: string | null }
  | { type: 'chooseLegend'; card: string }
  | { type: 'crew'; card: string; cards: string[] }
  | { type: 'cycle'; card: string }
  | { type: 'resolveOptional'; accept: boolean }
  | { type: 'payCost'; pay: boolean }
  | { type: 'pass' | 'concede' | 'keep' | 'mulligan' }
  | { type: 'playLand'; card: string }
  | { type: 'tapMana'; card: string; color?: Color }
  | {
      type: 'cast';
      card: string;
      targets?: TargetPlan;
      target?: Target;
      autoTap?: boolean;
      x?: number;
      mode?: number;
    }
  | {
      type: 'activate';
      card: string;
      ability: number;
      discardCard?: string;
      targets?: TargetPlan;
      target?: Target;
    }
  | { type: 'bottom' | 'discard' | 'discardEffect' | 'sacrifice' | 'attackers'; cards: string[] }
  | { type: 'blockers'; pairs: { blocker: string; attacker: string }[] }
  | { type: 'assignDamage'; orders: DamageOrder[] }
  | { type: 'orderTriggers'; ids: string[] }
  | { type: 'chooseTriggerTargets'; targets: TargetPlan }
  | { type: 'chooseTriggerTarget'; target: Target }
  | { type: 'searchLibrary'; cards: string[] }
  | { type: 'orderLibrary'; top: string[]; rest: string[] };
export type Command = Action & { player: PlayerId; expectedRevision?: number };
export type LegalAction =
  | { type: 'pass' | 'concede' }
  | Extract<
      Action,
      {
        type:
          | 'pass'
          | 'concede'
          | 'playLand'
          | 'tapMana'
          | 'cast'
          | 'turnFaceUp'
          | 'crew'
          | 'cycle'
          | 'activate'
          | 'chooseTriggerTarget'
          | 'chooseTriggerTargets'
          | 'chooseLegend';
      }
    >
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
    {
      name: string;
      colors: Color[];
      description: string;
      art: string;
      thumbnail: string;
      archetype: string;
      cards: Record<string, number>;
    }
  >
>;
export class RuleError extends Error {
  code: string;
  constructor(code: string, message: string);
}
export function createGame(config?: GameConfig): GameState;
export function dispatch(state: GameState, command: Command): DispatchResult;
export function legalActions(
  state: GameState,
  player: PlayerId,
  options?: { x?: number },
): LegalAction[];
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
export function manaOptions(state: GameState, object: GameObject): readonly Color[];
export function canTapForMana(state: GameState, object: GameObject, player: PlayerId): boolean;
export function canPlayLand(state: GameState, player: PlayerId, id: string): boolean;
export function castProblem(
  state: GameState,
  player: PlayerId,
  id: string,
  target?: Target,
  options?: { autoTap?: boolean; mode?: number; targets?: TargetPlan; x?: number },
): string | null;
export function abilityProblem(
  state: GameState,
  player: PlayerId,
  id: string,
  index: number,
  target?: Target | null,
  discardCard?: string,
  targets?: TargetPlan,
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
  options?: { autoTap?: boolean; excludeSources?: string[] },
): {
  taps: string[];
  activations: { card: string; color: Color }[];
  spent: Record<Color, number>;
  remaining: Record<Color, number>;
} | null;
export function suggestedDamage(
  state: GameState,
  choice?: Extract<Choice, { kind: 'assignDamage' }>,
): DamageOrder[];
export function chooseBotCommand(state: GameState, player: PlayerId): Command | null;
export function assertInvariants(state: GameState): true;
export function exportReplay(state: GameState): Replay;
export function replay(record: Replay): GameState;
export function playerView(
  state: GameState,
  viewer: PlayerId,
  options?: { includeEvents?: boolean },
): PlayerView;

export class RegistryError extends Error {
  diagnostics: string[];
  constructor(diagnostics: string[]);
}
export function validateDefinition(card: unknown): string[];
export function createRegistry(
  input?: Readonly<Record<string, CardSpec>> | readonly CardSpec[],
): Readonly<Record<string, CardDefinition>>;

export function hasType(card: CardDefinition, type: CardType): boolean;
export function typesOf(card: CardDefinition): readonly CardType[];
export function primaryType(types: readonly CardType[]): CardType | undefined;

export function targetSpec(value: TargetKind): Readonly<TargetSpec> | null;
export function validateTargetSpec(value: unknown): string[];
export function validateFilter(value: unknown): string[];

export const CARD_IDS: Readonly<Record<string, string>>;
export function resolveCardName(identifier: string): string | null;

export function eventSpec(value: string | EventSpec): Readonly<EventSpec> | null;
export function validateEventSpec(value: unknown): string[];

export function spellProfile(card: CardDefinition, mode?: number): CardDefinition | null;
export function spellOptions(card: CardDefinition): { mode?: number; profile: CardDefinition }[];

export function cyclingProblem(state: GameState, player: PlayerId, id: string): string | null;

export function castingProfile(
  state: GameState,
  player: PlayerId,
  object: GameObject,
  mode?: number,
  target?: Target | Target[] | null,
  card?: CardDefinition,
  x?: number,
): CardDefinition | null;

export function crewProblem(
  state: GameState,
  player: PlayerId,
  id: string,
  cards: string[],
): string | null;
export function crewCandidates(state: GameState, player: PlayerId, id: string): GameObject[];
export function crewPlan(state: GameState, player: PlayerId, id: string): string[] | null;
export function manaValue(card: CardDefinition, x?: number): number;
export const MAX_X: number;
