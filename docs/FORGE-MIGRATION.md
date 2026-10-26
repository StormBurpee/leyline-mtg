# A migration path from Forge

Forge's card scripts are useful structured input. Oracle prose is not a safe substitute for executable rules.

Leyline includes a **conservative migration adapter**, separate from the engine. It reads local Forge `.txt` scripts and produces reviewable JSON candidates plus explicit rejection diagnostics. It does not execute scripts, fetch a card collection, change the live registry, or claim full Forge compatibility.

```sh
node scripts/import-forge.mjs path/to/forge/forge-gui/res/cardsfolder new-report.json
```

The report destination must not already exist. Omit it to print JSON to stdout. The adapter skips symbolic links when walking a directory.

## Implemented translation grammar

- The five basic lands and explicit supported nonbasic mana abilities. Flexible sources produce one mana, not every listed color.
- Unconditional self enters-tapped replacements; conditional and competing replacements are rejected.
- Single-face permanent types, including artifact/enchantment creatures, with literal characteristics and supported keywords.
- Prowess, translated to a cast-trigger definition. Menace and single-instance mana/life ward.
- Direct spell instructions: literal damage, counterspell, untargeted draw, creature destruction, battlefield-creature bounce and temporary pumps.
- Scry, surveil and mandatory self-discard, including resolution choices.
- Referenced `SVar:` / `DB$` subability chains with cycle, missing-reference and unused-variable checks.
- Supported mana/tap activated abilities and flexible one-mana abilities.
- Selected self-enter, other-creature-enter, landfall and controlled spell-cast triggers, including target selection and optional controller decisions.
- Literal mill, life-gain, source-counter and source-untap instructions.
- Simple colored/generic costs and the supported target predicates.

Every unrecognized rules field, opcode, keyword or extra ability parameter is a rejection. Modal spells, variable expressions, alternate costs, broader `T:` predicates and dynamic `SVar:` expressions remain manual migration work. A recognized opcode does not authorize dropping an unrecognized restriction or subability.

## Review workflow

1. Inspect the diagnostics. A candidate is not a proof of card correctness.
2. Compare its executable definition with current Oracle text and rule interactions.
3. Author or migrate a schema-versioned source under `packages/cards/cards/`. Compile it with `npm run cards:build`, then validate with `npm run cards:check`. The generated catalog is not edited by hand.
4. Add engine interaction tests. Parser tests only establish translation behavior.
5. Refresh display metadata separately and regenerate the support manifest.

The fixture suite includes small, attributed Forge examples under GPL-3.0-or-later. Generated definitions derived from Forge scripts must retain compatible licensing and attribution. See [provenance](PROVENANCE.md).

A later importer should extend this grammar one semantic family at a time. Unsupported syntax must remain visible; increasing a displayed card count is not a reason to weaken rejection behavior.

## Reproducible inventory

The pinned upstream snapshot contains 34,131 script files. Adapter 0.8.0 produces 1,896 candidates and explicitly rejects 32,235 files. This is a syntax inventory, not 1,896 verified playable cards. The report records its upstream commit and compiler hash in [forge-audit.json](forge-audit.json); the earlier adapter inventory is retained in [forge-audit-v0.1.json](forge-audit-v0.1.json).

Runtime fixtures execute selected translated cards through Leyline, including private scry, surveil, tap costs, discard continuations and targeted pumps. They do not compare execution against the Forge Java runtime.

The v0.9 Standard tranche promotes 145 previously recognized candidates after Oracle identity/characteristic comparison, review of their printed rules, and per-card casting/ability execution checks. It does not register the remaining Arena candidates automatically. The fixture manifest records pinned Forge source links and hashes alongside the independently retrieved Oracle records.
