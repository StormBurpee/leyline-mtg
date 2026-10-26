# Changelog

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
