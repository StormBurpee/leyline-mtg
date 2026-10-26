# Headless simulation

The browser is optional. Simulations use the same dispatcher and card definitions as the tabletop.

```sh
node scripts/simulate.mjs 10 731
```

This emits one JSON record per game, alternating the starting player. The included heuristic is a reproducible sparring policy, not a trained model or a strength benchmark. The current card pool is still a small subset; this is **not** a Standard-complete simulator.

## Bring a policy

```js
import { runEpisode } from '../packages/simulation/run.js';

const policy = async ({ observation, actions, player }) => {
  // Call your model with this perspective, not an authoritative game state.
  return { type: 'concede', player };
};
const result = await runEpisode({
  config: { seed: 731 },
  policies: [policy, policy],
  maxDecisions: 3000,
});
```

A session exposes immutable player observations, ordinary legal-action candidates and structured pending choices. `actions` is **not** a flattened enumeration of every combat assignment, library permutation or subset choice. Those use the typed command protocol; `step` is the final legality check. Exhaustive action-space adapters remain work to do.

## Information boundary

Agents do not receive the seed, RNG, deck configuration, replay history, event journal, concealed card handles or library order. Opposing hands and libraries expose counts. Only definitions for visible cards and stack sources are included, rather than sending the entire card registry at every decision. Visible cards use per-player opaque handles rather than deck-construction IDs. A new incarnation receives a new handle. Scry/surveil observations expose only the cards currently being examined.

The local session translates agent handles back to engine references and rejects raw or concealed handles. Observations are deeply frozen. Policies run in the same process: this prevents accidental state leakage, **not malicious JavaScript execution**. Untrusted agents require worker/process isolation and resource controls. Public-event memory, generalized shuffle identity handling and a production remote protocol are not yet implemented.

## Outcomes and reproducibility

`termination` distinguishes a finished game from a decision limit, cancellation, policy exception or illegal command. A truncated episode is never silently scored as a draw. `winner` is meaningful as a game result only when `termination === 'finished'`.

Each episode result records the engine version, a SHA-256 ruleset fingerprint and a configuration fingerprint. These are evaluation outputs, not policy inputs. Deterministic policies with the same configuration reproduce the same episode. A nondeterministic model must supply its own reproducible sampling configuration or save its accepted commands. `includeReplay: true` produces a privileged evaluation artifact containing both decks and the seed. Keep it out of policy inputs.

Cancellation is checked between decisions and after an asynchronous policy returns. It cannot interrupt a stuck synchronous callback or an unresolved promise; external workers/timeouts are required for that.

## Acceptance gates

- Complete, dated Standard inventory first; full non-Alchemy Arena inventory next.
- Executable definitions and interaction tests, not Oracle-text placeholders.
- Explicit choice schemas for all supported mechanics.
- Invalid episodes reported separately from game outcomes.
- Paired-seat evaluation, throughput profiling and parallel workers before large training jobs.
- Differential and information-flow tests as the supported rules surface expands.
