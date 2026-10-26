# Changelog

## 0.9.0 — Reviewed Standard expansion

- Added 145 reviewed Standard source definitions, including spells, creatures, gain lands, scry lands and mana/filtering abilities.
- Independent Oracle identity/characteristic checks and pinned Forge provenance for every addition.
- Per-card casting/payment/resolution tests, mana-option and ability tests, and five mixed-deck simulation matchups.
- Fixed summoning sickness expiring at the opponent's turn boundary; readiness now follows the controller's most recent turn start.
- Permanents with both mana and other activated abilities expose both in the client.
- Live characteristics display granted keywords, not only printed ones.

279 executable cards plus three tokens. The dated Standard inventory has 212 executable definitions out of 5,164; this remains a small subset, not complete Standard support.

## 0.8.0 — Targeted triggered abilities

- Required trigger targets are chosen during stack placement, preserving APNAP and same-controller ordering.
- Missing legal targets remove the trigger; invalid and stale target choices reject atomically.
- Targeted triggers interact with ward, optional resolution and source last-known information.
- Eight reviewed source definitions, including Reclamation Sage, Meteor Golem and Exclusion Mage; 134 executable cards total.
- Explicit legal target-choice actions for simulation policies, with opaque object handles and private continuations.
- Departed trigger sources retain opaque incarnation-bound references rather than leaking concealed raw object IDs.
- Browser highlights and a target-list alternative, plus a reproducible replay paused at the new decision.
- Conservative Forge translation for targeted DB trigger roots; nested additional targets still reject.

Multi-target, modal, delayed/reflexive and general leave-the-battlefield triggers remain unsupported.

## 0.7.0 — Direct manipulation at the table

- Drag cards from hand to the battlefield, players, permanents or spells on the stack.
- Legal drop zones come from the engine, with revision checks at submission.
- Drag to select attackers and assign blockers; confirm the complete group separately.
- Targeting tethers, compact spell-target trays, combat links and cancelled-drag returns.
- State-driven card movement, tap transitions, graveyard departures and life changes.
- Saved reduced-motion preference, keyboard/click alternatives and stable scroll positions.
- Added a reproducible interactive position and gesture/command-boundary regression tests.

This is a client release. The rules package and core card pack remain at 0.6.0; executable coverage remains 126 cards and three tokens.

## 0.6.0 — Versioned card sources

- Replaced the hand-written JavaScript card list with one schema-versioned JSON file per card.
- Added bounded data-only mechanic templates, stable identities and all-or-nothing compilation/linking.
- Generated runtime data is checked against source in CI; all 129 v0.5 definition contracts are preserved.
- Replaced closed target/event categories with composable predicates, retaining legacy compatibility.
- Added schema validation and tests for unknown instructions, bad references, malformed data and cyclic templates.
- Separated runtime-definition validation from catalog loading, so source compilation can bootstrap cleanly.
- Corrected battlefield Anthem bonuses incorrectly affecting creature cards/spells outside the battlefield.

The core pack remains 126 cards plus three tokens. This is an authoring/runtime architecture milestone, not full Arena coverage.

## 0.5.0 — Multiple card types and optional abilities

- Artifact creatures and enchantment creatures retain both printed type categories.
- Artifact-, enchantment- and creature-cast triggers use the complete type set.
- Optional triggered effects pause for a real accept/decline decision at resolution.
- Artifact/enchantment targeting, removal and permanent bounce.
- Five-color mana artifacts and artifact creatures respect tap costs and summoning sickness.
- Fourteen additional executable cards; 126 cards total.
- Registry validation rejects fields that would otherwise be ignored on the wrong card type.
- Migration reports fingerprint the compiler and its validation/type dependencies.

Land-creature combinations, type-changing continuous effects and full format coverage remain unsupported.

## 0.4.0 — Trigger migration and flexible mana

- Strict Forge translation for selected enters-the-battlefield, cast and landfall triggers.
- Land entry uses the common event path, with explicit trigger ordering.
- Flexible single-mana sources use matching rather than a greedy colored-cost assignment.
- Manual color choices, unconditional tapped entry and the ten life-gain dual lands.
- Milling, three landfall creatures and three milling cards; 112 executable cards total.
- CI-gated annotated version tags, with immutable backfilled checkpoints.

General replacement ordering, broader triggers and full Standard/Arena coverage remain open.

## 0.3.0 — Simulation boundary and card-pool tracking

- Headless sessions with immutable, player-specific observations and opaque card handles.
- Async policy callbacks, deterministic episode logs and explicit failure/truncation outcomes.
- Dated Standard and non-Alchemy Arena inventories, with per-card implementation status.
- Menace block validation and ward with mana/life payment choices.
- Shared atomic mana, life and tap cost handling; no double-tapping a mana source to pay its own tap cost.
- 34 reviewed single-face Standard creatures and six ward creatures; 96 executable cards total.
- Damage source characteristics use current information or departure-time last-known information.
- Registry and command validation hardening, plus source-limited observations for larger catalogs.

Full Standard, Arena and Forge parity remain open. Card inventory is not executable coverage.

## 0.2.0 — Registry and resolution foundations

- Validated, immutable per-game card catalogs, preserved in replays.
- Resolution continuations for scry, surveil and mandatory discard choices.
- Opt, Preordain, Consider, Catalog, Careful Study and Merfolk Looter.
- Replay branching into local hotseat play, without editing the original record.
- Conservative Forge-script migration auditing and a pinned upstream inventory.
- Cross-platform checks and local-server asset-boundary tests.

Still a development preview. No full Forge parity, general layers, replacement pipeline, Commander or network play is claimed. See the parity tracker for open work.

## 0.1.0 — First playable kernel

- Deterministic commands, priority, stack, mana and two-player turn structure.
- Combat assignments, supported keywords, triggers and state-based actions.
- Modern tabletop, card inspection, deck import, local saves and replay.
- Initial curated card pool and an inspectable heuristic opponent.
