# Provenance and licensing

Leyline's engine and client are written in JavaScript for this repository. They do not run a Java backend, transpile Forge bytecode, or claim compatibility with Forge's card-script language.

## Forge

[Card-Forge/forge](https://github.com/Card-Forge/forge) was inspected as an architectural reference on 2026-10-25. In particular:

- `forge-game/.../phase/PhaseHandler.java`: priority handling and stabilization before giving priority.
- `forge-game/.../GameAction.java`: game actions and state-based checks.
- `forge-game/.../spellability/SpellAbility.java`: separation of spell abilities from display representations.
- `forge-game/.../trigger/TriggerHandler.java`: pending triggers, distinct from resolution.
- `forge-gui/res/cardsfolder/l/lightning_bolt.txt` and `c/counterspell.txt`: declarative executable card definitions.

No Forge Java implementation source is distributed in this repository. Sixteen small Forge card-script fixtures are reproduced in `packages/forge-import/test/fixtures/`, with upstream source links and GPL-3.0-or-later attribution; they test the conservative migration adapter. The comparable rule behavior is implemented directly from the game rules in a separate, smaller architecture. Leyline is licensed **GPL-3.0-or-later**, consistent with an open-source future that can incorporate properly attributed GPL-compatible contributions. This does not make this project an official Forge release. The included license is the unmodified GNU GPL v3 license text.

## Rules and cards

Rule references refer to the [official Comprehensive Rules](https://magic.wizards.com/en/rules), effective September 25, 2026 at the time of implementation. The reference was retrieved from the official page; no promise of automatic future rules updates is made.

Magic: The Gathering, card names, Oracle text, symbols, illustrations and other Wizards properties are not relicensed under Leyline's source-code license. This is an unofficial, noncommercial fan project, not approved or endorsed by Wizards of the Coast.

`apps/web/card-metadata.json` contains display metadata retrieved from Scryfall. Its URLs reference externally hosted card images; image files are not bundled. Artist credits are shown in the inspector. Running `node scripts/fetch-card-metadata.mjs` explicitly refreshes metadata; no card-rule behavior is generated from Oracle text. Review Scryfall's API policies before changing its access pattern or deploying at scale.

The geometric Leyline mark and README diagrams are original project graphics. Gameplay screenshots show the actual client, with third-party card art visible and credited as above. They are not concept renders or proof of broader engine support.
