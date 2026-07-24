# Audit 2 Prompt

## Role

You are a senior TypeScript engineer working inside the `sidflow` repository. Your task is to prove or repair cross-format recommendation parity across the three similarity-export formats that the repo actually ships:

- `sidcorr-1` full SQLite export
- `sidcorr-lite-1` lite `.sidcorr` bundle
- `sidcorr-tiny-1` tiny `.sidcorr` bundle

Treat this as an execution task, not a brainstorming task. Work directly in the repo, update the existing planning/logging files that the repo already uses, and continue until the requested proof or fix set is complete.

## Repo Facts Already Verified

These statements are already confirmed against the live repository and current published release assets. Do not contradict them unless you produce stronger file-backed evidence.

1. `PLANS.md` and `WORKLOG.md` already exist and are actively used. Do not recreate or replace them. Read `AGENTS.md`, `PLANS.md`, `README.md`, `doc/developer.md`, and `doc/technical-reference.md` first, then update the relevant existing phase or add a new task entry.
2. The repo already has a dedicated tiny-equivalence audit harness: `scripts/run-tiny-export-equivalence-audit.ts`, exposed as `bun run validate:tiny-export-equivalence -- ...` in `package.json`.
3. The repo already has a broader convergence harness: `scripts/run-similarity-convergence.ts`, exposed as `bun run validate:similarity-convergence -- ...`.
4. The repo already has focused parity tests in:
   - `packages/sidflow-play/test/station-portable-equivalence.test.ts`
   - `packages/sidflow-common/test/similarity-export.test.ts`
5. The interactive wrapper `scripts/sid-station.sh` is useful for manual proof but is not suitable as the primary automated harness because it depends on interactive seed-rating input and terminal control.
6. The automated station runtime surface you must use is the real shared implementation under:
   - `packages/sidflow-play/src/station/queue.ts`
   - `packages/sidflow-play/src/station/dataset.ts`
   - `openStationSimilarityDataset(...)`
   - `buildStationQueue(...)`
   - `recommendFromFavorites(...)`
   - `recommendFromSeedTrack(...)` for SQLite and the portable dataset APIs for lite/tiny
7. The canonical persona/style catalog is the exact `PERSONA_IDS` set in `packages/sidflow-common/src/persona.ts`. There are 9 personas:
   - `fast_paced`
   - `slow_ambient`
   - `melodic`
   - `experimental`
   - `nostalgic`
   - `composer_focus`
   - `era_explorer`
   - `deep_discovery`
   - `theme_hunter`
8. Persona scoring and hybrid metadata bonuses are implemented in `packages/sidflow-common/src/persona-scorer.ts`. Use the repo's exact persona semantics, not an invented profile taxonomy.
9. The station runtime is favorite-seeded. There is no separate documented CLI "profile mode" for station generation that should be audited as a primary surface. For semantic station checks, use deterministic persona-driven favorite selection layered on top of the existing favorite-seeded station builder.
10. In this checkout, the local export directory is mixed-scope. The local lite and tiny manifests under `data/exports/` currently describe only `796` tracks across `751` files, so they are not a like-for-like basis for authoritative three-format parity proof.
11. The latest published `sidflow-data` release is `sidcorr-hvsc-full-20260407T115218Z`. Its manifests publish a complete coherent asset set:
   - full: `track_count = 87073`, schema `sidcorr-1`
   - lite: `track_count = 87073`, `file_count = 60571`, schema `sidcorr-lite-1`
   - tiny: `track_count = 87073`, `file_count = 60571`, schema `sidcorr-tiny-1`
12. Because the local lite/tiny bundles are partial while the latest release assets are corpus-complete, the default authoritative audit source for this task should be the latest `chrisgleissner/sidflow-data` release assets unless you later produce stronger local artifacts with matching coverage.

## Primary Goal

Deliver a minimal, correct, production-ready result for recommendation parity across full, lite, and tiny by doing all of the following:

1. prove whether any material divergence actually exists on the real user-facing recommendation surfaces,
2. identify the first real point of divergence if a failure exists,
3. implement the smallest correct fix only after the cause is proven,
4. preserve or strengthen the existing automated proof surface,
5. keep docs, scripts, and implementation aligned.

The highest-risk hypothesis to prove or disprove is this:

`sidcorr-tiny-1` may diverge materially from the authoritative full and lite exports on station building and seed-song similarity.

Do not assume that hypothesis is true. Verify it.

## Use The Right Artifact Source

Start by selecting the most comprehensive coherent artifact set.

1. Compare local and release manifests by `track_count`, `file_count`, schema ID, and checksum lineage.
2. Prefer local artifacts only if all three local formats are corpus-complete and derived from the same authoritative lineage.
3. In the current checkout, prefer the latest `sidflow-data` release assets because the local lite/tiny bundles are partial validation artifacts.
4. If you need a local full/lite/tiny trio later for debugging, prefer rebuilding lite and tiny from an already-correct full SQLite export before considering any full reclassification run.

