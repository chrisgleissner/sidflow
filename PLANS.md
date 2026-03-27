# PLANS.md - SID Classification Pipeline Recovery

## Phase 15 - Full-Corpus Classification Stability Recovery

### Objective

Make `bash scripts/run-similarity-export.sh --mode local --full-rerun true` complete successfully on the full HVSC corpus with 100% classification coverage, bounded memory, bounded worker count, and no timeout-driven data loss.

### Root Cause Hypotheses

- [x] The primary OOM driver is WASM trace capture buffering every SID write in memory until the end of a render (`pendingTraces` in `wav-renderer.ts`), which scales badly on complex tracks and across concurrent workers.
- [x] The primary data-loss path is the render-pool circuit breaker (`timedOutSids`) plus tagging/build skip branches in `index.ts`, which permanently drops later jobs for an SID after a timeout.
- [x] The primary oversubscription path is thread selection defaulting to logical-core count instead of a bounded fixed worker heuristic; the web `/api/classify` route also ignores a request-level thread override.
- [x] Worker instability is amplified by forceful `worker.terminate()` on timeout/error with immediate replacement, producing churn instead of bounded, cooperative recycling.
- [x] Memory telemetry is incomplete because it tracks heap only, not RSS, and does not persist worker-pool lifecycle or fallback-level metrics.

### Fix Strategy By Failure Class

- [x] Render bounding: enforce wall-clock/CPU-style budgets inside the render loop itself so renders terminate cooperatively with partial output instead of parent-side kill/skip.
- [x] Worker pool: keep a fixed-size global queue and worker pool, cap default concurrency at `min(physical_cores / 2, 6)`, and recycle workers after a bounded job count.
- [x] Data loss: remove timeout circuit-breaker purging and replace it with an ordered fallback ladder that always produces either truncated audio or metadata-only output.
- [x] Memory discipline: stream SID trace sidecars in bounded batches, avoid whole-trace retention, reduce duplicate PCM buffering, and dispose engines after every attempt.
- [x] Telemetry: persist RSS, active/busy worker count, worker recycle count, fallback level, render truncation, and classification outcome summaries.
- [x] API / orchestration: make `/api/classify` honor thread overrides and use the same bounded worker heuristic as the CLI path used by the full similarity-export script.

### Investigation / Validation Steps

- [x] Replace trace accumulation and timeout-purge code paths.
- [x] Add targeted tests for bounded rendering, worker recycling, no-skip fallback behavior, and concurrency heuristics.
- [x] Add CI-safe stability regressions that repeatedly classify the pathological Mario SID and the full checked-in SID fixture set while checking for RAM/thread/throughput drift.
- [x] Run focused classify tests and build.
- [ ] Review and reconcile the current dirty-tree render-pool follow-up changes before broader validation (`runConcurrent` per-SID serialization, worker-attempt timeout guard, worker dispose hardening).
- [ ] Run targeted subset classifications, including the previously pathological 2SID repro and a bounded HVSC subset, while collecting RSS / fallback telemetry.
- [ ] Run the full `bash scripts/run-similarity-export.sh --mode local --full-rerun true` validation.
- [ ] Record final metrics summary and reproducibility evidence in `WORKLOG.md`.
- [ ] Re-run repository validation gates required by repo policy (`bun run build`, relevant targeted tests, then `bun run test` x3 once the classification changes are stable).

### Progress

