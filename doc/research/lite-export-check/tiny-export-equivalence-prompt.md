---
description: Audit the existing sidcorr-tiny export against the authoritative full sidcorr export with deterministic, repeatable station-building and seed-song similarity checks that can run locally on Linux and optionally in CI.
---

# Tiny Export Equivalence Audit Prompt

Write and run a deterministic audit of the existing tiny SID export and prove whether it is equivalent enough to the full export for:

1. building listener-persona radio stations
2. finding songs similar to a given seed song

This audit must be local-first on Linux, fully repeatable, and suitable for optional CI automation. The output must make factual comparison easy and must fail loudly when equivalence is not proven.

## Primary Goal

Prove, with reproducible evidence, that `sidcorr-tiny-1` is equivalent to the full export for the user-facing recommendation surfaces that matter most:

1. persona-based station construction across all personas supported by tiny
2. seed-song neighbor retrieval for many different seed songs

The comparison target is the local authoritative full export versus the local tiny export derived from the same corpus.

Use the shipped station runtime defaults as the primary audit baseline unless a stress mode is explicitly requested. In particular, the default `adventure` level should match the station runtime's product default rather than an arbitrarily more exploratory setting.

## Required Reading Before Running Anything

Read and use these repository sources before implementing or running the audit:

1. `README.md`
2. `doc/similarity-export.md`
3. `doc/similarity-export-lite.md`
4. `doc/similarity-export-tiny.md`
5. `doc/research/similarity-export-audit.md`
6. `packages/sidflow-common/src/persona.ts`
7. `packages/sidflow-common/src/persona-scorer.ts`
8. `packages/sidflow-play/src/station/queue.ts`
9. `packages/sidflow-play/src/station/dataset.ts`
10. `scripts/run-similarity-convergence.ts`

The audit must cite concrete implementation facts from those files in its final Markdown report.

## Operating Constraints

This work must be deterministic and automation-safe.

### Local-First Linux Requirement

- The default execution target is a local Linux checkout.
- The workflow must avoid interactive UI steps.
- Prefer existing Bun scripts and shared runtime code already used by the repo.

### Optional CI Requirement

- The exact same audit must be runnable non-interactively in CI if a maintainer chooses to wire it into a workflow.
- Do not require TTY input, prompt-based ratings, browser interaction, or ad-hoc manual inspection.
- All outputs must be written to a single deterministic artifact root under `tmp/`.

### Repeatability Rules

The audit is invalid unless all of the following are true:

1. Every random choice is seeded explicitly.
2. Every output path is explicit.
3. Every command can be rerun from a clean Linux checkout without editing the code.
4. Every comparison emits machine-readable JSON and a human-readable Markdown summary.
5. Running the audit twice against unchanged inputs produces the same conclusions and the same ordered result sets, except for timestamp fields.

## Important Implementation Constraint

Use the CLI station builder stack, but do not rely on the interactive `scripts/sid-station.sh` TUI as the test harness.

Reason: the wrapper is useful for manual proof, but it requires live seed ratings and terminal control, which makes it unsuitable for deterministic local automation and CI.

Instead, use the same underlying station-building path non-interactively through the shared runtime components already used by the CLI station implementation:

- `openStationSimilarityDataset(...)`
- `buildStationQueue(...)`
- `recommendFromFavorites(...)`
- `recommendFromSeedTrack(...)`

This still tests the real station/recommendation stack. It simply removes the interactive shell wrapper from the proof surface.

## Inputs

The audit harness must support both of these input modes:

1. local exports already present in the checkout
2. CI-hosted exports downloaded from `https://github.com/chrisgleissner/sidflow-data/releases/`

Default behavior should use local exports when they are present and sufficient.

The source must be configurable because local artifacts may be incomplete or stale.

Expected artifact names:

- full export: `sidcorr-hvsc-full-sidcorr-1.sqlite`
- tiny export: `sidcorr-hvsc-full-sidcorr-tiny-1.sidcorr`
- optional lite export: `sidcorr-hvsc-full-sidcorr-lite-1.sidcorr`

