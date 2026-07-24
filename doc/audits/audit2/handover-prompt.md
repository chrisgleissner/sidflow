# Audit 2 Handover Prompt

## Role

You are continuing an in-progress Audit 2 execution task inside the `sidflow` repository. Do not restart the audit from scratch. Pick up from the exact state described below, verify the current state in-repo, and finish the remaining proof and documentation work.

The goal remains the same as `doc/audits/audit2/prompt.md`: prove or repair cross-format recommendation parity across the three shipped similarity-export formats:

- `sidcorr-1` full SQLite export
- `sidcorr-lite-1` lite bundle
- `sidcorr-tiny-1` tiny bundle

Treat this as an execution handoff, not a brainstorming prompt.

## Current Branch And Scope

- Repository: `chrisgleissner/sidflow`
- Current branch: `feat/sidcorr-tiny`
- Default branch: `main`
- Date of handoff: `2026-04-16`

Only continue the Audit 2 work. Do not widen scope.

## What Was Already Done

### Required process and source selection

1. The required repo docs and process files were already read earlier in the session, including:
   - `AGENTS.md`
   - `PLANS.md`
   - `README.md`
   - `doc/developer.md`
   - `doc/technical-reference.md`
   - `doc/similarity-export.md`
   - `doc/similarity-export-lite.md`
   - `doc/similarity-export-tiny.md`
   - `doc/research/similarity-export-audit.md`
   - `doc/research/lite-export-check/tiny-export-equivalence-prompt.md`
   - `doc/audits/audit2/prompt.md`
2. `PLANS.md` was updated under Phase 34 with `P34-T08 Audit 2: prove or repair full/lite/tiny recommendation parity on the release-complete artifact set`.
3. `WORKLOG.md` received a kickoff entry at `2026-04-16T10:17Z` documenting the release-backed artifact choice and the initial audit plan.
4. The audit baseline was intentionally switched from local `data/exports/` to published release assets because the checked-in local lite/tiny artifacts were partial and not suitable for authoritative parity proof.

### Authoritative artifact basis used during the audit

The working audit basis was the published `sidflow-data` release lineage rooted at:

- release tag: `sidcorr-hvsc-full-20260407T115218Z`
- authoritative full SQLite asset path used locally during audit work:
  - `tmp/lite-export-check/audit2-release-proof-v3/downloads/sidcorr-hvsc-full-sidcorr-1.sqlite`
- authoritative tiny asset path used locally during audit work:
  - `tmp/lite-export-check/audit2-release-proof-v3/downloads/sidcorr-hvsc-full-sidcorr-tiny-1.sidcorr`
- rebuilt lite path used for the latest repair/proof iterations:
  - `tmp/lite-export-check/rebuilt-from-release/sidcorr-hvsc-full-sidcorr-lite-1.sidcorr`

This was not a guess. Earlier audit work established that the release SQLite and release tiny were corpus-complete and that local checked-in lite/tiny files were not.

### Harness and regression work already completed

1. `scripts/run-tiny-export-equivalence-audit.ts` was extended from tiny-only checking to full-vs-lite and full-vs-tiny checking on both:
   - favorite-seeded station building
   - direct seed-song similarity
2. `packages/sidflow-common/test/similarity-export.test.ts` was extended with durable regressions covering:
   - 24D lite vector preservation
   - deterministic equal-score tie-breaking across SQLite and lite
   - 4D lite raw compact-rating decode behavior
3. Focused parity tests were repeatedly rerun while debugging.

### Root-cause localization that already happened

The session already ruled out a long list of wrong explanations.

#### Findings that are already proven

1. Tiny was not the active production parity problem on the release-backed audit surface. Tiny kept passing against full on the real-corpus audits throughout this session.
2. Lite station parity was the real failing surface.
3. The release SQLite corpus stores live low-dimensional vectors for all rows. The earlier 24D truncation fix was valid as regression coverage, but it was not the explanation for the real release-corpus failure.
4. Deterministic `track_id` tie-breaking in SQLite recommendation sorting was necessary and was already added earlier in the session.
5. The lite loader was changed to decode 3D/4D bundles from exact compact ratings instead of PQ-reconstructed vectors, and then refined to use raw compact-rating vectors. That change dramatically improved release-corpus parity.