- 2026-03-27: Replaced the WASM render pool timeout/circuit-breaker implementation with a cooperative fixed-size pool that recycles workers after 32 jobs and emits lifecycle events.
- 2026-03-27: Moved render bounding into `renderWavWithEngine()`, streamed trace sidecars in batches, and removed whole-trace buffering plus duplicate PCM chunk accumulation.
- 2026-03-27: Refactored `buildAudioCache()` and `generateAutoTags()` so render failures flow through a bounded fallback ladder and end in metadata-only classification instead of `skipped`/`song_failed` outcomes.
- 2026-03-27: Bounded thread selection via the physical-core heuristic in classify orchestration, feature extraction pool sizing, and the web `/api/classify` path; request-level `threads` is now honored by the API schema and temp config.
- 2026-03-27: Focused validation passed: `bun run build` succeeded, and `bun test packages/sidflow-classify/test/render-timeout.test.ts packages/sidflow-classify/test/multi-sid-classification.test.ts packages/sidflow-classify/test/cli.test.ts` completed with 26 passing tests and 0 failures.
- 2026-03-27: Added `packages/sidflow-classify/test/super-mario-stress.test.ts` as a CI-safe stability harness. It now runs two automated regressions through the real classifier: 3 rounds of 24 runtime copies of `test-data/C64Music/GAMES/S-Z/Super_Mario_Bros_64_2SID.sid`, and 2 rounds over every checked-in SID fixture. The assertions watch peak thread count, peak RSS, cross-round final RSS/thread drift, and completion-gap / per-record throughput slowdown. The file passed 3 consecutive runs in about 6.7s per run.
- 2026-03-27: New unvalidated follow-up edits are present in the dirty tree: `runConcurrent()` now serializes work by SID path, the WASM render pool has a per-job timeout/replacement guard, and the worker now null-checks engine disposal. These changes still need build/test confirmation and real subset telemetry before the broader export run.

### Measurable Success Criteria

- [ ] Full command completes with `0` skipped songs and `0` fatal classification failures.
- [ ] Peak RSS remains below 4 GB during the final run.
- [ ] Worker pool never exceeds the configured fixed size and does not exhibit crash/restart loops.
- [ ] Telemetry shows every SID reaches one of: full render, truncated render, degraded render, or metadata-only classification.
- [ ] Re-running the full command yields identical classification counts.

## Objective

Recover the SID classification pipeline by diagnosing and fixing the pathological behavior where `GAMES/S-Z/Super_Mario_Bros_64_2SID.sid` causes all workers to become stuck, pegging all cores at 100% with zero forward progress.

## Branch Topology

- `main`: restored to `c392f08` (stable baseline)
- `fix/direct-sid-classification`: contains commits `e6ea3b4..e06e301` + new fix work

## Phase 0 - Branch Recovery and Plan
- [x] Create `fix/direct-sid-classification` at `e06e301`
- [x] Reset `main` to `c392f08`
- [x] Verify branch topology
- [x] Create PLANS.md
- [x] Create WORKLOG.md

## Phase 1 - Establish Baseline
- [ ] Confirm pipeline builds and tests pass on fix branch
- [ ] Run small bounded classification (5-10 SIDs) to confirm non-pathological behavior
- [ ] Define reproduction tiers (single SID, small batch, prefix replay)
- [ ] Define forward-progress metrics

## Phase 2 - Telemetry Instrumentation
- [ ] Add per-song wall-clock timeout to `runConcurrent` worker invocations
- [ ] Add per-worker SID attribution logging (JSON)
- [ ] Add stall watchdog: no song completes for 60s -> dump state
- [ ] Add duplicate-dispatch detection (same SID on multiple workers)
- [ ] Add periodic status snapshot (every 10s) with queue/worker state
- [ ] Add per-song timing and outcome tracking
- [ ] Machine-readable run summary JSON

## Phase 3 - Controlled Reproduction
- [ ] Tier A: Single-SID isolation of `Super_Mario_Bros_64_2SID.sid`
- [ ] Tier B: Small batch (5-10 SIDs) including the problematic SID
- [ ] Tier C: Prefix replay approaching historical failure
- [ ] Determine minimal reproduction scope

## Phase 4 - Root Cause Analysis
- [ ] Identify exact stage where problematic SID stalls
- [ ] Determine if single worker hangs vs multiple workers stuck on same SID
- [ ] Determine if duplicate dispatch occurs
- [ ] Compare normal vs pathological SID telemetry
- [ ] State root cause precisely

## Phase 5 - Implement Fixes
- [ ] Per-song watchdog timeout with error attribution
- [ ] Worker ownership discipline (one SID cannot monopolize all workers)
- [ ] Deduplication/lease protection against duplicate concurrent dispatch
- [ ] Forward-progress detection
- [ ] Safe failure: pathological SID skipped/quarantined, pipeline continues
- [ ] Structured failure artifacts