For the purpose of this task, use the CI-hosted release assets rather than the incomplete local exports.

If the audit also supports export regeneration, that regeneration path must itself be deterministic and non-interactive.

## Personas To Cover

Audit all personas supported by tiny, exactly as defined in `packages/sidflow-common/src/persona.ts`:

- `fast_paced`
- `slow_ambient`
- `melodic`
- `experimental`
- `nostalgic`
- `composer_focus`
- `era_explorer`
- `deep_discovery`
- `theme_hunter`

Do not hard-code a different persona list.

## Station Equivalence Audit

For each persona above:

1. Run the station builder at least 5 times against the full export.
2. Run the station builder at least 5 times against the tiny export.
3. Use matched deterministic seeds so each full/tiny pair is directly comparable.
4. Use the same station size, same minimum duration, same adventure level, same rating seed inputs, and same excluded-track policy.

### Minimum Station Run Matrix

For each persona, use at least these five run seeds:

- `1001`
- `1002`
- `1003`
- `1004`
- `1005`

If additional runs are useful, add them, but do not reduce this minimum.

### Station Inputs Must Be Deterministic

For each persona/run combination:

1. deterministically select the seed favorites from the full export
2. persist those exact favorite track IDs and ratings as JSON
3. feed the identical favorites and ratings into both full and tiny station builds

Do not let the tiny export choose different seed inputs than the full export.

### Required Station Metrics

For every persona/run pair, compute at minimum:

1. top-`N` overlap for the final station list, where `N` is the actual station size
2. Jaccard overlap on the station track sets
3. Spearman rank correlation on shared tracks
4. mean pairwise intra-station similarity for the full station and for the tiny station
5. delta between those two coherence scores
6. style-mask distribution similarity using the tiny/full style masks
7. composer diversity comparison
8. era/year spread comparison where metadata is available
9. duplicate SID-file rate comparison

### Required Cross-Persona Divergence Checks

The audit must also prove that different personas produce meaningfully different stations.

For both full and tiny independently:

1. compare every persona against every other persona
2. compute pairwise overlap percentages
3. compute pairwise rank correlation where tracks overlap
4. compute distribution deltas for style masks and available metadata

The report must clearly show whether persona collapse exists.

If two supposedly different personas repeatedly generate near-identical stations, call that out as a failure or material warning.

Treat persona-collapse findings that already exist in the authoritative full runtime as baseline warnings unless the tiny export materially worsens them. Do not fail export-equivalence solely because the full baseline itself exhibits persona overlap.

## Seed-Song Similarity Audit

Run a separate direct seed-song audit that does not depend on the station builder.

### Required Seed Count

Use at least 50 different seed songs.

### Seed Selection Rules

Seed selection must be deterministic and reproducible. Use one of these approaches:

1. take every `k`th track from the full export after stable ordering by `sid_path`, then `song_index`
2. or use a fixed seeded sample with the seed written into the report

Whichever method you choose, document it and reuse the exact same seed list for every rerun.

### Seed Recommendation Checks

For each of the 50 seed songs:

1. query the full export for similar songs using the repo’s real seed recommendation path
2. query the tiny export for similar songs using the repo’s real portable recommendation path
3. compare the top 10, top 20, and top 50 result sets
4. compute overlap, Jaccard, and rank correlation
5. record exact missing-from-tiny and missing-from-full IDs for the top 10 and top 20

Prefer these implementation paths:

- full: `recommendFromSeedTrack(...)` for direct full-export neighbor checks
- tiny: dataset-handle `getNeighbors(...)` and `recommendFromFavorites(...)` as appropriate for the tiny runtime behavior being audited

If the tiny runtime lacks an exact direct analogue to the full seed-neighbor API, document the semantic difference and still perform the strongest comparable check possible using the shipped tiny runtime API.

## Convergence Standard

This prompt uses strong convergence.

Do not stop once a report exists. Iterate until the audit is rigorous, reproducible, and easy to compare factually.

