# Exhaust: non-mana activated abilities

## Rule contract

The reviewed [Comprehensive Rules effective June 19, 2026](https://media.wizards.com/2026/downloads/MagicCompRules%2020260619.pdf), CR 702.177a, make Exhaust an activation restriction, not a resolution effect. CR 602.5b keeps a usage restriction attached to its object through control changes. CR 400.7 treats a permanent returning from another zone as a new object. The [Aetherdrift release notes](https://media.wizards.com/2025/downloads/DFT_Release_Notes_n3YgBw67Ww/EN_MTGDFT_ReleaseNotes_20241111.pdf) also distinguish multiple Exhaust abilities on one permanent and explain the new-object reset.

- Source and compiled abilities carry `exhaust: true`; each ability index records its used incarnation in `GameObject.exhaustUses`.
- A successful activation consumes that use while paying costs, before resolution. Countering or losing every target does not refund it. An illegal command leaves state, costs, stack, and usage untouched.
- Uses survive cleanup, control changes, and losing/regaining abilities. Zone movement clears them; a new copy token does not copy them. Separate, even identically worded, abilities have separate uses.
- The existing cost planner and stack capture preserve mana, tap, discard/life costs, exact source references, source definition/stats, target legality, and printed sorcery restrictions. Exhaust does not grant Power-up's entry-turn discount.
- The same `abilityProblem` gate drives legal actions, bots, public/opaque observations, replay, and the activation dialog's visible disabled explanation.

This is an explicit **non-mana** contract. Exhaust abilities containing mana-production effects, including nested ones, are rejected rather than incorrectly using the stack. The compiler also rejects malformed flags, graveyard Exhaust, and mixed Power-up/loyalty/once-per-turn contracts. No exhaust-activation trigger event, discount, reset permission, or copying mechanism is implied.

## Complete card additions

Oracle identities, complete text, and display metadata come from the repository's October 26 Standard inventory. Display metadata is integrated into `apps/web/card-metadata.json`; generated catalogs and dated coverage inventories include the admitted definitions.

| Card                   | Complete supported behavior                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Camera Launcher        | Artifact creature; source counter and exact flying Thopter token                                                          |
| Draconautics Engineer  | Two independent Exhaust uses; other-controlled-creature haste; source counter; exact 4/4 red flying Dinosaur Dragon token |
| Greenbelt Guardian     | Repeatable target-creature trample, separately exhausted three-counter ability                                            |
| Hazard of the Dunes    | Reach, trample, three-counter Exhaust                                                                                     |
| Keen Buccaneer         | Vigilance; real draw/discard continuation followed by source counter                                                      |
| Liliana the Repentant  | Another controlled creature/planeswalker entry mill; sorcery-only creature/planeswalker reanimation and source counter    |
| Mai, Jaded Edge        | Prowess and permanent double-strike counter; narrow extension of the existing source keyword-counter contract             |
| Pacesetter Paragon     | Source counter and temporary double strike                                                                                |
| Prowcatcher Specialist | Haste and two-counter Exhaust                                                                                             |
| Rebellious Captives    | Source counters, selected-land earthbend, and existing incarnation-safe delayed land return                               |
| Skystreak Engineer     | Flying and two-counter Exhaust                                                                                            |
| Stampeding Scurryfoot  | Source counter and exact 3/3 green Elephant token                                                                         |

## Remaining inventory boundaries

The other 25 Exhaust-related Standard inventory records are **not admitted by this change**:

- **Mana activation/planning:** Loot, the Pathfinder; Pit Automaton; Redshift, Rocketeer Chief. These also need their other printed effects; merely making their mana abilities stack abilities is not acceptable.
- **Exhaust-specific events, discounts, reset/copy permissions:** Adrenaline Jockey; Afterburner Expert; Boom Scholar; Elvish Refueler; Rangers' Aetherhive; Rangers' Refueler.
- **Other cost, selection, numeric or effect contracts:** Bitter Work; Boommobile; Greasewrench Goblin; Hog-Monkey; Invasion Submersible; Jeong Jeong, the Deserter; Marshals' Pathcruiser; Mindspring Merfolk; Riverchurn Monument; Rocketeer Boostbuggy; Rough Rhino Cavalry; Sabotage Strategist; Sita Varma, Masked Racer; Skyserpent Seeker; Spire Mechcycle; Winter, Cursed Rider.

Examples include activated X, waterbend, selecting/tapping another Mount or Vehicle, exact optional discard-count draws, targeting a creature with a +1/+1 counter, permanent Vehicle animation, special firebending mana, and per-player graveyard-count milling. None are approximated or silently dropped.

## Verification

`tests/exhaust.test.js` compiles source definitions into a dedicated registry, so it does not depend on regenerated catalog files. It covers schema/native/compiler round trips, invalid contracts, exact card clauses, payment and failure atomicity, distinct abilities, countered/fizzled uses, source departure/blink, real cleanup, control and ability-loss lifecycles, copied tokens, timestamped keyword counters, bot legality, visible disabled UI text, opaque handles, and deterministic replay across later turns. `tests/types/exhaust.ts` checks the public fields and double-strike counter union.

Managed preview was unavailable in this task. No manual server, browser, CDP, or escalation workaround was attempted; runtime browser interaction remains unverified. Focused source/UI tests are not a full-suite or deployment claim.