## Phase 6 - CPU Utilization Stabilization
- [ ] Measure utilization during healthy runs
- [ ] Identify idle gaps or bottlenecks
- [ ] Verify >= 50% avg CPU per core during substantial runs
- [ ] No false 100% CPU with zero progress

## Phase 7 - Long-Run Validation
- [ ] Bounded run crossing historical ~10 min failure threshold
- [ ] Large corpus run with continuous progress
- [ ] All expected output artifacts produced
- [ ] Telemetry confirms worker health throughout

## Phase 8 - Regression Protection
- [ ] Regression test for pathological-song timeout behavior
- [ ] Scheduler test: duplicate SID ownership cannot consume all workers
- [ ] Timeout/watchdog test
- [ ] Documented reproduction procedure

## Phase 9 - Final Documentation
- [ ] Root-cause write-up in doc/research/
- [ ] Updated classification usage docs
- [ ] Telemetry inspection guide
- [ ] Final verification evidence in WORKLOG.md

## Phase 10 - PR #87 Convergence

### Objective

Bring PR #87 to a merge-ready state by addressing inline review feedback, fixing the failing CI job, and re-running validation until the branch is stable.

### Checklist
- [ ] Review all inline PR comments and classify each as fix / no-op with rationale
- [ ] Implement minimal code/test fixes for valid review findings
- [ ] Re-run targeted classify tests and build locally
- [ ] Re-run full `bun run test` until green
- [ ] Re-run required validation 3x per repo policy and capture outputs
- [ ] Respond to each inline review comment with technical resolution
- [ ] Resolve all review threads/comments that are addressed
- [ ] Push branch updates and verify all CI checks pass

### Progress
- 2026-03-24: Loaded repo guidance and PR state. `gh api graphql` reports no active review threads, but `gh api repos/.../pulls/87/comments` returned 11 inline Copilot comments that still need individual responses.
- 2026-03-24: `gh pr status` shows PR #87 has 1/4 failing checks. The failing check is `Build and test / Build and Test` from Actions run `23484605584`.
- 2026-03-24: Initial review triage identified likely-valid issues in `render-timeout.test.ts`, `wasm-render-pool.ts`, `index.ts`, and a wording issue in `cli.ts`. Work in progress.

### Decision Log
- 2026-03-24: Treat inline Copilot comments as authoritative review work even though GraphQL `reviewThreads` returned no active thread nodes for this PR.

### Outcomes
- Pending.

---

## Phase 14 - SID Classification Defect Convergence

### Objective

Fix the classification pipeline defects around renderer selection, missing SID
trace sidecars, silent-frame activity leakage, and waveform ratio dilution while
keeping changes minimal and localized.

### Checklist
- [ ] Record renderer-selection analysis and silent-fallback findings in `WORKLOG.md`
- [ ] Enforce WASM as the classification default when no engine is specified
- [ ] Require explicit degraded-mode opt-in before classification may use `sidplayfp-cli`
- [ ] Fail fast with a clear error when classification selects `sidplayfp-cli` without opt-in
- [ ] Emit an explicit degraded-mode warning when classification intentionally uses `sidplayfp-cli`
- [ ] Make SID-native feature extraction degrade gracefully when the trace sidecar is missing
- [ ] Keep WAV feature extraction successful even when SID-native extraction is unavailable
- [ ] Exclude `waveform: "none"` frames from active voice detection
- [ ] Exclude `waveform: "none"` frames from waveform-ratio denominators
- [ ] Add regression tests for renderer gating, missing-sidecar degradation, and SID frame math
- [ ] Run validation: `bun run build`
- [ ] Run targeted classify tests
- [ ] Run full `bun run test` three consecutive times