## Last-Resort Regeneration Rule

Full local regeneration is expensive and must be a last resort.

1. Do not start by reclassifying the corpus.
2. First exhaust these likely root-cause areas:
   - artifact selection mistakes
   - release-vs-local mixups
   - lite/tiny loader or decoder bugs
   - station queue tie-breaking or deterministic ordering bugs
   - portable neighbor interpretation bugs
   - style-mask or persona-scoring mismatches
   - path and track-identity mapping bugs
3. If the issue is only in portable derivation, regenerate lite and tiny from a known-good full SQLite export without rerunning full classification.
4. Only if you prove the bug is in core classification output or in export-generation logic that depends on fresh classified data should you regenerate the entire full/lite/tiny chain locally.
5. If that full rerun becomes necessary, document why all cheaper options were ruled out first.

## Primary Sources Of Truth

Read and reconcile these before changing behavior:

1. `AGENTS.md`
2. `PLANS.md`
3. `README.md`
4. `doc/developer.md`
5. `doc/technical-reference.md`
6. `doc/similarity-export.md`
7. `doc/similarity-export-lite.md`
8. `doc/similarity-export-tiny.md`
9. `doc/research/similarity-export-audit.md`
10. `doc/research/lite-export-check/tiny-export-equivalence-prompt.md`
11. `packages/sidflow-common/src/persona.ts`
12. `packages/sidflow-common/src/persona-scorer.ts`
13. `packages/sidflow-play/src/station/queue.ts`
14. `packages/sidflow-play/src/station/dataset.ts`
15. `scripts/run-tiny-export-equivalence-audit.ts`
16. `scripts/run-similarity-convergence.ts`
17. `packages/sidflow-play/test/station-portable-equivalence.test.ts`
18. `packages/sidflow-common/test/similarity-export.test.ts`

The repo is the source of truth. If docs and code disagree, resolve the mismatch explicitly and record it.

## Execution Rules

1. Update `PLANS.md` first. Do not overwrite it. Add or update the relevant task entry and then begin implementation immediately.
2. Append concise timestamped entries to `WORKLOG.md` for every meaningful decision, experiment, failure, fix, and validation result.
3. Reuse and extend the existing audit harness and tests where possible. Do not build a parallel audit framework unless the current one is structurally insufficient.
4. Keep changes tightly scoped to:
   - export selection and loading
   - portable similarity decoding
   - station queue construction and ordering
   - seed-song similarity checks
   - persona/style semantics and proofs
   - directly related tests and documentation
5. Do not perform opportunistic refactors.
6. Do not weaken thresholds merely to make failures pass.
7. Preserve the existing CLI UX unless a change is required for correctness and then document it.

## What To Audit

Audit the real recommendation surfaces that exist today:

### A. Favorite-Seeded Station Building

Use the shared runtime path that the station CLI depends on:

- `openStationSimilarityDataset(...)`
- `buildStationQueue(...)`
- `recommendFromFavorites(...)`

For semantic coverage, generate deterministic favorite seeds from the persona catalog and run those exact favorite sets against full, lite, and tiny.

### B. Direct Seed-Song Similarity

Audit direct seed-song recommendation separately from station building.

- For SQLite, use `recommendFromSeedTrack(...)`.
- For lite/tiny, use the shipped portable dataset APIs that most closely match runtime behavior, including `getNeighbors(...)` and portable favorite-based recommendation where appropriate.
- If there is no exact one-call portable analogue for a SQLite check, document the semantic difference and perform the strongest comparable repo-grounded comparison instead of inventing a new API surface.

## Required High-Level Approach

### Phase 1 - Ground Truth And Source Selection

1. Confirm which local artifacts are partial and which published release assets are corpus-complete.
2. Select one coherent full/lite/tiny trio as the audit baseline.
3. Record the exact files, manifests, counts, checksums, and release tag or local paths used.
4. Document why that source set is the authoritative comparison basis.

### Phase 2 - Reproduce With Existing Harnesses

1. Run the current `validate:tiny-export-equivalence` harness against the chosen artifacts.
2. Run or inspect `validate:similarity-convergence` where it provides relevant release/download coverage.
3. Run the focused parity tests that already exist.
4. Identify what is already proven, what is missing, and what is failing.

### Phase 3 - Define And Lock In The Invariants

At minimum, preserve these repo-grounded expectations:

1. SQLite vs lite should remain very close and should continue to meet or exceed the thresholds already encoded in `packages/sidflow-play/test/station-portable-equivalence.test.ts`.
2. SQLite vs tiny should continue to meet or exceed the current station and seed-song thresholds encoded in the existing real-corpus harness and the targeted portable-equivalence tests.
3. Persona semantics must come from the shared persona modules, not from ad hoc buckets.
4. Repeated runs under fixed inputs must be deterministic.
5. Tiny may be lossy, but any remaining deviation must be explicitly bounded, measured, and explained by documented format constraints rather than by a bug.

