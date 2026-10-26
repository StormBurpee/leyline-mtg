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

The larger held-out evaluation will be recorded here before review completion.

## Scope and review points

- `sequence-policy.js`: capped resource search; exact automatic payments and ward
  reservations; combined direct damage; distinct-card/target constraints. It does
  not resolve triggers, invent future draws or search every payment assignment.
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

Opponent hidden-card ranges, unknown tricks, general stack search, payment
optimization, multi-turn draw distributions and training are still absent. The
spell planner uses static values and can miss newly enabled targets, mana and ETB
lines. Wide-board combat is bounded and can be slow; some decisions take seconds.
Starting-hand mulligans remain a basic land-count heuristic. Starter-deck matches
are useful regression/strength evidence within this kernel, not competitive Magic
evaluation. Human evaluation and a broader adversarial opponent pool are required
before any human-level claim.