### Progress
- 2026-03-26: Analysis started. Confirmed classification code reads `render.preferredEngines[0]` directly in multiple places, so renderer choice is implicit and unvalidated.
- 2026-03-26: Confirmed repo default config is already `wasm`-first; the defect is code-level acceptance of `sidplayfp-cli` without explicit opt-in, not the checked-in default config.
- 2026-03-26: Confirmed missing trace sidecars currently abort merged feature extraction in both the main-thread hybrid extractor and the worker-thread extraction path because both use `Promise.all` semantics.
- 2026-03-26: Confirmed active-frame and waveform-ratio defects live in `packages/sidflow-classify/src/sid-native-features.ts`.
- 2026-03-26: Adjusted renderer enforcement approach after review: classification now preserves the user's configured preferred engine, warns once when a non-WASM engine is explicitly selected, and only allows automatic fallback from failed WASM renders to `sidplayfp-cli` when `render.allowDegradedSidplayfpCli=true`.
- 2026-03-26: Focused validation passed: `bun test packages/sidflow-classify/test/index.test.ts packages/sidflow-classify/test/sid-native-features.test.ts` completed with 28 passing tests and 0 failures.
- 2026-03-26: CI-equivalent Playwright reproduction exposed a separate merge blocker: admin E2E pages were loading unauthenticated because the admin session cookie was scoped to `/admin` while the same session was also required for `/api/admin/*`. Updated the cookie scope to `/` in middleware and Playwright test seeding.
- 2026-03-26: Classification E2E failures were traced to stale synthetic-cache fixtures in the web Playwright suite. The classifier now requires cache-complete WAV fixtures (`.wav`, `.sha256`, `.render.json`, `.trace.jsonl`) for WASM reuse, so the E2E specs were updated to seed full cache entries instead of bare WAV files.
- 2026-03-26: Added a new synthetic station regression at `packages/sidflow-play/test/station-multi-profile-e2e.test.ts` that classifies one five-cluster corpus, exports one similarity database, and verifies five distinct 10-rating personas each produce a cluster-pure 20-song station.
- 2026-03-26: Stability validation passed for the new five-profile station regression: `bun test packages/sidflow-play/test/station-multi-profile-e2e.test.ts` completed successfully three consecutive times.

### Decision Log
- 2026-03-26: Scope renderer enforcement to the classification pipeline, not the standalone render CLI, because the reported defects are classification-specific and the render CLI intentionally supports multi-engine fallback for manual rendering.
- 2026-03-26: Preserve `render.preferredEngines` as the authoritative explicit engine choice for classification. The new `render.allowDegradedSidplayfpCli` flag gates only automatic fallback after a failed WASM render; it does not gate an explicit user-selected `sidplayfp-cli` preference.

### Outcomes
- Pending.

## Phase 11 - Similarity Export Slowdown Telemetry

### Objective

Add deterministic, per-song classification lifecycle telemetry for the `bash scripts/run-similarity-export.sh --mode local --full-rerun true` workflow, then use that evidence to explain the reported slowdown around 70-75% completion.

### Checklist
- [x] Read repo guidance, docs, and classify/export entrypoints
- [x] Establish baseline build/test state before code changes
- [x] Add wrapper-run metadata capture for the exact similarity-export command
- [x] Emit structured per-song classification telemetry without changing the main classification JSONL schema
- [x] Surface the hidden post-extraction phases in CLI/web/script progress reporting
- [x] Add focused tests for telemetry + phase reporting
- [x] Run a bounded classify/export verification and inspect emitted telemetry
- [x] Document the slowdown root cause and evidence in `doc/research/`
- [ ] Re-run final validation (`bun run build`, targeted tests, `bun run test` x3)

### Progress
- 2026-03-25: Baseline `npm run build` succeeded. `npm run test` also exited successfully from a clean code baseline.
- 2026-03-25: Code inspection shows `generateAutoTags()` does a concurrent feature-extraction pass, then a second serialized pass that builds the dataset-normalized rating model and writes final classification records. Existing progress/log parsing largely exposes the first phase, so late-run work can look like a slowdown.
- 2026-03-25: Added `classification_*.events.jsonl` telemetry, wrapper-level `run-events.jsonl`, and explicit `Building Rating Model` / `Writing Results` progress phases.

