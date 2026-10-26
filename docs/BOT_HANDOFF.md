# Bot handover — 2026-10-26

Stopped at the user's request to conserve usage. Draft PR #13 stays open; nothing
was merged or deployed. Branch: `bot/strategic-search`.

## Code and verification

The policy/evaluation checkpoint is `f42cf1cc1d58ce5b1e55d34edd65f3df87ffe271`.
It includes a final timing correction: select the best creature before delaying it
to main two, so a weaker first-main spell cannot spend its reserved mana.

- 32 focused tests passed after that correction, including its new regression.
- Full repository checks passed **831/831 before** that last policy correction.
- The prior policy commit `fdf148c985c146af683f446fbf815ab4743ad8a1` passed CI.
- An isolated integration with modal commit `f06022768e96d61494849044ed7766cdaa0eae9b`
  passed **901/901**, before the last timing correction. Keep the parent's
  `spellProfile` cast-scoring lookup and selected-mode `actionEffects` routing.
- Full checks, typecheck, cards check, build and complete formatting verification
  have **not** been rerun for the final timing correction. Edited files were formatted.
- No evaluation worker was running when this handover was requested. The last
  900-game run had completed; no further run was started.

## Evidence

All reported wins/losses below concern the policy **before** the final timing fix.
The final fix has not been benchmarked. Raw outcomes, identities, budgets, runtime,
ruleset/configuration hashes and summaries are under `docs/benchmarks/`.

| Run                                                         | Wins-losses |         Invalid |
| ----------------------------------------------------------- | ----------: | --------------: |
| Released v0.22 versus legacy reproduction, 24 games         |        15-9 |               0 |
| First candidate, 600 mixed games                            |     294-305 |       1 timeout |
| Later candidate, 600 mixed games                            |     324-269 | 7 policy errors |
| Departed-attacker fix, 600 mixed games versus released-safe |     329-271 |               0 |
| Same policy, 240 games versus legacy                        |      166-74 |               0 |
| Same policy, 900 fresh-seed mirrors versus released-safe    |     470-430 |               0 |

The fresh mirror result's conservative seed-cluster interval is **49.11–55.33%**;
the mixed result's is **49.45–60.22%**. Neither establishes broad superiority over
v0.22. Human-level play is unproven. The released-safe opponent is explicitly named:
it filters stale public attacker references before calling the unchanged frozen
reference. Original failed runs remain committed. Five development runs and their
invalid outcomes are also preserved under `benchmarks/development/`; intermediate
source hashes are recorded, but not every intermediate source variant is committed.

Roots & Relics scored 24-36 in the fresh mirrors. A diagnostic exposed the final
timing bug above. Correcting it did not turn the examined seed into a win; broader
evaluation is still required, and this seed is now development evidence.

## Changed files

- Engine: `bot.js`, `combat-policy.js`, `trick-policy.js`, new
  `attack-plan-policy.js`, `hand-policy.js`, `sequence-policy.js` under
  `packages/engine/src/`.
- Evaluation: `packages/simulation/evaluation.js`, `reference-policies.js`;
  `scripts/evaluate-bots.mjs`, `summarize-bots.mjs`.
- Tests: `tests/bot-tactics.test.js`, `bot-combat-projection.test.js`,
  `bot-hand.test.js`, `bot-sequences.test.js`, `evaluation.test.js`; frozen
  `tests/fixtures/v0.22-policy/{bot,combat-payoffs,combat-policy,decision-safety,
development-policy,library-search,trick-policy}.js` and its README.
- Documentation: `docs/SIMULATION.md`, `BOT_STRENGTH.md`, this handover, and
  benchmark JSONL/summary/analysis artifacts.

No card catalogs, card definitions, rules, client, versions, release workflows or
existing legacy replay fixtures were changed. No engine hook was needed.

## Resume

1. Run full checks for the final timing fix and retain the modal integration routing.
2. Benchmark the final source identity on fresh seeds; keep the earlier confirmation
   as diagnostic data. Do not describe its results as results of the final fix.
3. Investigate remaining strategic weaknesses, particularly Roots, without tuning
   to individual hands. Unknown opposing interaction, multi-turn planning, general
   stack search and principled mulligan selection remain outside this policy.
4. Wide-board decisions can still take seconds. Measure latency before increasing
   search budgets. Human/adversarial evaluation is required for stronger claims.

No implementation blocker remains. Work stopped by user request, with the final
verification and strength evaluation incomplete. Local scratch data and modal
integration files remain in the ignored `outputs/` directory; generated `dist/`
is untracked and was not included in the PR.
