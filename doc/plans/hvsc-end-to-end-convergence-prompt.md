# HVSC End-to-End Convergence Prompt

## Why work slowed down

The repo no longer has a purely local Mario bug. The Mario subtune stall was diagnosed and fixed, but the work afterwards drifted because the remaining acceptance proof is broader and slower:

1. The first recovery prompt was optimized for the Mario seam, not for end-to-end proof across all three final outcomes.
2. Validation broadened into full-suite and long-running commands before every harness assumption was pinned down.
3. Some failures were harness-specific rather than product-specific.
   - `scripts/run-bun.mjs` forces `SIDFLOW_MAX_THREADS=1` for `bun test`, which made `packages/sidflow-classify/test/multithread-render.test.ts` fail even though the renderer pool itself was still fine.
4. Background terminal loops were brittle.
   - Several long commands were cancelled or left in an ambiguous state by terminal/tool behavior rather than by repo code.
   - Evidence stored in repo-local logs was reliable; interactive terminal state was not.
5. The acceptance target is now larger than "Mario no longer stalls".
   - We still need fresh proof for all problematic SIDs under the strict classify contract.
   - We still need one full fresh HVSC rerun under the authoritative wrapper.
   - We still need five persona stations validated against the real export.

## What is already proven

These points are backed by code changes and repo-local artifacts already captured in `PLANS.md` and `WORKLOG.md`:

1. The Mario 2SID stall was real and reproducible under the real CLI.
   - `./scripts/sidflow-classify` on `GAMES/S-Z/Super_Mario_Bros_64_2SID.sid` stalled at `render_start` and then at `song_select_start` under structured instrumentation.
2. The root cause was localized to redundant subtune reselection.
   - `loadSidBuffer()` followed by explicit `selectSong()` caused Mario subtune 1 to wedge before the render loop.
3. The root cause fix exists in the engine/classify seam.
   - `packages/libsidplayfp-wasm/src/player.ts` now accepts `loadSidBuffer(data, songIndex)`.
   - `packages/sidflow-classify/src/render/wav-renderer.ts` and `packages/sidflow-classify/src/sid-native-features.ts` now load the requested subtune directly instead of calling `selectSong()` afterward.
4. The real Mario CLI repro now completes.
   - The exact bounded Mario command completed in 3.16s with 37 rendered / 37 extracted / 37 JSONL records.
5. The strict fail-open contract was tightened.
   - Strict classify paths now throw on render failure or feature-extraction failure.
   - Remaining degradation tests were rewritten toward fatal behavior.
6. Targeted seam validation passed.
   - `wav-renderer-duration-cap.test.ts`
   - `render-timeout.test.ts`
   - `high-risk-render-failure.test.ts`
   - `multi-sid-classification.test.ts`
   - `super-mario-stress.test.ts`
7. `bun run build` passes.

## What is still missing before the task is truly done

### A. Proof that all problematic SID songs can be classified without OOME, errors, or stalls

Missing proof items:

1. Re-run the checked-in high-risk fixture set under the current strict tree and record the exact outputs.
2. Re-run `packages/sidflow-classify/test/super-mario-stress.test.ts` if any classify/render code changed after the last logged run.
3. Run a bounded HVSC subset under the authoritative wrapper on the current strict tree and prove:
   - no stalls
   - no OOME
   - no missing `.trace.jsonl` failures
   - no metadata-only or WAV-only success paths
4. If any historical problematic HVSC songs are not already covered by checked-in fixtures or worklog repros, add them to the bounded subset proof set and log them explicitly.

### B. Proof that truly all HVSC songs can be classified in one fresh rerun

Missing proof items:

1. One fresh end-to-end run of:
   - `bash scripts/run-similarity-export.sh --mode local --full-rerun true`
2. The run must start from a fresh output state that cannot reuse stale success artifacts as evidence.
3. Evidence must include:
   - exact command
   - start and end timestamps
   - total files / songs processed
   - render / extract / persisted counts
   - zero fatal classification defects
   - zero metadata-only / WAV-only strict successes
   - peak RSS
   - output artifact paths
4. If the wrapper fails, the failure must be localized and fixed before attempting the full rerun again.
5. Completion is not proven by partial progress snapshots.

### C. Proof that persona stations can be built and remain taste-pure

Missing proof items:

1. Build the export DB from the fresh successful rerun.
2. Run the persona validator on the real export:
   - `bun scripts/validate-persona-radio.ts --config <config> --db <export.sqlite> --report <report.md>`
3. Capture proof for all five personas defined by the script:
   - `pulse_chaser`
   - `dream_drifter`
   - `maze_architect`
   - `anthem_driver`
   - `noir_cartographer`
