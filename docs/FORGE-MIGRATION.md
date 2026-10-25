# A migration path from Forge

Forge's card scripts are useful structured input. Oracle prose is not a safe substitute for executable rules.

Leyline includes a **conservative migration adapter**, separate from the engine. It reads local Forge `.txt` scripts and produces reviewable JSON candidates plus explicit rejection diagnostics. It does not execute scripts, fetch a card collection, change the live registry, or claim full Forge compatibility.

```sh
node scripts/import-forge.mjs path/to/forge/forge-gui/res/cardsfolder new-report.json
```

The report destination must not already exist. Omit it to print JSON to stdout. The adapter skips symbolic links when walking a directory.

## Implemented translation grammar

- The five basic lands, with their implicit mana abilities.
- Single-type creatures with literal power/toughness and supported combat keywords.
- Prowess, translated to a cast-trigger definition.
- One direct spell ability: literal damage, counterspell, untargeted draw, creature destruction or battlefield-creature bounce.
- Simple colored/generic costs and the supported target predicates.

Every unrecognized rules field, opcode, keyword or extra ability parameter is a rejection. Modal spells, variable expressions, alternate costs, `T:` triggers and `SVar:` references remain manual migration work. For example, the real Sprite Dragon script is rejected even though Leyline has a separate hand-authored Sprite Dragon implementation. The adapter must not pretend it understands a grammar it has not implemented.

## Review workflow

1. Inspect the diagnostics. A candidate is not a proof of card correctness.
2. Compare its executable definition with current Oracle text and rule interactions.
3. Add the reviewed definition to the registry in `packages/engine/src/cards.js`.
4. Add engine interaction tests. Parser tests only establish translation behavior.
5. Refresh display metadata separately and regenerate the support manifest.

The fixture suite includes small, attributed Forge examples under GPL-3.0-or-later. Generated definitions derived from Forge scripts must retain compatible licensing and attribution. See [provenance](PROVENANCE.md).

A later importer should extend this grammar one semantic family at a time. Unsupported syntax must remain visible; increasing a displayed card count is not a reason to weaken rejection behavior.
