# Forge parity tracker

**Target:** a maintainable JavaScript implementation with the breadth of Forge and a better modern client. **Current status:** an early local kernel. The target is not achieved.

This tracker separates implemented behavior from planned work. A green CI run proves that the current tests pass, not that the Comprehensive Rules are complete or that every Forge card works.

| Area                | Present                                                                      | Missing before a parity claim                                                                   |
| ------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| State and execution | Serializable state, atomic commands, seeded RNG, replay, revision checks     | Large-catalog/version compatibility, long-match and simulation scaling                          |
| Turn and stack      | Two-player turn steps, priority, LIFO stack                                  | Extra turns/phases, arbitrary skip effects, multiplayer turn order                              |
| Choices             | Mulligans, cleanup discard, attackers/blockers, damage splits, trigger order | General resolution continuations, modal choices, search, scry/surveil, optional payments        |
| Costs               | Colored/generic mana, tap costs                                              | X, hybrid/Phyrexian/snow, alternative/additional costs, reductions, restrictions, cost rollback |
| Objects and zones   | Core zones, incarnation-safe targeting, tokens                               | Copies, control changes, faces, counters beyond +1/+1, attachment families                      |
| Continuous rules    | Temporary stats/keywords, Anthem, Pacifism                                   | Full layers, timestamps, dependencies, characteristic-defining abilities                        |
| Events              | Selected ETB and cast triggers, APNAP                                        | General trigger predicates, delayed/reflexive/intervening-if triggers, replacements/prevention  |
| Combat              | Basic declarations, current damage assignment, supported combat keywords     | Broader attack/block requirements, multiple combat variants, planeswalkers/battles              |
| Card support        | 50 curated cards, three token definitions                                    | Large validated registry, broad script grammar, per-mechanic interaction fixtures               |
| Migration           | Conservative Forge candidate compiler                                        | T/SVar/DB grammar, validation harness, broad proven card-script compatibility                   |
| Opponent            | Deterministic heuristic sparring policy                                      | Search, hidden-information modeling, deck-specific strategy, strength evaluation                |
| Formats             | Local two-player constructed subset                                          | Commander/Brawl, draft/sealed/cube, variant rules, legalities and sideboards                    |
| Product             | Tabletop, inspection, import, saves and replay                               | Networking, collections, deckbuilding breadth, campaign/quest/adventure equivalents             |

## Next acceptance gates

1. **Extensible registry:** a valid new definition can run through the same engine without editing a global singleton; invalid definitions and unsupported opcodes fail before a match begins; replay preserves the chosen ruleset.
2. **Resolution continuations:** a spell can ask a player to order or move cards and then resume without granting priority or processing state-based actions in the middle of resolution.
3. **Costs and replacement pipeline:** choices are explicit and reversible until commitment; no partially paid illegal action leaks state.
4. **Continuous-effect engine:** fixture-driven layer and dependency behavior before broader card imports.
5. **Compatibility:** audit a pinned Forge snapshot, report exact accepted/rejected syntax, and run translated cards against interaction tests. No coverage percentage without a reproducible denominator.

Client polish continues alongside these gates, but a polished board must not conceal rules shortcuts. Features are added to this tracker only when implemented and verified, with remaining limits retained.
