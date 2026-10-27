export type ConvokeChoice = {
  card: string;
  symbol: Exclude<Color, 'C'> | 'generic' | HybridSymbol;
};
/** Public types for the dependency-free JavaScript engine. */
export type CardType =
  | 'land'
  | 'creature'
  | 'instant'
  | 'sorcery'
  | 'artifact'
  | 'enchantment'
  | 'planeswalker';
export type PlayerId = 0 | 1;
export type Color = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
export type HybridSymbol = `${Exclude<Color, 'C'>}/${Exclude<Color, 'C'>}`;
export type TwobridSymbol = `2/${Exclude<Color, 'C'>}`;
export type ManaCost = Partial<
  Record<Color | 'generic' | 'X' | HybridSymbol | TwobridSymbol, number>
>;
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
  | { stunned: boolean }
  | { token: boolean }
  | { basic: boolean }
  | { legendary: boolean }
  | { adventure: boolean }
  | { attacking: boolean }
  | { blocking: boolean }
  | { name: string }
  | { subtype: string }
  | { keyword: string }
  | { power: NumericComparison }
  | { toughness: NumericComparison }
  | { manaValue: NumericComparison };
export interface TargetSpec {
  /** Exclude this exact source incarnation; source context is required. */
  excludeSource?: boolean;
  scope:
    | 'permanent'
    | 'ability'
    | 'spell'
    | 'player'
    | 'damageable'
    | 'graveyard'
    | 'playerOrPlaneswalker';
  where?: CardPredicate;
}
export type TargetKind = LegacyTargetKind | TargetSpec;
export interface EventSpec {
  event:
    | 'chapter'
    | 'enter'
    | 'cast'
    | 'dies'
    | 'diesGroup'
    | 'battlefieldToGraveyard'
    | 'battlefieldToGraveyardGroup'
    | 'sacrifice'
    | 'attack'
    | 'tap'
    | 'step'
    | 'attackGroup'
    | 'noncombatDamageToPlayer'
    | 'combatDamagePlayer'
    | 'librarySearch'
    | 'draw'
    | 'lifeGain'
    | 'faceUp'
    | 'targeted';
  step?: 'draw' | 'upkeep' | 'beginCombat' | 'end' | 'main1' | 'main2';
  object?: 'source';
  controller?: 'you' | 'opponent';
  filter?: CardPredicate;
  excludeSource?: boolean;
  chapters?: number[];
  spellNumber?: number;
  drawNumber?: number;
  castByController?: boolean;
  targetingController?: 'you' | 'opponent';
  targetingKind?: 'spell' | 'ability';
  firstEachTurn?: true;
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
  | { kind: 'maxManaValue'; player: 'you' | 'opponent' | 'all'; where?: CardPredicate }
  | { kind: 'spellsCast'; player: 'you' | 'opponent' | 'all'; where?: SpellHistoryPredicate }
  | { kind: 'life'; player: 'you' | 'opponent' }
  | { kind: 'sum'; values: NumericValue[] }
  | { kind: 'scale'; value: NumericValue; factor: number }
  | { kind: 'floorDivide'; value: NumericValue; divisor: number };
export type EffectNumericValue =
  | NumericValue
  | { kind: 'sourceStat'; stat: 'power' | 'toughness' }
  | { kind: 'sum'; values: EffectNumericValue[] }
  | { kind: 'scale'; value: EffectNumericValue; factor: number }
  | { kind: 'floorDivide'; value: EffectNumericValue; divisor: number };
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
  | { op: 'anthemEmblem'; where: CardPredicate; power: number; toughness: number }
  | { op: 'ninjutsuEnter'; defender: Target }
  | { op: 'impulseCastOrDamage' | 'castDamageEmblem'; amount: number }
  | { op: 'disableDamagePrevention' }
  | {
      op: 'damageEachPlayer' | 'damageEventPlayer' | 'damageTargetController';
      amount: NumericValue;
    }
  | { op: 'exileGraveyards'; players: 'all' | 'controller' | 'opponent' }
  | { op: 'chooseLandName' }
  | { op: 'endTurn' }
  | {
      op: 'discardTrigger';
      count: number;
      where: CardPredicate;
      selector: TargetKind;
      effects: Effect[];
    }
  | { op: 'sacrificeSelf' }
  | {
      op: 'sacrifice';
      count: number;
      player: 'controller' | 'opponent' | 'target' | 'all';
      where?: CardPredicate;
    }
  | { op: 'drawEventAmount' }
  | { op: 'creatureForm'; power: number; toughness: number; subtypes: string[] }
  | { op: 'optionalDiscardDraw' | 'distributedCounters' }
  | { op: 'becomeLand'; mana: Color[] }
  | { op: 'conditional'; condition: StateCondition; then: Effect[]; else?: Effect[] }
  | { op: 'stunOn'; amount: EffectNumericValue; subject?: 'source' | 'attached' }
  | { op: 'keywordCounter'; subject: 'source'; keyword: 'indestructible'; amount: number }
  | { op: 'fight' | 'bite'; sourceGroup: string; victimGroup: string }
  | { op: 'damageEventPowerOpponent' }
  | {
      op: 'exileTop';
      count: NumericValue;
      player: 'controller' | 'target';
      duration: 'turn' | 'nextTurn';
      castOnly?: boolean;
      anyMana?: boolean;
    }
  | { op: 'returnTransformed' | 'chooseMana' }
  | { op: 'combatMana'; count: number }
  | { op: 'impulseChoose'; count: number }
  | { op: 'bindingNegotiation' }
  | { op: 'revealDiscard'; where?: CardPredicate }
  | { op: 'explore'; subject?: 'source' }
  | { op: 'keywordCounters'; keywords: string[] }
  | { op: 'removeAbilities'; until: 'endOfTurn' | 'sourceLeaves' }
  | { op: 'counterAbility'; removeSourceAbilities?: boolean }
  | { op: 'stripDestroyByManaValue'; amount: NumericValue }
  | { op: 'returnSelfAsEnchantment' | 'shuffleSourceAndTarget' }
  | { op: 'exileGraveyards'; players: 'controller' | 'opponent' | 'all' | 'target' }
  | {
      op: 'chooseExile';
      count: number;
      player: 'controller' | 'opponent' | 'target' | 'all';
      where?: CardPredicate;
    }
  | { op: 'empowerJace'; definition: string; count: number }
  | { op: 'mobilize'; definition: string; count: EffectNumericValue }
  | { op: 'addMana'; mana: ManaCost }
  | { op: 'damageEventOpponent'; amount: EffectNumericValue }
  | { op: 'damage' | 'damageOpponent'; amount: EffectNumericValue }
  | {
      op: 'gainLife' | 'loseLife';
      amount: EffectNumericValue;
      player?: 'controller' | 'opponent' | 'target';
    }
  | {
      op: 'moveTarget';
      trackSource?: boolean;
      subject?: 'source' | 'attached';
      destination: 'hand' | 'battlefield' | 'exile';
      controller?: 'owner' | 'you';
      tapped?: boolean;
    }
  | {
      op: 'draw' | 'scry' | 'surveil' | 'discard';
      count: EffectNumericValue;
      player?: 'controller' | 'opponent' | 'target';
    }
  | {
      op: 'lookChooseHand';
      count: EffectNumericValue;
      selectCount?: EffectNumericValue;
      restOrder?: 'chosen' | 'random';
      player?: 'controller' | 'opponent' | 'target';
    }
  | {
      op: 'searchLibrary';
      count: number;
      player?: 'controller' | 'opponent' | 'target' | 'targetController';
      optional?: boolean;
      countFrom?: 'moved';
      where?: CardPredicate;
      destination: 'hand' | 'battlefield' | 'top' | 'graveyard';
      tapped?: boolean;
      reveal?: boolean;
    }
  | { op: 'mill'; count: EffectNumericValue; player: 'controller' | 'opponent' | 'target' }
  | { op: 'counter'; unlessPay?: ManaCost; exile?: boolean }
  | { op: 'attachEquipment' }
  | { op: 'exileUntilSourceLeaves' | 'moveLinkedExileToGraveyard' }
  | { op: 'delayedBlink'; controller?: 'owner' | 'you' }
  | { op: 'exileUntilSourceLeavesAll'; where: CardPredicate }
  | { op: 'bounce' | 'destroy'; subject?: 'source' | 'attached' }
  | { op: 'untap' | 'tap' | 'prepare' | 'unprepare'; subject?: 'source' | 'attached' }
  | {
      op: 'bounceAll' | 'destroyAll' | 'exileAll' | 'tapAll' | 'untapAll';
      player?: 'controller' | 'opponent' | 'target';
      rememberMovedCount?: boolean;
      where: CardPredicate;
      excludeSource?: boolean;
    }
  | {
      op: 'counterAll';
      where: CardPredicate;
      amount: EffectNumericValue;
      excludeSource?: boolean;
      counter?: '-1/-1';
    }
  | {
      op: 'modifyAll';
      where: CardPredicate;
      power: EffectNumericValue;
      toughness: EffectNumericValue;
      keywords?: readonly string[];
      excludeSource?: boolean;
    }
  | {
      op: 'damageAll';
      where?: CardPredicate;
      amount: EffectNumericValue;
      players?: 'none' | 'controller' | 'opponent' | 'all';
      excludeSource?: boolean;
    }
  | { op: 'doubleCounters'; subject?: 'source' | 'attached'; where?: CardPredicate }
  | { op: 'earthbend'; amount: number }
  | { op: 'questCounterTrigger'; threshold: number; selector: TargetKind; effects: Effect[] }
  | { op: 'removeCounterTrigger'; selector: TargetKind; effects: Effect[] }
  | { op: 'fightAttached' }
  | { op: 'untapSearched' }
  | { op: 'behold'; subtype: string; then: readonly Effect[] }
  | { op: 'doublePower'; subject?: 'source' | 'attached' }
  | {
      op: 'counterOn';
      subject?: 'source' | 'attached';
      amount: EffectNumericValue;
      counter?: '-1/-1';
    }
  | {
      op: 'animateLand';
      keywords?: string[];
      permanent?: true;
      allCreatureTypes?: true;
      power: number;
      toughness: number;
      colors?: Color[];
      subtypes: string[];
    }
  | {
      op: 'combatRestriction';
      subject?: 'source' | 'attached';
      restriction: 'cannotBlock' | 'cannotBeBlocked';
    }
  | {
      op: 'modify';
      subject?: 'source' | 'attached';
      power: EffectNumericValue;
      toughness: EffectNumericValue;
      keywords?: string[];
    }
  | {
      op: 'copyToken';
      subject?: 'source';
      count: number;
      exceptions?: {
        power?: number;
        toughness?: number;
        nonlegendary?: boolean;
        addSubtypes?: ('Hero' | 'Coward')[];
      };
    }
  | {
      op: 'token';
      countFrom?: 'moved';
      definition: string;
      count: EffectNumericValue;
      temporaryKeywords?: string[];
      player?: 'controller' | 'opponent' | 'target' | 'targetController';
      tapped?: boolean;
    };
export type AdditionalCastingCost =
  | { kind: 'discardOrLife'; life: number }
  | { kind: 'blight'; amount: number }
  | { kind: 'teamwork'; power: number };
export type AdditionalCostPayment =
  | null
  | { life: true }
  | { discard: ObjectTarget }
  | { blight: ObjectTarget }
  | { teamwork: ObjectTarget[] };
export type StateCondition =
  | { kind: 'sourceQuestCountersAtLeast'; count: number }
  | { kind: 'additionalCostPaid' }
  | { kind: 'sourceType'; type: CardType }
  | { kind: 'sourcePrepared'; prepared: boolean }
  | { kind: 'sourceExiledCardTypesAtLeast'; count: number }
  | { kind: 'eventManaSpentAtLeast'; count: number }
  | {
      kind:
        | 'opponentLostLifeThisTurn'
        | 'controllerLostLifeThisTurn'
        | 'controllerTurn'
        | 'opponentTurn';
    }
  | { kind: 'controllerFirstTurns'; count: number }
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

export interface TriggerMode {
  label: string;
  target?: TargetKind;
  targetGroups?: readonly TargetGroup[];
  effects: readonly Effect[];
}
export interface CardDefinition {
  readonly name: string;
  readonly type: CardType;
  readonly types?: readonly CardType[];
  readonly cost: ManaCost;
  readonly text: string;
  readonly color: readonly string[];
  readonly keywords: readonly string[];
  readonly subtypes: readonly string[];
  readonly loyalty?: number;
  readonly power?: number;
  readonly toughness?: number;
  readonly basic?: boolean;
  readonly legendary?: boolean;
  readonly token?: boolean;
  readonly mana?: Color | readonly Color[];
  readonly manaSacrifice?: boolean;
  readonly manaFromTrackedExile?: boolean;
  readonly manaLifeCosts?: Partial<Record<Color, number>>;
  readonly entryLifePayment?: number;
  readonly chooseCreatureType?: boolean;
  readonly chooseBasicLandType?: boolean;
  readonly manaRestrictions?: Partial<Record<Color, 'creature' | 'chosenCreatureType'>>;
  readonly entersTapped?: boolean;
  readonly entersTappedUnless?: StateCondition;
  readonly manaConditions?: Partial<Record<Color, StateCondition>>;
  readonly targetGroups?: readonly TargetGroup[];
  readonly target?: TargetKind | null;
  readonly effects?: readonly Effect[];
  readonly crew?: number;
  readonly ninjutsu?: ManaCost;
  readonly turnLoyaltyCreature?: {
    power: number;
    toughness: number;
    subtypes: string[];
    keywords: string[];
  };
  readonly cycling?: ManaCost;
  readonly cyclingType?: string;
  readonly flashback?: ManaCost;
  readonly harmonize?: ManaCost;
  readonly distributedCounters?: TargetKind;
  readonly cannotBeBlockedByLowerPower?: boolean;
  readonly plot?: ManaCost;
  readonly warp?: ManaCost;
  readonly mainName?: string;
  readonly backFace?: CardDefinition;
  readonly frontName?: string;
  readonly frontFaceCost?: ManaCost;
  readonly adventure?: CardDefinition;
  readonly kicker?: { cost: ManaCost; effects: readonly Effect[] };
  readonly offspring?: ManaCost;
  readonly disguise?: ManaCost;
  readonly startEngines?: boolean;
  readonly maxSpeedKeywords?: readonly string[];
  readonly entryKeywordCounters?: string[];
  readonly entryPlusCounters?: number | { readonly kind: 'x' };
  readonly landNameLock?: true;
  readonly exileGraveyardMoves?: true;
  readonly prepareSpell?: CardDefinition;
  readonly entersPrepared?: boolean;
  readonly libraryTopAccess?: { play: CardPredicate };
  readonly additionalEnterTrigger?: CardPredicate;
  readonly suppressEnterTriggers?: CardPredicate;
  readonly entryStunCounters?: number;
  readonly entryCounterBonus?: { amount: number; condition: StateCondition };
  readonly cantGainLife?: boolean;
  readonly cantPreventDamage?: boolean;
  readonly foreignCreatureSubtype?: string;
  readonly gift?: { definition: string; effects: readonly Effect[] };
  readonly drawBonus?: { amount: number; handAtMost: number };
  readonly damageBonus?: { amount: number; where: CardPredicate };
  readonly cannotAttack?: boolean;
  readonly cannotBlock?: boolean;
  readonly unblockable?: boolean;
  readonly uncounterable?: boolean;
  readonly spree?: true;
  readonly modes?: readonly {
    additionalCost?: ManaCost;
    label: string;
    target?: TargetKind;
    targetGroups?: readonly TargetGroup[];
    effects: readonly Effect[];
  }[];
  readonly etb?: readonly Effect[];
  readonly ward?: { mana?: ManaCost; life?: number };
  readonly additionalCost?: AdditionalCastingCost;
  readonly opponentCreatureProtectionBypass?: true;
  readonly abilitiesRemoved?: true;
  readonly baseStats?: { power?: NumericValue; toughness?: NumericValue };
  readonly sacrificeCost?: { where: CardPredicate };
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
    maxBlockers?: number;
    power: NumericValue;
    toughness: NumericValue;
    keywords?: readonly string[];
  };
  readonly static?: {
    kind: 'anthem';
    power: NumericValue;
    toughness: NumericValue;
    /** Keyword predicates use effective abilities; permitted only without keyword grants. */
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
    effects?: readonly Effect[];
    modes?: readonly TriggerMode[];
    target?: TargetKind;
    targetGroups?: readonly TargetGroup[];
    optional?: boolean;
    oncePerTurn?: boolean;
    /** Intervening-if: checked both when the event occurs and on resolution. */
    condition?: StateCondition;
    /** Trigger restriction: checked only when the event occurs. */
    triggerCondition?: StateCondition;
  }[];
  readonly activated?: readonly {
    powerUp?: true;
    loyalty?: number;
    cost: {
      mana?: ManaCost;
      tap?: boolean;
      life?: number;
      sacrificeSelf?: boolean;
      exileSelf?: boolean;
      discard?: 1;
    };
    /** Owner-activated from the graveyard; exileSelf is optional, not an implicit cost. */
    zone?: 'graveyard';
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
  chosenLandName?: string;
  keywordCounters?: Record<string, number>;
  powerUpUses?: Record<number, number>;
  minusCounters?: number;
  loreCounters?: number;
  questCounters?: number;
  loyalty?: number;
  loyaltyUsed?: string;
  stunCounters?: number;
  keywordCounterTimestamps?: Record<string, number>;
  layerTimestamp?: number;
  damage: number;
  deathtouchDamage: boolean;
  controlledSince: number;
  enteredTurn?: number;
  token: boolean;
  attachedTo: ObjectTarget | null;
  faceDown?: boolean;
  flashbackPaid?: boolean;
  harmonizePaid?: boolean;
  harmonize?: ObjectTarget | null;
  warpPaid?: boolean;
  transformed?: boolean;
  adventureCast?: boolean;
  trackedExile?: ObjectTarget[];
  preparedCopy?: ObjectTarget;
  preparedFrom?: ObjectTarget;
  spellCopy?: boolean;
  definitionOverride?: CardDefinition;
  chosenCreatureType?: string;
  chosenBasicLandType?: string;
  chosenX?: number;
  castPlayer?: PlayerId;
  abilityUses?: Record<number, string>;
  triggerUses?: Record<number, string>;
  targetHistory?: { stamp: string; counts: Record<string, number> };
  plotted?: { turn: number; incarnation: number };
  warped?: { turn: number; incarnation: number };
  adventured?: { player: PlayerId; incarnation: number };
  playPermission?: {
    castOnly?: boolean;
    anyMana?: boolean;
    player: PlayerId;
    turn: number;
    incarnation: number;
    untilNextTurn?: PlayerId;
    nextTurnStarted?: boolean;
  };
}
export interface PlayerState {
  id: PlayerId;
  name: string;
  life: number;
  mana: Record<Color, number>;
  restrictedMana?: {
    color: Color;
    restriction?: 'creature' | 'chosenCreatureType';
    duration?: 'combat';
    creatureType?: string;
    uncounterable?: boolean;
  }[];
  speed?: number;
  speedTriggeredTurn?: number;
  lifeLostTurn?: number;
  cardsDrawn?: { turn: number; count: number };
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
  modes?: readonly TriggerMode[];
  targetController?: PlayerId;
  movedCount?: number;
  emblem?: boolean;
  sagaChapter?: number;
  id: string;
  kind: 'spell' | 'ability';
  name: string;
  controller: PlayerId;
  source: ObjectTarget | null;
  /** One-time post-zone-change source reference used only for target exclusion. */
  targetingSource?: ObjectTarget;
  sourceDefinition?: CardDefinition;
  sourceStats?: { power: number; toughness: number };
  sourceCopyDefinition?: CardDefinition;
  x?: number;
  castingCost?: ManaCost;
  distribution?: Record<string, number>;
  convoke?: ConvokeChoice[];
  sacrifice?: ObjectTarget;
  harmonize?: ObjectTarget | null;
  rule?: 'increaseSpeed' | 'warpExile' | 'mobilizeSacrifice' | 'earthbendReturn';
  sourceQuestCounters?: number;
  additionalCost?: AdditionalCostPayment;
  delayedObjects?: ObjectTarget[];
  flashbackPaid?: boolean;
  harmonizePaid?: boolean;
  warpPaid?: boolean;
  adventureCast?: boolean;
  kicked?: boolean;
  offspringPaid?: boolean;
  giftPromised?: boolean;
  uncounterable?: boolean;
  condition?: StateCondition;
  sourceKeywords: string[];
  sourceController?: PlayerId;
  eventAmount?: number;
  eventManaSpent?: number;
  manaSpent?: number;
  damagedPlayer?: PlayerId;
  sourceAttachment?: ObjectTarget | null;
  effects: (
    | Effect
    | { op: 'animateVehicle' }
    | { op: 'returnEarthbent' }
    | { op: 'returnDelayedBlink'; controller: 'owner' | 'you' }
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
  defender?: Target;
  trample: boolean;
  blockers: ObjectTarget[];
  keywords: string[];
}
export type Choice =
  | { kind: 'castExiled'; player: PlayerId; card: string; incarnation: number; amount: number }
  | { kind: 'manaColor'; player: PlayerId; card: string }
  | {
      kind: 'entryLife';
      player: PlayerId;
      card: string;
      amount: number;
      payable: boolean;
      forcedTapped: boolean;
      typeChoices: Record<string, string>;
      auraChoices: Record<string, ObjectTarget>;
      lifeChoices: Record<string, boolean>;
      entries: {
        object: ObjectTarget;
        controller?: PlayerId;
        attachment?: ObjectTarget | null;
        tapped?: boolean;
      }[];
    }
  | {
      kind: 'empowerJace';
      player: PlayerId;
      cards: string[];
      objects: ObjectTarget[];
      count: number;
    }
  | {
      kind: 'exilePlay' | 'bindingNegotiation' | 'revealDiscard' | 'exileToGraveyard';
      eligibleCards?: string[];

      player: PlayerId;
      cards: string[];
      targetPlayer?: PlayerId;
    }
  | {
      kind: 'auraEntry';
      lifeChoices?: Record<string, boolean>;
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
      kind: 'creatureType' | 'landType';
      lifeChoices?: Record<string, boolean>;
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
      sagaSacrifices?: string[];
    }
  | {
      kind: 'triggerMode';
      player: PlayerId;
      entry: StackEntry;
      modes: number[];
      remainingEntries: StackEntry[];
      remaining: { player: PlayerId; entries: StackEntry[] }[];
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
  | { kind: 'attackDefenders'; player: PlayerId; cards: string[] }
  | { kind: 'behold'; player: PlayerId; cards: string[]; subtype: string; then: readonly Effect[] }
  | {
      kind: 'removeCounter';
      player: PlayerId;
      source: ObjectTarget;
      counters: string[];
      reflexive: Extract<Effect, { op: 'removeCounterTrigger' }>;
    }
  | { kind: 'optionalEffect'; player: PlayerId; name: string }
  | {
      kind: 'payCost';
      player: PlayerId;
      cost: { mana?: ManaCost; life?: number };
      stackId: string;
      reason: 'ward' | 'counterUnless';
      counterDestination?: 'graveyard' | 'exile';
      payable: boolean;
    }
  | { kind: 'landName'; player: PlayerId; card: string; names: string[] }
  | { kind: 'mulligan' | 'attackers' | 'blockers'; player: PlayerId }
  | {
      kind: 'librarySearch';
      optional?: boolean;
      player: PlayerId;
      cards: string[];
      min: number;
      max: number;
      destination: 'hand' | 'battlefield' | 'top' | 'graveyard';
      tapped: boolean;
      reveal: boolean;
      where: CardPredicate | null;
    }
  | {
      kind: 'libraryOrder';
      player: PlayerId;
      action: 'scry' | 'surveil' | 'lookChooseHand' | 'explore';
      revealed?: boolean;
      cards: string[];
      selectCount?: number;
      restOrder?: 'chosen' | 'random';
    }
  | {
      kind: 'sacrifice';
      destination?: 'exile';
      player: PlayerId;
      count: number;
      cards: string[];
      refs: ObjectTarget[];
      remaining: Array<{ player: PlayerId; count: number; cards: string[]; refs: ObjectTarget[] }>;
      selected: Array<ObjectTarget & { player: PlayerId }>;
    }
  | { kind: 'bottom' | 'discard'; player: PlayerId; count: number }
  | {
      kind: 'discardEffect';
      optional?: boolean;
      drawOnDiscard?: number;
      player: PlayerId;
      count: number;
      reflexive?: Extract<Effect, { op: 'discardTrigger' }>;
    }
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
  endingTurn?: boolean;
  emblems?: ({ id: string; controller: PlayerId; name: string } & (
    | { kind?: 'castDamage'; amount: number }
    | { kind: 'anthem'; where: CardPredicate; power: number; toughness: number }
  ))[];
  damagePreventionDisabledTurn?: number;
  layerClock?: number;
  rulesRevision: 1 | 2 | 3;
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
  delayedTriggers?: Omit<StackEntry, 'id'>[];
  earthbendReturns?: (Omit<StackEntry, 'id'> & { object: ObjectTarget })[];
  linkedExiles?: { source: ObjectTarget; cards: ObjectTarget[] }[];
  pendingLinkedReturns?: ObjectTarget[];
  castingCompletion?: {
    parentResolution?: NonNullable<GameState['resolving']>;
    player: PlayerId;
    command: Command;
    profile: CardDefinition;
    stackId: string;
    plan: { choices: ConvokeChoice[]; sacrifice?: ObjectTarget };
  };
  modifiers: {
    objectId: string;
    incarnation: number;
    power?: number;
    toughness?: number;
    keywords?: string[];
    addTypes?: CardType[];
    combatRestriction?: 'cannotBlock' | 'cannotBeBlocked';
    creatureForm?: { power: number; toughness: number; subtypes: string[] };
    animation?: {
      power: number;
      toughness: number;
      colors?: Color[];
      subtypes: string[];
      preserveSubtypes?: boolean;
    };
    expires?: number;
    untilNextTurn?: PlayerId;
    timestamp?: number;
    permanent?: true;
    removeAbilities?: true;
    enchantmentOnly?: true;
    untilSourceLeaves?: ObjectTarget;
    landForm?: { mana: Color[] };
  }[];
  choice: Choice | null;
  resolving: { entry: StackEntry; index: number; revealedPlayer?: PlayerId } | null;
  combat: {
    attackers: ObjectTarget[];
    defenders?: Record<string, Target>;
    blocks: Record<string, ObjectTarget[]>;
    blocked: string[];
    firstEligible: string[];
    firstIncarnations?: Record<string, number>;
    hasFirst: boolean;
  };
  events: readonly GameEvent[];
  history: readonly Command[];
  config: GameConfig;
  players: PlayerState[];
}
export type Action =
  | { type: 'turnFaceUp'; card: string }
  | { type: 'payEntryLife'; pay: boolean }
  | { type: 'chooseLandType'; landType: string }
  | { type: 'chooseCounter'; counter: string | null }
  | { type: 'chooseCreatureType'; creatureType: string }
  | { type: 'chooseAuraAttachment'; card: string }
  | { type: 'declineCastExiled' }
  | { type: 'chooseManaColor'; color: Exclude<Color, 'C'> }
  | { type: 'chooseResolutionCard'; card: string | null }
  | { type: 'chooseLegend'; card: string }
  | { type: 'crew'; card: string; cards: string[] }
  | { type: 'ninjutsu'; card: string; attacker: ObjectTarget }
  | { type: 'cycle'; card: string }
  | { type: 'plot'; card: string }
  | { type: 'resolveOptional'; accept: boolean }
  | { type: 'payCost'; pay: boolean }
  | { type: 'pass' | 'concede' | 'keep' | 'mulligan' }
  | { type: 'playLand'; card: string }
  | { type: 'tapMana'; card: string; color?: Color }
  | {
      type: 'cast';
      card: string;
      targets?: TargetPlan;
      distribution?: Record<string, number>;
      target?: Target;
      autoTap?: boolean;
      convoke?: ConvokeChoice[];
      sacrifice?: ObjectTarget;
      harmonize?: ObjectTarget | null;
      additionalCost?: AdditionalCostPayment;
      x?: number;
      mode?: number;
    }
  | {
      type: 'activate';
      card: string;
      ability: number;
      discardCard?: string;
      targets?: TargetPlan;
      distribution?: Record<string, number>;
      target?: Target;
    }
  | { type: 'bottom' | 'discard' | 'discardEffect' | 'sacrifice'; cards: string[] }
  | { type: 'chooseAttackDefenders'; defenders: Record<string, Target> }
  | { type: 'attackers'; cards: string[]; defenders?: Record<string, Target> }
  | { type: 'blockers'; pairs: { blocker: string; attacker: string }[] }
  | { type: 'assignDamage'; orders: DamageOrder[] }
  | { type: 'orderTriggers'; ids: string[] }
  | { type: 'chooseTriggerMode'; mode: number }
  | { type: 'chooseTriggerTargets'; targets: TargetPlan }
  | { type: 'chooseTriggerTarget'; target: Target }
  | { type: 'chooseLandName'; name: string }
  | { type: 'searchLibrary'; cards: string[]; decline?: boolean }
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
          | 'plot'
          | 'activate'
          | 'chooseTriggerMode'
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
  rulesRevision?: 1 | 2 | 3;
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
  options?: {
    autoTap?: boolean;
    mode?: number;
    targets?: TargetPlan;
    distribution?: Record<string, number>;
    x?: number;
    convoke?: ConvokeChoice[];
    sacrifice?: ObjectTarget;
    harmonize?: ObjectTarget | null;
    additionalCost?: AdditionalCostPayment;
  },
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
  source?: ObjectTarget | null,
): boolean;
export function targetsFor(
  state: GameState,
  kind: TargetKind,
  player: PlayerId,
  source?: ObjectTarget | null,
): Target[];
export function planPayment(
  state: GameState,
  player: PlayerId,
  cost: ManaCost,
  options?: { autoTap?: boolean; excludeSources?: string[] },
): {
  life?: number;
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

export function plotProblem(state: GameState, player: PlayerId, id: string): string | null;
export function ninjutsuProblem(
  state: GameState,
  player: PlayerId,
  id: string,
  attacker: ObjectTarget,
): string | null;
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

export function convokeCandidates(state: GameState, player: PlayerId): GameObject[];
export function convokePayment(
  state: GameState,
  player: PlayerId,
  profile: CardDefinition,
  choices?: ConvokeChoice[],
  autoTap?: boolean,
  excludeManaSources?: string[],
): {
  cost: ManaCost;
  choices: ConvokeChoice[];
  excludeSources: string[];
  mana: { activations: { card: string; color: Color }[] };
} | null;

export function harmonizeCandidates(state: GameState, player: PlayerId): GameObject[];
export function castingSacrificeCandidates(
  state: GameState,
  player: PlayerId,
  profile: CardDefinition,
): GameObject[];
export function castingPayment(
  state: GameState,
  player: PlayerId,
  profile: CardDefinition,
  options?: {
    card?: string;
    sacrifice?: ObjectTarget;
    harmonize?: ObjectTarget | null;
    additionalCost?: AdditionalCostPayment;
    convoke?: ConvokeChoice[];
    autoTap?: boolean;
  },
):
  | (NonNullable<ReturnType<typeof convokePayment>> & {
      sacrifice?: ObjectTarget;
      harmonize?: ObjectTarget | null;
      additionalCost?: AdditionalCostPayment;
    })
  | null;

export function attackDefenders(state: GameState, player?: PlayerId): Target[];
export function attackDefender(state: GameState, attacker: string): Target | null;

export function additionalCostCandidates(
  state: GameState,
  player: PlayerId,
  profile: CardDefinition,
  card?: string,
): GameObject[];
export function additionalCostOptions(
  state: GameState,
  player: PlayerId,
  profile: CardDefinition,
  card?: string,
): (AdditionalCostPayment | undefined)[];
