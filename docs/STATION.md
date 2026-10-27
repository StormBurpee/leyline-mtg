# Station, Spacecraft and charge thresholds

Rules references: [Wizards' Comprehensive Rules, effective September 25, 2026](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt), CR 702.184, 721.2–4, 608.2h, 613.6, 707.2 and 506.4; [Edge of Eternities release notes](https://magic.wizards.com/en/news/feature/edge-of-eternities-release-notes), July 21, 2025.

## Executable data and commands

`{ "kind": "station" }` enables a separate `station` command: `{ type: 'station', card, cards: [payer] }`. It requires exactly one other untapped creature, priority, the controller's main phase and an empty stack. The payment is not a target and never applies a Pilot's Crew/Saddle bonus. Tapping uses the common tap-event pipeline. The source may already be tapped; summoning sickness does not prevent this cost.

The stack entry binds both object incarnations. Resolution reads current payer power, or the payer's last battlefield power captured during its departure, including simultaneous-departure snapshots. Nonpositive power adds no counters. Source ability loss, controller changes or subtype changes do not invalidate an announced ability; leaving and returning does. Successful placement uses real `chargeCounters`, integrated with counter-kind selection/removal and cleared on zone changes. There is no generic inert treatment of shield, finality or other rules-bearing counters.

`stationLevel` contains an increasing bounded `threshold`, optional paired `power`/`toughness`, and nested abilities. It compiles to `stationLevels` with validated grants. Supported grants are non-changeling keyword abilities, triggered/activated abilities, a single anthem and a single self-bonus. Threshold ward, recursive levels and unsupported mechanics fail compilation. Token references within levels are checked by the pack and registry.

Thresholds derive effective characteristics continuously, not from a one-time animation flag. Printed Station P/T belongs to the threshold, not outside-battlefield card characteristics. Copies keep threshold definitions but neither counters nor currently unlocked characteristics. The creature type/P/T component applies before ability removal; later animation P/T overrides it. Losing a creature threshold removes combat membership, and restoring it does not rejoin combat. Control duration determines summoning sickness. These admitted cards remain creatures on opponents' turns when charged; none has a controller-turn-only form.

## Complete source admissions

Atmospheric Greenhouse; Dawnsire, Sunstar Dreadnought; Debris Field Crusher; Extinguisher Battleship; Galvanizing Sawship; Infinite Guideline Station; Kavaron, Memorial World; Lumen-Class Frigate; Pinnacle Kill-Ship; Rescue Skiff; Specimen Freighter; Susurian Dirgecraft; The Seriema; Uthros Scanship; Warmaker Gunship; Wedgelight Rammer; Wurmwall Sweeper.

Every admission includes its full entry and threshold abilities. Debris's pump, Specimen's mill, Infinite Guideline's draw, and Seriema's indestructibility are in their respective striations, not always-on abilities. Existing Robot Token is the exact 2/2 colorless artifact creature.

## Explicit exclusions

The full supplied Standard inventory has 27 Station cards. Ten remain unadmitted:

- Adagia, Windswept Bastion: legendary copy exception.
- Entropic Battlecruiser: opponent-discard events and per-opponent discard-or-life result.
- Evendo, Waking Haven; Uthros, Titanic Godcore; The Eternity Elevator: dynamic mana production, including charge-count expressions and payment planning.
- Fell Gravship: mandatory nontargeted graveyard choice after milling.
- Larval Scoutlander: optional land/Lander sacrifice followed by search.
- Sledge-Class Seedship: optional nontargeted hand-to-battlefield creature choice.
- Susur Secundi, Void Altar: sacrificed-cost-creature power capture and draw.
- Synthesizer Labship: targeted artifact animation and its layered duration contract.

This batch does not implement toughness-instead-of-power station modifiers, extra station counters, or generic named-counter placement/proliferation. Those are separate capabilities, not implied by Station itself.

## Verification and client

`tests/station-pack.test.js` compiles all 17 sources directly alongside the existing catalog. Coverage includes full entry/attack/activation clauses, negative-power and Pilot costs, exact-incarnation LKI, simultaneous departures, copied thresholds, ability loss, sorcery timing, counter removal, combat membership, summoning sickness, schema/adapter round trips, bot decisions, deterministic replay and opaque session handles.

The client shows charge counts and locked/active thresholds. Its Station gallery accepts exactly one payer and explains resolution-time power. DOM lifecycle coverage checks replacement selection, inspection/back, cancellation/reopen and repeated stale confirmation. DOM coverage is not visual-browser verification; managed preview was unavailable. The integrated v0.57 catalog contains all 17 sources and matching display metadata. Release checks include source/generated freshness, schema/type validation, compatibility regressions and deterministic meta-deck games; browser/layout verification remains unperformed.
