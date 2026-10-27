# Standard coverage gap: first-pass feature audit

Baseline: v0.38.0, 879 curated cards out of the dated 5,164-card Standard inventory. The remaining gap is 4,285. This is not a claim of full rules parity for curated cards.

The [machine-readable audit](coverage/standard-gap-2026-10-27.json) preserves counts, candidate names, baseline commit and limitations.

## Implemented progress through v0.60.0

Current dated inventory coverage: **2,200 / 5,164**; **2,964 remain**. This is 1321 complete card additions since the audit baseline, not a projection. Each row attributes a card once to its delivered batch; it does not imply every card containing that feature now works.

| Delivered feature/card batch                                      | Cards added |
| ----------------------------------------------------------------- | ----------: |
| Existing-engine cards and subtype buffs                           |          52 |
| Land/typecycling                                                  |          23 |
| Linked battlefield exile                                          |          20 |
| Vehicles and crew                                                 |          18 |
| Public spell-history conditions                                   |          18 |
| Combat-damage triggers                                            |          14 |
| Warp                                                              |          12 |
| Changeling                                                        |          10 |
| Chosen X spells                                                   |          10 |
| Convoke                                                           |           9 |
| Mobilize                                                          |           9 |
| Actual sacrifice-event triggers                                   |           8 |
| Resolving sacrifice effects                                       |           7 |
| Targeting and limited triggers                                    |           7 |
| Additional casting sacrifice costs                                |           6 |
| Flashback                                                         |           5 |
| Plot                                                              |           5 |
| Targeted permanent token copies                                   |           4 |
| Adventure pairs                                                   |          24 |
| Shocklands and Starting Town                                      |          11 |
| Twobrid payment choices                                           |           4 |
| Mandatory revealed-hand discard                                   |           2 |
| Izzet completion and reusable selection/history/reflexive effects |           7 |
| Planeswalker/Empower spells                                       |           3 |
| Land animation (Restless Bivouac)                                 |           1 |
| Boros spells and further existing-engine cards                    |          36 |
| Source-excluding targets                                          |          29 |
| Saga chapters                                                     |          11 |
| Unless-pay counters                                               |           9 |
| Multi-card library selection                                      |           8 |
| Effective-keyword P/T anthems                                     |           2 |
| Next-turn land form                                               |           1 |
| Resolving source-stat effects                                     |           3 |
| Source-copy token effects                                         |           3 |
| Explore and Map-token cards                                       |          15 |
| Temporary combat restrictions                                     |          21 |
| Remaining selected meta-deck definitions                          |          65 |
| Existing-engine expansion after meta completion                   |         164 |
| Actual draw events and turn history                               |          15 |
| Actual tap-event triggers                                         |          15 |
| Next-end-step blink returns                                       |           3 |
| Chosen-X entry counters                                           |           3 |
| Further source-only definitions                                   |          92 |
| Graveyard self-return activations                                 |           7 |
| Negative-counter effects                                          |           4 |
| Resolving preparation and nested prepared X                       |          11 |
| Source-only expansion after preparation                           |          61 |
| True modal triggered abilities                                    |          14 |
| Simultaneous death-group triggers                                 |           4 |
| Source-only expansion after modal triggers                        |          65 |
| Optional Bargain costs                                            |          13 |
| Source-bound fight and planeswalker bite                          |           7 |
| Source-only expansion after Bargain                               |          66 |
| Saddle and Mount attack triggers                                  |          21 |
| Source-only expansion after Saddle                                |          34 |
| Generic battlefield-departure triggers                            |          13 |
| Target-bound resolving conditions                                 |          16 |
| Filtered top-library selection                                    |          27 |
| Chosen-sacrifice activation costs                                 |          40 |
| Source-only Agent 13                                              |           1 |
| Resolution-time effect alternatives                               |           8 |
| Graveyard card-type union / Delirium                              |           9 |
| Non-mana Exhaust activations                                      |          12 |
| Literal Discover and resolution-time free casting                 |          11 |
| Role Aura sources, exact returns and creature-owned grants        |          22 |
| Station and continuous charge thresholds                          |          17 |
| Complete Class cards (Standard-legal subset)                      |           3 |
| Simultaneous entry-group payoffs                                  |           3 |
| Source-only choices, grants and recipient bindings                |          18 |
| Connive, recruit and optional discard-search                      |          18 |
| Further complete Class cards                                      |           3 |
| Source-only flashback, target bindings and discard continuations  |           9 |
| **Total since v0.38.0**                                           |    **1321** |

Stormchaser’s Talent is a fourth executable Class but is banned in Standard; it increases Arena coverage only. Elvish Archivist and Enduring Innocence were corrected to grouped entry predicates and are not new cards.

The baseline forecasts below remain unchanged for comparison. They were conservative first-pass probes: several implemented families unlocked more cards than those probes identified. Remaining cards in each family can still require other unsupported behavior.

## Direct implementation leads

These are conservative candidates whose remaining source passed authoring/schema/native compilation after removing only the exact standalone mechanic clause in an audit copy. They are **not shipped, rules-tested, or guaranteed unlocks**. Implementing the mechanic must restore the removed behavior and verify its interactions.

| Feature family    | Probe candidates | Missing cards containing the mechanic |
| ----------------- | ---------------: | ------------------------------------: |
| Land/typecycling  |               23 |                                    39 |
| Warp              |                7 |                                    32 |
| Changeling        |                6 |                                    19 |
| Convoke           |                6 |                                    19 |
| Flashback         |                5 |                                    45 |
| Plot              |                5 |                                    37 |
| Vehicles and crew |                5 |                                    76 |
| Mobilize          |                5 |                                    12 |

The 62 probe candidates are a near-term lead, not an additive forecast for every card carrying these mechanics. Unknown clauses still reject entire cards.

## Non-overlapping first-pass buckets

- 369 cards require unsupported structures/types, including multi-face layouts, Adventures, Sagas and planeswalkers.
- 896 additional normal-layout cards carry an identified unsupported named mechanic.
- 3,020 other normal-layout cards need further effect, trigger, cost, targeting or authoring work.

This categorization is not a complete dependency analysis. A card in the first bucket can also need several effect mechanics; assignment there prevents double counting.

## Wider systems

Unimplemented-card text touches variable amounts/scaling/X on 899 cards, turn/frequency history on 686, sacrifice on 630, library selection/search/reveal on 626, linked/delayed zones on 449, control/type/ability changes on 328, copying on 220, and combat damage on 129. These are overlapping text cohorts, not independent blockers or predicted additions. Basic versions of several already work.

Prioritize work by verified complete-card unlocks and reusable system coverage. Do not equate keyword incidence, old Forge-importer diagnostics, or successful syntactic compilation with complete playable support. An exact dependency-complete forecast for all 4,285 remaining cards is still outstanding.
