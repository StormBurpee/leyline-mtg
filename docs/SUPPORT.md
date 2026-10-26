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
