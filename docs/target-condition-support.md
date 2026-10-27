# Target-bound resolving conditions

This v53 family adds `targetMatches` and `targetEnteredThisTurn` inside an
instruction's `conditional` branch. A condition explicitly names either
`target: "target"` or `targetGroup: "actor"`, never both. A group must declare
at most one object; a zero-target optional declaration evaluates false.

```json
{
  "op": "conditional",
  "condition": {
    "kind": "targetMatches",
    "targetGroup": "actor",
    "where": { "subtype": "Mount" }
  },
  "then": [
    {
      "op": "addCounters",
      "target": "target",
      "targetGroup": "actor",
      "counter": "+1/+1",
      "amount": 1
    }
  ]
}
```

`targetMatches` accepts the existing closed public predicate language, including
current type/subtype, token/tapped/combat status, effective creature statistics,
keywords, and mana value. Its declaration must target a permanent or a graveyard
card; players, stack objects, concealed zones, and ambiguous multi-object groups
are rejected. `targetEnteredThisTurn` accepts a permanent declaration only.
`all`/`any` composition retains the existing complexity budgets. Schema, native
validation, and TypeScript keep these conditions separate from trigger gates,
activation restrictions, entry conditions, and continuous bonuses: no condition
is evaluated before targets have been selected.

## Resolution contract

- Targets are rechecked once when resolution starts, using their announced
  selectors, controllers, hexproof/shroud restrictions, and exact incarnations.
  Illegal group members are removed independently; a spell with no remaining
  legal targets does not resolve.
- Each condition then reads the current public characteristics of its surviving
  object at that instruction. Depressurize therefore reads power **after** its
  -3/-0 modifier. Gaining hexproof during resolution does not retroactively make
  an already legal target unusable. A missing, departed, returned, hidden, or
  initially illegal target evaluates false, even for a negated filter.
- Face-down objects expose only their public face-down characteristics, never
  their concealed name, subtypes, or printed mana value. Noncreature battlefield
  objects do not acquire a fictional zero power/toughness for these predicates.
- There is no general target LKI lookup. For the admitted _was/had_ follow-through
  cards, the condition chooses its branch immediately before the single
  destroy/exile/return instruction. Both branches preserve that instruction's
  order; the selected branch stores the relevant pre-move fact and then performs
  the stated follow-through. Destruction need not succeed unless the card says
  so. This is not permission to move other conditional checks earlier.
- The existing nested target-controller snapshot also supports
  `damageTargetController` bound to one permanent/graveyard group. It snapshots
  only a surviving legal object's controller at resolution, before movement.
  Wisecrack uses one creature group as both bite actor and victim; its subsequent
  controller damage is dealt by the spell, not by that creature.
- Policy previews receive the same declared target/group context and Bargain
  paid state. They remain bounded heuristics, not full resolution simulation.

Rules basis: the repository's September 25, 2026 Comprehensive Rules baseline,
CR 400.7 (new zone incarnations), 603.3d/603.4 (target selection and intervening
conditions), 608.2b/c/h (legality, instruction order, public/last-known
information), 704.4 (no state-based actions during resolution), and 708.2
(face-down characteristics). See the [official rules page](https://magic.wizards.com/en/rules).
The [Lost Caverns release notes](https://magic.wizards.com/en/news/feature/the-lost-caverns-of-ixalan-release-notes)
explicitly confirm Malamet's counter survives an illegal opposing target; the
[Thunder Junction release notes](https://magic.wizards.com/en/news/feature/outlaws-of-thunder-junction-release-notes)
confirm Throw requires both targets when cast. The
[Edge of Eternities release notes](https://magic.wizards.com/en/news/feature/edge-of-eternities-release-notes)
confirm Seedship's mana-value clause, including X being zero on a permanent.

## Complete cards

Exact identities, full Oracle text, costs and characteristics from the supplied
October 26 Standard inventory are preserved with its checksum in
`tests/fixtures/target-conditions-oracle-reviewed.json`.

| Card                  | Complete supported behavior                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brackish Blunder      | Return creature to owner; Map only from pre-return tapped status, including creature tokens.                                                                     |
| Budding Insurgent     | Vigilance; sorcery-only self-sacrifice activation destroys artifact/enchantment; draw only for a legendary enchantment.                                          |
| Consuming Ashes       | Exile creature; pre-exile mana value at most three enables the full surveil-two decision.                                                                        |
| Depressurize          | Temporary -3/-0, then destroy only if its resulting effective power is at most zero.                                                                             |
| Driftgloom Coyote     | ETB linked exile of opposing creature; source counter from pre-exile power at most two; existing linked return preserved.                                        |
| Hazardroot Herbalist  | Once per attack declaration, own target gains +1/+0; only a token also gains deathtouch.                                                                         |
| Ingenious Leonin      | Printed activation cost; another own attacking target gets a counter, then first strike only if currently a Cat.                                                 |
| Little Bear           | Flash; ETB untaps another own creature; a current Bear also gets a counter.                                                                                      |
| Malamet Battle Glyph  | Own target gets a counter if it entered this turn, then fights opposing target; partial-target semantics preserved.                                              |
| Scavenging Ooze       | Exile a card from either graveyard; creature-card branch counters the source and gains life independently of source survival.                                    |
| Seedship Impact       | Destroy artifact/enchantment; Lander from pre-destruction mana value at most two, including indestructible targets.                                              |
| Sunpearl Kirin        | Flash/flying; optional other own nonland return; token branch draws after the return.                                                                            |
| Tainted Treats        | Destroy artifact/creature; Food from pre-destruction mana value at most four.                                                                                    |
| Throw from the Saddle | Mount receives a counter instead of a temporary +1/+1; then the creature bites the opposing target.                                                              |
| Wisecrack             | Creature deals its own effective power to itself with its damage keywords; an attacking target's controller takes two from the spell before state-based actions. |
| Yip Yip!              | Own creature gets temporary +2/+2; current Ally also gains flying; Lesson subtype retained.                                                                      |

Focused tests cover all sixteen cards through casts, activations, trigger target
choices, and resolution continuations, plus compiler/native rejection,
source round trips, public face-down behavior, partial targets, illegal and
returned incarnations, source departure, and deterministic command replay.

## Deliberate exclusions

- **Back for Seconds:** still needs a resolution-time optional choice of at most
  one eligible returned card for a different destination. A target mana-value
  condition alone cannot implement that choice.
- **Beastie Beatdown:** requires distinct card-type counting for delirium; this
  family does not add that mechanic.
- **Reptilian Recruiter:** requires temporary control and its cleanup semantics.
- Damage-outcome/excess-damage conditions, arbitrary target LKI, target-to-target
  numeric comparisons, and hidden-card characteristic queries remain outside
  this family. No partial versions of these cards are admitted here.
