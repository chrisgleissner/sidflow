# PLANS.md

## Objective

## 2026-03-23 Main branch convergence

### Goal

Bring `main` back to a stable, merge-ready state by identifying the regression introduced after `c392f08`, fixing the root cause, validating locally, and confirming GitHub Actions returns to all-green on `main`.

### Checklist

- [x] Inspect recent `main` CI runs and identify the first failing commit window
- [x] Verify current branch/head state and recent commit history
- [ ] Extract failed unit-test-with-coverage logs from GitHub Actions
- [ ] Reproduce the failure locally
- [ ] Implement the minimal root-cause fix
- [ ] Run required local validation
- [ ] Commit and push to `main`
- [ ] Confirm GitHub Actions is green on `main`

### Progress

- 2026-03-23: Confirmed `main` is clean locally and currently at `9854cc2`.
- 2026-03-23: GitHub Actions `Continuous Integration` is failing on the latest five `main` pushes (`e6ea3b4` through `9854cc2`), while `c392f08` was green.
- 2026-03-23: The failure pattern is consistent across that entire window: `Build and test / Build and Test` fails specifically at the `Run unit tests with coverage` step; build and package verification are green.
- 2026-03-23: Reproduced the similarity-export truncation from captured local artifacts in `tmp/runtime/similarity-export/`. The classify response body included `Classification failed: Out of memory`, but the API still returned `success: true` and the progress store synthesized a completed snapshot after only 1,175 of 87,074 songs.
- 2026-03-23: Root cause split into two regressions: classify tagging oversubscribed memory with `2N` outer tasks on top of `N` render and `N` feature workers, and the classify route plus `run-similarity-export.sh` trusted HTTP 200/exit code 0 even when logs and counters proved the run was partial.
- 2026-03-23: Verified the OOM/reporting fix with a bounded maintenance-script run: `bash scripts/run-similarity-export.sh --mode local --full-rerun true --max-songs 1500` completed classification and export successfully with `Tracks: 1500`.
- 2026-03-23: Identified a separate `full-rerun` data-retention bug: the script cleared audio cache and export outputs but left prior `data/classified/classification_*.jsonl` and `features_*.jsonl` files in place, causing export to merge stale history and report `Tracks: 8298` after a fresh 1,500-song classify. Updated the script to delete prior classified JSONL artifacts on full reruns before starting classification.

## 2026-03-23 PR convergence

### Goal

Bring PR #86 to merge-ready by addressing remaining review feedback, validating the branch locally, and ensuring CI reaches all-green status.

### Checklist

- [x] Inspect PR review threads and branch CI status
- [x] Verify active README review comments against current content
- [x] Apply minimal doc fixes for valid comments
- [ ] Run required local validation for the branch state
- [ ] Respond to each review thread with technical resolution notes
- [ ] Resolve all review threads
- [ ] Confirm all PR checks are green

### Progress

- 2026-03-23: Identified two active README review comments with valid documentation fixes and one outdated PLANS comment that needs a resolution note rather than a code change.
- 2026-03-23: Full test gate exposed a real regression in `packages/sidflow-classify/test/metrics.test.ts`. Root causes were `generateAutoTags` reporting `totalFiles` as SID-file count instead of per-song total, and the metrics test seeding fake cached WAVs without the now-required WASM render/trace sidecars, which forced unintended rerenders against invalid short SID fixtures.
- 2026-03-23: Fixed `generateAutoTags` metrics accounting and updated the metrics test to seed cache artifacts that satisfy the single-pass WASM trace contract. Targeted `bun test packages/sidflow-classify/test/metrics.test.ts` now passes.
- 2026-03-23: Verified SID fixture structure against `doc/c64/sid-spec.md`, `doc/c64/sid-file-structure.md`, and the real `test-data/C64Music/MUSICIANS/N/Ninja/Ta-Boo.sid` binary. Confirmed that valid PSID fixtures on this branch must respect `dataOffset`, embedded load address rules when header `loadAddress=0`, and real init/play entry-point bytes.
- 2026-03-23: Proved the branch's end-to-end classification and station behavior with targeted E2E tests. `bun test packages/sidflow-classify/test/fast-e2e.test.ts packages/sidflow-play/test/station-similarity-e2e.test.ts` passed with `5 pass / 0 fail`. The station proof classifies 200 synthetic tracks, exports SQLite, simulates CLI playback ratings, and verifies the rebuilt 20-song station stays entirely inside the liked cluster.
- 2026-03-23: Read `doc/c64/sid-spec.md`, `doc/c64/sid-file-structure.md`, and `doc/c64/assembly-spec.md`, then analyzed `test-data/C64Music/MUSICIANS/N/Ninja/Ta-Boo.sid`. Verified it is a compact PSID v2 file with `dataOffset = 0x7c`, one song, external metadata strings, and a short 6502 payload with distinct init/play entry points. Updated test fixtures to use valid PSID structure plus real payload bytes instead of arbitrary short strings.
- 2026-03-23: The next full-suite blocker was not a test assertion but the coverage batch runner reading `coverage/lcov.info` too early. Added an explicit wait-for-artifact step, and a direct end-to-end `node scripts/run-unit-coverage-batches.mjs` run now completes successfully and writes merged coverage.

