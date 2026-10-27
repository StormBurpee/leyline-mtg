# Supported rules and cards

This is a small executable kernel, not a full Magic implementation. A name appearing in Scryfall or a display image does not imply support. The source of truth is `packages/cards/cards/`; `packages/engine/src/generated-catalog.js` is its compiled runtime artifact.

## Scope

- Two-player, 20-life local constructed games, with configurable test fixtures.
- Deck validation: at least 60 cards in the client, at most 250, up to four copies of nonbasic cards. No format-specific banned list or set-rotation certification.
- London mulligans, chosen bottom cards, first-player first-draw skip, cleanup discard.
- Main-phase land timing, one land per turn, instant/sorcery timing, priority and LIFO stack.
- Mana pools, colored and generic costs, mana abilities, flexible single-mana sources and optional automatic source selection. No hybrid, Phyrexian, snow, variable X, alternative or additional costs.
- Creature tap costs and attacking remain restricted until the controller’s next turn begins, unless the creature has haste.
- Objects changing zones become new incarnations; spells recheck targets at resolution.
- Creatures, instants, sorceries, basic/nonbasic mana lands, supported artifacts and enchantments. Artifact and enchantment creatures retain both types; only the listed executable definitions are supported.
- Type-aware artifact/enchantment removal, permanent bounce and exile.
- Attacking/legendary/keyword target predicates, target rechecking, targeted +1/+1 counters and permanent untapping. Keyword-only temporary modifiers can affect noncreature permanents.
- Public graveyard-card targets, recovery to hand and creature/artifact reanimation with fresh incarnations and enters triggers.
- Player-directed draw/discard/life gain/life loss, including choices made by an opponent during resolution.
- Triggered abilities choose legal targets when placed on the stack, before priority. Impossible required targets remove the trigger; targets are rechecked on resolution.
- Creature-death triggers with pre-event characteristics/controllers and simultaneous death snapshots. Tokens trigger before ceasing to exist.
- Optional triggered effects with explicit resolution-time accept/decline choices.
- Activated abilities with mana, life, tap and self-sacrifice costs, explicit targets, and stack resolution.
- Scry, surveil and mandatory discard choices during resolution, with instruction continuations and no intervening priority.
- Choose-one instant/sorcery modes announced at cast time with independent targets/effects, public stack labels and replayed mode indices. Unavailable modes are not legal actions.
- Group destruction/exile, damage, temporary modifiers, counters and tap/untap effects with explicit filters and simultaneous departure snapshots.
- Treasure/Food/Clue and additional fixed creature tokens; sacrificing mana sources; cycling from hand; upkeep, combat, main-phase and end-step triggers; stable filtered static anthems and intrinsic attack/block restrictions.
- Own-library search with basic/type/subtype/color/mana-value filters, chosen quantities, explicit reveal flags, hand/graveyard/battlefield/top destinations and deterministic shuffle. Unrestricted searches require the available quantity; quality-restricted searches can fail to find. Multiple searched permanents enter together.
- Ward triggers for opposing spells and activated/triggered abilities, with optional mana/life payments during resolution. Multiple ward instances and other payment families remain unsupported.
- Schema-checked card sources, reusable mechanics, composable target/event predicates and all-or-nothing pack compilation.
- Immutable per-game catalogs validated before play and embedded in replays.
- ETB, landfall, declared-attacker, noncreature-cast and instant/sorcery-cast triggers. APNAP order and explicit same-controller ordering.
- Menace, haste, vigilance, flying, reach, defender, first strike, double strike, trample, deathtouch and lifelink in the supported card pool.
- Prowess-style triggers, persistent +1/+1 counters, temporary stat/keyword modifiers, token creation, card draw, mill, damage, life gain, countering, destroy and bounce.
- Simultaneous combat damage with player-chosen splits across multiple blockers.
- Legendary permanents: explicit controller choices in APNAP order, simultaneous graveyard placement alongside other state-based actions, and retained death/enter triggers. Indestructible does not prevent the legend rule.
- State-based loss from life or empty-library draw, lethal/zero-toughness/deathtouch deaths, token cleanup and invalid Aura attachments.

## Further Standard expansion (v0.27)