## Phase 16 - Takeover Prompt Handoff

### Objective

Capture the complete recovery brief as a reusable markdown prompt in `doc/` so a follow-on LLM can finish the full-corpus classification run and the downstream five-persona station validation.

### Checklist
- [x] Read repo guidance (`PLANS.md`, `README.md`, `doc/developer.md`, `doc/technical-reference.md`)
- [x] Write a raw markdown takeover prompt under `doc/`
- [x] Include the exact full-corpus requirement for all 60,582 songs
- [x] Include the five-persona, 10-vote station validation requirement

### Progress
- 2026-03-27: Added `doc/full-hvsc-classification-takeover-prompt.md` containing the handoff prompt for finishing the full HVSC classification/export run and validating five disjoint persona-driven stations.
- 2026-03-25: Focused validation passed: `npm run build:quick` and `bun test packages/sidflow-classify/test/cli.test.ts packages/sidflow-classify/test/auto-tags.test.ts packages/sidflow-classify/test/index.test.ts`.
- 2026-03-25: Bounded wrapper verification hit an environment blocker (`ffmpeg` missing), but still produced the wrapper `run_start` artifact. The classification lifecycle itself was verified end-to-end with the same run context against `test-data`.

### Decision Log
- 2026-03-25: Keep telemetry in a separate `classification_*.events.jsonl` stream to avoid breaking downstream consumers of the canonical `classification_*.jsonl` schema.

### Outcomes
- Root cause identified: a real late serialized finalization pass existed, but the severe slowdown symptom was primarily caused by missing visibility into that pass.

## Phase 12 - Enhanced Per-Song Lifecycle Logging (Strict JSONL)

### Objective

Implement a deterministic, structured, per-song classification logging system
that captures the full lifecycle of each song with system metrics, stage
durations, and stall detection — writing to `logs/classification-detailed.jsonl`.
Use the collected evidence to further confirm/refine the root cause found in
Phase 11.

### Checklist
- [ ] Add `SongLifecycleLogger` to `classification-telemetry.ts`
  - [ ] Per-song JSONL format: ts, songIndex, totalSongs, songPath, songId, stage, event, durationMs, workerId, pid, threadId, memoryMB, cpuPercent, extra
  - [ ] `resolveGitCommit()`, `captureMemoryMB()`, `captureCpuPercent()` helpers
  - [ ] Stall detection watchdog (30-second scan, 10× median threshold)
  - [ ] `run_start` event with gitCommit; `run_end` event with totalDurationMs
- [ ] Instrument all 11 stages in `generateAutoTags` (index.ts)
  - QUEUED, STARTED, RENDERING, RENDERED, EXTRACTING, EXTRACTED, ANALYZING, ANALYZED, TAGGING, TAGGED, COMPLETED
  - Each stage emits start + end events with duration
- [ ] Add `lifecycleLogPath?` option to `GenerateAutoTagsOptions` (defaults to `logs/classification-detailed.jsonl`)
- [ ] Add `logs/` to `.gitignore`
- [ ] Create `doc/research/classification-logging-audit.md` with full evidence-based analysis
- [ ] Update WORKLOG.md
- [ ] Run `bun run build:quick` + targeted tests; fix any regressions
- [ ] Run `bun run test` three times consecutively with 100% pass rate

### Progress
- 2026-03-25: Phase started. Code exploration complete.

### Decision Log
- 2026-03-25: Keep PRIMARY log at `logs/classification-detailed.jsonl` (project root), separate from the existing `data/classified/classification_*.events.jsonl`. This avoids any schema-breaking changes.
- 2026-03-25: `lifecycleLogPath` param added to `GenerateAutoTagsOptions` so tests can redirect to a temp dir.
- 2026-03-25: `captureCpuPercent` measures delta from last sample — process-wide, not per-worker (sufficient for high-level analysis).

### Outcomes
- Pending.

---

## Phase 13 - Full HVSC Classification Validation and Release Publication

### Objective