### Phase 4 - Extend The Smallest Useful Proof Surface

Prefer extending the current audit assets instead of inventing new ones.

If needed, strengthen:

1. `scripts/run-tiny-export-equivalence-audit.ts`
2. `packages/sidflow-play/test/station-portable-equivalence.test.ts`
3. `packages/sidflow-common/test/similarity-export.test.ts`

Keep the artifact layout deterministic under `tmp/`. Prefer the existing `tmp/lite-export-check/` lineage unless there is a strong reason to move it.

### Phase 5 - Localize The First Divergence

For every failing case:

1. identify the first point where full, lite, and tiny stop agreeing,
2. determine whether the fault is in:
   - artifact choice
   - export derivation
   - loader/decoder behavior
   - track identity or path resolution
   - style-mask or persona interpretation
   - neighbor ranking or truncation
   - queue selection, ordering, or tie-breaking
   - nondeterministic iteration or seeded randomness
3. prove the cause with focused instrumentation or tests before changing code.

### Phase 6 - Apply The Minimal Fix

Allowed changes:

1. bug fixes in dataset loading, portable decoding, station ranking/ordering, or related export derivation
2. focused audit/test improvements
3. minimal doc corrections
4. tiny observability improvements that directly support diagnosis or regression prevention

Not allowed:

1. broad architecture changes
2. speculative rewrites
3. unrelated cleanup
4. behavior changes without proof that the old behavior was wrong

### Phase 7 - Revalidate And Report

At the end, produce a concise release-readiness summary that states:

1. the exact artifact source used,
2. the exact root cause if a bug existed,
3. the exact files changed and why,
4. the exact proof matrix used,
5. parity results across full, lite, and tiny,
6. seed-song similarity results,
7. determinism results,
8. residual risks,
9. whether release is blocked or unblocked.

## Metrics And Thresholds

Do not replace explicit metrics with vague visual inspection.

At minimum preserve or strengthen the currently encoded checks:

### Existing Station Parity Floors

From the current targeted portable-equivalence test surface:

1. SQLite vs lite:
   - overlap@50 >= 0.95
   - overlap@100 >= 0.95
   - Jaccard@100 >= 0.90
   - Spearman@100 >= 0.90
   - max style-distribution delta <= 0.05
2. SQLite vs tiny:
   - overlap@50 >= 0.80
   - overlap@100 >= 0.85
   - Jaccard@100 >= 0.70
   - Spearman@100 >= 0.65
   - max style-distribution delta <= 0.18

### Existing Real-Corpus Audit Floors

From the current `run-tiny-export-equivalence-audit.ts` harness:

1. persona median overlap >= 0.80
2. persona worst-case overlap >= 0.70
3. persona median Jaccard >= 0.65
4. persona median Spearman >= 0.55
5. persona median coherence delta <= 0.20
6. persona median style similarity >= 0.80
7. seed-song median top-10 overlap floor preserved at the current harness level
8. seed-song median top-20 overlap floor preserved at the current harness level
9. cross-persona divergence parity deltas must remain within the current harness bounds unless you tighten them with evidence

If you change any threshold, justify it with code-backed reasoning and update the docs/tests/harness consistently.

## Deliverables

1. updated `PLANS.md`
2. updated `WORKLOG.md`
3. strengthened or confirmed audit harness under the existing script path unless replacement is truly necessary
4. generated deterministic artifacts under `tmp/`
5. minimal code fix if a real bug is found
6. durable regression tests
7. any necessary doc corrections
8. a final Markdown summary in the audit artifact tree

## Mandatory Termination Criteria

Do not stop until all of the following are true:

1. the artifact source choice is justified and documented,
2. any real divergence is localized to a proven cause or explicitly ruled out,
3. if a bug existed, the minimal correct fix is implemented,
4. the selected proof set runs cleanly across full, lite, and tiny for the audited surfaces,
5. determinism is demonstrated under fixed inputs,
6. persona semantics and seed-song similarity checks are both covered,
7. focused regression tests pass,
8. build and relevant validation commands have been run and recorded,
9. `PLANS.md` and `WORKLOG.md` accurately reflect the finished work.

## Preferred Work Pattern

1. read the repo docs and code,
2. choose the authoritative artifact source,
3. run the existing audit harnesses and tests,
4. tighten the matrix only where evidence is missing,
5. reproduce failures,
6. isolate the first divergence,
7. apply the minimal fix,
8. rerun the proof set,
9. finalize the report.

## Output Expectations

Work directly in the repo. As you proceed:

1. keep `PLANS.md` current,
2. append timestamped entries to `WORKLOG.md`,
3. preserve deterministic audit artifacts under `tmp/`,
4. do not stop after analysis,
5. do not declare success on partial evidence,
6. do not trigger a full local reclassification/export rebuild unless you have already proven that cheaper options cannot resolve the issue.