Design, implement, benchmark, and validate a single-pass SID classification pipeline in which one LibSidPlayFP execution produces both the WAV artifact and a deterministic sidecar for SID-native feature extraction, with no second playback pass required on the optimized path, and with classification plus SQLite export integrity preserved.

## Branch-vs-main findings

### Merge base

- `be58e55c9b91b29308b7a33c299b76c1d8eb91bf`

### Relevant changed-file categories on this branch

- WASM trace capture and runtime plumbing:
  - `packages/libsidplayfp-wasm/src/bindings/bindings.cpp`
  - `packages/libsidplayfp-wasm/src/player.ts`
  - `packages/libsidplayfp-wasm/src/index.ts`
  - focused tests under `packages/libsidplayfp-wasm/test/`
- Classify/render pipeline and hybrid merge:
  - `packages/sidflow-classify/src/render/wav-renderer.ts`
  - `packages/sidflow-classify/src/index.ts`
  - `packages/sidflow-classify/src/feature-extraction-worker.ts`
  - `packages/sidflow-classify/src/sid-register-trace.ts`
  - `packages/sidflow-classify/src/sid-native-features.ts`
  - `packages/sidflow-classify/src/deterministic-ratings.ts`
  - classify tests under `packages/sidflow-classify/test/`
- Export/schema surfaces:
  - `packages/sidflow-common/src/jsonl-schema.ts`
  - `packages/sidflow-common/src/similarity-export.ts`
  - `packages/sidflow-common/src/lancedb-builder.ts`
  - export/recommender tests under `packages/sidflow-common/test/`
- Docs and prior design notes:
  - `README.md`
  - `doc/technical-reference.md`
  - `doc/research/sid-classification-enhancement-report.md`

### Already implemented on this branch

- SID register-write tracing exists in the WASM player and can be enabled before WAV rendering.
- WAV rendering already supports sidecar trace capture in the same playback pass via `.trace.json`.
- SID-native feature extraction already prefers the trace sidecar when present.
- Hybrid merge is already WAV-first for key collisions.
- SQLite export already serializes merged features and 24D vectors.

### Partially implemented / still conflicting with target state

- The code path is now single-pass by default, but the final repo-wide validation gate is still open.
- README coverage now includes the exported vector layout and a JSON sample, but the deeper technical-reference refresh is still pending.
- The new 200-song end-to-end proof is CI-safe and local-fixture-backed, but it still needs to be carried through the final full-suite gate.

### Dead code / temporary behavior to remove or isolate

- The slow-path re-render in `packages/sidflow-classify/src/sid-native-features.ts` is now a compatibility fallback that conflicts with the optimized architecture and should be removed from the default path.

### Code/doc conflicts

- Current docs describe the hybrid feature system but do not document the single-pass cache contract or trace-sidecar validity rules.
- The old active `PLANS.md` and `WORKLOG.md` tracked unrelated work and were not authoritative for this task.

## Current architecture summary

- Render phase: `renderWavWithEngine(...)` renders the WAV and captures raw SID register writes in the same engine run on the default WASM path.
- Sidecars today:
  - `.sha256` for WAV content hash
  - `.render.json` for render settings
  - `.trace.jsonl` for SID write traces
- Extraction phase:
  - WAV features come from the WAV artifact.
  - SID-native features come from `.trace.jsonl` and fail deterministically when the required sidecar is missing.
  - Worker and main-thread paths enforce the same trace-sidecar contract.
- Merge phase:
  - WAV-derived keys win on collisions.
  - SID-derived fields use the `sid*` namespace and feed explicit hybrid-vector fusion logic.
