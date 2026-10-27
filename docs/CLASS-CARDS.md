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
- **Stormchaser's Talent:** entry Otter; level-2 graveyard instant/sorcery return;
  level-3 spell-cast Otter creation. The blue-red 1/1 Otter has real prowess.

Stormchaser's Talent is **not** part of legal Standard coverage: Wizards banned
it in Standard on August 10, 2026. Its addition is Arena executable coverage.

## Dated Standard inventory and remaining work

The October 26, 2026 legal Standard inventory contains 14 Classes. Hunter's,
Caretaker's and Builder's Talents are the three complete legal Standard unlocks
here; Stormchaser's adds executable Arena coverage outside legal Standard.
Caretaker's and Builder's use real simultaneous `enterGroup` events, not
per-object approximations. Token-copy and permanent-return targets use the
existing incarnation-bound targeting and entry-choice continuations.

The other legal names are Artist's Talent, Bandit's Talent, Blacksmith's Talent,
Cool but Rude, Does Machines, Gossip's Talent, Innkeeper's Talent, Leader's
Talent, Ninja Teen, Party Dude and Scavenger's Talent. Each stays unsupported
until every clause works. In particular this Class foundation does not itself
provide arbitrary damage/counter replacement ordering, sacrifice-three and
reanimation continuations, sneak, random discard, equipment reassignment, or
instantaneous event-source blinking. It is not support for any of those cards.

## Verification

`node --test --test-concurrency=1 packages/engine/test/class-levels.test.js`
compiles source cards into an isolated registry, validates schemas and native
roundtrips, and covers payment/timing, countering, source changes, copies,
ability loss/restoration, stable command identity, real-card effects, opaque bot
commands, readable cost/level controls, and deterministic replay. Neighboring
ability, registry, source-copy and trigger suites remain separate focused checks.
`class-grouped-entry-cards.test.js` covers the two group-dependent Classes.
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
[August 10, 2026 banned announcement](https://magic.wizards.com/en/news/announcements/banned-and-restricted-august-10-2026).
