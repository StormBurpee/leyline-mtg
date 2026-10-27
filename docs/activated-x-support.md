# Chosen X in activated mana costs

Rules basis: the locally retained **Comprehensive Rules effective September 25,
2026**, CR 107.3a/k, 118.7b–d, 400.7, 601.2b–h, 602.2b, 608.2b/h and
702.193a–b. This is chosen, independent X in an ordinary nonmana activated
ability's mana cost, not every use of the letter X.

- Commands require an explicit integer `x` in the implementation range 0–1000;
  fixed-cost abilities reject unsolicited X. Repeated `{X}` symbols each cost
  that much generic mana. Invalid commands leave their input unchanged.
- X is substituted before the Power-up reduction. Matching colored/colorless
  reduction is applied first; its excess reduces generic mana. Printed X in the
  permanent's mana cost contributes zero to that reduction. Costs never become
  negative. Unsupported hybrid Power-up reductions fail validation.
- The determined payment and independent X are locked on the stack before mana
  abilities and costs are paid. The source's tap cost is reserved; mana sources
  sacrificed as a selected cost cannot also sacrifice themselves for mana.
  Eligible non-sacrificing mana sources may tap before being sacrificed.
- Target references retain their incarnations. Sacrificing a chosen target can
  make it illegal on resolution; neither its replacement incarnation nor the
  returned source inherits the old binding. An ability can still draw or gain
  life after its source leaves. Each activation retains its own X through
  optional effect continuations. Copies of permanents retain the printed X
  ability but do not inherit its earlier activation choices.
- `legalActions(state, player, { x })` inspects an exact choice. Default proposals
  are bounded and include small values and an affordability-derived high value;
  dispatch accepts any legal exact X in range, not only a proposed value.
- The client chooses X before targets and selected sacrifice costs. The selected
  X survives grouped targets, the card reader and payment confirmation. Cancel
  does not pay costs. Revision/source-incarnation checks and detached-button
  tests protect interrupted and repeated submissions. Stack and log display X.
  Opaque agent commands, public stack observations and deterministic replay
  preserve the announced value and determined payment.
- Bot previews use announced X and reject known overdraw, including already
  pending X-draw abilities. This remains a bounded policy, not perfect play.

`sourcePowerAtMost` additionally supports a declaration-time condition on an
intrinsic `unblockable` restriction. It reads current power and is rejected from
continuous characteristic bonuses to prevent recursive power queries. Already
legal blocks are not undone by a later change in power.

Still unsupported: X life/discard/sacrifice quantities, X-dependent target
selectors/counts and conditions, X mana-producing activated abilities, dynamic
X defined by arbitrary card text, waterbend, and copying stack abilities. No
selected-sacrifice LKI model or ability-cost tax system is claimed here. A card
needing any of those clauses must remain unsupported until its complete text
works.

Focused checks: `packages/engine/test/activated-x.test.js` and
`tests/activated-x-contract.test.js` cover rules, validation/native round trips,
public/opaque replay and headless DOM lifecycle. DOM tests are not real-browser
or layout verification. Release-wide/generated-catalog checks belong to the
integration work, not these isolated tests.

## Complete Standard sources

The October 26, 2026 Standard inventory and full local Forge scripts were checked
for every printed clause. This batch adds three complete definitions:

- **Alquist Proft, Master Sleuth:** legendary 3/3 Human Detective; vigilance;
  entry investigation using the existing exact Clue token; `{X}{W}{U}{U}`,
  tapping, and choosing a controlled Clue as a sacrifice cost; draw X and gain X
  life. The Clue is a cost, not a target. No sacrificed-object LKI is needed.
- **Mindspring Merfolk:** 1/1 Merfolk Wizard; its complete `{X}{U}{U}`, tap,
  once-per-incarnation Exhaust ability draws X and then places one +1/+1 counter
  on every Merfolk creature currently controlled by the ability's controller.
  X = 0 still pays the fixed costs, consumes Exhaust and places the counters.
- **Stature, Size Shifter:** legendary 1/1 Human Hero; current-power conditional
  unblockability; the complete X-cost Power-up counters with the entry-turn
  reduction and once-per-incarnation use restriction.

`tests/activated-x-sources.test.js` compiles the source files into an isolated
registry: exact Oracle text/identity/characteristics, JSON schema and native
round trips, all clauses, zero-X follow-ons, stale cost references, source
removal/return, creature-copy behavior, and real-source bot selections.

### Remaining inventory, not admitted

| Card                                | Remaining full-text blocker                                              |
| ----------------------------------- | ------------------------------------------------------------------------ |
| Berta, Wise Extrapolator            | Increment and one-or-more counter-placement mana trigger.                |
| Boommobile                          | Entry mana restricted to activating abilities.                           |
| Bruce Banner // The Incredible Hulk | Complete transforming/enrage and extra-combat sequence.                  |
| Dauntless Dismantler                | Opponent artifact entry replacement plus exact-X mana-value sweep.       |
| Gogo, Master of Mimicry             | Stack-ability copies, noncopyable restriction, and X minimum.            |
| Katara, Water Tribe's Hope          | Waterbend payment and variable team base characteristics.                |
| Krumar Initiate                     | X life payment and complete variable endure choice.                      |
| Likeness Looter                     | Exact-X graveyard copying with retained flying/ability.                  |
| Rot-Curse Rakshasa                  | X target count and decayed keyword counters.                             |
| Rydia, Summoner of Mist             | Exact-X Saga return with finality counter.                               |
| Sita Varma, Masked Racer            | Optional team base characteristics set from the source's resolved power. |
| Steel Hellkite                      | Damage-controller history and exact-X nonland sweep.                     |
| Taii Wakeen, Perfect Shot           | Exact noncombat-damage draw trigger and variable damage replacement.     |

The inventory's **Valor's Flagship** and **Webstrike Elite** use X in cycling
costs, not this ordinary activated-ability profile, and remain outside this
batch. These blockers are not approximated or omitted to inflate coverage.