4. Evidence must show:
   - each persona produced the full requested station size
   - contamination count is zero for every persona
   - cross-persona overlap is zero
   - own-persona similarity beats nearest-other-persona similarity
5. If the validator fails, the failure must be fixed or the persona definitions/station runtime must be corrected with evidence.

## Convergence rules for the next agent

These rules are meant to stop the agent from burning time in loops, vague status updates, or terminal-driven ambiguity.

1. Treat the job as unfinished until all three outcomes above are proven with artifacts.
2. Never downgrade the acceptance target from full proof to partial confidence.
3. Never start a new broad run until the current narrower gate has either passed or been explained and fixed.
4. Use repo-local log files as the source of truth for long commands.
   - Do not rely on terminal scrollback.
   - Do not rely on background terminal state alone.
5. For any command expected to take more than a few minutes:
   - wrap it with `scripts/run-with-timeout.sh`
   - prepend `/usr/bin/time -v`
   - redirect stdout/stderr into repo-local files under `tmp/`
6. If a terminal tool is cancelled or closes unexpectedly:
   - inspect the log file first
   - determine whether the process actually finished or failed
   - only rerun once the state is understood
7. No repeated reruns of the same command unless one of these changed:
   - code
   - config
   - instrumentation
   - hypothesis
8. When a validation gate fails, first ask whether the failure is:
   - a real product defect
   - a test assumption defect
   - a harness/environment defect
9. For thread-sensitive tests, account for harness overrides.
   - `scripts/run-bun.mjs` forces `SIDFLOW_MAX_THREADS=1` during `bun test` unless the test overrides it explicitly.
10. For full test gates, use file-backed logs and inspect the tail after each run.
    - Do not assume a multi-run shell loop succeeded just because the command launched.
11. Keep `PLANS.md` and `WORKLOG.md` current after every significant step.
12. Do not stop at "build passes" or "targeted tests pass". Those are intermediate gates only.

## Mandatory validation order

The next agent must follow this order exactly:

1. Confirm the current tree still builds.
2. Re-run targeted classify seam tests relevant to recent code changes.
3. Re-run any harness-sensitive tests whose assumptions were changed.
4. Re-run checked-in problematic/high-risk SID validations.
5. Re-run the Mario stress harness if classify/render code changed.
6. Run one bounded HVSC subset through the authoritative wrapper with full logs.
7. If all of the above are green, run the full fresh authoritative HVSC rerun.
8. If the full rerun succeeds, validate persona stations on the real export.
9. Only after all of the above, run `bun run test` three consecutive times with literal `0 fail` evidence.

## Replacement prompt

