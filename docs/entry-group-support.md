# Simultaneous entry groups

Rules basis: Wizards' [Comprehensive Rules, effective September 25, 2026](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt), CR 603.2c, 603.3b, 603.6a, 603.6d, and 400.7. Card identities and complete printed characteristics/text use the October 26, 2026 local Standard inventory (`research/standard-expansion/standard.json`), checked against the full local Forge card scripts.

## Event contract

- `enter` still observes each entrant. `enterGroup` observes one actual simultaneous entry batch; identity, controller, and filter predicates must match the same entrant.
- Choices required before entry are staged for the whole batch. Every entrant moves before any entry observer is collected. Entry counters, static characteristics, suppression, and simultaneous new watchers apply before matching.
- One ordinary `token` instruction creates its full count simultaneously, like the existing copy-token and mobilize batch paths. Distinct instructions remain distinct events; there is no heuristic grouping of neighboring effects.
- Group triggers retain the usual APNAP ordering, optional resolutions, source snapshots, once-per-turn occurrence tracking, and fresh-incarnation behavior. They expose no arbitrary single `eventSource` for a many-object event.
- An applicable additional-entry-trigger permanent contributes one extra trigger for the batch, not one per matching entrant. Once-per-turn restrictions still limit actual occurrences. Suppressed entrants cannot cause a trigger; other unsuppressed matching members can.
- Without group observers, group notification changes no state, logs, or IDs.

## Replay compatibility

New games explicitly use rules revision 4. Revisions 1–3 retain the former sequential ordinary-token loop, including object/trigger ID interleaving and temporary-keyword timing. Under those revisions, migrated `enterGroup` predicates participate in the original per-entrant observer order and do not also emit a group observation. This preserves command IDs even for old records that load current rather than embedded card definitions.

Explicit imported revisions survive resume/export. Unmarked envelopes through v0.42 infer revision 1, v0.43–0.48 infer revision 2, and v0.49–0.57 infer revision 3; v0.58 onward infer revision 4. The outer engine-version acceptance policy is unchanged by this feature.

## Complete sources

Three new Standard cards and one token definition are implemented in full:

| Card                            | Oracle ID                              | Printed metadata                            | Supported clauses                                                                                                                           |
| ------------------------------- | -------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Baron Bertram Graywater         | `e25b516c-bf95-42bc-8b1e-04617a3d28df` | {2}{W}{B}; legendary Vampire Noble; 3/4     | Once-per-turn token-entry group creates a 1/1 black Vampire Rogue with lifelink; {1}{B} plus sacrifice another creature/artifact draws one. |
| Mister Fantastic, Reed Richards | `7fa5237e-dd79-4646-b935-cb8c6ee803ab` | {3}{U}; legendary Human Scientist Hero; 2/4 | Reach; optional draw once per own token-entry group, without a per-turn restriction.                                                        |
| Valley Questcaller              | `81c509b2-3164-47e9-94b3-bdba0487d2f1` | {1}{W}; Rabbit Warrior; 2/3                 | Scry once per group of other friendly Rabbits/Bats/Birds/Mice; those other friendly tribes get +1/+1.                                       |

`Black Vampire Rogue Token` is an exact black 1/1 Vampire Rogue creature with lifelink, identity `leyline:token/black-vampire-rogue-token`. Elvish Archivist and Enduring Innocence migrate their existing “one or more” predicates to the new family; neither counts as a new card, and all other clauses remain intact.

The feature does not implement generic heterogeneous token-list instructions, new replacement/doubling mechanics, or unrelated omitted card abilities. Existing supported return/copy/mobilize entry batches share the same observation path.

## Focused verification

`batched-entry-triggers.test.js` exercises same-member predicates, count-versus-group behavior, separate instructions, simultaneous watchers/copies, post-entry characteristics, suppression/doublers, once-per-turn and ability loss, staged choices with atomic invalid commands, APNAP, public snapshots, no-observer invariance, and deterministic rules-revision 1–4 replay. `standard-entry-group-cards.test.js` checks source schema, semantic validation and native roundtrip, every new card clause, exact metadata/token characteristics, both migrations, legacy observer IDs, and actual-card serialized replay. No aggregate or browser checks are implied by these focused tests.
