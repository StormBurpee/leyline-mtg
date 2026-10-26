# Bot improvement checkpoint

This pass adds bounded spell-sequence planning and corrects named card-selection,
timing and public-combat mistakes. It is an implemented heuristic/search policy,
not a trained model and not evidence of human-level play.

Base: v0.22.0, `dae135954740ff4d8e50fa6094c31e64e539c275`.
Rules and card catalogs are unchanged. No additional services or credentials are
required. All episodes use `runEpisode` and `createSession`; policies receive only
their permitted immutable observation. Seed, RNG, replay and experiment scheduling
data stay on the evaluation side.

## Reproduced baseline

`released` versus `legacy`, Ember/Grove/Dawn/Nightfall mirrors, seeds 11/38/731,
both policy seats, player 0 starting: **15 wins, 9 losses**, no errors or truncation.
Ember 4–2, Grove 3–3, Dawn 4–2, Nightfall 4–2. This exactly reproduces the supplied
release baseline. Raw episodes and timings are in
`benchmarks/v022-reproduction.jsonl` and its summary.

## Development experiments

Development used seeds 101/202/303 on eight starter mirrors, both seats and starts
(96 games per variant). Spell planning plus hand selection scored 53–43. Adding a
general nonlethal return-attack penalty, along with the tactical corrections,
scored 49–47. Neither interval excluded 50%. The speculative return-attack penalty
was removed; targeted lethal forecasts and regression fixes remain. These seeds
are development data, not held-out evidence. Development JSONL artifacts are kept
locally under `outputs/`, including any failed/truncated episodes.

The initial checkpoint (`4d8a839`) scored **294–305 with one wall-time limit** over
600 games: all 15 starter mirrors and 15 cyclic cross-deck matchups, seeds
1229/3253/5501/7919/104729, both seats and both starting players. The complete-block
score was 49.33%, approximate 95% interval 47.35–51.31%. This did **not** demonstrate
an improvement. All 600 records are retained in `benchmarks/heldout-v022.jsonl`.

Subsequent changes add coherent evasive attack groups, evaluate a known affordable
modifier spell after projected blocks, and value creature bodies rather than mana
spent. Combat projections omit inert mana lands internally while restoring them
in returned outcomes, and reject impossible damage subsets before costly stat
evaluation. A 70-permanent diagnostic position produced the same attack decision
in 2.8 seconds versus 12.4 seconds before these optimizations; this is one profile,
not a general throughput guarantee. Differential fixtures compare complete combat
outcomes against the frozen implementation.

The slow Grove development episode (seed 101, player 1 starting, candidate seat 1)
eventually finished at turn 100 / 2605 decisions in a diagnostic rerun of the first
checkpoint, with player 1 winning. That rerun does not replace the primary timeout.
This timeout remains in the report even though later forecasts run faster.

## Evaluation and discovered regressions

All comparisons below swap policy seats and use both starting players. `mixed`
contains all 15 starter mirrors plus 15 cyclic cross-deck matchups. The older
`legacy` field contains six mirrors and six cyclic cross-deck matchups. These are
heuristic opponents, not a diverse adversarial or human evaluation pool.

| Candidate | Opponent / field                           | Games | Wins-losses |         Invalid | Artifact prefix        |
| --------- | ------------------------------------------ | ----: | ----------: | --------------: | ---------------------- |
| `a9e790d` | released / mixed, five new seeds           |   600 |     324-269 | 7 policy errors | `final-v022`           |
| `a9e790d` | legacy / 12 matchups, five new seeds       |   240 |      166-74 |               0 | `final-legacy`         |
| `fdf148c` | released-safe / same mixed seeds           |   600 |     329-271 |               0 | `verified-v022`        |
| `fdf148c` | legacy / same seeds                        |   240 |      166-74 |               0 | `verified-legacy`      |
| `fdf148c` | released-safe / 15 mirrors, 15 fresh seeds |   900 |     470-430 |               0 | `confirmation-mirrors` |

The seven errors came from stale public attacker references after an attacking
Burnished Hart sacrificed itself. Both policies could fail on this position. The
current forecast now checks battlefield/incarnation validity. `released-safe` is
an explicitly named adapter that removes only those stale public references before
invoking the unchanged frozen v0.22 source. `released` retains its original
behavior. The failed 600-game run is preserved alongside the repaired comparison.

