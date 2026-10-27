# Cards are data

The authoritative card definitions live in `packages/cards/cards/`, one JSON file per card. The runtime catalog is a compiled artifact. Adding a card that uses existing mechanics does not require editing engine JavaScript.

## The pipeline

```text
Card sources + mechanic templates
             │
       JSON Schema checks
             │
       semantic compilation
             │
  runtime validation + reference linking
             │
     generated immutable catalog
             │
       browser / simulation / replay
```

Run:

```sh
npm ci
npm run cards:build
npm run cards:check
npm test
```

`cards:check` recompiles the source and fails if tracked artifacts are stale. CI runs it before the test suite. Ajv and Prettier are development dependencies; neither ships with the rules engine or runs during a match.

## A card file

[Spirited Companion](../packages/cards/cards/spirited-companion.json) declares its Oracle identity, printed characteristics and the reusable `etb.draw` mechanic with `cards: 1`. [Monastery Swiftspear](../packages/cards/cards/monastery-swiftspear.json) declares haste and references `prowess`. [Patchwork Automaton](../packages/cards/cards/patchwork-automaton.json) declares ward and an artifact-cast predicate with an `addCounters` instruction.

The editor schema is [card.schema.json](../packages/cards/schema/card.schema.json). Files carry `schemaVersion: 1`; this version is independent of package and replay versions. Oracle IDs identify real cards; names remain the readable runtime/deck interface. Tokens use an explicit `leyline:token/…` namespace. `resolveCardName(id)` resolves an identity from the built-in pack without guessing unsupported cards.

`rulesText` is presentation, not executable input. Changing that text cannot implement an ability.

## Reuse without callbacks

[mechanics.json](../packages/cards/mechanics.json) contains data templates. A reference such as `{"use":"landfall.grow","args":{"power":1,"toughness":1}}` expands into an event predicate and an effect. Parameters are bounded integers, substituted as values, not interpolated into source code. Unknown parameters, missing mechanics, cycles and oversized expansions fail compilation.

The initial templates are deliberately small. Extend a shared mechanic once, then reference it from cards. Do not add a card-name switch to the engine.

## Composable predicates

Targets and triggers share predicate operators: `all`, `any`, `not`, card type, color, controller/owner relation, tapped/token status and numeric comparisons on power, toughness and mana value.

```json
{
  "scope": "permanent",
  "where": {
    "all": [
      { "type": "creature" },
      { "controller": "opponent" },
      { "tapped": true },
      { "power": { "lte": 2 } }
    ]
  }
}
```

This selector is evaluated against the actual game state, including supported power/toughness modifiers, and rechecked during resolution. It does not bypass shroud, hexproof or zone incarnations. Event predicates are observations, not targeting: they do not incorrectly apply targeting restrictions.

Event predicates include casting, battlefield entry and departure, and the other explicitly validated families. For example, `{"event":"cast","controller":"you","filter":{"color":"R"}}` works without introducing a new red-spell trigger enum. `enter` observes each entrant; `enterGroup` observes one actual simultaneous entry event for “one or more” abilities (CR 603.2c, 603.6a). Its controller, identity, and filter predicates must match the same member. Entry choices finish before the whole group enters; simultaneous entrants then observe one another, after replacement counters and continuous effects. Separate instructions are never merged. Rules revision 4 batches an ordinary multi-token instruction; revisions 1–3 retain historical sequential entry and object/trigger IDs when replaying old exports.

## What compilation guarantees

- The whole pack compiles or fails; unsupported cards are not silently omitted.
- Duplicate identities/names and dangling token references fail linking.
- Unknown fields, instructions, recipient bindings and unimplemented costs fail with paths and diagnostic codes.
- Card data contains no JavaScript callbacks. Accessors, cycles and non-JSON values are rejected by the compiler API; this is not a sandbox for hostile JavaScript callers.
- All 129 definitions from v0.5, including three tokens, retain identical runtime-definition contracts after migration. These contracts do not claim complete Magic interaction coverage.
- Source compilation can bootstrap without an existing generated runtime catalog.

## Limits still matter

This change makes authoring and importing maintainable; it does not implement all of Magic. Quantities are currently literals or compile-time parameters. Variable costs, runtime count expressions, arbitrary event bindings, general layers/replacements, multi-zone/split-destination search, multiple targets and multi-face cards still need engine work. Unsupported supertypes can be represented in source but are not flattened into vanilla cards.

The compiler lowers into the existing runtime instruction set to preserve tested behavior. That representation is internal; edit source files, not `packages/engine/src/generated-catalog.js`. The Forge adapter is a separate input frontend with its own strict grammar and diagnostics. Its candidates are not automatically promoted into the core pack.

## Targeted triggered abilities

