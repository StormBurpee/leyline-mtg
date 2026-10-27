# Class level bars

Rule reference: **Comprehensive Rules, effective September 25, 2026**, rules
107.16 and 716.2–716.4. A Class level is a designation, not a counter or copiable
characteristic. A permanent with no explicit designation is level 1.

- The two level-bar activations occupy stable command slots, use the stack, cost
  their printed mana, and can be activated only at the preceding level and only
  as a sorcery. Countering one does not advance the Class.
- Resolution changes only the same battlefield incarnation. Losing abilities or
  changing control after activation does not counter it. Leaving and returning
  produces a new object at level 1.
- Acquired class abilities accumulate at levels 2 and 3. Removing abilities
  removes their grants, but does not erase the level. Copy values retain the
  printed level bars, not the source permanent's current level.
- Acquired triggered abilities are normal triggers once queued. Their existence
  is not encoded as an intervening-if. Real intervening-if clauses (such as
  Hunter's Talent's power threshold) are still checked at resolution.
- Becoming a level emits a distinct `classLevel` event after the designation
  changes. Consequently the newly acquired becomes-level trigger can trigger,
  and its controller and targets are fixed through the normal trigger boundary.

Source data uses an ability of kind `classLevel`, with `level`, a braced mana
`cost`, and a complete `abilities` array. Both level 2 and level 3 are required,
ordered and non-nested. Runtime `classLevels` contain validated ability
fragments. Currently supported fragment fields are `etb`, `triggers`,
`activated`, `static`, `costModifiers`, and `damageBonus`; other grants fail
compilation instead of being omitted. Multiple simultaneous anthem fragments
remain unsupported, as do multiple simultaneous damage-bonus replacements.
Generic activated, triggered and static grants are tested.

## Complete cards

- **Hunter's Talent:** both-target entry damage; level-2 attacking-creature
  +1/+0 and trample; level-3 end-step draw with its real intervening-if.
- **Caretaker's Talent:** one token-entry group draw per turn; level-2 copy of
  a controlled token; level-3 +2/+2 for controlled creature tokens.
- **Builder's Talent:** the exact white 0/4 defender Wall; one level-2 counter
  trigger per qualifying entry group; level-3 targeted noncreature, nonland
  permanent reanimation.
- **Leader's Talent:** targeted attack counter; level-2 life for each own
  counter-bearing creature departure using last-known counters; level-3 spell-cast
  counters on the creatures currently controlled when the trigger resolves.
- **Gossip's Talent:** each own creature entry surveils; level-2 attacking power-3-or-less
  creature becomes unblockable for the turn; level-3 optional exact-damage-source
  immediate blink under its owner's control.
- **Does Machines:** ordered entry mill/draw/discard; level-2 return of up to two
  targeted own artifact graveyard cards; level-3 counters and conditional permanent
  additive 0/0 Robot animation of a controlled artifact.
- **Stormchaser's Talent:** entry Otter; level-2 graveyard instant/sorcery return;
  level-3 spell-cast Otter creation. The blue-red 1/1 Otter has real prowess.

Stormchaser's Talent is **not** part of legal Standard coverage: Wizards banned
it in Standard on August 10, 2026. Its addition is Arena executable coverage.

## Dated Standard inventory and remaining work

The October 26, 2026 legal Standard inventory contains 14 Classes. Hunter's,
Caretaker's, Builder's, Leader's and Gossip's Talents plus Does Machines are the
six complete legal Standard Classes here; Stormchaser's adds executable Arena
coverage outside legal Standard.
Caretaker's and Builder's use real simultaneous `enterGroup` events, not
per-object approximations. Token-copy and permanent-return targets use the
existing incarnation-bound targeting and entry-choice continuations.

The other legal names are Artist's Talent, Bandit's Talent, Blacksmith's Talent,
Cool but Rude, Innkeeper's Talent, Ninja Teen, Party Dude and Scavenger's Talent.
Each stays unsupported until every clause works. In particular this Class foundation does not itself
provide arbitrary damage/counter replacement ordering, sacrifice-three and
reanimation continuations, sneak, random discard, equipment reassignment, or
life-gain replacement multiplication. It is not support for any of those cards.

## Bounded follow-through primitives

`hadCounters` is a boolean event predicate restricted to battlefield-departure
families. It reads counters from the shared predeparture snapshot (including
loyalty, keyword and charge counters), not the object after counters reset. Group
predicates require controller, type and counter facts on the same group member.
The historical fact remains true when a queued Leader trigger resolves; it is
not an intervening-if lookup of a newly returned object.

`blink` binds either the normal permanent target, the exact source, or the exact
event source. It exiles then returns a nontoken immediately under owner/you
control, with normal entry-choice continuations and no intervening priority.
Linked-exile duration returns happen immediately after the blink exile (CR 610.3),
before the blinked permanent returns; both phases retain their entry-choice
continuations. Optional triggers offer the decision at resolution. No battlefield incarnation
is followed across an unrelated zone change, and tokens cannot return.

`animatePermanent` adds the creature type and listed creature subtypes, setting
base power/toughness without removing existing types, colors or abilities. It is
an indefinite, noncopiable modifier on one battlefield incarnation, not an
ability granted by the Class. Existing artifact creatures get the counters but
are not animated by Does Machines. A later crew/Station threshold does not undo
the 0/0 base; Equipment becomes unattached normally. Both new operations accept
only a single target-group member; arbitrary batch blink/animation remains
unsupported rather than being approximated sequentially.

## Verification

`node --test --test-concurrency=1 packages/engine/test/class-levels.test.js`
compiles source cards into an isolated registry, validates schemas and native
roundtrips, and covers payment/timing, countering, source changes, copies,
ability loss/restoration, stable command identity, real-card effects, opaque bot
commands, readable cost/level controls, and deterministic replay. Neighboring
ability, registry, source-copy and trigger suites remain separate focused checks.
`class-grouped-entry-cards.test.js` covers the two group-dependent Classes.
`class-next-cards.test.js` covers all three follow-through Classes, historical
counter snapshots, same-member group matching, optional blink/incarnations,
continuations, native/source rejection boundaries, Vehicle/Station/Equipment
animation interactions, opaque bot decisions and deterministic replay.
`class-next-adversarial.test.js` independently covers linked-exile blink ordering,
Aura legality before the source returns, nested linked/blink entry choices, exact
return incarnations, actual token-copy characteristics, and replay at each paused
entry stage (CR 111.8, 400.7, 610.3, 613.1d and 613.4, effective September 25, 2026).
`tests/class-card-metadata.test.js` verifies the generated catalog/Oracle display
contract and inspector output after integration regenerates the catalog and
imports the reviewed external metadata.

`packages/engine/test/class-adversarial.test.js` adds independent checks for
native characteristic-only fragments, cumulative replacement fail-closed
validation, transforming-back-face context and nested token cross-references,
new-controller level triggers, retained designations after copy/type changes,
and target control/incarnation changes.

Managed browser preview was unavailable; DOM string assertions are not a claim
of manual browser QA. No generated catalog or global coverage artifact is part
of this source change.

Sources: [official Class rules](https://magic.wizards.com/en/rules),
[Bloomburrow release notes](https://magic.wizards.com/en/news/feature/bloomburrow-release-notes),
[TMNT release notes](https://magic.wizards.com/en/news/feature/teenage-mutant-ninja-turtles-release-notes),
[August 10, 2026 banned announcement](https://magic.wizards.com/en/news/announcements/banned-and-restricted-august-10-2026).