- Export phase:
  - SQLite stores merged `features_json`, schema version `1.3.0`, and the final vector.

## Target architecture

- A rendered WAV is only considered valid for classification if its render sidecar declares trace capture and the trace sidecar is present and parseable.
- No default code path performs a second LibSidPlayFP execution to backfill missing traces.
- Cache validation upgrades or invalidates stale WAV artifacts that predate trace sidecars.
- Trace sidecar serialization is deterministic and versioned enough to support repeatable output and validation.
- SID-enriched classification must not stop at raw register writes; the pipeline must deterministically transform those traces into higher-level musical signals used downstream for similarity and playlisting, such as arpeggio activity, rhythmic regularity, waveform mix, filter motion, register motion, and related SID-native features.

## Risks

- Invalidating stale caches can increase benchmark cold-start time; this is acceptable if it eliminates the second pass and preserves correctness.
- Trace artifacts may materially increase I/O; benchmark data will determine whether compaction or serialization changes are justified.
- Removing the fallback path can expose previously hidden stale cache issues; tests and cache-upgrade logic must cover this.
- Full-suite test expectations in this repo are strict; final completion requires three consecutive clean `bun run test` runs.

## Phases

### Phase 1 — Audit and planning

- [x] Inspect git status and branch state
- [x] Compare branch against `main`
- [x] Identify relevant changed files
- [x] Read current plans, worklog, docs, and core code paths
- [x] Replace `PLANS.md` with this task-specific plan
- [x] Reset `WORKLOG.md` for this task

### Phase 2 — Single-pass contract implementation

- [x] Add explicit render-sidecar metadata describing trace capture and trace schema/version
- [x] Make cache validation reject or rebuild WAV artifacts that lack valid trace sidecars for hybrid classification
- [x] Remove the default second-render fallback from SID-native extraction
- [x] Align worker and main-thread behavior so missing/corrupt sidecars are handled consistently and deterministically
- [x] Ensure trace sidecar writing uses deterministic serialization
- [x] Ensure the SID-native extraction stage converts raw SID register traces into stable, higher-level musical signals that are suitable for export and similarity decisions

### Phase 3 — Regression coverage

- [x] Add tests for stale cache invalidation and trace-sidecar contract enforcement
- [x] Add tests for deterministic trace-sidecar serialization/metadata
- [x] Add or extend export validation tests if schema-sensitive behavior changes

### Phase 4 — Validation and benchmarking

- [x] Run focused build and tests for touched packages
- [x] Establish a 200-song baseline on the pre-optimization behavior if still reproducible in-repo
- [x] Run 200-song benchmark on the optimized path
- [x] Inspect artifact sizes, timing, and any dominant bottleneck
- [ ] If a justified bottleneck remains, implement one focused optimization and rerun the 200-song benchmark

### Benchmark execution contract

- Never block indefinitely on a benchmark process.
- Every 200-song run must be monitored at 30-second intervals.
- Every 200-song run has a hard wall-clock timeout of 10 minutes.
- Progress checks must record, at minimum:
  - completed songs or JSONL records
  - output/log file growth
  - latest log activity timestamp
- If no progress is observed for 2 consecutive 30-second checks, treat the run as stalled, terminate it, and continue.
- Partial benchmark results are valid and must be recorded rather than discarded.
- When a run terminates early, compute per-song time from the completed subset and extrapolate only as an explicitly labeled estimate.
- After any benchmark outcome (complete, partial, or terminated), continue immediately to the next benchmark, analysis, or optimization step.

### Phase 5 — Correctness and export integrity

- [x] Diff representative classification outputs old vs new where feasible
- [x] Spot-check representative songs for WAV and SID-native fields
- [x] Build/validate SQLite export and confirm feature/vector/schema integrity
- [x] Add a 200-song end-to-end station proof that classifies locally, exports SQLite, simulates ratings, and validates a 20-song similar-only rebuilt queue
- [ ] Update technical docs to describe the final architecture and operational expectations

### Phase 6 — Final gate

- [ ] `bun run build`
- [ ] `bun run test` three consecutive times with `0 fail`
- [ ] Mark plan complete with benchmark and validation evidence

## Concrete implementation tasks

