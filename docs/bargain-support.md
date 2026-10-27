# Bargain casting support

Bargain is an optional additional sacrifice cost, not a rules-level modal ability.
The source declaration is `{ "kind": "bargain" }`; the native definition has
`bargain: true`. The existing cast command's `mode` selector announces **0**
(default, decline) or **1** (bargain). Mode 1 also requires an exact `sacrifice`
object reference. No `modes` ability is manufactured for these cards.

A bargain payment sacrifices exactly one artifact, enchantment, or token the
caster controls. Any token qualifies, including a nonartifact creature or land
token. The same permanent may be tapped for mana and then sacrificed, but a
sacrifice-as-mana source cannot simultaneously fund the mana cost and pay bargain.
Targets are announced before payment; payment is atomic; actual sacrifice/death
triggers use the existing last-known-information and APNAP ordering machinery.
All total-cost increases and reductions are locked before any payment.

`sourceBargained` is a declarative condition for resolving spell effects,
self-cost reductions, and permanent entry abilities. A successful bargain is
stored separately as `bargained` on the stack entry and cast object, retained
only across stack-to-battlefield entry, and cleared by subsequent zone changes.
Entry triggers snapshot that status, so removing or blinking their source does
not invalidate the original trigger. Copies of a permanent do not inherit it.
General stack-spell copying remains outside the supported opcode surface; a
future implementation must copy the original spell's additional-cost status
rather than pay bargain again or infer it from the command's mode number.

## Complete cards

- Agatha's Champion
- Archon's Glory
- Candy Grapple
- Farsight Ritual
- Hamlet Glutton
- High Fae Negotiator
- Ice Out
- Johann's Stopgap
- Kellan's Lightblades
- Realm-Scorcher Hellkite
- Stonesplitter Bolt
- Tenacious Tomeseeker
- Troublemaker Ouphe

The client exposes decline/bargain as casting options, then reviews the actual
eligible sacrifice after choosing targets. The bot, opaque simulation proposals,
and replay use that same command and cost validation boundary.

## Explicit remaining exclusions

These cards are not approximated or admitted by this change:

- **Back for Seconds:** optional selection of one eligible returned card for an
  alternate battlefield destination.
- **Beseech the Mirror:** face-down library exile and constrained optional free
  casting, followed by a conditional hand destination.
- **Brave the Wilds:** targets conditional on announcing bargain, plus permanent
  land animation.
- **Diminisher Witch:** Cursed Role token attachment, base-stat replacement, and
  controller-specific Role uniqueness.
- **Rowan's Grim Search:** top-four rearrangement with at most two cards retained.
- **Thunderous Debut:** top-twenty selective creature reveal, conditional
  destination, and library shuffle.
- **Torch the Tower:** damage-linked until-end-of-turn graveyard replacement.

Other casting-option combinations fail closed rather than silently losing a
choice. Artifact lands are excluded by the existing native multitype definition
validator; this change does not expand that unrelated card-family boundary.

## References and verification

Rules basis: CR 601.2b/c/f/g/h, 603.4, 400.7 and 702.166; the project's
September 25, 2026 Comprehensive Rules baseline. The [official Wilds of Eldraine
release notes](https://magic.wizards.com/en/news/feature/wilds-of-eldraine-release-notes)
(September 2023) confirm that bargain is optional, sacrifices one eligible
permanent, and is retained by copies of bargained spells.

Focused verification lives in `packages/engine/test/bargain.test.js`,
`tests/bargain-pack.test.js`, and the bargain case in
`tests/client-choice-lifecycle.test.js`. It covers complete card clauses,
decline/payment/rejection, source departure, target-before-payment ordering,
source reservation, cost locking, source round trips, opaque handles,
deterministic replay, bot proposals, and interrupted/repeated client decisions.