Validate that a complete HVSC classification run produces correct artifacts
(features JSONL, auto-tags, SQLite export) and publish the verified export to
`chrisgleissner/sidflow-data` as a release.

### Phase 13.0 — Pre-Run Context Audit (COMPLETE)

**Evidence gathered before classification:**
- HVSC: 60,572 SID files in `workspace/hvsc/C64Music/`
- Prior interrupted run (01:48–01:52 UTC 2026-03-26): classified only 1,089 of 87,074+ total sub-songs (1.3%)
- Cause of interruption: external (process killed; no `run_end` event; last event `render_start` at queueIndex 1112)
- `data/exports/` is EMPTY — no SQLite export exists
- Existing `data/classified/features_2026-03-26_01-48-27-584.jsonl`: 1,089 entries only (partial)
- `workspace/audio-cache/`: 1,113 WAV files survive from interrupted run  
- `workspace/tags/`: 12 `auto-tags.json` files (all from manual ratings, NOT from auto-classification)
- `isAlreadyClassified` checks `auto-tags.json` → so `skipAlreadyClassified=true` will NOT skip the 1,089 partial songs (no auto-tags were written since the tagging phase never started)
- Conclusion: functionally equivalent to a full fresh run; WAV files provide a small rendering cache benefit
- Committed test SQLite (git HEAD) has only 7 tracks with 4 dimensions (schema 1.2.0, NOT a real export)
- `.sidflow.json` uncommitted diff: `sidplayfp-cli` moved to first in `preferredEngines` (intentional for speed)
- `classification-telemetry.ts` uncommitted diff: defensive try/catch around CPU/memory helpers (correctness improvement)

### Phase 13.1 — Pre-Classification Build Verification
- [ ] Run `bun run build` and confirm 0 errors
- [ ] Run targeted classify tests: `bun test packages/sidflow-classify/test/`
- [ ] Record pass/fail

### Phase 13.2 — Full Classification Run
**Method**: `bash scripts/run-similarity-export.sh --mode local`
(Without `--full-rerun`; the script will naturally re-classify everything since no auto-tags exist.
The 1,113 WAV files provide a minor rendering cache benefit.)

- [ ] Confirm no web server is running on port 3000 before starting
- [ ] Start classification run in background
- [ ] Monitor progress every 10 minutes
- [ ] Confirm completion: 87,074+ songs processed, `run_complete` event emitted
- [ ] Verify artifacts post-run:
  - [ ] `data/classified/features_*.jsonl` total line count ≥ 60,572
  - [ ] `workspace/tags/` auto-tags.json files populated
  - [ ] `data/exports/*.sqlite` exists and is non-empty
  - [ ] `data/exports/*.manifest.json` exists

### Phase 13.3 — Classification Completeness Verification
- [ ] Count total SID files: `find workspace/hvsc -name "*.sid" | wc -l` → expect ~60,572
- [ ] Count unique classified entries in features JSONL
- [ ] Verify no duplicate `sid_path` entries in features JSONL
- [ ] Check for truncated/malformed JSONL lines
- [ ] Cross-check: rendered, extracted, tagged counts match expected total

### Phase 13.4 — Export Validation (SQLite)
- [ ] Verify SQLite schema integrity (tables: `meta`, `tracks`, `neighbors`)
- [ ] Verify `tracks` row count ≥ 60,572
- [ ] Verify all 24 similarity vector fields present per track
- [ ] Check for NULL or empty vectors (expect 0)
- [ ] Validate `meta` table: schema_version, generated_at, track_count
- [ ] Cross-check manifest: track_count matches SQLite, checksums match
- [ ] Spot validation: 50+ random sample tracks from JSONL vs SQLite

### Phase 13.5 — Programmatic Quality Validation (replacing interactive SID station)
**Context**: The `scripts/sid-station.sh` interactive audio questionnaire cannot be
executed autonomously (requires human audio perception and TUI interaction).
Equivalent programmatic validation will be performed:

