# Provenance and licensing

Leyline's engine and client are written in JavaScript for this repository. They do not run a Java backend, transpile Forge bytecode, or claim compatibility with Forge's card-script language.

## Forge

[Card-Forge/forge](https://github.com/Card-Forge/forge) was inspected as an architectural reference on 2026-10-25. In particular:

- `forge-game/.../phase/PhaseHandler.java`: priority handling and stabilization before giving priority.
- `forge-game/.../GameAction.java`: game actions and state-based checks.
- `forge-game/.../spellability/SpellAbility.java`: separation of spell abilities from display representations.
- `forge-game/.../trigger/TriggerHandler.java`: pending triggers, distinct from resolution.
- `forge-gui/res/cardsfolder/l/lightning_bolt.txt` and `c/counterspell.txt`: declarative executable card definitions.

No Forge Java implementation source is distributed in this repository. Fifty-one small Forge card-script fixtures are reproduced in `packages/forge-import/test/fixtures/`, with upstream source links and GPL-3.0-or-later attribution; they test the conservative migration adapter. The comparable rule behavior is implemented directly from the game rules in a separate, smaller architecture. Leyline is licensed **GPL-3.0-or-later**, consistent with an open-source future that can incorporate properly attributed GPL-compatible contributions. This does not make this project an official Forge release. The included license is the unmodified GNU GPL v3 license text.

## Rules and cards

Rule references refer to the [official Comprehensive Rules](https://magic.wizards.com/en/rules), effective September 25, 2026 at the time of implementation. The reference was retrieved from the official page; no promise of automatic future rules updates is made.

Magic: The Gathering, card names, Oracle text, symbols, illustrations and other Wizards properties are not relicensed under Leyline's source-code license. This is an unofficial, noncommercial fan project, not approved or endorsed by Wizards of the Coast.

`apps/web/card-metadata.json` contains display metadata retrieved from Scryfall. Its URLs reference externally hosted card images; image files are not bundled. Artist credits are shown in the inspector. Running `node scripts/fetch-card-metadata.mjs` explicitly refreshes metadata; no card-rule behavior is generated from Oracle text. Review Scryfall's API policies before changing its access pattern or deploying at scale.

The geometric Leyline mark and README diagrams are original project graphics. Gameplay screenshots show the actual client, with third-party card art visible and credited as above. They are not concept renders or proof of broader engine support.

## Reviewed card data

The v0.3–v0.5 `reviewed-creatures.js` contained 34 single-face creature definitions derived from the same pinned Forge snapshot (`e5a0f8156da70ffc7866f923bed371c0111707cd`). Each was reviewed for representation by literal characteristics, supported combat keywords and prowess, then exercised by casting/resolution fixtures. The source scripts remain attributable to Forge contributors under GPL-3.0-or-later. Their Oracle text remains Wizards property. These checks do not certify every possible interaction with unsupported Magic mechanics.

`docs/card-pools/` records dated Scryfall inventories and implementation status, not executable rules. Queries, retrieval times and source-page hashes are retained. Scryfall availability tags are not a verified export of an Arena client installation. Alchemy-tagged results and auxiliary tokens/emblems are tracked separately rather than counted as playable deck cards.

The adapter recognizes a narrow set of `T:` trigger predicates and unconditional self enters-tapped `R:` replacements. Unused `SVar:BuffedBy` values `Land`, `Creature` and `Card.nonCreature` are treated as AI hints, based on their use in Forge `forge-ai/.../ComputerUtil.java` and `AiController.java`; other unused variables still fail. This is not a general Forge trigger or replacement interpreter.

The exact `AI:RemoveDeck:Random` presentation/deck-generation flag is ignored by the adapter. Forge `forge-core/.../CardRules.java` stores it as a random-deck exclusion, not an in-game rule. Other AI fields remain explicit diagnostics. Optional trigger control comes from `OptionalDecider$ You`; it is preserved as a resolution choice, not dropped.

## Native source pack

Version 0.6 migrates the complete v0.5 registry into schema-versioned JSON files under `packages/cards/cards/`. Real-card identities come from the already-retrieved Scryfall Oracle IDs. Token identities are project-local. All 129 pre-migration runtime definitions are protected by cryptographic regression contracts. The original 34-creature fixture remains under engine test fixtures, not in the production registry. This is a data-format migration, not a claim that importing Oracle text executes its rules.

Version 0.8 adds eight targeted-trigger sources reviewed against Scryfall Oracle records on October 26, 2026 and the same pinned Forge scripts: Acidic Slime, Exclusion Mage, Flametongue Kavu, Man-o'-War, Meteor Golem, Ravenous Chupacabra, Reclamation Sage and Sage's Row Denizen. Scryfall keyword-action tags (such as Mill) are not treated as printed keyword abilities. The four added Forge fixtures are unmodified apart from attribution headers; unsupported AI hints remain diagnostics.
