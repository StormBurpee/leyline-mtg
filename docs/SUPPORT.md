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
- Type-aware artifact/enchantment removal and permanent bounce.
- Triggered abilities choose legal targets when placed on the stack, before priority. Impossible required targets remove the trigger; targets are rechecked on resolution.
- Optional triggered effects with explicit resolution-time accept/decline choices.
- Activated abilities with mana, life and tap costs, explicit targets, and stack resolution.
- Scry, surveil and mandatory discard choices during resolution, with instruction continuations and no intervening priority.
- Ward triggers for opposing spells and activated/triggered abilities, with optional mana/life payments during resolution. Multiple ward instances and other payment families remain unsupported.
- Schema-checked card sources, reusable mechanics, composable target/event predicates and all-or-nothing pack compilation.
- Immutable per-game catalogs validated before play and embedded in replays.
- ETB, landfall, noncreature-cast and instant/sorcery-cast triggers. APNAP order and explicit same-controller ordering.
- Menace, haste, vigilance, flying, reach, defender, first strike, double strike, trample, deathtouch and lifelink in the supported card pool.
- Prowess-style triggers, persistent +1/+1 counters, temporary stat/keyword modifiers, token creation, card draw, mill, damage, life gain, countering, destroy and bounce.
- Simultaneous combat damage with player-chosen splits across multiple blockers.
- State-based loss from life or empty-library draw, lethal/zero-toughness/deathtouch deaths, token cleanup and invalid Aura attachments.

## Deliberately not claimed

Commander/Brawl, more than two players, commander tax/damage, planeswalkers, battles, Equipment, general activated costs, graveyard casting, alternative costs, replacement/prevention ordering, general layers/dependencies, continuous control changes, legend choices, modal choices, searching/shuffling effects, adventures, transforming cards, Sagas, copies, protection, non-mana/non-life ward costs, poison, storm, combat restrictions beyond this pool, and tournament legality are not implemented.

Do not add these cards as “vanilla” approximations. An unsupported card should fail at import time rather than silently change the game.

## Complete executable registry

Run `node scripts/support-manifest.mjs` to generate `docs/support.json`, with every playable definition, keyword, opcode and trigger predicate. Tokens are listed separately and cannot be imported into a deck.

The current starter lists intentionally exercise stack interaction and creature growth. They are testable introductory decks, not competitive deck recommendations.

## Extension sequence

1. Extend the existing choice continuations to modal, search and optional-payment effects.
2. A timestamp/dependency-aware layer evaluator with an interaction fixture suite.
3. A replacement/prevention proposal-and-choice pipeline, including recursive-event protections.
4. Broader costs, flexible targets and legal-action generation.
5. Commander/multiplayer only after state, priority, APNAP and victory rules are generalized together.
6. A validated Forge-script translation subset with an explicit unsupported-opcode report, not automatic Oracle-text interpretation.

This is a dependency order, not a delivery promise. Each step needs regression examples before expanding the supported card count.
