# Vehicles and crew: bounded support

## Rules and representation

Reviewed against Wizards' [Comprehensive Rules, effective September 25, 2026](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt): 208.3, 301.7, 302.6, 613.1d, 702.122, and 514.2.

- `crew: N` belongs to a noncreature artifact Vehicle with literal printed power/toughness. Card sources author `{ "kind": "crew", "power": N }`.
- `crew` commands supply the Vehicle's `card` and a `cards` array of any number of **other**, distinct, untapped creatures the player controls. Their current powers are summed, including negative values. Summoning sickness does not restrict this cost; this is not a tap-symbol ability of the crew creatures.
- Cost payment is immediate and atomic. The ability uses the stack; losing the crew creatures does not undo payment. A tapped or already animated Vehicle may be crewed again. Crew zero supports an empty cost.
- Resolution adds artifact/creature types through incarnation-bound, current-turn `addTypes` modifiers. The shared effective `definition(state, object)` feeds targeting, combat, mana tapping, static effects, and state-based actions. Printed definitions are not mutated. Cleanup removes animation alongside other temporary modifiers.
- Noncreature battlefield permanents have no operative power/toughness; numeric `stats` queries return zero there. Outside the battlefield, Vehicles retain their printed power/toughness, including searches, graveyard targets, and spell/cast predicates. Printed values remain in the definition and inspection. Counters and P/T modifiers remain dormant and take effect if the same incarnation becomes a creature. Animation never resets control duration or counts as entering the battlefield.
- The internal `animateVehicle` instruction is deliberately not an arbitrary authored effect opcode. This is a bounded type-addition foundation, not a general layers/copy/type-replacement implementation.

## Complete card additions (18)

Air Response Unit; Clamorous Ironclad; Cultivator's Caravan; Dependable Quinjet; Skybox Ferry; Adventurer's Airship; Boosted Sloop; Careening Mine Cart; Debris Beetle; Fire Nation Warship; Hulldrifter; Ripclaw Wrangler; S.H.I.E.L.D. Helicarrier; Spotcycle Scouter; Strixhaven Skycoach; Veloheart Bike; Burner Rocket; Thundering Broodwagon.

These include all five initial verified crew candidates plus thirteen from the full Oracle inventory. Their additional keywords, mana abilities, cycling, enters/dies/attack triggers, looting, tokens, targeted modifications/removal, and optional search are authored, not omitted.

## Interface and bounded automation

The permanent's ability menu opens a multi-creature crew selector with running power total, card inspection/back, toggling, cancellation, and a revision guard. Selection is local until confirmation. Live inspection distinguishes an idle Vehicle from its temporary artifact-creature state. Replay and opaque session protocols use existing `card`/`cards` handle transport.

Legal-action enumeration returns one deterministic valid witness rather than enumerating exponentially many subsets; dispatch and the human interface accept every legal subset. The bot crews before its attack or before blocking when appropriate, without repeatedly crewing already animated Vehicles or queuing duplicate animation. It is a simple heuristic, not an optimal crew-cost/combat planner.

## Explicit exclusions

No approximate sources were added for remaining Vehicles. Still unsupported here: alternative crew contributions or prohibitions, history-sensitive crew payoffs, once-per-turn crew restrictions, multiple crew abilities, exhaust/permanent animation, static conditional animation, variable printed Vehicle P/T, copy-dependent Vehicles, face-down Vehicle animation, transform/double-faced Vehicles, and unrelated unimplemented abilities on those cards. No expansion to changeling/copy support is implied. Noncreature printed Vehicles with creature-only CDAs or disguise are rejected by validation. Future copy effects must continue to use copiable, not temporary effective, characteristics.

The event log calls cost payment `crewActivated`; it does not misrepresent payment as a "becomes crewed" trigger. CR 702.122e trigger support remains excluded.

## Source audit (2026-10-27)

Compared all 20 authored Standard Vehicles at repository baseline `4046d88` with the
2026-10-26 Oracle inventory (`research/standard-expansion/standard.json`, 5,164 cards).
Reviewed full rules text, ability costs, targets, timing, optionality, token definitions,
crew values, mana costs, colors, types, and printed power/toughness. This is a bounded
source audit, not a claim of exhaustive runtime verification for every interaction.

| Vehicle                  | Additional authored abilities checked                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| Adventurer's Airship     | Flying; self-attack draw then discard                                                             |
| Air Response Unit        | Flying, vigilance                                                                                 |
| Apocalypse Runner        | Tap; your power-2-or-less creature gains lifelink and cannot be blocked this turn                 |
| Boosted Sloop            | Menace; your attack-group draw then discard (not restricted to this Vehicle attacking)            |
| Burner Rocket            | Flash; ETB your target creature +2/+0 and trample until end of turn                               |
| Careening Mine Cart      | Self-attack creates one Treasure; **removed spurious mana ability**                               |
| Clamorous Ironclad       | Menace; cycling {R}                                                                               |
| Cultivator's Caravan     | Tap for one mana of any color                                                                     |
| Debris Beetle            | Trample; ETB opponent loses 3, controller gains 3                                                 |
| Dependable Quinjet       | Flying; tap for one mana of any color                                                             |
| Detention Chariot        | ETB exile opponent's target artifact or creature until source leaves; cycling {W}                 |
| Fire Nation Warship      | Reach; dies creates one Clue                                                                      |
| Hulldrifter              | Flying; ETB draw two                                                                              |
| Ripclaw Wrangler         | ETB opponent discards one                                                                         |
| S.H.I.E.L.D. Helicarrier | Flying; ETB creates two white 1/1 Soldiers                                                        |
| Skybox Ferry             | Flying; cycling {2}                                                                               |
| Spotcycle Scouter        | ETB scry two                                                                                      |
| Strixhaven Skycoach      | Flying; optional ETB basic-land search to hand, revealed, then shuffle                            |
| Thundering Broodwagon    | Reach, menace; ETB destroy opponent's nonland permanent with mana value at most four; cycling {2} |
| Veloheart Bike           | ETB gain two life; tap for one mana of any color                                                  |

No additional source/Oracle mismatch was found in this set. "Each opponent" is
represented by the opposing player in this two-player engine; multiplayer is not
implied. The Treasure, Clue, and white Soldier token sources were also inspected.
Mine Cart's Treasure reminder text describes the **token's** mana ability, not an
ability of Mine Cart. Regression tests reject direct mana activation both before
and after crew, retain its attack trigger, and verify the resulting Treasure can
produce mana and is sacrificed. A second regression checks the exact mana-action
set of all 20 audited Vehicles, retaining all three legitimate mana Vehicles.