### State immediately before the last fix

By the time the final narrowing happened, the release-backed audit had been reduced to one remaining full-vs-lite station outlier:

- persona: `slow_ambient`
- run seed: `1004`

That outlier had already been localized much further than the original failures:

1. full and lite had identical intent models for `slow_ambient-1004`
2. full and lite had identical candidate sets at several recommendation limits in one earlier probe
3. full and lite had matching recommendation metadata for the shared pool
4. the remaining mismatch was clearly small and sensitive to tie-frontier behavior

## Additional Work Completed In The Latest Session Slice

The most recent continuation narrowed and fixed the final outlier further.

### Files changed in the latest slice

1. `packages/sidflow-common/src/similarity-export.ts`
   - Added exported helper `stableSimilarityScore(score)`.
   - Changed SQLite recommendation sorting to rank by rounded stable score first, then `track_id`.
2. `packages/sidflow-common/src/similarity-export-lite.ts`
   - Imported `stableSimilarityScore` from `similarity-export.ts`.
   - Changed lite favorite-recommendation sorting to use the same rounded stable score and `track_id` tie-break as SQLite.
3. `packages/sidflow-common/test/similarity-export.test.ts`
   - Added a regression asserting that microscopic floating-point drift collapses onto the same stable recommendation frontier.
4. `tmp/debug-slow-ambient.ts`
   - Temporary debug probe script used to compare full vs lite phase-by-phase for the remaining `slow_ambient-1004` outlier.
   - This is a temporary diagnostic file under `tmp/`, not a production artifact.

### Why the last fix was made

The latest direct probes showed:

1. vectors matched between full and lite for the candidate union in the remaining outlier case
2. row metadata matched
3. centroids matched
4. the observed score delta was microscopic:
   - `maxScoreDelta = 2.220446049250313e-16`
5. these differences were enough to perturb the top-2000 cutoff inside `recommendFromFavorites(...)` for a large equal-score frontier

That meant the remaining divergence was ranking instability caused by raw floating-point ordering near the top-K cutoff, not a semantic difference in vectors or station logic.

### What the latest local probe proved after the fix

After adding stable rounded score sorting to both SQLite and lite, the temporary probe at `tmp/debug-slow-ambient.ts` reported complete agreement for the previously failing case:

- centroids matched
- candidate lists matched exactly
- filtered lists matched exactly
- deduped lists matched exactly
- chosen station sets matched exactly
- ordered station outputs matched exactly
- `firstVectorDiff` was `null`

The probe command used was:

```bash
bun tmp/debug-slow-ambient.ts
```

The final probe output after the fix showed:

- `candidates.firstDiff = -1`
- `filtered.firstDiff = -1`
- `deduped.firstDiff = -1`
- `chosen.firstDiff = -1`
- `ordered.firstDiff = -1`

### Latest focused validation already completed

This focused test run passed after the last fix:

```bash
bun test packages/sidflow-common/test/similarity-export.test.ts
```

Literal result observed in-session:

```text
15 pass
0 fail
46 expect() calls
Ran 15 tests across 1 file.
```

## What Is Still Left To Do

The remaining work is now primarily proof completion and bookkeeping.

### 1. Re-run the full release-backed strict parity audit

This is the highest-priority unfinished step.

The intended command was already prepared and started, but the user interrupted the run before completion. Re-run it from scratch:

```bash
mkdir -p tmp/lite-export-check && scripts/run-with-timeout.sh 7200 -- bun run validate:tiny-export-equivalence -- --output-root tmp/lite-export-check/audit2-rebuilt-lite-proof-v5 --full-export tmp/lite-export-check/audit2-release-proof-v3/downloads/sidcorr-hvsc-full-sidcorr-1.sqlite --lite-export tmp/lite-export-check/rebuilt-from-release/sidcorr-hvsc-full-sidcorr-lite-1.sidcorr --tiny-export tmp/lite-export-check/audit2-release-proof-v3/downloads/sidcorr-hvsc-full-sidcorr-tiny-1.sidcorr --strict > tmp/lite-export-check/audit2-rebuilt-lite-proof-v5.log 2>&1
```

