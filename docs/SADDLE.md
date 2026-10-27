# Saddle and Mount support

Rules reference: [Wizards' Comprehensive Rules, effective September 25, 2026](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt), CR 702.171a–c, 603.2e, 603.4, and [Outlaws of Thunder Junction release notes](https://magic.wizards.com/en/news/feature/outlaws-of-thunder-junction-release-notes) (April 5, 2024).

## Executable contract

A source ability `{ "kind": "saddle", "power": 3 }` compiles to a bounded integer `saddle` threshold. The public `saddle` command names the source and every cost creature. Validation requires your priority, your main phase, an empty stack, and distinct **other**, untapped creatures you control whose total effective saddle power meets the threshold. Summoning sickness does not stop a creature paying this cost. The Mount itself may be tapped or summoning sick. Negative-power creatures count negatively; zero-power and excess-power selections are legal. All selections are validated before costs are paid.

Costs use the shared actual-tap event machinery. The ability uses the stack and only marks the exact source incarnation as saddled when it resolves. It never animates, untaps, grants haste, or changes actual power. A source losing its abilities or changing controller/type after activation can still become saddled. A departed or blinked source cannot. Designation and per-incarnation saddle-resolution history survive control/ability changes, but reset on departure and cleanup. Copies do not copy those object-state fields.

Repeated activations remain legal. Every successful exact-incarnation resolution records `saddleResolved`; only an actual designation gain emits the `saddled` trigger event (CR 603.2e). A persistent designation is not a new "becomes" event. `firstEachTurn` on a self-`saddled` event uses independent permanent history, not an ability's once-per-turn use counter; the first resolution is remembered even if the triggered ability was absent at that time.

`triggerCondition: { "kind": "sourceSaddled" }` implements **attacks while saddled** as an occurrence-only restriction. It is not an intervening-if condition. Putting the same predicate in `condition` instead intentionally rechecks at resolution. Queued effects that do not need their source survive its departure; source-bound effects retain exact-incarnation safety.

Pilot tokens are 1/1 colorless Pilot creatures with `{ "kind": "crewSaddlePowerBonus", "power": 2 }`. Their effective contribution is three when crewing a Vehicle or saddling a Mount, but their actual/copiable power remains one. Removing that ability removes the cost bonus. Non-Mount saddle sources receive no Pilot bonus.

Human selection shares Crew's multi-card gallery, inspection/back, cancellation and revision lease. Bot actions, opaque session handles, public declarations, deterministic replay and visible live designation are integrated.

## Complete sources

Alacrian Jaguar; Autarch Mammoth; Bounding Felidar; Bridled Bighorn; Brightfield Glider; Brightfield Mustang; Congregation Gryff; Dracosaur Auxiliary; Drover Grizzly; Gila Courser; Gilded Ghoda; Gloryheath Lynx; Guardian Sunmare; Lagorin, Soul of Alacria; Ornery Tumblewagg; Quilled Charger; Seraphic Steed; Stubborn Burrowfiend; Trained Arynx; Unswerving Sloth; Venomsac Lagac.

Additional exact token sources: green 3/3 Elephant, white 1/1 Sheep, white 3/3 Angel with flying, and the Pilot described above. Gilded Ghoda creates the existing Treasure token; Treasure reminder text does **not** make Ghoda itself a mana source.

## Boundaries

This batch does not track which creatures saddled a permanent. It therefore does not admit Giant Beaver, Rambling Possum, Calamity, Fortune, or The Gitrog. Archmage's Newt, Caustic Bronco, District Mascot and Bulwark Ox also remain excluded because their complete additional clauses need separate support. No generic "saddles" contributor trigger is implied by the designation event. There are no new card-specific shortcuts, animation effects, or inferred mana abilities.

Focused tests compile the new sources directly with the existing catalog, so they can verify source-only development without altering generated catalog artifacts. Publication still requires the normal parent-owned card build and aggregate checks.