The audit is complete only when all of the following are true:

1. a single Linux command can run it end to end without prompts
2. the command writes deterministic artifacts under one output root
3. the Markdown report clearly states pass/fail for each persona and each seed-song cohort
4. the JSON artifacts are sufficient for downstream diffing and CI assertions
5. a second rerun against unchanged inputs confirms deterministic conclusions

## Required Automation Shape

Implement the audit as a non-interactive script or test harness that can be invoked in either of these modes:

1. local Linux developer mode
2. CI mode

The script may expose flags, but the defaults must favor local Linux execution.

### Required CLI Behavior

The audit harness must support at least:

- `--export-source <local|release>` with default `local`
- `--full-export <path>`
- `--tiny-export <path>`
- `--lite-export <path>`
- `--output-root <path>`
- `--station-size <n>`
- `--persona-runs <n>` with default `5`
- `--seed-song-count <n>` with default `50`
- `--strict` to exit nonzero on failed thresholds
- `--ci` to suppress any cosmetic output and keep artifacts machine-focused

When `--export-source release` is used, also support:

- `--release-repo <owner/repo>` with default `chrisgleissner/sidflow-data`
- `--release-tag <tag|latest>`

### Required Artifact Layout

Write results under a deterministic directory such as:

`tmp/lite-export-check/<timestamp-or-fixed-run-id>/`

Inside that root, include at minimum:

- `commands.json`
- `config.json`
- `station-inputs/`
- `station-runs/full/`
- `station-runs/tiny/`
- `seed-checks/full/`
- `seed-checks/tiny/`
- `comparisons/station-equivalence.json`
- `comparisons/seed-song-equivalence.json`
- `comparisons/persona-divergence.json`
- `report.md`
- `SHA256SUMS`

The top-level Markdown report must link or reference the JSON files it summarizes.

## Thresholds

Use explicit thresholds and fail the audit when they are violated.

At minimum:

1. per-persona median station overlap must be stated explicitly
2. per-persona worst-case overlap must be stated explicitly
3. seed-song top-10 and top-20 overlap minima must be stated explicitly
4. persona-divergence maxima must be stated explicitly

Do not hide threshold failures inside prose. Emit a pass/fail table.

If current repository behavior cannot satisfy a threshold, report the measured result honestly and mark the threshold as failed.

## Determinism Proof

As part of the audit, rerun at least one subset of the checks twice with unchanged inputs and verify:

1. identical seed favorites were chosen
2. identical station outputs were produced for the same persona/run/export pair
3. identical seed-song recommendation outputs were produced for the same seed song/export pair

Document the determinism proof in the report.

## CI Suitability Notes

The audit must explicitly state how to run in CI.

Include:

1. expected Linux environment
2. Bun requirement
3. any repo-local prerequisites
4. whether prebuilt exports are assumed or built during the job
5. expected runtime and artifact size considerations

If the full audit is too expensive for every CI run, define:

1. a default local full audit
2. a lighter CI audit mode with the same logic but reduced counts

Even in reduced CI mode, the workflow must remain deterministic.

## Deliverables

Produce:

1. the non-interactive audit harness or prompt-directed implementation plan
2. a Markdown result report that is easy to compare factually
3. machine-readable JSON artifacts for every major comparison surface
4. explicit rerun commands for local Linux and CI

## Final Report Requirements

The Markdown report must contain these sections in this exact order:

1. Scope
2. Inputs
3. Commands Run
4. Repeatability Contract
5. Persona Station Equivalence Summary
6. Persona Station Detailed Results
7. Cross-Persona Divergence Summary
8. Seed-Song Similarity Summary
9. Seed-Song Detailed Results
10. Determinism Proof
11. CI/Local Run Guidance
12. Verdict

The final Verdict must answer plainly:

1. Is tiny equivalent enough to full for persona stations?
2. Is tiny equivalent enough to full for seed-song similarity?
3. Which personas or seed cohorts diverge materially?
4. Is the audit repeatable enough for CI enforcement?