The 600-game clean mixed result was 54.83%: its 150 matchup/seed-block approximate
95% interval was 52.18-57.48%, but the stricter five-seed interval was 49.45-60.22%.
The independent 900-game mirror confirmation scored 52.22%, with 225-block interval
49.89-54.55% and 15-seed interval 49.11-55.33%. **These results do not establish a
broad improvement over v0.22.** The 240-game legacy result was 69.17%, with the
five-seed interval 56.60-81.73%; this older opponent is a substantially easier test.

Seed intervals group all decks, seats and starts sharing a seed. They use the
conservative t approximation described in `SIMULATION.md`; all intervals are
approximate and specific to this matchup schedule. `.analysis.json` files hash the
untouched input JSONL. No failed/truncated record becomes a win or draw, and reruns
never replace earlier records. The 15 confirmation seeds were generated from the
first little-endian 32 bits of SHA-256(`leyline-confirmation-v1/0` through `/14`),
before observing their outcomes. They are listed in the experiment metadata.

The confirmation's Roots & Relics result (24-36) exposed a timing regression:
removing ordinary creatures from first-main scoring allowed weaker ramp spells to
consume mana intended for a stronger creature. In a visible-observation diagnostic,
the policy cast Solemn Simulacrum while holding Serra Angel against an opposing
Serra Angel. The fix chooses the best play **before** deciding to defer it until
main two; a focused regression covers reserving that mana. The confirmation is
therefore diagnostic data for this further fix, not held-out evidence for it.

The `fdf148c` policy identity was
`29422aa0a9193e932f6b7ac0128967a01f9babb602dac68640c8dde8101abb36` (transitive source
SHA-256). The shared ruleset hash was
`11ab67ad08713606b002928466163b079f21acdc6b2260a178453e940576fc8c`.
Runs used Node v24.22.1 on Windows, four workers, 3,000 decisions and five minutes
per episode. Budgets and per-game configuration hashes are recorded in every
artifact. Mixed/legacy/confirmation wall times were 261/278/505 seconds. Current
policy mean/max decision times were respectively 1.84 ms/2.49 s, 6.69 ms/4.77 s,
and 2.25 ms/4.15 s. Shared CPU load varied; these are measured run costs, not isolated
latency guarantees.

## Scope and review points

- `sequence-policy.js`: capped resource search; exact automatic payments and ward
  reservations; combined direct damage; distinct-card/target constraints. It does
  not resolve triggers, invent future draws or search every payment assignment.
- `attack-plan-policy.js`: one known pure modifier spell after the projected
  blocker response, up to 48 candidates total / eight per attack set. Actual play
  replans after blocks; the forecast assumes that spell resolves and charges a card.
- `hand-policy.js`: visible-card selection for scry, surveil, bottom and discard.
- `bot.js`: integration, redundant Pacifism rejection and ordinary creature timing.
  The cast-scoring definition lookup remains the small integration point for the
  separately developed `spellProfile(card, mode)` change. Sequence effects flow
  through `actionEffects`, so the planned modal update there will also reach it.
- `combat-policy.js`: public attack-trigger forecasts for return attacks and
  reserved blockers, plus stable survivor valuation after temporary attack boosts.
- `packages/simulation/evaluation.js` and `scripts/evaluate-bots.mjs`: paired-seat
  experiment scheduling, bounded workers, source identity, outcome preservation,
  runtime records and block-based uncertainty.
- New focused tests cover mana stranding, two-spell lethal, ward reservations,
  candidate crowding, hidden-zone access guards, input immutability, scry and
  discard needs, attack-trigger lethal, redundant Pacifism and combat timing.

The frozen pre-tactical policy and historic replay contracts remain unchanged.
The v0.22 policy reference is separately frozen under `tests/fixtures/v0.22-policy/`.

## Remaining limitations

Opponent hidden-card ranges, unknown opposing tricks, general stack search, payment
optimization, multi-turn draw distributions and training are still absent. The
spell planner uses static values and can miss newly enabled targets, mana and ETB
lines. Wide-board combat is bounded and can be slow; some decisions take seconds.
Starting-hand mulligans remain a basic land-count heuristic. Starter-deck matches
are useful regression/strength evidence within this kernel, not competitive Magic
evaluation. Human evaluation and a broader adversarial opponent pool are required
before any human-level claim.
