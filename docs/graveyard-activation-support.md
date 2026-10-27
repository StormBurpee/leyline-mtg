# Graveyard activated abilities and self-return

## Rules contract

Reviewed against the [Comprehensive Rules, effective September 25, 2026](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt): CR 113.6m, 117.1b, 400.7, 602.1a, 602.2, and 602.5d. Oracle clauses were checked against the local October 26, 2026 Standard inventory (`research/standard-expansion/standard.json`).

- `zone: "graveyard"` restricts activation to the source's owner's graveyard. It does **not** imply an exile cost. Priority, declared targets, conditions, optional sorcery timing, and complete cost affordability are checked before payment. A former battlefield controller cannot activate another player's graveyard card.
- `cost.exileSelf` remains available when Oracle explicitly requires exiling the source. Graveyard activations cannot tap or sacrifice their source; loyalty abilities remain battlefield-only. Mana, life, and the existing single-card discard costs retain their normal validation and payment behavior.
- Self-return reuses `moveTarget` with source JSON `target: "source"` (native `subject: "source"`). It is not targeted. For a mana-only activation, the source stays in its graveyard while the independent ability is on the stack. A hand return uses `destination: "hand"`; battlefield return uses `destination: "battlefield"` and, where printed, `tapped: true`.
- The stack entry captures the graveyard incarnation. Resolution cannot follow a card that left and returned, even if it is again in the same graveyard. Battlefield return uses normal entry processing, creates a fresh incarnation, and queues entry triggers. The owner receives the card unless a supported effect explicitly says otherwise.
- Multiple activations remain legal if their costs can be paid. After the first return, another pending activation cannot return that new object. The bot avoids paying twice for a pending self-return of the same incarnation; this is a policy choice, not a new rules restriction.

Previously, registry validation rejected **all** graveyard activations without `exileSelf`, even when the complete Oracle ability had only a mana cost. Such definitions now validate without adding a fictitious exile step. No new opcode or source-reference format is introduced.

## Complete source additions

| Card                     | Full supported clauses                                                   |
| ------------------------ | ------------------------------------------------------------------------ |
| Reassembling Skeleton    | `{1}{B}` return to the battlefield tapped                                |
| Tunnel Rats              | `{4}{B}` return to the battlefield tapped                                |
| Merchant of Many Hats    | `{2}{B}` return to hand                                                  |
| Project Deathlok Soldier | Artifact creature; `{2}{B}` return to hand                               |
| Blessed Ghoul            | Lifelink; `{2}{W/B}` return to hand; hybrid casting and activation       |
| Bestial Bloodline        | Enchant creature; enchanted creature gets +2/+2; `{4}{G}` return to hand |
| Summoned Dromedary       | Vigilance; `{1}{W}` return to hand, only as a sorcery                    |

All returns in this table activate from the card's owner's graveyard. No abilities or costs have been omitted. Other-zone activations, arbitrary alternative costs, costs requiring additional unsupported choices, and unrelated unsupported clauses remain outside this addition.

## Verification

`tests/graveyard-self-return.test.js` compiles the actual sources directly into an immutable test catalog, so it does not depend on generated catalog changes. Coverage includes source schema and native round trips; all seven complete cards; owner/zone/priority/timing/payment rejection atomicity; hybrid costs and lifelink; Aura attachment and recovery; source incarnation changes; repeated activations; ordinary entry triggers; target/cost declarations; bot nonduplication; and a command-only replay using the unchanged Reassembling Skeleton, Shock, and basic-land definitions, with actual casting and activation mana payments.

Existing exile-as-cost and reflexive-target behavior remains covered by `tests/cryomancer-pack.test.js`. Its former assertion that an empty graveyard activation cost is intrinsically invalid was replaced with an actually invalid sacrifice-source cost.
