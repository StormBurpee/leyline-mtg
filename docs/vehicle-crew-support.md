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
