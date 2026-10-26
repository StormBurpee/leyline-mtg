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

The current event families are casting and entering the battlefield. For example, `{"event":"cast","controller":"you","filter":{"color":"R"}}` works without introducing a new red-spell trigger enum. Other event families remain explicit unsupported capabilities.

## What compilation guarantees

- The whole pack compiles or fails; unsupported cards are not silently omitted.
- Duplicate identities/names and dangling token references fail linking.
- Unknown fields, instructions, recipient bindings and unimplemented costs fail with paths and diagnostic codes.
- Card data contains no JavaScript callbacks. Accessors, cycles and non-JSON values are rejected by the compiler API; this is not a sandbox for hostile JavaScript callers.
- All 129 definitions from v0.5, including three tokens, retain identical runtime-definition contracts after migration. These contracts do not claim complete Magic interaction coverage.
- Source compilation can bootstrap without an existing generated runtime catalog.

## Limits still matter

This change makes authoring and importing maintainable; it does not implement all of Magic. Quantities are currently literals or compile-time parameters. Variable costs, runtime count expressions, arbitrary event bindings, general layers/replacements, search, multiple targets and multi-face cards still need engine work. Unsupported supertypes can be represented in source but are not flattened into vanilla cards.

The compiler lowers into the existing runtime instruction set to preserve tested behavior. That representation is internal; edit source files, not `packages/engine/src/generated-catalog.js`. The Forge adapter is a separate input frontend with its own strict grammar and diagnostics. Its candidates are not automatically promoted into the core pack.

## Targeted triggered abilities

A triggered ability can declare the same `target` selector as a spell or activated ability. Targets are selected when the trigger is put on the stack, not when its event happens and not when it resolves. `optional: true` makes the effect optional at resolution; it does not make a required target optional. See [Reclamation Sage](../packages/cards/cards/reclamation-sage.json) and [Sage's Row Denizen](../packages/cards/cards/sages-row-denizen.json).
