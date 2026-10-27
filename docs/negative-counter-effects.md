# Explicit -1/-1 counter effects

Reviewed against Wizards' [Comprehensive Rules, effective September 25, 2026](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt): 122.1a, 122.2–3, 603.10a, 608.2b, 704.3–4, 704.5f and 704.5q.

Card sources may author `addCounters` with `counter: "-1/-1"` on the source, attached permanent, or chosen target, including target groups. `counterAll` accepts the same optional field for a filtered simultaneous group. Both support existing resolution-time numeric expressions. Unsupported counter names still fail schema, compilation, and registry validation.

The compiler retains the existing implicit +1/+1 runtime contract. Only negative-counter instructions gain the native `counter: "-1/-1"` field. This preserves existing source compilation and replay definitions. Placement changes stats immediately but does not cancel opposing counters or run state-based actions between resolving instructions. The existing simultaneous SBA batch handles cancellation, zero-toughness deaths (including indestructible), and pre-departure trigger snapshots. Zone changes clear counters; stale targets cannot affect a returned incarnation. Generic remove-any-counter choices also recognize -1/-1 counters.

## Complete cards added

- **Bile-Vial Boggart:** dies trigger with zero or one chosen creature, not an optional effect on a required target.
- **Blight Rot:** four -1/-1 counters on its chosen creature.
- **Darkness Descends:** two -1/-1 counters on every creature, followed by simultaneous SBA handling.
- **Nightmare Sower:** flying, lifelink, and your opponent-turn cast trigger with zero or one chosen creature. Counter placement is not damage and does not gain life.

Printed identities and complete Oracle text come from the dated Standard inventory used by this expansion. `negative-counters.test.js` covers schema/native roundtrips, invalid-target rejection, cancellation timing, simultaneous deaths/LKI, source departures, optional targets, numeric/attached/group placement, indestructible, overflow atomicity, counter removal, bot target direction, and complete command replay.

## Boundaries

This is explicit counter placement, not wither, persist, proliferate, a general counter-trigger/replacement system, or entry-counter replacement authoring. Existing blight costs and SBA cancellation remain separate. Hapatra, the Desert Fang is not admitted: its greatest graveyard mana-value expression is unsupported (the current maximum queries only the battlefield). No remaining card with extra unsupported clauses is represented by a partial definition. Bot adjustments recognize targeted negative counters; this is not a general board-wipe or counter-strategy planner.
