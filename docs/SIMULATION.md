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

Targeted triggered abilities expose concrete `chooseTriggerTarget` actions. Object references use player-specific incarnation-bound handles, including references to departed sources; departed/concealed handles cannot be submitted as current visible objects. Internal trigger-placement continuations are omitted from observations.

## Tactical sparring policy

Since v0.13, the default policy searches public-board blocker assignments instead of using a fixed two-creature menace rule. Candidate combat damage uses the engine's first/double-strike, trample, deathtouch, indestructible and lifelink handling. Damage allocation considers valuable blockers; attack candidates include a bounded defending response and a next-turn public-board lethal check. Tap abilities preserve a blocker when the defensive comparison matters, except when an immediate lethal ability is available. Cast-trigger creatures can be deployed before a nonlethal spell when both are affordable.

Since v0.15, combat forecasts also resolve life-only death payoffs through the real stack and state-based actions. Blood Artist and Zulaport Cutthroat can change the chosen attack or block. The forecast preserves APNAP ordering, legal player targets, source last-known damage keywords and the timing between first-strike and normal damage. Optional life effects and same-controller trigger ordering use deterministic life-total heuristics, not exhaustive stack search.

Combat results expose `omittedTriggers` and `payoffLimitReached`. Unsupported entries are omitted whole: a draw-plus-life-loss trigger is not partially resolved. Hidden zones are never fabricated into known draws. These fields describe the search horizon, not a rules-engine inability to execute the cards in an actual game.

Since v0.16, land sequencing compares mana-enabled legal plays before considering the colored requirements of the known hand. It prioritizes an immediately available lethal line and avoids delaying a playable threat with a tapped land. This projection does not resolve landfall or land ETB triggers. Removal scoring distinguishes destruction/damage from bounce against indestructible, and opponent-wide burn can be used for nonlethal pressure.

Since v0.17, supported modifier spells are compared against declared combat before spending a card. The policy looks for changed survivors, prevented lethal or immediate victory, and evaluates survivors at their original value rather than inflated temporary stats. Pure nonlethal face damage is not enough to spend a pump card; mana-only pump abilities can add pressure. A separate bounded check recognizes protection from individual known damage, destroy, bounce, exile or Pacifism threats. It does not search arbitrary stack combinations or forecast combat while spells are pending. Combat trick evaluation currently uses the window after blocks and before first-strike damage.

Since v0.22, attack selection projects mandatory untargeted attack life effects and nonnegative self modifications on a public-board copy before evaluating blocks. This covers fixed attack drain and cards such as Borderland Marauder and Jumbo Cactuar. Targeted, optional, draw/search and mixed unsupported attack entries are omitted whole. It is not general attack-trigger lookahead, and the existing `omittedTriggers` counter describes combat-death payoffs rather than this separate attack projection.

This is still bounded tactical search plus heuristics. It does not model unknown tricks, draw distributions, full death-trigger resolution, multi-turn strategy, opponent ranges or trained play. Search limits can miss better assignments on wide boards. Its win rates are not reliable evidence of competitive deck strength. Evaluate an external policy through the same observation boundary and record its identity, sampling settings and failures alongside the engine and ruleset fingerprints.

Historical replay/engine regression uses a frozen pre-tactical policy so changes in decision quality do not masquerade as rules changes. Current-policy tests instead check legality, information boundaries, reproducibility and named tactical decisions.

## Spell planning and paired evaluation

The default bot now searches sequences of currently legal spells during its own
main phase. The deterministic resource search considers up to 24 candidates,
four spells and 256 nodes. It uses the actual automatic mana-payment plan, reserves
ward costs, prevents repeated use of a card/target, and recognizes combined known
face damage. It replans after every real action. It does **not** install simulated
permanents, draw hidden cards, assume an opposing hand, resolve arbitrary triggers,
or run a complete rules rollout. Newly enabled spells and targets are outside this
horizon. Resource scores still come from heuristics.

Scry, surveil, discard and mulligan-bottom choices compare visible cards against
known mana needs, reconsidering marginal land value after each discard. Surveil
retains enough cards for a known following draw. Ordinary creatures can wait until
the second main phase to preserve combat-trick mana. Redundant Pacifism is rejected.
Public attack triggers are included in hypothetical return attacks and decisions
to retain tap-ability blockers. Temporary attack boosts are not valued as permanent
material gained just by declaring an attack.

Wide-board attack candidates include public evasion and keyword groups, avoiding
the old gap where only one of several unblocked flyers attacked. A bounded extension
can consider one known, affordable, pure modifier spell after the predicted
blocker response (48 candidate evaluations total, eight per attack set). It charges
for spending the card and accounts for attacking mana creatures becoming tapped.
The actual bot replans after blocks. Unknown opposing responses, mixed-effect
tricks and arbitrary spell chains remain outside that forecast.

Run an evaluation through the opaque session boundary:

```sh
node scripts/evaluate-bots.mjs --candidate=current --opponent=released --suite=mixed --seeds=1229,3253,5501,7919,104729 --workers=4 --output=outputs/comparison.jsonl
```

The default includes all 15 starter mirrors, both policy seats and both starting
players. `--suite=mixed` adds each starter against the next starter in registry
order. `--decks=ember,grove`, `--starting=0`, `--maxDecisions=3000`, and
`--maxEpisodeMs=300000` can restrict the experiment. The opponents are `released`
(a frozen v0.22 policy) and `legacy` (the existing pre-tactical policy).

Each JSONL file starts with source hashes, commit, runtime and budget metadata,
then retains every episode result, including policy errors, illegal actions,
decision limits and worker wall-time limits. Successful episode records include
ruleset/configuration fingerprints and per-policy decision timing. A timed-out
worker is terminated and replaced. Its configured seed/decks/seats remain recorded
for reproduction; it has no completed episode fingerprint or policy timing.
Output paths must be new, preventing accidental loss of failed experiments.

The adjacent `.summary.json` reports raw outcomes separately from complete paired
results. Confidence blocks group both starting-player variants of the same
matchup/seed, rather than treating reused shuffles as independent samples. Normal
intervals are approximate, conditional on the scheduled matchup/seed population,
and can be unreliable for small samples or zero observed variance. They do not
establish strength against human players or arbitrary decks. See
[BOT_STRENGTH.md](BOT_STRENGTH.md) for the measured checkpoint and limitations.

## Library-search decisions and hidden identity

During `librarySearch`, only the searching agent sees its library definitions and eligible opaque handles. Those handles can be submitted through the normal command boundary. After the search, library objects are concealed again; only public results and the agent’s own hand remain visible. Episode continuation and replay retain deterministic shuffle state privately.

The lower-level `playerView` now replaces hidden hand/library IDs with positional `hidden:…` placeholders. These placeholders are not engine command IDs and are not identity-tracking handles. Public historical stack source references remain available without identifying a hidden-zone position. Use `createSession` for the stronger, incarnation-bound agent interface rather than sending full engine state.

The practice bot chooses missing land colours and useful cards from a permitted search. Its tutoring heuristic is bounded and does not establish competitive play strength. The Roots & Relics starter exercises ramp, fetch lands, Gearhulk searches and large-creature tutoring.
