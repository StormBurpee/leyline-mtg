# Changelog

## 0.14.0 — Safer AI decisions

- Evaluate ward using resources remaining after base payment.
- Avoid voluntary self-lethal life-loss and empty-library draw lines in known effect chains.
- Prefer immediate lethal over routine activations; deploy an already-castable landfall permanent before the land drop.
- Preserve cards during surveil when the same spell still has a draw to perform.
- Prefer safe trigger targets while retaining a legal fallback for mandatory choices.

These are bounded policy guards, not a complete forecast of every triggered interaction.

## 0.13.1 — Keyboard focus

- Escape now cancels click-targeting even while a card button has keyboard focus.
- Full-control and explicit pass-turn shortcuts work from focused controls without hijacking text input or ordinary button activation.
- Enter on an already selected hand card uses its play action.

## 0.13.0 — Read the table

- Larger expanded hands, adjacent full-card inspection, visible auto-payment previews and direct click-to-target.
- Targeted spells can be dropped onto the table before choosing a target; cast/ability targets have visible tethers and damage has source-to-target feedback.
- A contextual action button, explicit full control, one-shot phase stops, pass-until-response and pass-turn controls. Automation sends normal engine commands and rechecks stops at timer execution.
- Optional automatic trigger ordering and suggested damage; attacks, blocks, targets, discards and optional effects remain explicit choices.
- Public-board tactical combat search replaces the two-blocker menace shortcut. Attack subsets include a bounded defensive-response and crack-back check; tap abilities preserve necessary blockers, and cast-trigger threats receive sequencing consideration.
- Tactical evaluation uses the real combat damage kernel, but does not solve hidden information, future draws, combat tricks or full triggered-ability chains. This remains a sparring bot, not a competitive benchmark.
- Replays from v0.10 and v0.11 are accepted again. Legacy trace regression uses a frozen policy rather than requiring new AI to repeat old mistakes.

## 0.12.0 — Last Rites

- Death triggers use pre-event characteristics and controllers, including simultaneous creature deaths and tokens.
- Activated abilities can sacrifice their source as a cost. Costs are paid immediately; the ability remains on the stack independently of its source.
- Added 88 reviewed definitions, including Blood Artist, Zulaport Cutthroat, Mind Stone, Cathar Commando, Fanatical Firebrand and Doomed Necromancer.
- Added Last Rites, an introductory black/red death-trigger and self-sacrifice deck.
- The practice policy can use graveyard-return and removal sacrifice abilities, while avoiding immediately cashing in early mana rocks.
- Torch Courier was not admitted: its Forge selector does not encode the Oracle “another” restriction in the supported target grammar. Compiler recognition alone is not executable support.

434 executable cards plus three tokens. This does not add arbitrary sacrifice outlets, sacrifice additional spell costs, death replacements or once-per-turn triggers.

## 0.11.0 — The deck room

- Rebuilt the lobby as an art-led deck library with all 12 starter lists and independent opponent selection.
- Added a visual deck builder: card search, color/type filters, drag-to-add, copy controls, mana curve, local saves, draft recovery and list export.
- Imports can retain unsupported cards as visibly incomplete drafts; incomplete lists cannot start a game.
- Reworked the tabletop with printed card silhouettes, live-stat overlays, stronger tap states and explicit layout tracks that keep match controls visible.
- Added nine new 60-card introductory lists. These are executable demonstrations, not format-certified or competitive lists.
- Fixed importing more than four copies of an unsupported card throwing instead of returning validation errors.

## 0.10.0 — Graveyard play and a third deck

- Graveyard targeting, recovery, reanimation and exile removal.
- Life loss is distinct from damage; draw/discard/life effects can affect another player without granting priority during resolution.
- Added 67 reviewed cards, including Zombify, Eternal Witness, Siege Rhino, Burglar Rat, Regrowth and Sign in Blood.
- Added Second Burial, a 60-card introductory reanimation deck, and a playable showcase position.
- Graveyard target menus and drag-target trays; card motion starts from the graveyard counter.
- Ward and hexproof do not incorrectly protect cards in graveyards.

346 executable cards plus three tokens. The dated inventories contain 231 executable Standard cards and 334 non-Alchemy Arena cards; full coverage remains open.

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
