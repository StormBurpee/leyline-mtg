# Bounded +1/+1 counter placement replacements

## Complete cards

This family adds three complete cards from the retained October 26, 2026 Standard
inventory (5,164 Oracle identities):

- **Caradora, Heart of Alacria:** optional, revealed Mount-or-Vehicle library search
  to hand with shuffle; one extra +1/+1 counter on creatures or Vehicles its
  controller controls, including uncrewed Vehicles.
- **Michelangelo, Weirdness to 11:** exact existing Mutagen token on entry; one
  extra +1/+1 counter on creatures its controller controls. The Mutagen's real
  `{1}, {T}, sacrifice` sorcery-only ability works with the replacement.
- **Yoshimaru, Beloved Companion:** one extra +1/+1 counter on creatures its
  controller controls; complete `{6}` activation targeting any legendary creature,
  including an opponent's. Opposing recipients do not gain its replacement bonus.

All costs, types, statistics and full Oracle text are preserved. No partially
implemented cards or new placeholder tokens are counted.

## Contract

`plusCounterBonus` admits only a positive fixed additive amount and the closed
`creatureYouControl` or `creatureOrVehicleYouControl` recipient scope. It modifies
only a **positive placement of new +1/+1 counters**, not existing counters. The
recipient's current controller matters; the player putting the counters does not.
Every applicable source applies exactly once to each placement event. Multiple
supported replacements commute: their eligibility cannot change when counters
are added and all add fixed amounts. There is no strategically distinct ordering
choice in this bounded family. Adding multiplication, prevention, optional
replacement, counter-count predicates or any noncommuting operation requires an
explicit affected-player ordering continuation before admitting that contract.

All currently executable +1/+1 placement routes share the helper: source/target,
grouped and distributed instructions, entry counters (including X), explore,
connive, earthbend and counter-doubling instructions. Doubling an existing count
puts that many new counters, then modifies that placement; it does not multiply
old counters plus the bonus. Separate instructions remain separate events;
zero/negative instructions cannot create an extra counter. Existing -1/-1 counters
remain until the normal simultaneous state-based cancellation.

Entry replacement sources are frozen **before the whole simultaneous entry**.
General replacement abilities on a new entrant do not enhance itself or another
simultaneous entrant. Already-present sources apply before entry observers and
state-based actions, including with Torpor Orb. Gev's additive entry counters
compose with the bonus; zero X without another entry-counter effect stays zero.
Prospective recipient control and creature/Vehicle status are checked, including
an enchantment-only return. Copy values retain the replacement definition, not
existing counters or Class level designations. Runtime ability loss, source
departure and control changes immediately affect later placements.

## Explicit remaining gaps

The schema/compiler/native contracts reject unknown counter kinds, player or
placer scopes, multipliers and optional replacement fields; duplicate declarations
on one definition reject rather than overwrite. This is not a generic counter
engine and does not change charge, stun, lore, quest, loyalty or keyword counters.
Class levels remain noncounter designations.

- **Innkeeper's Talent:** doubles counters _you put_ on any permanent or player,
  and grants dynamic ward to own counter-bearing permanents. Requires actor-aware
  all-counter placement, player counters, and ward-grant layering.
- **Loading Zone:** all-counter doubling on own creatures/Spacecraft/Planets plus
  Warp. Requires all-counter placements and noncommuting replacement ordering.
- **Doc Samson, Super Psychiatrist:** actor-aware additions of each counter kind
  on own permanents and power-based mana production.
- **Doubling Season:** effect-only counters (distinct from cost placement) and
  token creation replacement, plus ordering against additive replacements.
- **The Earth Crystal:** +1/+1 doubling and fixed two-counter distribution among
  one or two targets; requires ordering and that distribution contract.
- **Prairie Dog:** until-end-of-turn, actor-aware replacement and an end-step
  condition tracking spells specifically cast from hand. Neither clause is
  approximated by this family.

## Verification

`packages/engine/test/counter-placement-replacements.test.js` compiles the three
sources into an isolated registry, independent of generated catalog updates. It
covers exact Oracle metadata, source/schema/native roundtrips, rejection paths,
recipient ownership/control, uncrewed and animated Vehicles, ability loss,
multiple sources, simultaneous entry orders, X/Gev/zero entry, token copies,
positive/negative/other counters, all placement routes, complete tutor and token
clauses, real paid activations, bot/legal-command compatibility, hidden search
information, deterministic replay and opaque session handles. Public type tests
are in `tests/types/counter-replacements.ts`; the reviewed display evidence is in
`tests/fixtures/counter-replacements-oracle-reviewed.json`.

`packages/engine/test/counter-replacements-review.test.js` adds independent
adversarial coverage for prospective stolen-entry control, simultaneous
replacement entrants with Gev, copied ability loss, lethal negative-counter
timing, real distributed-X/stale-target allocations, repeated grouped placement
instructions, and grouped/connive/earthbend command rollback on overflow.
A former Vehicle returned enchantment-only is excluded both at entry and on
later placements; the Vehicle scope requires its artifact card type (CR 205.1a).

Rules references: [official Aetherdrift release notes, Caradora](https://magic.wizards.com/en/news/feature/aetherdrift-release-notes),
[official TMNT release notes, Michelangelo](https://media.wizards.com/2026/downloads/TMT_Release_Notes_eM8Yplm3UV/u17aHk8iV1_EN_MTGTMT_ReleaseNotes_20251001.pdf),
and [September 25, 2026 Comprehensive Rules](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt),
especially CR 107.1b, 122.6, 614.5, 614.12, 616.1 and 701.10e.
The engine implements only the bounded commuting subset described above, not general replacement ordering.