- [ ] Run 5 distinct similarity profile queries using the play CLI:
  1. Seed: high-BPM song → verify returned songs have high BPM
  2. Seed: low-energy ambient song → verify low energy in results
  3. Seed: heavy-bass song → verify high bassPresenceFused in results
  4. Seed: melodically clear song → verify high melodicClarityFused in results
  5. Seed: high-noise/experimental song → verify high waveNoiseRatio in results
- [ ] For each run: capture playlist output and compare feature vectors
- [ ] Verify cosine similarity between seed and top-5 results is > 0.8
- [ ] Document anomalies if any

### Phase 13.6 — Release Publication
**Precondition**: All phases 13.3–13.5 must PASS

- [ ] Verify release artifact: `data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite`
- [ ] Use command: `bash scripts/run-similarity-export.sh --workflow publish-only --mode local --publish-release true`
- [ ] Verify release exists on `chrisgleissner/sidflow-data`
- [ ] Verify artifacts are downloadable
- [ ] Verify checksums match manifest

### Termination Criteria (ALL must be true before declaring Phase 13 complete)
1. Classified song count ≥ 60,572 (all HVSC SID files)
2. SQLite `tracks` row count = classified song count
3. Manifest consistency checks pass
4. 50+ random sample spot validations pass
5. 5/5 programmatic similarity profile queries produce coherent results
6. No unresolved anomalies
7. Release successfully published and verified

### Numeric Checkpoints
- HVSC SID count: 60,572 (verified 2026-03-26)
- Expected sub-song total: ~87,074 (per README run logs)
- Expected SQLite rows: ≥ 60,572 (one per SID; multi-song SIDs counted per-SID)
- Vector dimensions: 24 (per README classification vector reference)
- Schema version: `sidcorr-1`
- Feature schema version: `1.3.0`

### Progress
- 2026-03-26T07:30Z: Pre-run audit complete. All findings documented above.
- 2026-03-26T07:30Z: Confirmed HVSC 60,572 SIDs, 1,089 partial features, 0 auto-tags from auto-classification, empty exports dir.
- 2026-03-26T07:45Z: Build completed (bun run build) — 0 TypeScript errors. Wasm upstream check warning (expected, not blocking).
- 2026-03-26T07:54Z: First classification attempt started — processes entered Tl (stopped) state when terminal was backgrounded. WAV count stuck at 1,133.
- 2026-03-26T08:07Z: Second attempt using `setsid` — PID 45977 (bun classify CLI), PID 45743 (next-server), 20 threads running. Processes in Rl/Sl state (not stopped). A duplicate nohup invocation attempted at 08:10 but was blocked with HTTP 500 "already running" (lock protection working).
- 2026-03-26T08:07Z-08:25Z: Classification actively progressing. Rate ~530-560 songs/min. Features at 08:25: ~7,900+ classified. ETA ~10:50 UTC (2.5 hours from start).
- 2026-03-26T08:25Z: Original bash wrapper exited (after nohup duplicate confused the log). Created `tmp/post-classify-export.sh` — setsid-detached monitor (PID 776421, Ss state, no controlling terminal) waiting for PID 45977 to exit, then auto-triggers `bun run export:similarity -- --profile full --corpus-version hvsc`.
- DISCOVERY: "272525 previously classified songs" message in run log is misleading — `count_classified_rows()` counts ALL lines in `classification_*.jsonl` event log files, not unique songs. Cosmetic bug, no functional impact.

### Decision Log
- 2026-03-26: Run with `--mode local` (no `--full-rerun`) — functionally identical to full re-run since no auto-tags exist; preserves 1,113 WAV files as minor render cache.
- 2026-03-26: Interactive SID station not automatable; replaced with programmatic similarity profile validation using the play CLI.
- 2026-03-26: Keep existing uncommitted `.sidflow.json` change (sidplayfp-cli first) — intentional optimization confirmed by partial run (1,089 songs successfully rendered at ~44 songs/s).
- 2026-03-26: Export script will delete WAVs after classification (`DELETE_WAV_AFTER_CLASSIFICATION=true` default) — acceptable since export SQLite is the durable artifact.

### Outcomes
- Pending.
