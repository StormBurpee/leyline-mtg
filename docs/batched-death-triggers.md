# Batched death triggers

Reviewed against Wizards' [Comprehensive Rules, effective September 25, 2026](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt), using the locally retained rules text: 603.2c, 603.3b, 603.10a, 700.1, 700.4, and 704.3.

`diesGroup` represents **one or more creatures dying in one simultaneous event**. `battlefieldToGraveyardGroup` represents the corresponding event for permanents, including noncreature artifacts. It uses the same optional `controller`, `filter`, `excludeSource`, and `object: "source"` predicates as individual departures. All predicates must match the same member of the batch. Creature membership and object predicates use pre-event last-known information, not the reset graveyard object or a later live board.

A matching ability triggers once for that event, not once per object and not once per spell resolution. Existing `dies` remains the legacy creature-only, per-object event; existing `battlefieldToGraveyard` remains the per-permanent event. Games without aggregate observers allocate no new aggregate facts, trigger IDs, or event-log entries. Existing replay catalogs remain unchanged.

## Batch boundaries

- An ordinary `move()` owns and completes its singleton departure context.
- One sacrifice instruction completes only after every selected permanent moves. All-player sacrifice choices still occur in APNAP order before any movement.
- Filtered mass destruction, target-group destruction/movement, and ability-stripping mass destruction each finish their own departure event.
- One state-based-action batch includes lethal/zero-toughness deaths, legend-rule departures, and completed Saga sacrifices. A subsequent SBA cascade is a new event.
- Separate instructions or cost payments are not collapsed into one event merely because nobody has received priority.

`captureDepartureContext()` retains the prebatch observers, characteristics, controllers, and replacement effects. When aggregate observers exist it also accumulates only actual battlefield-to-graveyard moves. The owner of a shared context calls `finishDepartureBatch()` after all those moves; a nested sacrifice helper does not prematurely finish an externally owned SBA context. Completion drains the aggregate list, so repeating completion cannot duplicate triggers. Manual engine callers sharing a departure context must also explicitly complete it.

Rest in Peace's replacement prevents deaths, including if Rest in Peace itself leaves in that same batch. Tokens trigger before the subsequent SBA removes them. A departing observer still observes other simultaneous deaths and retains its old controller, source characteristics, and departure reference. Source incarnation checks prevent a resolving counter effect from modifying a returned source. Existing `oncePerTurn` bookkeeping consumes the opportunity when the event occurs, even if the trigger is subsequently countered, and resets for a new turn or incarnation. APNAP trigger stacking and controller ordering choices remain on the ordinary path.

## Complete cards

The complete Oracle definitions and identities were checked against the expansion's dated Standard inventory:

- **G'raha Tia:** reach; one card for one or more other creatures and/or artifacts you control dying, only once per turn. An artifact creature does not count twice.
- **Great Fierce Bee:** flying; scry 1 for one or more other creatures dying, including opponents' creatures and tokens.
- **Homicide Investigator:** investigate for one or more nontoken creatures you control dying, including itself, only once per turn.
- **Vengeful Townsfolk:** one +1/+1 counter for one or more other creatures you control dying.

`batched-death-triggers.test.js` compiles these source files directly, validates schema/native roundtrips, tests batch boundaries, predicates, controller/type/source LKI, replacement effects, tokens, APNAP, per-turn limits, ability loss, source reentry, combined legend/Saga SBAs, and deterministic actual-card command replay without depending on generated-catalog refreshes.

## Boundaries

This is not generic event aggregation: entering, combat damage, excess noncombat damage, sacrificing, and counter placement remain separate families. Aggregate effects do not expose an arbitrary representative `eventSource` or a batch-power sum. Cross-object graveyard targets excluding the trigger source remain rejected rather than guessing a post-departure identity.

No partial cards were admitted. **Chainsaw** still requires named rev counters and its counter-dependent equipped bonus. **Blood Spatter Analysis** still requires named bloodstain counters and the sacrifice-linked reflexive return trigger. **The Skullspore Nexus** needs batch total power and additional clauses; **Scavenger's Talent** needs Class levels and finality. **Elegy Acolyte** aggregates combat damage and has Void, while **Magmatic Galleon** aggregates excess noncombat damage; neither is unlocked by death aggregation.
