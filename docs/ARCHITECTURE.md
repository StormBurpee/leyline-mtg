# Engine architecture

The client never decides whether a game action is legal. It submits a command to `dispatch`, receives either a new state or an error, and renders the result.

```
Human UI ─┐
Bot ──────┼── command + revision ── dispatch ── new state + events
Replay ───┘                            │
                         validate → pay → apply → stabilize
```

## State and identity

`model.js` owns serializable state, object references, zones and the seeded PRNG. There are no DOM nodes, callbacks, wall-clock reads or ambient randomness in game state. No network request is made by the engine.

Every card has an object ID and an **incarnation**. A zone change increments the incarnation and resets local characteristics. A targeted Giant Growth does not accidentally resolve on a creature that left and returned before resolution. Triggered and activated abilities retain their controller and source characteristics independently of whether the source remains in play.

The state has a monotonically increasing revision. Commands may supply `expectedRevision`; the UI always does. A double-click against stale state is rejected instead of applying a second action.

## Command transaction

`dispatch(state, command)` is the only public mutation boundary. It clones the mutable game core and command, shares immutable event/history entries, checks the command, applies costs and consequences, checks invariants, and returns the new state. A rule rejection returns the exact original state. Programmer errors are not swallowed or relabeled as ordinary illegal play.

This favors correctness and inspectability over throughput. Historical event and command records are frozen and shared between states; only their array indexes are copied. The mutable core is still cloned. A persistent-vector journal and structurally shared core snapshots remain possible optimizations after profiling.

## Priority and stabilization

The caster retains priority. Two consecutive passes either resolve the top stack item or advance the step if the stack is empty. Taking another action resets the pass count.

Before priority is granted, state-based actions repeat to a fixed point. Then pending triggers are put on the stack in active-player/nonactive-player order. A player with multiple simultaneous triggers receives an explicit bottom-to-top ordering choice. No arbitrary sort silently decides their order.

The client may pass automatically after casting, unless **Hold priority** is enabled. This is a client convenience implemented as a second ordinary command, not an engine shortcut. Playing a land does not auto-pass. Automatic empty-priority yielding stops whenever a spell or activated ability is available and can be disabled.

## Cards and effects

`cards.js` is the built-in, hand-authored executable registry. `registry.js` validates complete per-game catalogs, rejects unsupported fields/opcodes before play, and freezes them for safe sharing between states. Scryfall metadata is display-only and never interpreted as code. Each supported card declares costs, types, targets, keywords, effects and optional triggers or activated abilities.

`effects.js` resolves the supported opcodes, validates targets again at resolution, and batches pending triggers. Adding Oracle text to the display catalog does **not** make a card playable. Unsupported deck imports fail explicitly.

The current continuous-effect implementation handles printed characteristics, +1/+1 counters, temporary power/toughness and keyword changes, and controller-wide Anthem bonuses. It is **not** a general implementation of layers, timestamps and dependencies. Do not add cards that need those semantics until that subsystem exists and is tested.

## Combat

Attackers and blockers are simultaneous declarations. Flying/reach, vigilance, haste, defender, Pacifism, first strike, double strike, deathtouch, lifelink and trample are supported for this card pool.

Damage assignment is a separate choice, made active player first. The client offers a suggested split, but the engine accepts other legal distributions. All packets are applied before state-based actions. This implements current multiple-blocker assignment rules, not the retired damage-assignment-order system.

Blocked status remains even if every blocker leaves. Trample can still deal damage in that case. First-strike eligibility is remembered across the first and regular damage steps.

## Presentation and opponent

- `apps/web/app.js`: application state, user intents, save/replay, bot scheduling.
- `apps/web/view.js`: escaped HTML presentation, independent of engine mutation.
- `apps/web/style.css`: responsive visual system, no framework runtime.
- `bot.js`: deterministic legal-action policy. It does not inspect the enemy hand or library. It is a sparring bot, not a competitive search engine.

## Persistence and future multiplayer

A save is a versioned initial configuration plus commands, including the complete validated card catalog. Replay schema version 1 is separate from the package version; legacy 0.1 logs remain readable. Import replays those commands through the same validator. JSON snapshots are not accepted as arbitrary authoritative state.

`playerView` redacts opposing hands and library identities for inspection. It is a starting point, not a secure network protocol: the current client is local, owns the full state, and developer/replay tools expose both decks. Before adding multiplayer, put the authoritative engine on a server, make hidden-zone handles unlinkable, authenticate player identity, enforce revision leases, and test information-flow properties. Never send full state to remote players.

## Resolution continuations

A resolving spell or ability has a serializable instruction cursor, separate from the waiting stack. Scry, surveil and effect-discard instructions suspend at a typed choice and resume the same frame after a validated answer. Priority, state-based actions and pending-trigger placement wait until the entire resolution finishes. Hidden library choices are redacted in the other player’s view. The spell remains in the stack zone until completion even though it is no longer a waiting stack item.
