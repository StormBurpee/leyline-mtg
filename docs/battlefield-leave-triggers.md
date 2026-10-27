# Battlefield departure triggers

Reviewed against the locally retained Wizards Comprehensive Rules (September 25, 2026), especially 603.6c and 603.10a: leaves-the-battlefield abilities observe a permanent moving from the battlefield to another zone and use the game state immediately before the event. This is distinct from the immediate duration expiry of an `until ... leaves the battlefield` exile effect (610.3).

## Event contract

`{ "event": "leave" }` is the individual permanent-departure event. The optional `object: "source"`, `controller`, `filter`, and `excludeSource` predicates use predeparture identity, controller, types, keywords, power/toughness, and token status. `destinations` is an optional nonempty, duplicate-free list of supported nonbattlefield zones (`graveyard`, `exile`, `hand`, `library`, `stack`, `void`). It matches the **actual destination after replacement**, not the originally requested destination. Three Tree Scribe uses this to exclude graveyard moves without mistaking replacement exile for dying.

The event uses the existing `captureDepartureContext()` snapshot, including for non-graveyard moves. Simultaneous destruction, bounce, exile, grouped targets, sacrifices, and state-based actions share their prebatch observers. A departing observer can see other simultaneous departures even after its own object moved; control changes and ability loss are evaluated before departure. Tokens trigger before the subsequent state-based action removes them. Source and event LKI retain prebatch anthems, and effects referencing the old source do not follow a later battlefield incarnation.

This does not replace `dies` (creatures only), `battlefieldToGraveyard` (all actual graveyard departures), sacrifice events, or aggregate death events. No new event-log records, trigger IDs, or persistent state fields are allocated in games without matching departure observers. Casting and activated sacrifice costs finish announcement/payment before these triggers are stacked, using the ordinary APNAP and controller-ordering paths.

Existing linked exile returns remain immediate one-shot duration expiry, not triggered abilities. Their target-group exile moves now share the same departure snapshot as other simultaneous target-group moves. The return mechanism and timing are unchanged.

## Complete cards

The complete rules text, printed characteristics, and Oracle identities were copied from the expansion's dated Standard inventory, not inferred from a `leaves the battlefield` substring.

- **City Pigeon** and **Featherbrained Filcher:** flying and a Food on every departure.
- **Zoo Escapees:** a Mutagen on every departure; existing exact Mutagen activation is reused.
- **Cryogen Relic:** enter/leave draws; `{1}{U}`, sacrifice to place one stun counter on up to one tapped target creature.
- **Mouser Foundry:** enter/leave 1/1 colorless artifact Robot; `{4}{R}`, sacrifice to deal 3 to target creature. Reuses the existing Small Robot Token, not the unrelated 2/2 Robot.
- **Momo, Playful Pet:** flying, vigilance, and all three targeted/non-targeted departure modes.
- **Greed's Gambit:** all entry, own-end-step, and departure draw/discard/life/sacrifice clauses, with exact new 2/1 black flying Bat tokens.
- **Super Shredder:** menace and one counter for each other permanent's departure, including opposing permanents.
- **Three Tree Scribe:** friendly creature departures without dying, including its own departure; targets a creature still controlled when targets are chosen.
- **Weapons Manufacturing:** friendly nontoken artifact entries create exact new colorless Munitions artifact tokens whose departure deals 2 to any target. Token artifact entries do not recurse.
- **Suki, Courageous Rescuer:** other-creature +1/+0 anthem and own-turn, once-per-turn friendly-other-permanent departure Ally production.
- **Molten Man, Inferno Incarnate:** basic Mountain search tapped, continuous bonus for all controlled Mountains, and land sacrifice on departure.
- **Nutrient Block:** indestructible Food activation and draw only on actual battlefield-to-graveyard movement, deliberately using the existing narrower event rather than `leave`.

`packages/engine/test/battlefield-leave-triggers.test.js` directly compiles and validates all thirteen cards and both new tokens, checks native roundtrips, exercises every printed clause, and tests destinations, replacements, simultaneous observers, prebatch characteristics, ability loss, stolen control, tokens, APNAP, source reentry, cost-trigger ordering, exact token properties, linked-return preservation, and command-only replay. It does not depend on a generated-catalog refresh.

## Deliberate boundaries

This is not general zone-change aggregation, phasing, multiplayer departure from the game, a delayed trigger engine, named-counter transfer, or arbitrary linked exile tracking. Most inventory texts mentioning departure are unrelated `until` durations or need unsupported additional clauses. No such partial cards were admitted: Anticausal Vestige needs hand-to-battlefield selection; Broodguard Elite and Selfless Police Captain need counter transfer; champions need behold/link tracking; Sewer-veillance Cam needs a tap-or-untap choice on resolution rather than an incorrectly substituted modal trigger. Linked return-to-hand and manifest-dread clauses remain separate work.