1. Extend `WavRenderSettingsSidecar` so cache metadata records whether trace capture is required/present and which trace sidecar schema/version applies.
2. Update `renderWavWithEngine(...)` to write deterministic trace sidecars and pair them with render metadata.
3. Update cache validation in classify orchestration so stale WAVs without trace sidecars are invalidated instead of silently reused.
4. Replace the main-thread slow fallback render in `defaultSidWriteTraceProvider(...)` with deterministic failure semantics that force rerender through the normal render pipeline.
5. Keep worker extraction behavior consistent with the new contract.
6. Verify that the SID-native feature extractor turns low-level register writes into the intended high-level musical signals (for example arpeggio activity, waveform ratios, filter motion, rhythmic regularity, and voice-role summaries) and preserves those signals through JSONL and SQLite export.
7. Add regression tests for stale WAVs, missing sidecars, deterministic trace-sidecar behavior, and export/playlist behavior that depends on the derived high-level SID signals.
8. Run focused validation, then benchmarks, then export-integrity checks.

## Validation gates

- Single-pass gate:
  - No default classify path triggers a second `renderSeconds(...)` or full rerender to obtain SID traces.
- Classification gate:
  - SID-native fields still populate on fresh renders.
  - WAV-derived features still populate and retain precedence.
  - Stale caches are rebuilt or rejected deterministically.
  - Derived high-level SID-native signals from trace data remain available in JSONL outputs and downstream exports.
- Export gate:
  - SQLite export retains `sidcorr-1` schema integrity.
  - `feature_schema_version` remains consistent.
  - `features_json` and vector dimensions remain coherent.
  - Exported `features_json` preserves the derived high-level SID-native signals needed for recommendation quality.
- Performance gate:
  - 200-song optimized benchmark shows measurable improvement versus the current two-pass-or-fallback behavior or, if baseline reproduction is impossible, versus a forced fallback compatibility run.
- Test gate:
  - `bun run build` passes.
  - `bun run test` passes three consecutive times.

## Termination criteria

- Branch-vs-main diff is documented in this plan and the worklog.
- `WORKLOG.md` contains timestamped commands, findings, implementation notes, benchmarks, and validation outcomes.
- The optimized path requires a single playback pass to produce both WAV and trace sidecar.
- The default pipeline no longer depends on a second LibSidPlayFP run for trace capture.
- 200-song benchmark evidence is recorded.
- Classification correctness and SQLite export integrity are validated.
- Docs, tests, and code reflect the final architecture.

## Deferred items

- Additional trace compaction or binary sidecar work beyond the current schema is deferred unless benchmarks show `.trace.jsonl` write/parse overhead is still a material bottleneck after removing second-pass behavior.

## Backlog

### Constant SID-native classification features

**Status**: Not started
**Filed**: 2026-03-23

Many SID-derived classification features are initialized to constant or near-constant values across the entire corpus, producing no discriminatory signal for similarity or recommendation. Analysis of 500 records from `data/classified/features_2026-03-23_18-13-03-454.jsonl` shows:

**Always zero (8 features — completely useless for classification):**
- `sidArpeggioActivity` = 0
- `sidFilterMotion` = 0
- `sidPwmActivity` = 0
- `sidRegisterMotion` = 0
- `sidRhythmicRegularity` = 0
- `sidSamplePlaybackActivity` = 0
- `sidSyncopation` = 0
- (also `sidFeatureVariant` = "sid-native", but this is a label, not a signal)

**Severely quantized (only 2–5 distinct values, all simple fractions like 0, 1/3, 1/2, 2/3, 1):**
- `sidActiveVoiceFrameRatio`, `sidAdsrPadRatio`, `sidAdsrPluckRatio`
- `sidGateOnsetDensity` (only 5 values: 0, 1/15, 2/15, 1/5, 1/3)
- `sidRoleAccompanimentRatio`, `sidRoleBassRatio`, `sidRoleLeadRatio`
- `sidWaveMixedRatio`, `sidWaveNoiseRatio`
- `sidTraceFrameCount` (only 750 or 900 = PAL/NTSC)

**Healthy variance (genuine signal):**
- `sidBytes`, `sidFilterCutoffMean`, `sidFilterResonanceMean`, `sidTraceEventCount`, `sidVolumeMean`
- `sidMelodicClarity`, `sidVoiceRoleEntropy`
- `sidWavePulseRatio`, `sidWaveSawRatio`, `sidWaveTriangleRatio`