Then inspect at least:

- `tmp/lite-export-check/audit2-rebuilt-lite-proof-v5/report.md`
- `tmp/lite-export-check/audit2-rebuilt-lite-proof-v5/comparisons/station-equivalence.json`
- `tmp/lite-export-check/audit2-rebuilt-lite-proof-v5/comparisons/seed-song-equivalence.json`
- `tmp/lite-export-check/audit2-rebuilt-lite-proof-v5.log`

What you need to confirm:

1. full vs lite station parity now passes for all personas, including `slow_ambient`
2. full vs lite seed-song parity still passes
3. full vs tiny still passes
4. strict mode exits successfully

### 2. Run broader required validation if the strict audit passes

At minimum, run:

```bash
bun run build
```

Then determine how much of the repo’s stricter test policy you can satisfy during the continuation session. If full `bun run test` is attempted, follow the repo instructions and record literal outputs if you get to `0 fail`.

### 3. Update `PLANS.md`

The plan file still needs the latest findings appended. Record at least:

1. the final lite root cause
2. the new stable-score sorting fix
3. the successful focused test run
4. the final release-backed audit result once rerun
5. whether Audit 2 is now blocked or unblocked for release readiness

Do not replace existing content. Append to the active Phase 34 / `P34-T08` progress notes.

### 4. Update `WORKLOG.md`

`WORKLOG.md` currently contains the kickoff entry but does not yet capture the later debugging arc. Add concise timestamped entries covering:

1. extension of the audit harness to lite
2. the mistaken initial 24D live-corpus hypothesis being superseded by stronger evidence
3. the compact-rating lite runtime fix for low-dimensional release bundles
4. the final floating-point frontier stabilization fix
5. focused validation and final release-backed audit results

### 5. Remove the temporary debug script if it is no longer needed

If the full audit passes and no further local debugging is required, delete:

- `tmp/debug-slow-ambient.ts`

If you still need it while validating, keep it until the proof is complete and then remove it before final sign-off.

## Important Current Facts To Preserve

Do not regress or contradict these without stronger file-backed evidence.

1. Tiny has been passing the real-corpus parity surfaces; lite was the actual problem.
2. The final known remaining outlier was `slow_ambient-1004`, and the latest local probe shows it is now fixed by stable rounded score sorting.
3. The remaining unfinished work is proof completion, not broad re-diagnosis.
4. The expensive full audit was interrupted by the user, not by a demonstrated code failure.
5. The authoritative release-backed artifact basis should remain:
   - full SQLite from `tmp/lite-export-check/audit2-release-proof-v3/downloads/...`
   - rebuilt lite from `tmp/lite-export-check/rebuilt-from-release/...`
   - tiny from `tmp/lite-export-check/audit2-release-proof-v3/downloads/...`

## Recommended Continuation Order

1. Re-read:
   - `AGENTS.md`
   - `PLANS.md`
   - `doc/audits/audit2/prompt.md`
   - this handover file
2. Re-run the strict release-backed audit command above.
3. Inspect the resulting report and JSON summaries.
4. If it passes, run `bun run build`.
5. Update `PLANS.md` and `WORKLOG.md`.
6. Remove `tmp/debug-slow-ambient.ts` if no longer needed.
7. Produce the final Audit 2 release-readiness summary.

## Definition Of Done For The Next Session

Audit 2 is complete only when all of the following are true:

1. the release-backed strict parity audit completes successfully on the chosen full/lite/tiny trio
2. the last lite station outlier is gone in the authoritative report, not just in the local probe
3. the focused regression tests remain green
4. required plan/worklog documentation is updated
5. any temporary debug file is removed or explicitly justified
6. a concise final release-readiness summary is produced with exact artifact paths and exact validation results