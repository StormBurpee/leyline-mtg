# Graveyard card types and Delirium

## Contract

`{ "kind": "graveyardCardTypes", "player": "you" | "opponent" | "all" }`
is a closed numeric expression usable by existing comparisons, arithmetic,
continuous bonuses, resolving effects, trigger conditions and cost conditions.
It unions the card types of public nontoken, non-copy cards in the selected
players' graveyards. An artifact creature contributes two types; repeated types
contribute once. `all` unions both graveyards rather than adding their counts.
Graveyard membership follows ownership, not a stale battlefield controller.
The caller's controller binding supplies the meaning of `you` and `opponent`.

The expression reads graveyard characteristics, including the main face of an
Adventure card, not an Adventure spell face or expired battlefield-only type
changes. Subtypes and supertypes do not count. Existing expression depth/node
budgets apply; the resulting set is bounded by admitted card types. The registry
currently admits seven types, not Battle or Kindred. Tokens, spell copies, hidden
placeholder records, and explicit excluded object IDs do not contribute. There
is no zone/filter override and no new access to hidden-zone characteristics.

Source `combatRestriction` abilities may now include a state `condition` for
`cannotAttack` or `cannotBlock`. They compile to at most eight
`conditionalCombatRestrictions`. Other conditional restriction kinds are rejected.
Conditions are evaluated against the permanent's current controller only when
attack/block legality is queried. They neither remove an established attacker or
blocker from combat nor survive removal of the intrinsic ability. Existing
unconditional restrictions and temporary rule-effect restrictions are unchanged.

## Complete admissions

| Card                  | All clauses represented                                                             |
| --------------------- | ----------------------------------------------------------------------------------- |
| Wildfire Wickerfolk   | Haste; live +1/+1 and trample at four types                                         |
| Spineseeker Centipede | Mandatory basic-land search, reveal, hand and shuffle; live +1/+2 and vigilance     |
| Patchwork Beastie     | Conditional attack/block prohibition; optional controller-upkeep mill               |
| Violent Urge          | +1/+0 and first strike; separate resolution-time double strike                      |
| Beastie Beatdown      | Explicit friendly/enemy targets; conditional two counters before power-based damage |
| Hand That Feeds       | Attack-occurrence-only threshold; +2/+0 and menace                                  |
| Drag to the Roots     | Conditional generic-cost reduction; destroy target nonland permanent                |
| Demonic Counsel       | Restricted revealed Demon search or replacement unrestricted unrevealed search      |
| Impossible Inferno    | Six damage; conditional exile/play permission through the next turn                 |

Delirium is not a single timing rule. Hand That Feeds uses `triggerCondition`
because its current Oracle wording restricts the attack occurrence. A true
intervening-if uses `condition` and checks both occurrence and resolution.
Resolving branches inspect the graveyard at their own instruction boundary; the
resolving instant/sorcery is still on the stack and does not count itself. Casting
reductions use cost-time state. Activated conditions are checked before payment,
not after exiling a source as a cost. Tests cover these paths separately.

For Demonic Counsel, an unrestricted search omits `where`; enumerating all card
types as a filter would incorrectly allow fail-to-find. For Beastie Beatdown, a
remaining legal friendly target still receives counters when the enemy target is
illegal, but a missing/illegal damage source cannot deal damage.

No claim is made for the remaining Delirium cards' independent missing mechanics,
such as finality counters, conditional mode counts, additional combat phases,
conditional tribal anthems, counter doubling, or maximum-hand-size changes.

## Evidence and verification

Complete identity, Oracle text, type line, mana cost, colors and printed P/T are
recorded in `tests/fixtures/delirium-oracle-reviewed.json`, with the SHA-256 of
`research/standard-expansion/standard.json` used for the review. Nine source
cards validate, compile, and round-trip without discarded clauses.

Rules references: CR 205.2a–b (card types), 603.4 (intervening-if), 601.2f (total
casting cost), 508.1c/509.1b (declaration restrictions), and 715.4 (Adventure
characteristics). The official [Duskmourn release notes](https://magic.wizards.com/en/news/feature/duskmourn-house-of-horror-release-notes),
last modified September 16, 2024, clarify the Delirium type union, Patchwork's
already-declared combat behavior, and Drag's cost-time restriction. Current
Oracle wording in the inventory takes precedence over older printed self names.

Focused checks:

```sh
node --test --test-concurrency=1 tests/delirium-schema.test.js packages/engine/test/delirium.test.js
npm run typecheck
```

The focused suite uses a registry compiled directly from these sources, avoiding
a dependency on a separately regenerated global catalog. Publication, aggregate
checks and browser validation are integration responsibilities, not claimed by
these focused checks.