**Root cause hypothesis**: The SID-native feature extractor (`sid-native-features.ts`) computes many features from per-frame or per-voice summaries that collapse temporal information into binary or ternary buckets. For example, waveform ratios are likely computed as "fraction of voices using waveform X" (yielding only 0, 1/3, 2/3, 1 for a 3-voice SID), and temporal features like arpeggio activity, filter motion, syncopation, and rhythmic regularity appear to use thresholds or detection logic that never triggers on real trace data.

**Required fix**: Audit `sid-native-features.ts` and its trace-to-feature pipeline. Replace per-voice-only aggregation with per-frame temporal analysis where appropriate. Fix detection thresholds that produce constant zero. Ensure features truly extract SID register behavior instead of defaulting to hard-coded values.

---

## 2026-03-23 Performance investigation: classification throughput regression

### Problem statement

Classification throughput has regressed from ~9 songs/s to ~6.5 songs/s. CPU utilization oscillates between 50% and 10%, averaging ~30% on a 20-core machine. The pipeline should fully utilize available cores during the tagging phase.

### Environment

- 20 logical CPUs, Linux 6.17.0-19-generic, Bun 1.3.10
- 61,275 SID files in HVSC collection
- Config: introSkipSec=15, maxClassifySec=15, maxRenderSec=30, WASM engine, threads=0 (auto)

### Reproduction

```bash
bash scripts/run-similarity-export.sh --mode local --full-rerun true
```

### Phases

#### Phase 1 — Baseline reproduction
- [x] Run a small subset classification (~200–500 songs) to establish a reproducible baseline
- [x] Record throughput (songs/s), wall-clock time, CPU utilization
- [x] Capture timing breakdown per pipeline stage
- **Result**: 200 Hubbard_Rob songs, 4.87 songs/s, 41.1s wall-clock. render=94.5%, extract=5.5%.

#### Phase 2 — Profiling and attribution
- [x] Instrument the tagging loop to measure per-song render time, extraction time, I/O time
- [x] Identify where time is actually spent (render vs extract vs I/O vs serialization vs idle)
- [x] Measure worker pool utilization (idle time, queue depth)
- **Result**: WASM rendering dominated at 94.5% of measured time. Each render required full WebAssembly.compile() + instantiation, creating a serialised bottleneck across all 20 workers.

#### Phase 3 — Root-cause isolation
- [x] Identify the single largest bottleneck from profiling data
- [x] Determine whether the bottleneck is CPU-bound, I/O-bound, or concurrency-structural
- **Result**: CPU-bound WASM compilation. Each render worker independently compiled the same 392 KB WASM binary from scratch, wasting ~90% of render time on redundant compilation. Two unsafe optimisation attempts (Emscripten module caching → heap corruption; engine reuse → silent render failures) were rejected before arriving at the safe approach.

#### Phase 4 — Fix implementation
- [x] Implement a targeted fix for the identified bottleneck
- [x] Keep changes minimal and focused
- **Result**: Implemented `WebAssembly.Module` compilation caching via Emscripten's `instantiateWasm` hook in `engine-factory.ts`. Pre-compiles the WASM binary once to an immutable `WebAssembly.Module`, then each engine creation calls `WebAssembly.instantiate(compiledModule, imports)` to get a fresh `WebAssembly.Instance` with its own linear memory. Zero shared mutable state.

#### Phase 5 — Verification
- [x] Re-run the same baseline measurement
- [x] Confirm improvement with evidence
- **Result**: 200 songs in 29.1s, **6.88 songs/s (+41% improvement)**. Pipeline now balanced: render=49.4%, extract=49.3%. Zero WASM errors, zero audio failures across all 200 songs. All 10 engine-factory tests pass.

#### Phase 6 — Finalisation
- [x] Record all evidence in WORKLOG.md
- [x] Update any relevant docs
- [x] Remove temporary profiling instrumentation from index.ts

### Key observations from code review

- `generateAutoTags()` metadata phase is **serial**: processes all SID files sequentially before any parallel tagging begins
- `taggingConcurrency = baseConcurrency * 2 = 40` outer tasks compete for 20 render workers + 20 extraction workers
- `intermediateFlushChain` serializes JSONL writes in deterministic order
- `deleteWavAfterClassification=true` + `forceRebuild=true` means every song needs full render+extract+delete cycle
- `needsWavRefresh()` does multiple file stat/read operations per song
- `updateDirectoryPlaylist()` called for every song during tagging
