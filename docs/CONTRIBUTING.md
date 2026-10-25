# Contributing

Small, reviewable changes are easier to trust than a larger card count.

## Local loop

Node.js 22 or newer is required. The engine and client have no runtime dependencies.

```sh
npm ci
npm test
npm run check
npm start
```

Open the address printed by the server. `node scripts/build.mjs` creates a portable static client in `dist/`.

## Adding a card

1. Find the current official Oracle text and the rules that its interactions require.
2. Check `docs/SUPPORT.md`. Do not approximate a missing mechanic to make the card appear supported.
3. Add a declarative definition to `packages/engine/src/cards.js`. Prefer existing effect opcodes.
4. Add focused tests in `packages/engine/test/`. Test both the expected result and the ways the action should fail. Include a source leaving play, changing zones, losing its target, or interacting with another trigger where relevant.
5. If the card needs a new opcode, implement and test the opcode separately. Unknown opcodes must throw, never silently do nothing.
6. Refresh display metadata deliberately with `node scripts/fetch-card-metadata.mjs`. Respect the service's rate limits. Images and Oracle text do not grant executable support.
7. Run checks and a real browser interaction before updating screenshots or claims.

## Rules changes

Include a rule-number reference and the reference document's effective date. Explain which previously accepted or rejected command changes. Add a minimal replay or test fixture that reproduces the issue. Do not infer correctness from the bot completing a game.

## Style

Use plain names and direct control flow. Keep engine behavior out of the client. Avoid speculative abstractions, unnecessary dependencies, fake progress, and fallback behavior that conceals unsupported rules. Prettier formats the source; TypeScript checks the public declaration contract. Neither is a runtime dependency.

Use GPL-3.0-or-later-compatible contributions and retain upstream attribution. Do not commit access tokens, credentials, personal replays, copyrighted image archives, or proprietary code. See `PROVENANCE.md` for asset and source boundaries.

## Before opening a pull request

- Tests cover the actual change, including rejection behavior.
- Invalid commands still leave their input unchanged.
- The same seed and command log replay to the same state.
- UI changes work with keyboard input and at narrow widths.
- README and support claims describe what is present, not what is planned.
