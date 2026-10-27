# Preparation effects and triggers

This family extends preparation cards beyond `entersPrepared`; it does not claim
complete support for every preparation card.

Rules basis: CR 722 (preparation cards), CR 603.4 (intervening-if triggers), and
CR 400.7 (new objects after changing zones), using the repository's 2026-09-25
rules reference. The [Secrets of Strixhaven release notes, 2026-04-10](https://magic.wizards.com/en/news/feature/secrets-of-strixhaven-release-notes)
confirm the preparation designation, copy in exile, current-controller casting
permission, ordinary costs/timing, and survival of ability loss or type changes.

## Authoring contract

- `{ "op": "prepare", "target": "source" }` prepares the current source
  incarnation. `target` and `attached` bindings also work. A noncreature, or a
  creature without prepare-spell characteristics, cannot newly become prepared.
- `unprepare` uses the same bindings. It removes the designation and invalidates
  the associated exile copy; a previously cast spell on the stack is unaffected.
- Both effects are idempotent. Repeated preparation does not create extra copies.
- `{ "kind": "sourcePrepared", "prepared": false }` is an incarnation-bound
  condition. On a trigger it is checked both when the event occurs and when the
  ability resolves. A missing or departed source fails either boolean condition.
- Preparation remains object state, not an ability. Removing abilities does not
  erase the prepare-spell characteristics or an already prepared copy. Existing
  preparation also survives losing creature type or becoming a different copy.
- Casting the exile copy consumes preparation immediately, including if the
  spell is subsequently countered or all of its targets become illegal. Reentry
  cannot inherit an older incarnation's preparation or pending self-effects.
- Each nested prepare spell validates its own X expressions against its own mana
  cost. X on a prepared spell does not provide X to its creature's abilities.

These instructions use the existing event predicates, trigger queue, target
validation, payments, spell timing and resolution machinery. The card definitions
contain no name-specific engine branches. Shared spell names still have separate
exile objects and source links.

## Complete card additions in this family

- Abigale, Poet Laureate // Heroic Stanza
- Emeritus of Abundance // Regrowth
- Emeritus of Conflict // Lightning Bolt
- Encouraging Aviator // Jump
- Infirmary Healer // Stream of Life
- Joined Researchers // Secret Rendezvous
- Scathing Shadelock // Venomous Words
- Skycoach Waypoint
- Stingerquill Voxmancer // Vicious Verse
- Tam, Observant Sequencer // Deep Sight
- Woodwork Prodigy // Soul Tether

Woodwork Prodigy uses the shared Heartwood token definition, including its
Heartwood artifact subtype, red/green colors and both mana options.

## Candidates intentionally not admitted by this change

These are real clause-level gaps, not approximated as `entersPrepared`:

| Candidate                                      | Remaining prerequisite                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Bloodline Recollector; Emeritus of Woe         | Creature-death counts for the current turn.                                                                 |
| Scheming Silvertongue; Leech Collector         | Life-gain amount/history and first-gain-event predicates.                                                   |
| Emeritus of Ideation; Lluwen, Exchange Student | Optional eight-card graveyard-exile payment; creature-card graveyard-exile activation cost, respectively.   |
| Kirol, History Buff                            | Batched one-or-more cards leaving your graveyard event.                                                     |
| Spiritcall Enthusiast                          | Batched one-or-more token entries, not one trigger per token.                                               |
| Harmonized Trio                                | Two additional creature taps in the activation cost and ordered hand-to-library Brainstorm resolution.      |
| Codie, Ravenous Codex                          | Prepared-spell cast predicate, spell copying with new targets, and group preparation.                       |
| Biblioplex Tomekeeper                          | Optional modal triggered ability with mode-dependent targets.                                               |
| Infinite Coursework                            | Continuous removal of the enchanted permanent's abilities; an ETB ability-removal effect is not equivalent. |
| Paradox Shaper                                 | Targeted graveyard-card movement to library bottom.                                                         |
| Hexhaven Dueling Arena                         | A target predicate for creatures that attacked earlier this turn.                                           |
| Emeritus of Truce                              | Exiled target's last-known power and controller for life gain.                                              |
| Grave Researcher                               | Returned target's mana value for life loss.                                                                 |

## Verification

`packages/engine/test/become-prepared.test.js` covers schema/compiler/authoring
roundtrips, face-specific colors, actual paid casts and activated preparation,
trigger restrictions and resolution rechecks, normal timing, invalid targets and
immutable rejections, lost abilities, control changes, stale incarnations,
shared token identity, nested X and embedded-definition deterministic replay.
Existing preparation, condition, registry, X-cost and target-group tests remain
part of the regression surface.