A triggered ability can declare the same `target` selector as a spell or activated ability. Targets are selected when the trigger is put on the stack, not when its event happens and not when it resolves. `optional: true` makes the effect optional at resolution; it does not make a required target optional. See [Reclamation Sage](../packages/cards/cards/reclamation-sage.json) and [Sage's Row Denizen](../packages/cards/cards/sages-row-denizen.json).

Graveyard selectors use `scope: "graveyard"`, with ownership/type predicates. `moveTarget` supports recovery to hand, reanimation to the battlefield and exile; zone changes create new incarnations. Draw, discard, life gain and `loseLife` accept controller, opponent or selected-player recipients. Life loss does not trigger lifelink or count as damage. These operations do not imply library search, flashback, multi-target effects or generic Aura reattachment support.

## Library search

The `searchLibrary` instruction searches its controller’s library and then shuffles it. It accepts literal `amount`, optional `where`, `destination` (`hand`, `graveyard`, `battlefield`, or `top`), and optional `reveal`/battlefield-only `tapped` flags. Top selections are set aside during the shuffle and restored in the chosen order. Battlefield filters must constrain results to supported non-Aura permanent types.

A `where` quality allows finding fewer cards, including none. Without a filter, the player must find the requested number or as many as remain. `basic` and exact-case `subtype` predicates supplement the existing type, color, boolean and numeric predicates. These are library characteristics, not battlefield stat modifications.

A pending `librarySearch` exposes legal candidate IDs, minimum and maximum quantities, and destination flags. Submit `{ type: 'searchLibrary', cards: [...] }`; stale, duplicate, foreign and nonmatching selections are rejected without changing state. Resolution continues afterward without an intervening priority window. Optional whole-trigger searches use the existing optional-trigger decision; declining one does not shuffle.

This does not implement opponent libraries, replacement search limits, choosing different destinations for different found cards, variable quantities, or generic Aura attachment on entry. Cards requiring those features remain unsupported rather than receiving partial definitions.

### Filtered top-library selection

`lookChooseHand` inspects `amount` cards (or as many as remain), then puts the chosen cards into hand without drawing. `selectCount` defaults to one. Optional `where` uses the existing library-characteristic predicates; the deciding player can see every inspected card, but only matching cards are selectable. Mandatory selection takes the smaller of the requested count and the eligible count. Unlike a quality-restricted **search**, this inspection cannot fail to find a matching card. `optional: true` permits zero through that maximum; it does not skip moving the remainder.

`reveal: true` publicly records the selected identities. `revealAll: true` exposes the whole inspected set during the choice, without moving it out of the library. A normal look remains private. After cards move or are reordered, opposing views use opaque hidden-zone handles again; public reveal events retain names, not trackable hidden-zone IDs. `restDestination` defaults to `bottom` and also supports `graveyard`. `restOrder` defaults to `chosen`; `random` is allowed only for bottom placement and shuffles a canonical unchosen subset with the replay RNG. It cannot be influenced by the submitted remainder order.

The pending `libraryOrder` choice adds `eligibleCards`, `optional`, `reveal`, `revealed` and `restDestination` only when relevant. Submit the existing `{ type: 'orderLibrary', top: [...chosen], rest: [...remaining] }` command; every inspected card must occur exactly once. Decisions continue resolution without priority. Relative filters remain bound to the ability's controller even when another player is the recipient. Rules basis: CR 608.2d, 609.3, 701.20a/b/d/e and the distinct search permission in 701.23b (Comprehensive Rules, effective September 25, 2026).

## Selected sacrifices in activated costs

Activated `cost.sacrifice` describes a mandatory chosen payment, for example
`{"count":1,"where":{"any":[{"type":"creature"},{"type":"artifact"}]},"excludeSource":true}`.
`count` is a literal 1–10; `where` is an optional public-state predicate. The
activating player must currently control every selected battlefield permanent.
The `activate` command supplies `sacrifices: ObjectTarget[]`, including exact
incarnations. They are costs, not targets and not resolution-time instructions.
When `sacrificeSelf` is also present, the source cannot fill the chosen count and
all sacrifices share one departure snapshot. A source without the new cost keeps
its old command and replay shape.

Targets are selected before costs; a creature sacrificed as payment cannot be a
new graveyard target of that same activation. Mana may tap a selected permanent
first, but cannot sacrifice it and also spend it as the chosen cost. Eligibility
is checked again after mana abilities, with failed payments rolled back atomically.
The human choice stage supports large-card reading, cancellation and explicit
confirmation; bot and opaque-agent proposals carry the same references. Default
action enumeration bounds multi-permanent subsets to 256; explicit commands accept
any valid subset. Selected-sacrifice mana abilities, variable quantities and
resolution effects dependent on sacrificed-object characteristics remain unsupported.

Rules reference: [Comprehensive Rules, effective June 19, 2026](https://media.wizards.com/2026/downloads/MagicCompRules%2020260619.pdf),
602.2b, 601.2c/f–h and 603.10a.