```text
ROLE
You are the recovery owner for SIDFlow's end-to-end HVSC classification and station-validation pipeline. Your job is not finished when a local seam is fixed; it is finished only when all problematic songs classify cleanly, the full fresh HVSC rerun succeeds under the authoritative wrapper, and the persona-station validator proves taste purity on the real export.

MISSION
Drive the repository to evidence-backed completion for all three outcomes:

A. Problematic SID songs classify without OOME, errors, or stalls.
B. A fresh full HVSC rerun succeeds end to end.
C. Five persona stations can be built from the real export with zero contamination and zero overlap.

CURRENT VERIFIED GROUND TRUTH
1. The Mario 2SID stall was reproduced and fixed.
   - Root cause: `loadSidBuffer()` followed by explicit `selectSong()` could wedge Mario before the render loop.
   - Fix: direct subtune loading via `loadSidBuffer(data, songIndex)` in the engine and classify call sites.
2. The exact bounded Mario CLI repro now succeeds.
3. Strict classify paths now fail fast on render or feature-extraction failure.
4. Targeted seam tests and `bun run build` currently pass.
5. The remaining gap is proof, not merely diagnosis.

NON-NEGOTIABLE OPERATING RULES
1. Keep going until A, B, and C are all proven with artifacts, or until you hit a real external blocker that you cannot clear locally.
2. Never claim success from partial evidence.
3. Never run an unbounded classify, export, or validation command.
4. For long-running commands, always:
   - use `scripts/run-with-timeout.sh`
   - prefix with `/usr/bin/time -v`
   - write stdout/stderr to repo-local log files under `tmp/`
5. Keep `PLANS.md` and `WORKLOG.md` updated after each meaningful step.
6. No blind reruns. If the same command would be repeated, you must first state what changed in code, config, instrumentation, or hypothesis.
7. If a terminal tool closes, times out, or is cancelled, inspect the log file before deciding the next action.
8. Distinguish product bugs from harness bugs.
   - Example: `scripts/run-bun.mjs` forces `SIDFLOW_MAX_THREADS=1` during `bun test`, so thread-sensitive tests must account for that.
9. Use repo maintenance scripts and documented entrypoints, not ad hoc alternatives.

PRIMARY SOURCE FILES
1. `AGENTS.md`
2. `PLANS.md`
3. `WORKLOG.md`
4. `README.md`
5. `doc/developer.md`
6. `doc/technical-reference.md`
7. `doc/plans/hvsc-classification-stall-prompt.md`
8. `doc/plans/hvsc-end-to-end-convergence-prompt.md`

ARTIFACT DISCIPLINE
1. Use repo-local folders such as:
   - `tmp/classify-stall/<timestamp>/`
   - `tmp/hvsc-subset/<timestamp>/`
   - `tmp/hvsc-full/<timestamp>/`
   - `tmp/persona-validation/<timestamp>/`
2. Every long run must leave behind:
   - exact command text
   - exit status
   - `/usr/bin/time -v` output
   - stdout log
   - stderr log
   - key generated artifact paths

PHASE 1 - RE-ESTABLISH THE CURRENT BASELINE
1. Read the source files above.
2. Update `PLANS.md` with the active validation phase.
3. Review `WORKLOG.md` and do not duplicate already-proven experiments.
4. Confirm the current tree builds.

PHASE 2 - CLOSE THE "PROBLEMATIC SONGS" PROOF GAP
Goal: prove A, not just Mario.

1. Re-run the currently relevant targeted classify tests.
2. Re-run checked-in high-risk fixture validations on the strict tree and log the results.
3. Re-run `packages/sidflow-classify/test/super-mario-stress.test.ts` if classify/render code changed after the last recorded pass.
4. Run a bounded HVSC subset through the authoritative wrapper and prove:
   - no OOME
   - no stalls
   - no trace-sidecar failures
   - no metadata-only or WAV-only strict successes
5. If any problematic historical SID is missing from the proof set, add it explicitly.
6. Do not advance to the full rerun until this proof set is green.

PHASE 3 - COMPLETE THE FULL FRESH HVSC RERUN
Goal: prove B.

1. Start from a fresh output state that cannot hide failures behind stale artifacts.
2. Run the authoritative command:
   `bash scripts/run-similarity-export.sh --mode local --full-rerun true`
3. Capture all evidence in repo-local files.
4. If the run fails, localize the failure, fix it, and repeat from a fresh state.
5. Do not treat partial progress as success.
6. Completion criteria for this phase:
   - the full rerun exits 0
   - all songs are classified
   - no fatal classification defects
   - no metadata-only or WAV-only strict successes
   - artifact counts are internally consistent
   - `WORKLOG.md` records the full result

PHASE 4 - VALIDATE PERSONA STATIONS ON THE REAL EXPORT
Goal: prove C.

1. Identify the real export DB produced by the successful full rerun.
2. Run:
   `bun scripts/validate-persona-radio.ts --config <config> --db <export.sqlite> --report <report.md>`
3. Confirm all five personas pass:
   - `pulse_chaser`
   - `dream_drifter`
   - `maze_architect`
   - `anthem_driver`
   - `noir_cartographer`
4. Required proof:
   - full station size produced for every persona
   - contamination count = 0 for every persona
   - overlap = 0 across persona stations
   - own-persona similarity exceeds nearest-other-persona similarity
5. If validation fails, fix the station/runtime or persona setup and rerun.

PHASE 5 - FINAL REPO VALIDATION
1. Run `bun run build`.
2. Run any remaining targeted tests required by your changes.
3. Run `bun run test` three consecutive times.
4. Record the literal `0 fail` output for all three runs.
5. Do not declare completion without that evidence.

ANTI-STALL RULES
1. After every 3 to 5 tool calls, summarize the delta: what you learned, what failed, and what you will do next.
2. If a long command has no new log output for a meaningful interval, inspect its log file and process state before doing anything else.
3. If you hit the same class of failure twice, stop and write down the exact invariant that is still unproven.
4. Prefer narrowing the proof gap over expanding scope.
   - Example: if a bounded HVSC subset fails, fix that before attempting the full rerun.
5. Never let the work collapse into terminal babysitting. Every long run must have file-backed evidence and a clear acceptance condition.

DONE MEANS ALL OF THESE ARE TRUE
1. Problematic songs proof set is green.
2. Full fresh HVSC rerun is green.
3. Persona-station validation is green.
4. `bun run build` is green.
5. `bun run test` is green three times consecutively with literal `0 fail` evidence.
6. `PLANS.md` and `WORKLOG.md` clearly document the final proof.

FIRST ACTION
Read `PLANS.md` and `WORKLOG.md`, mark the current validation phase explicitly, then continue from the narrowest missing proof rather than repeating already-proven Mario diagnosis.
```