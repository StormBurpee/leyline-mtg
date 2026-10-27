<p align="center">
  <img src="docs/assets/leyline-banner.svg" alt="Leyline — a JavaScript rules engine for Magic" width="100%" />
</p>

<p align="center">
  <a href="#start-playing">Start playing</a> ·
  <a href="docs/ARCHITECTURE.md">Architecture</a> ·
  <a href="docs/CARD-DATA.md">Card format</a> ·
  <a href="docs/SUPPORT.md">Rules & card support</a> ·
  <a href="docs/SIMULATION.md">Simulation</a> ·
  <a href="docs/CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://github.com/StormBurpee/leyline-mtg/actions/workflows/ci.yml"><img src="https://github.com/StormBurpee/leyline-mtg/actions/workflows/ci.yml/badge.svg" alt="Engine and client checks" /></a>
  <img src="https://img.shields.io/badge/Node-22%2B-617d54?style=flat-square" alt="Node 22 or newer" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0--or--later-b49c62?style=flat-square" alt="GPL-3.0-or-later" /></a>
</p>

Leyline is a local-first Magic rules engine with a playable tabletop, written in JavaScript. The same kernel powers the browser client, the practice opponent and deterministic replays. No Java backend. No rules hidden in click handlers.

The target is every non-Alchemy card available on Arena, with complete Standard support first. That target is not yet met. [Track the dated card inventories.](docs/CARD-POOLS.md)

**Development preview:** 1589 executable cards and 57 token definitions. A scoped rules kernel, not a complete Forge port or a tournament-ready client. [The boundaries are documented.](docs/SUPPORT.md)

<p align="center">
  <img src="docs/assets/tabletop.png" alt="The actual Leyline client selecting a spell target in a resumed match" width="100%" />
  <sub>Actual client capture. A real match resumed through the engine, with a readable hand and explicit target selection. Card art belongs to its respective owners.</sub>
</p>

Cards are versioned JSON, compiled into a validated runtime catalog. Shared mechanics and composable predicates replace per-card JavaScript. [Read the card format.](docs/CARD-DATA.md)

## Start playing

```sh
git clone https://github.com/StormBurpee/leyline-mtg.git
cd leyline-mtg
npm start
```

Open the local address printed in your terminal. Requires **Node.js 22+**. There are no runtime dependencies to install.

The **Deck room** contains 14 playable starter lists: spells, ramp, flying control, tokens, drain, artifacts, double strike, midrange, reanimation and the Roots & Relics search toolbox. Choose your own opponent deck. Customize any starter in the visual builder, import a list, or build from the executable card pool. Saved lists and unfinished drafts stay on this device. Play against the practice bot or share a screen in local two-player mode. Drag a card onto your battlefield to play it, or onto a highlighted target to cast it. Select attackers and assign blockers by dragging, then confirm the group. Click and keyboard controls remain available. The stack and game log stay visible.

For a position with decisions already on the table, open **Engine → Inspect interactive position → Continue**. It is a real replay branch, not a staged board. [Client controls and verification.](docs/CLIENT.md)

For development:

```sh
npm ci
npm run check
npm run typecheck
npm run cards:check
npm run format:check
npm run build
```

`dist/` is a portable static client. The JavaScript engine also runs independently in Node.

## One engine. Every decision.

<img src="docs/assets/engine-flow.svg" alt="Human, bot and replay share the validated command boundary" width="100%" />

| At the table                     | In the engine                                                    |
| :------------------------------- | :--------------------------------------------------------------- |
| Cast, respond, hold priority     | Explicit priority and LIFO stack resolution                      |
| Choose targets and damage splits | Legal-action validation; targets checked again on resolution     |
| Order your triggers              | Pending triggers, state-based stabilization and APNAP ordering   |
| Save, resume, inspect            | Seeded shuffles, versioned command logs and deterministic replay |
| Add a supported card             | Declarative costs, effects, triggers and regression tests        |

Rejected commands leave the input state unchanged. Zone incarnations prevent stale targets from attaching to a creature that left and returned. Historical records are immutable; source state is separate from presentation.

```js
import { createGame, dispatch, exportReplay, replay } from './packages/engine/src/index.js';

let state = createGame({ seed: 731 });

const result = dispatch(state, {
  type: 'keep',
  player: 0,
  expectedRevision: state.revision,
});

if (result.ok) state = result.state;

const restored = replay(exportReplay(state));
```

Public TypeScript declarations are included. The implementation stays JavaScript. Validated registries can be supplied per game; replays embed their complete definition set.

## Small enough to understand

```text
packages/engine/src/   State, commands, costs, stack, effects, combat, bot
packages/engine/test/  Rule examples, rejection cases and replay regressions
apps/web/             Tabletop, card inspector, deck import and replay viewer
scripts/              Local server, static build and maintenance utilities
docs/                 Architecture, support manifest and contribution guide
```

The supported pool includes counterspells, prowess, cast triggers, token creation, +1/+1 counters, activated abilities, scry/surveil and draw/discard continuations, temporary effects, first/double strike, trample, deathtouch and lifelink. That is not a claim to implement every interaction those mechanics can have in the full game.

Commander, multiplayer, general layers/dependencies, replacement-effect ordering and unrestricted card support are still ahead. Unsupported imports fail visibly instead of becoming approximations. The bot is a deterministic sparring partner, not a competitive deck-testing oracle.

A conservative [Forge-script migration adapter](docs/FORGE-MIGRATION.md) produces reviewable candidates and explicit unsupported-syntax reports. It does not silently register partial cards.

**Start with a rule, not a card count.** [Read the contribution guide →](docs/CONTRIBUTING.md)

## Standing on good work

[Forge](https://github.com/Card-Forge/forge) is the architectural reference and the inspiration for the project's ambition. Leyline is a separate JavaScript implementation, not an official Forge release. [Source and asset provenance →](docs/PROVENANCE.md)

Source code is **GPL-3.0-or-later**. Magic: The Gathering, card names, Oracle text and illustrations remain the property of their respective owners. Images are served by Scryfall; artist credits appear in the client. Inter and Newsreader are distributed under the SIL Open Font License.

This is an unofficial fan project, not affiliated with or endorsed by Wizards of the Coast. Replays contain both players' hidden cards; read the [security boundaries](SECURITY.md) before sharing them or building multiplayer.