- Two-color hybrid mana symbols reserve fixed colored costs, select actual payment colors and consume floating mana only once. Monocolored-hybrid ({2/W}), Phyrexian and variable-X costs remain unsupported.
- Intrinsically uncounterable spells use the same counter prevention as Cavern-paid creatures. They still require legal targets and can fail to resolve if all targets become illegal.
- New authored definitions include Impact Tremors, Warleader's Call, Primeval Bounty, Tatyova, Spell Snare, Disdainful Stroke, Pyroclasm, Pond Prophet and other hybrid creatures. Complete rules-text matches are compiled; no partial vanilla definitions are admitted.

## Requested Rakdos deck (v0.25)

The exact 60-card default in `docs/decks/storm-rakdos.txt` is executable. This adds all 18 formerly missing nonbasic definitions, not substitute cards.

- Conditional land entry, subtype-conditioned mana and creature/type-restricted floating mana; Cavern chooses a creature type and marks spells uncounterable only when its restricted mana is spent.
- Public per-turn life-loss history, intervening-if triggers, once-per-turn activations, discard costs and attack-group/noncombat-damage events.
- Gev's additional entry counters, Valley's additive damage replacement and attacker/face-up creature damage with last-known source characteristics.
- Kicker, offspring 1/1 token copies, disguise casting and special-action turn-up. Face-down objects are nameless colorless 2/2 creatures with ward {2}; opponent observations conceal their identity.
- Start your engines as a state-based action, independent once-per-own-turn speed triggers, persistent speed and max-speed keywords. Rules reference: [Aetherdrift release notes](https://magic.wizards.com/en/news/feature/aetherdrift-release-notes).
- Fireglass Mentor's second-main-phase exile choice and turn-limited play permission; Binding Negotiation's temporary hand reveal, optional nonland discard and fallback for a face-up exiled card **the targeted opponent owns**.

The player-or-planeswalker selector currently offers players because planeswalker objects remain outside this kernel. These cards are executable within the documented two-player supported-card pool, not a claim of universal interaction parity. Disguise is currently authored only on supported creatures; general morph, manifest, cloak and copy effects remain outside scope.

## Deliberately not claimed

Commander/Brawl, more than two players, commander tax/damage, planeswalkers, battles, Equipment, general activated costs, graveyard casting, alternative costs beyond the authored disguise path, general replacement/prevention ordering, general layers/dependencies, continuous control changes, legendary sorcery casting restrictions, multi-mode selection and modal triggered/activated abilities, opponent-library search, replacement search restrictions, split-destination searches, adventures, transforming cards, Sagas, general copy effects beyond offspring, protection, non-mana/non-life ward costs, poison, storm, combat restrictions beyond this pool, and tournament legality are not implemented.

Do not add these cards as “vanilla” approximations. An unsupported card should fail at import time rather than silently change the game.

## Complete executable registry

Run `node scripts/support-manifest.mjs` to generate `docs/support.json`, with every playable definition, keyword, opcode and trigger predicate. Tokens are listed separately and cannot be imported into a deck.

The current starter lists intentionally exercise stack interaction and creature growth. They are testable introductory decks, not competitive deck recommendations.

## Extension sequence

1. Generalize multi-target/multi-mode announcements and remaining cost choices. Choose-one spell modes are announced during casting, not resolution.
2. A timestamp/dependency-aware layer evaluator with an interaction fixture suite.
3. A replacement/prevention proposal-and-choice pipeline, including recursive-event protections.
4. Broader costs, flexible targets and legal-action generation.
5. Commander/multiplayer only after state, priority, APNAP and victory rules are generalized together.
6. A validated Forge-script translation subset with an explicit unsupported-opcode report, not automatic Oracle-text interpretation.

This is a dependency order, not a delivery promise. Each step needs regression examples before expanding the supported card count.

### Life-gain events

Positive life gains trigger controller-filtered life-gain abilities. Lifelink damage is grouped by source within each simultaneous damage batch, preserving separate events for separate sources and suppressing zero gains. Trigger ordering and resolution use the normal stack. Dynamic “that much” effects and life-gain replacement/prevention are not yet included. Rules basis: [CR 119.9 and 702.15e](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt).

### Equipment

Equipment uses normal stack-based activated abilities with sorcery timing and controller-filtered creature targets. Fixed attached power/toughness and keyword bonuses, typed equip restrictions, literal mana/discard costs, and target-based enters-trigger attachment are supported. Zone-incarnation checks prevent stale attachments. An illegal attachment detaches without destroying the Equipment. Equipment and wearer controllers remain independent. Dynamic bonuses and granted activated/triggered abilities are still unsupported. See [CR 301.5 and 702.6](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt).

### Creature Auras

Fixed attached stat/keyword bonuses, combat restrictions, no-untap restrictions, and supported attached-permanent effect bindings are implemented. Creature enchant restrictions are rechecked independently of targeting protection. Noncast entry has explicit attachment choices, preserves simultaneous entrants and leaves an Aura in its prior zone if nothing legal can be enchanted. Attached-subject abilities use the current attachment or last-known attachment when their source leaves. Dynamic stats, control-changing Auras, ability removal and dependent-characteristic enchant filters remain unsupported. See [CR 303.4](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt).

### State-derived numeric values

A closed expression language supports public-zone counts with stable filters, public hand/library counts, life totals, bounded sums and scaling. Effects evaluate when each instruction resolves; continuous and characteristic-defining statistics evaluate from live state. Numeric operations reject unsafe integer results. Token creation is bounded to 1,000 tokens per instruction. Hidden-zone characteristic queries and filters dependent on computed power, toughness or keywords are rejected to avoid information leaks and unsupported dependency cycles. Cast-time X choices and dynamic mana generation are not implemented. Fixed-stat copy exceptions omit corresponding characteristic-defining abilities under [CR 707.9d](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt).

### Conditional continuous bonuses

Self and attached bonuses support stable public-state comparisons, controlled-permanent thresholds, turn ownership, attacking status and source entry-turn state. Source-state conditions are currently continuous-only; computed-keyword/statistic dependency cycles are rejected. Attackers and blockers remain in combat through the end-of-combat priority window under [CR 511.3](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt). Nonbattlefield card counts exclude tokens. Conditional casting permissions and spell-history counters are not implemented.

### Casting-cost modifiers

Generic casting-cost increases and reductions can be intrinsic or supplied by battlefield sources, filtered by caster and spell/target characteristics, and gated by supported public conditions. Determination uses the proposed stack state, adds increases before reductions, never removes coloured requirements and locks the cost before mana abilities/payments. Kicker and other supported additional costs precede these modifiers; printed mana value remains unchanged. Target menus show the selected cast cost. Activation-cost reductions and minimum-cost replacement rules are not implemented. Rules basis: [CR 601.2f–h](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt).

### Grouped spell targets and fights

Instants and sorceries without kicker, individual choose-one modes, triggered abilities and activated abilities may declare ordered groups (up to eight groups and sixteen target slots). Each group has its own selector, minimum/maximum and optional exclusions of earlier groups. Targets within one group must be distinct; separate declarations can repeat a target unless excluded. Resolution removes illegal bindings, fizzles only if every originally selected target is illegal, and still resolves spells cast with zero optional targets. Ward triggers once per targeted permanent. Damage and zone-change groups are batched. Fight damage is simultaneous and uses the creatures' current power and keywords; an illegal or absent combatant prevents its fight. See [official fight rules](https://media.wizards.com/2026/downloads/MagicCompRules%2020260619.pdf).

The client presents each group as large selectable cards with Read/Back and explicit final confirmation. Bot proposals are deterministic and bounded to 256 plans; this is not exhaustive search or human-level play. Triggered groups currently require independent selectors (cross-group exclusions remain spell/activation-only). Grouped abilities with discard costs, kicker groups and group-bound effects that pause for another choice are rejected. Untargeted follow-on draw/scry/search effects still retain the normal resolution continuation.

### Stun counters

Stun counters replace actual untapping in the untap step and from explicit/group effects. Only one is removed per untap event; counters do not tap a permanent, do not disappear from an already untapped object, and are not consumed when an effect prevents the untap event altogether. Counter placement supports source, attached, single-target and supported spell target groups. Permanents can enter with fixed stun counts. Zone changes clear counters. [Official stun-counter mechanics](https://magic.wizards.com/en/news/feature/dominaria-united-mechanics). Other counter kinds and replacement/prevention systems are not implied by this support.

### Conditional resolution instructions

A conditional instruction selects its then/else branch against the public state at that instruction, after earlier instructions have run. Selection is retained across resolution choices. Instruction graphs are bounded to 256 nodes and eight nested levels. Initial intervening-if trigger clauses remain trigger conditions checked at both event and resolution; a trailing condition is not promoted to that gate. Policy previews evaluate branches against the current public state and do not claim full future-state simulation. Outcome-linked conditions, target history and unsupported Oracle clauses still fail closed.

### Player combat-damage triggers

Self-hit and per-creature player combat-damage predicates use the actual damage source and recorded damage amount. Simultaneous packets finish damage/lifelink changes before trigger-condition checks. Damage-sized draws retain the amount if the source subsequently changes. One-or-more grouped combat hits and unsupported linked outcomes are not implied.

### Typecycling

One cycling ability per card can search a type/subtype or basic land rather than draw. Mana and discard are paid before the ability resolves; searches are optional, revealed and followed by shuffling. Nonbasic subtype lands and changeling creature types are recognized. Cycling-trigger and cycling-cost-modifier mechanics and arbitrary combined-supertype searches remain unsupported.

### Changeling

Printed/current-copy changeling supplies all supported creature types in every zone through shared subtype evaluation; it does not add card types or land/artifact subtypes. Face-down definitions suppress it. Tribal selectors, triggers, reducers and chosen-type mana share this behavior. General type-changing layers and dynamically granted changeling are not implemented; unsupported grant paths are rejected.

### Flashback

Fixed-mana, nonmodal instant/sorcery flashback uses normal timing/target legality and casting-cost modifiers from the graveyard. Its stack incarnation is exiled whenever it leaves the stack, including countering and failed target resolution. Graveyard actions, cost previews, replay and opaque command handles use the same casting path. Additional unsupported costs, X, duplicate flashback and kicker/offspring/disguise combinations are rejected.

### Vehicles and crew

Crew taps selected other untapped creatures with sufficient current total power, including summoning-sick creatures. The ability uses the stack and animates only the source battlefield incarnation until end of turn. A newly controlled Vehicle still needs haste or sufficient continuous control to attack/tap for its own tap-symbol abilities. Printed P/T applies outside the battlefield; battlefield noncreatures have no operative P/T. Earlier P/T modifiers persist and apply if that incarnation becomes a creature ([CR 208.3a](https://media.wizards.com/2026/downloads/MagicCompRules%2020260619.pdf)). See [implementation boundaries](vehicle-crew-support.md).

### Public spell-cast history

Turn-keyed per-player profile counts retain only public type, color, subtype and changeling characteristics, not identities or hidden face-down information. Successful casts record after payment and before cast triggers; the proposed spell is excluded during cost determination. Event-time spellNumber predicates count all spells by that caster and survive later casts. Filtered spell-count values support public type/color/subtype predicates. Cast-origin history, mana-value history, filtered ordinals and generic resolution-time subtraction of another spell are not implemented.

### Cast-time X

Supported instant/sorcery spells announce X before costs and targets are committed. Repeated symbols contribute repeatedly; taxes/reductions apply to the determined total, and payment is locked. X contributes zero to mana value outside the stack and its chosen value on the stack. Values flow through damage, draws, token counts and temporary modifiers. Manual commands accept 0–1000 as a documented implementation budget, not a Magic rule; default policy proposals use at most 24 values and exact-X action inspection is available. Unsupported permanent/activated/static expressions and alternate-cost combinations fail closed.

### Sacrifice effects

Source self-sacrifice and mandatory filtered player choices use actual sacrifice, not destruction. Players choose in APNAP order before a simultaneous multi-player departure batch; references retain incarnation/controller checks and pre-batch death snapshots. Effects continue after choices. No targeted-permanent restrictions apply to these untargeted choices, and indestructible does not stop sacrifice. Additional casting-cost sacrifices, bargain, delayed scheduling, sacrifice-event triggers and linked outcomes are separate unsupported work.
