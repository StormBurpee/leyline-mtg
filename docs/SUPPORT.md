# Supported rules and cards

This is a small executable kernel, not a full Magic implementation. A name appearing in Scryfall or a display image does not imply support. The playable registry is `packages/engine/src/cards.js`.

## Scope

- Two-player, 20-life local constructed games, with configurable test fixtures.
- Deck validation: at least 60 cards in the client, at most 250, up to four copies of nonbasic cards. No format-specific banned list or set-rotation certification.
- London mulligans, chosen bottom cards, first-player first-draw skip, cleanup discard.
- Main-phase land timing, one land per turn, instant/sorcery timing, priority and LIFO stack.
- Mana pools, colored and generic costs, mana abilities, optional automatic source selection. No hybrid, Phyrexian, snow, variable X, alternative or additional costs.
- Objects changing zones become new incarnations; spells recheck targets at resolution.
- Creatures, instants, sorceries, basic lands, Glorious Anthem and Pacifism. No general enchantment system beyond the executable definitions.
- Activated abilities with mana and tap costs, explicit targets, and stack resolution.
- ETB, noncreature-cast and instant/sorcery-cast triggers. APNAP order and explicit same-controller ordering.
- Haste, vigilance, flying, reach, defender, first strike, double strike, trample, deathtouch and lifelink in the supported card pool.
- Prowess-style triggers, persistent +1/+1 counters, temporary stat/keyword modifiers, token creation, card draw, damage, life gain, countering, destroy and bounce.
- Simultaneous combat damage with player-chosen splits across multiple blockers.
- State-based loss from life or empty-library draw, lethal/zero-toughness/deathtouch deaths, token cleanup and invalid Aura attachments.

## Deliberately not claimed

Commander/Brawl, more than two players, commander tax/damage, planeswalkers, battles, Equipment, general activated costs, graveyard casting, alternative costs, replacement/prevention ordering, general layers/dependencies, continuous control changes, legend choices, modal choices, searching/shuffling effects, general scry/surveil, adventures, transforming cards, Sagas, copies, protection, ward, poison, storm, combat restrictions beyond this pool, and tournament legality are not implemented.

Do not add these cards as “vanilla” approximations. An unsupported card should fail at import time rather than silently change the game.

## Complete executable registry

Run `node scripts/support-manifest.mjs` to generate `docs/support.json`, with every playable definition, keyword, opcode and trigger predicate. Tokens are listed separately and cannot be imported into a deck.

The current starter lists intentionally exercise stack interaction and creature growth. They are testable introductory decks, not competitive deck recommendations.

## Extension sequence

1. General choice continuations for modal, search and optional-payment effects.
2. A timestamp/dependency-aware layer evaluator with an interaction fixture suite.
3. A replacement/prevention proposal-and-choice pipeline, including recursive-event protections.
4. Broader costs, flexible targets and legal-action generation.
5. Commander/multiplayer only after state, priority, APNAP and victory rules are generalized together.
6. A validated Forge-script translation subset with an explicit unsupported-opcode report, not automatic Oracle-text interpretation.

This is a dependency order, not a delivery promise. Each step needs regression examples before expanding the supported card count.
