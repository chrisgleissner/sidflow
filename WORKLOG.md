# WORKLOG.md - SID Classification Pipeline Recovery

## 2026-03-27T19:05Z — Phase 17 discovery: authoritative CLI contract and remaining acceptance gaps

### Commands and entrypoints confirmed
1. The README defines the authoritative full-corpus workflow as `bash scripts/run-similarity-export.sh --mode local --full-rerun true`.
2. `scripts/run-similarity-export.sh` is the real operator wrapper. In local mode it boots the local web/server runtime, triggers `/api/classify`, waits for progress completion, then runs the similarity export builder.
3. The actual classification CLI is `scripts/sidflow-classify`, which calls `packages/sidflow-classify/src/cli.ts`; the core orchestration lives in `packages/sidflow-classify/src/index.ts`.
4. The export stage is `sidflow-play export-similarity`, implemented by `packages/sidflow-play/src/similarity-export-cli.ts` and the shared export builder in `@sidflow/common`.
5. The station CLI wrapper is `./scripts/sid-station.sh`, which delegates to `scripts/sidflow-play station`; the station runtime lives under `packages/sidflow-play/src/station/`.

### Classification success contract confirmed from code
1. A successful classification item is subtune-level, not file-level, when a SID contains multiple songs. `collectSidMetadataAndSongCount()` in `packages/sidflow-classify/src/index.ts` computes `totalSongs`, and `generateAutoTags()` enqueues one job per subtune. This explains why README can cite about 60,572 SID files while progress totals can report about 87,074 classification items.
2. A strict successful item currently requires:
   - rendered WAV cache output (or a validated cache hit)
   - WAV render settings sidecar
   - SID trace sidecar when using the strict hybrid classify path
   - merged WAV plus SID-native feature vector
   - final classification record persisted to JSONL and auto-tags output
3. SID trace sidecars are written and read in `packages/sidflow-classify/src/render/wav-renderer.ts` as `*.trace.jsonl` next to the WAV.
4. SID-native features are extracted through `packages/sidflow-classify/src/sid-native-features.ts`; the strict path is `createStrictHybridFeatureExtractor()`, which requires both WAV-derived and SID-native extraction to succeed.
5. Final classification persistence happens in the deferred second pass inside `generateAutoTags()` in `packages/sidflow-classify/src/index.ts`, which writes JSONL records and auto-tags files.

### Fatal defect classes confirmed
1. Exhausted render attempts are fatal inside `renderSongWithFallbacks()` in `packages/sidflow-classify/src/index.ts`; the call now throws an `AggregateError` instead of generating metadata-only placeholder output.
2. Missing or invalid SID trace sidecars are fatal through `defaultSidWriteTraceProvider()` in `packages/sidflow-classify/src/sid-native-features.ts` when the strict hybrid path is used.
3. Feature extraction failures are fatal in `generateAutoTags()` and `packages/sidflow-classify/src/feature-extraction-worker.ts`; the worker now uses `Promise.all()` instead of a degrade-open merge.
4. The renderer pool no longer has a parent-side per-job timeout in `packages/sidflow-classify/src/render/wasm-render-pool.ts`; cooperative render bounds in the renderer own timeout/truncation so trace sidecars can flush completely.

### Remaining acceptance gaps before completion
1. `scripts/run-similarity-export.sh` still needs end-to-end proof that it exits non-zero on the first real classification defect through the web/API wrapper path, not just the lower-level classify CLI.
2. Full-corpus evidence does not yet exist for zero timeout failures, zero trace-sidecar failures, and zero incomplete classifications across the entire HVSC run.
3. Persona station validation has helper code in-tree, but it still needs to be executed sequentially against the final export and recorded as proof.

## 2026-03-27T18:35Z — Fail-fast restoration for render/trace correctness

### User-reported defect
1. The current full run was producing normal-looking classification progress while silently degrading regular HVSC songs such as `Fate_II.sid`, `Competition_Entries.sid`, `Garfield.sid`, and `Hardcastle.sid`.
2. The visible symptom was repeated `Render attempt ... timed out after 6800ms/7700ms` messages followed by `SID-native feature extraction unavailable ... Missing or invalid SID trace sidecar ... continuing with WAV-only features`.
3. That behavior violated the stricter acceptance contract: if render attempts exhaust or the SID trace sidecar is missing/invalid, the run must fail immediately instead of emitting partial classification records.

### Root cause
1. `packages/sidflow-classify/src/index.ts` still converted exhausted render attempts into metadata-only placeholder WAVs and metadata-only feature vectors, so the run could continue after an actual render failure.
2. `packages/sidflow-classify/src/sid-native-features.ts` and `packages/sidflow-classify/src/feature-extraction-worker.ts` still had hybrid merge paths that treated SID-native extraction failure as non-fatal and silently emitted WAV-only features.
3. `packages/sidflow-classify/src/render/wasm-render-pool.ts` still had a second parent-side timeout layer. It could kill a worker before `renderWavWithEngine()` had finished flushing the trace sidecar footer, which directly explains the subsequent `Missing or invalid SID trace sidecar` errors.
4. The internal wall-clock heuristic in `computeRenderWallTimeBudgetMs()` had been driven down to an unrealistic 4-18s range, which was far too aggressive for ordinary multi-song Baldwin_Neil files.

### Code changes
1. `packages/sidflow-classify/src/index.ts`
   - Removed metadata-only placeholder WAV creation and metadata-only feature fallback from the classification path.
   - `renderSongWithFallbacks()` now throws once all ordered render attempts are exhausted.
   - `generateAutoTags()` now throws on feature extraction failure instead of emitting `feature_extraction_fallback`.
   - Default classify flows now use a strict WAV+SID merge path, so SID-native extraction failure is fatal.
   - Raised the internal cooperative wall-clock budget heuristic to a playback-scaled 15-60s window.
2. `packages/sidflow-classify/src/sid-native-features.ts`
   - Added `createStrictHybridFeatureExtractor()` for classification paths that require both WAV-derived and SID-native features to succeed.
3. `packages/sidflow-classify/src/feature-extraction-worker.ts`
   - Switched worker-thread extraction from `Promise.allSettled()` degrade-open behavior to `Promise.all()` fail-fast behavior.
4. `packages/sidflow-classify/src/render/wasm-render-pool.ts`
   - Removed the parent-side per-job timeout guard so the renderer's own cooperative bound owns truncation and trace flushing.
5. Tests
   - Updated `packages/sidflow-classify/test/render-timeout.test.ts` to require fail-fast behavior on render or extraction failure.
   - Extended `packages/sidflow-classify/test/sid-native-features.test.ts` with a strict-hybrid missing-trace regression.

### Validation
1. `bun run build:quick` — PASS
2. `bun test packages/sidflow-classify/test/render-timeout.test.ts packages/sidflow-classify/test/sid-native-features.test.ts packages/sidflow-classify/test/multi-sid-classification.test.ts` — PASS (`18 pass`, `0 fail`)
3. Real HVSC Baldwin_Neil repro under clean temp configs — PASS
   - Command family: `bash scripts/sidflow-classify --config <temp-config> --force-rebuild --sid-path-prefix <exact-target>`
   - Targets:
     - `C64Music/MUSICIANS/B/Baldwin_Neil/Fate_II.sid`
     - `C64Music/MUSICIANS/B/Baldwin_Neil/Competition_Entries.sid`
     - `C64Music/MUSICIANS/B/Baldwin_Neil/Garfield.sid`
     - `C64Music/MUSICIANS/B/Baldwin_Neil/Hardcastle.sid`
   - Results:
     - no `timed out`, `render_failed`, `feature_extraction_failed`, or missing-trace log lines
     - every rendered WAV had a `.trace.jsonl` sidecar
     - every emitted classification record had `features.sidFeatureVariant="sid-native"`
     - no output record was marked degraded for these repro songs

### Operational note
1. The in-flight full `run-similarity-export.sh` session that had started before this contract change was no longer valid evidence and was stopped through `bash scripts/stop-similarity-export.sh`.

## 2026-03-27T10:30Z — Phase 15 takeover: audit and next validation gates

### Tree state at handoff
1. The repo is already mid-recovery, with local modifications in `PLANS.md`, `packages/sidflow-classify/src/index.ts`, `packages/sidflow-classify/src/render/wasm-render-pool.ts`, `packages/sidflow-classify/src/render/wasm-render-worker.ts`, `packages/sidflow-classify/test/multi-sid-classification.test.ts`, and the new `packages/sidflow-classify/test/super-mario-stress.test.ts`.
2. Phase 15 implementation work appears largely present: bounded render attempts, metadata-only fallback, pooled workers, lifecycle telemetry, and the CI-safe Mario/fixture stress harness are all in-tree.
3. There is a second wave of dirty-tree follow-up logic that has not yet been revalidated in this session:
   - `runConcurrent()` now prevents concurrent processing of two songs from the same SID.
   - `WasmRendererPool` now arms a per-job timeout guard and replaces timed-out workers.
   - `wasm-render-worker.ts` now null-guards engine disposal after failed initialization.

### Immediate findings from code audit
1. The `runConcurrent()` SID-group serialization is aligned with the requirement that one worker processes exactly one SID at a time, but it needs targeted validation against throughput and deadlock risk.
2. The new pool-level timeout guard reintroduces worker termination as a last-resort control path. That may be necessary for Bun/WASM hangs, but it must be proven not to recreate the old skip/churn behavior during fallback retries.
3. The worker dispose hardening is correct on its face and should remove one obvious crash path when `createEngine()` throws before the `finally` block.

### Next actions
1. Re-run targeted build/tests on the current tree.
2. If green, run the Mario stress harness plus focused multi-SID tests against the current pool/index changes.
3. If still green, move to a bounded `run-similarity-export.sh` subset run with telemetry capture before attempting the full multi-hour validation.

## 2026-03-27T16:45Z — Phase 15: timeout replacement fix and wrapper repro validation

### Root cause refined
1. The old 8,200-song wrapper repro did not just hit a slow Mario render. The pool could reject a timed-out job immediately, but worker replacement still depended on Bun emitting the worker `exit` event.
2. When a hung WASM worker timed out without delivering a clean `exit`, the pool entry stayed `exiting=true` forever. That slowly drained the pool to zero usable workers, so the next fallback attempt for the same song would queue and wait indefinitely.
3. A second logic bug amplified the tail latency: `isRecoverableError()` treated `Render attempt timed out after ...` as recoverable, so `withRetry("building", ...)` retried the same render profile multiple times before advancing the ordered fallback ladder.

### Code changes
1. `packages/sidflow-classify/src/render/wasm-render-pool.ts`
   - Restored `DEFAULT_MAX_JOBS_PER_WORKER` to `32`.
   - Added forced replacement after timeout/error-driven `worker.terminate()` so replacement no longer depends solely on Bun’s `exit` event.
2. `packages/sidflow-classify/src/types/state-machine.ts`
   - Marked `Render attempt timed out after ...` and related timeout strings as non-recoverable so a render profile fails once and the fallback ladder advances immediately.
3. `packages/sidflow-classify/test/render-timeout.test.ts`
   - Added regression coverage for the tightened timeout classification and for pool replacement continuing to serve follow-up renders.
4. `scripts/stop-similarity-export.sh`
   - Added a repo-native stop helper for local similarity-export runs so service teardown follows repo maintenance-script rules.

### Validation
1. `bun run build:quick` — PASS
2. `bun test packages/sidflow-classify/test/render-timeout.test.ts packages/sidflow-classify/test/multi-sid-classification.test.ts` — PASS (`10 pass`, `0 fail`)
3. `bash scripts/run-similarity-export.sh --mode local --full-rerun true --threads 4 --max-songs 200` — PASS
   - Wrapper classification: 200/200
   - Export: PASS
   - Telemetry summary:
     - `renderProfiles={"full": 200}`
     - `peakRssMb=1110`
     - `metadataOnlyCount=0`
4. `bash scripts/run-similarity-export.sh --mode local --full-rerun true --threads 4 --max-songs 8200` — historical repro crossed and classify phase completed
   - Previous stale run froze at `8163/8200` on `Super_Mario_Bros_64_2SID.sid [1]`
   - New run reached `run_complete` with:
     - `classifiedFiles=8200`
     - `renderedFiles=8200`
     - `extractedFiles=8200`
     - `metadataOnlyCount=37`
     - `renderedFallbackCount=38`
     - `peakRssMb=3834`
     - `durationMs=989458`
   - Event-stream summary at classify completion:
     - `profiles={"full": 8163, "metadata-only": 37}`
     - `skippedFiles=0`
     - `fatal errors=0` at the classification API level

### Behavioral evidence from the 8,200-song repro
1. The run no longer deadlocked at the Mario boundary. It progressed from `8117/8200` to `8200/8200` while processing Mario songs sequentially.
2. Mario songs now degrade instead of wedging the queue:
   - earlier Mario songs hit `full` / `reduced-duration` / `low-sample-rate` timeouts and sometimes `minimal-snippet` WASM aborts
   - the pipeline then produced metadata-only placeholder WAVs and continued with WAV-only feature extraction
3. Peak RSS rose during the fallback-heavy Mario tail but stayed under the 4 GB target during the 8,200-song classify phase.

### Remaining gap
1. The full `bash scripts/run-similarity-export.sh --mode local --full-rerun true` acceptance run for all 60,582 target songs has not been completed yet in this session.
2. The five-persona downstream station proof still needs to be re-run against the final full-corpus output.

## 2026-03-27T17:25Z — Full-corpus run launched, persona CLI validator prepared

### Full wrapper run status
1. Launched `bash scripts/run-similarity-export.sh --mode local --full-rerun true --threads 4`.
2. Early checkpoint:
   - progress API: `processedFiles=5525`, `totalFiles=87074`, `skippedFiles=0`, `phase=tagging`
   - live worker state shows all 4 threads active with no stale workers
   - telemetry snapshot from `data/classified/classification_2026-03-27_17-20-12-961.events.jsonl` at that point:
     - `song_start=5536`
     - `render_complete=5534`
     - `feature_extraction_complete=5532`
     - `features_persisted=5524`
     - `peakRssMb=1824`

### Persona radio validation preparation
1. Added `scripts/validate-persona-radio.ts`.
2. The script is designed to run against the real exported SQLite bundle and the real station CLI/runtime:
   - choose 5 distinct personas from disjoint rating/taste buckets in the export DB
   - pick 10 seed songs per persona
   - persist those 10 ratings into the station-selection state used by the CLI
   - run `runStationCli()` five times with `playback=none`
   - rebuild each station queue and reject any cross-persona contamination or shared station tracks
3. `bun run build:quick` passed after adding the script.

## 2026-03-27T00:15Z — Phase 15: Fallback and Worker-Pool Refactor

### Implemented changes
1. Replaced `packages/sidflow-classify/src/render/wasm-render-pool.ts` with a cooperative fixed-size pool: no timeout watchdog, no `timedOutSids` purge path, graceful recycle after 32 jobs, and lifecycle event emission for spawn/recycle/fault/job transitions.
2. Reworked `packages/sidflow-classify/src/render/wav-renderer.ts` so renders stop cooperatively on a bounded wall-time budget, traces stream to sidecars in batches, and PCM is written into one preallocated buffer instead of chunk accumulation.
3. Refactored `packages/sidflow-classify/src/index.ts` to route both cache-building and auto-tagging through a render fallback ladder: full render, reduced duration, low sample rate, minimal snippet, then metadata-only placeholder/classification. Songs no longer drop into `skipped` or `song_failed` solely because rendering failed.
4. Added metadata-only feature fallback in `generateAutoTags()` so feature extraction failures still yield a deterministic record, and added RSS/fallback counters to `GenerateAutoTagsMetrics` plus CLI summary output.
5. Bounded worker sizing with the physical-core heuristic in `system.ts`, `feature-extraction-pool.ts`, and the web `/api/classify` route; the classify API now accepts `threads` and writes it into the temporary config used by the full similarity-export path.

### Focused validation
- `bun run build` — PASS
- `bun test packages/sidflow-classify/test/render-timeout.test.ts packages/sidflow-classify/test/multi-sid-classification.test.ts packages/sidflow-classify/test/cli.test.ts` — PASS (`26 pass`, `0 fail`)

### Remaining validation work
1. Run targeted subset classifications with telemetry capture to confirm fallback counts and peak RSS under real render load.
2. Run the full `bash scripts/run-similarity-export.sh --mode local --full-rerun true` workflow and verify 100% coverage, zero fatal classification failures, and acceptable memory/throughput.

## 2026-03-26T14:30Z — Phase 15: Stability Recovery Investigation

### Current findings
1. The render pool still contains a hard timeout watchdog plus a permanent `timedOutSids` circuit breaker in `packages/sidflow-classify/src/render/wasm-render-pool.ts`. A single timeout causes queued and future jobs for the same SID to be rejected.
2. Both `buildAudioCache()` and `generateAutoTags()` still convert render failure into `skipped` / `song_failed` outcomes in `packages/sidflow-classify/src/index.ts`, which violates the required 100% coverage guarantee.
3. `renderWavWithEngine()` buffers the entire SID trace in memory (`pendingTraces`) before writing the sidecar. This is the strongest current hypothesis for the late-run RSS blow-up and worker instability.
4. The default concurrency heuristic still resolves to logical CPU count, not `min(physical_cores / 2, 6)`. The web classify route also does not honor a request-level thread override in its temp config.
5. Current lifecycle telemetry records heap MB only; it does not persist RSS, active worker count, worker recycle count, or fallback level.

### Immediate implementation plan
1. Replace whole-trace accumulation with bounded trace-sidecar streaming and reduce per-render PCM buffering.
2. Move render bounding into the worker render loop so long renders truncate cooperatively instead of being killed externally.
3. Remove timeout-driven SID purging/skipping and replace it with a fallback ladder ending in metadata-only classification.
4. Bound worker concurrency with a physical-core heuristic and recycle workers after a fixed number of jobs.
5. Extend telemetry/worklog output with RSS, worker lifecycle, fallback, and classification outcome summary metrics.

### Metrics targets for the next validation pass
- Peak RSS: < 4096 MB
- Default worker count: `min(physical_cores / 2, 6)`
- Worker recycle interval: 32 jobs
- Full-run skipped songs: 0
- Full-run failed songs: 0

## 2026-03-24T00:00Z — Phase 0: Branch Recovery

### Actions
- Created branch `fix/direct-sid-classification` at `e06e301` (8 commits after `c392f08`)
- Reset `main` to `c392f08`
- Switched to `fix/direct-sid-classification`

### Branch topology verified
```
main:     c392f08 feat: add system ROMs requirements and alternative locations to README
fix/...:  e06e301 feat: enable SID register-write trace capture during WAV rendering
          includes e6ea3b4..e06e301 (8 commits)
```

### Key architectural findings from code review
1. `runConcurrent()` (index.ts:236) uses work-stealing queue — each worker grabs next item atomically
2. **NO per-song timeout**: if WASM render hangs, the Promise never resolves, worker blocked forever
3. `WasmRendererPool` (wasm-render-pool.ts) has no per-job timeout either
4. Heartbeats are emitted but **nobody acts on stale detection** — purely for UI display
5. `Super_Mario_Bros_64_2SID.sid`: PSID v3, 1 song, 7054 bytes, uses 2 SID chips
6. 61,275 SID files in HVSC corpus
7. Retry logic exists (`withRetry`) but only for caught errors — infinite hang bypasses it entirely
8. No deduplication: multi-song SIDs produce one queue entry per sub-song

### Root cause hypothesis
The most likely failure mode is: WASM render of `Super_Mario_Bros_64_2SID.sid` either runs forever (infinite loop in emulation) or takes pathologically long, and because there is NO per-song timeout, the worker Promise never resolves. As workers complete their other songs and try to grab the next item, they drain the queue — but the stuck worker(s) never finish. Eventually all workers are idle-waiting-for-queue-empty via `Promise.all(runners)` while the stuck worker holds the last item(s). This manifests as 100% CPU on the stuck worker thread(s) with no forward progress.

---

## 2026-03-25T00:00Z — Phase 12: Per-Song Classification Lifecycle Logging

### Objective
Implement a highly detailed, low-overhead, per-song lifecycle logging system to provide
full observability into the classification pipeline and confirm/diagnose the previously
reported 70-75% slowdown.

### Files modified
- `packages/sidflow-classify/src/classification-telemetry.ts` — Added `SongLifecycleLogger` class with 11-stage model, stall watchdog, memory/CPU sampling, and deterministic JSONL output
- `packages/sidflow-classify/src/index.ts` — Instrumented all 11 stages in `generateAutoTags()`, added `lifecycleLogPath?` option to `GenerateAutoTagsOptions`, re-exported new types
- `.gitignore` — Added `logs/` exclusion for per-run lifecycle log files
- `PLANS.md` — Added Phase 12 checklist
- `doc/research/classification-logging-audit.md` — Created; documents log format, stage model, stall detection, and diagnostic queries

### Architecture decisions
- Two independent telemetry streams: existing `ClassificationTelemetryLogger` (pipeline events) + new `SongLifecycleLogger` (per-song stages); both preserved with no cross-dependency
- `SongLifecycleLogger` uses fire-and-forget write chaining (`writeChain`) to avoid blocking worker threads; `flush()` is called in the `finally` block to drain before process exit
- Stall watchdog: 30-second `setInterval` comparing active stage age against `10× median(durationMs)` for that stage; emits `stage_stall` events inline in the JSONL stream
- `cpuPercent` is process-wide (not per-worker) — intentional limitation; documented in Phase 12 Decision Log in PLANS.md
- `workerId: 0` for the deferred pass (main-thread serial loop) to distinguish from concurrent worker IDs (1-based)

### Stage model
```
QUEUED → STARTED → RENDERING → RENDERED → EXTRACTING → EXTRACTED
        → ANALYZING → ANALYZED → TAGGING → TAGGED → COMPLETED
```

### Outcome
- 11 stages fully instrumented in concurrent worker AND deferred pass
- 0 TypeScript errors on both modified files
- Existing `ClassificationTelemetryLogger` events (`wav_cache_hit`, `feature_extraction_complete`, `song_complete`, `run_complete`) remain unchanged
- Log defaults to `logs/classification-detailed.jsonl` (gitignored; configurable via `lifecycleLogPath`)

---

## 2026-03-26T00:00Z — Phase 14: SID Classification Defect Analysis

### Requested defect set
- Bug 0: enforce WASM as the classification default and require explicit opt-in for degraded `sidplayfp-cli`
- Bug 1: prevent missing SID trace sidecars from aborting feature extraction
- Bug 2: exclude `waveform: "none"` frames from active-frame accounting
- Bug 3: exclude unclassifiable `waveform: "none"` frames from waveform-ratio denominators

### Analysis findings
1. Classification renderer selection is currently implicit. Multiple paths in `packages/sidflow-classify/src/index.ts` derive the engine from `render.preferredEngines[0]` with a silent fallback to `"wasm"` only when the config key is absent.
2. The checked-in repo config currently keeps `render.preferredEngines` as `["wasm", "sidplayfp-cli", "ultimate64"]`, so the checked-in default is correct. The defect is that any local config can switch classification to `sidplayfp-cli` without an explicit degraded-mode opt-in or warning.
3. The standalone render CLI (`packages/sidflow-classify/src/render/cli.ts`) uses ordered engine fallback, but that path is separate from classification and is not the root cause of the classification defect.
4. Missing trace sidecars currently hard-fail the merged extraction path in two places:
        - `createHybridFeatureExtractor()` in `packages/sidflow-classify/src/sid-native-features.ts` uses `Promise.all`, so SID-native failure aborts otherwise-valid WAV extraction.
        - `handleExtract()` in `packages/sidflow-classify/src/feature-extraction-worker.ts` also uses `Promise.all`, so worker-pool extraction aborts when SID-native extraction cannot read a trace sidecar.
5. The SID-native active-frame bug is confirmed in `packages/sidflow-classify/src/sid-native-features.ts`: active frames are currently defined as `frame.gate || frame.frequencyWord > 0`, which admits silent `waveform: "none"` frames.
6. The waveform-ratio bug is confirmed in the same file: `computeWaveformRatios()` divides by all `voiceFrames.length`, including `waveform: "none"` frames that cannot contribute to any numerator bucket.

### Implementation direction
- Add a small explicit config opt-in for degraded classification mode and centralize classification renderer resolution.
- Keep SID-native extraction failures non-fatal by merging WAV features first and only adding SID-native keys when extraction succeeds.
- Use render settings sidecars to distinguish expected degraded mode from unexpected missing-trace cases so logging severity matches the actual pipeline mode.

### Correction after implementation review
1. The first renderer-gating change was too aggressive because it stopped honoring explicit `render.preferredEngines` selections during classification.
2. The corrected behavior is:
         - `render.preferredEngines[0]` remains the authoritative explicit engine choice.
         - If that explicit choice is non-WASM, classification emits a warning that SID trace sidecars and SID-native features will be unavailable and accuracy will be reduced.
         - If the explicit choice is WASM and WASM rendering fails, classification hard-fails by default.
         - Automatic fallback from failed WASM renders to `sidplayfp-cli` is only allowed when `render.allowDegradedSidplayfpCli=true` and `sidplayfp-cli` is present later in the preferred-engine list.
3. This preserves user intent while preventing silent degradation.

### Validation
- 2026-03-26: Focused classify validation passed.
        - Command: `bun test packages/sidflow-classify/test/index.test.ts packages/sidflow-classify/test/sid-native-features.test.ts`
        - Result: 28 pass, 0 fail
        - Coverage of new behavior:
                - explicit non-WASM warning during classification
                - hard break on failed WASM render without explicit fallback opt-in
                - explicit degraded fallback to `sidplayfp-cli`
                - graceful sidecar-missing degradation
                - silent-frame and waveform-ratio fixes

### Merge-readiness follow-up
1. Reproduced the failing CI Playwright lane locally with `BABEL_ENV=coverage E2E_COVERAGE=true npx playwright test --project=chromium`.
2. The shared failure mode was not missing UI; admin pages were receiving `{"error":"unauthorized","reason":"missing-token"}`.
3. Root cause: the admin session cookie was issued for `/admin` only, but middleware also required that same session for `/api/admin/*`, so admin page data fetches were unauthenticated.
4. Fix direction: expand the admin session cookie scope to `/` and keep Playwright's seeded admin session aligned with the same path.

## 2026-03-26T13:00Z — Classification E2E cache fixtures and five-profile station proof

### Root cause
1. The remaining classification Playwright failures were not caused by missing JSONL writes in the classifier.
2. Telemetry showed the synthetic web E2E fixtures were being re-rendered through the WASM path because the seeded cache entries only contained `.wav` files.
3. Current `needsWavRefresh()` semantics require cache-complete fixtures for reuse under WASM classification: the WAV, SID hash sidecar, render-settings sidecar, and trace sidecar must all be present and internally consistent.
4. Because those sidecars were missing, the classifier retried synthetic PSID fixtures through the real WASM renderer, which correctly failed with `WASM renderer produced no audio`, leaving only telemetry JSONL and no canonical classification JSONL.

### Actions
1. Added `packages/sidflow-web/tests/e2e/utils/classification-cache-fixture.ts` to seed cache-complete synthetic WAV fixtures for web classification E2E coverage.
2. Updated `classify-api-e2e.spec.ts`, `classify-essentia-e2e.spec.ts`, and `classify-heartbeat.spec.ts` to use the new cache-fixture helper.
3. Fixed the malformed primary-JSONL regex in `classify-essentia-e2e.spec.ts` so it no longer filters out valid `classification_*.jsonl` files.
4. Added `packages/sidflow-play/test/station-multi-profile-e2e.test.ts`, a synthetic end-to-end proof that one classified/exported corpus can drive five distinct 10-rating personas into five disjoint, cluster-pure stations.

### Validation
1. `E2E_COVERAGE=true bunx playwright test tests/e2e/classify-api-e2e.spec.ts tests/e2e/classify-essentia-e2e.spec.ts tests/e2e/classify-heartbeat.spec.ts --project=chromium --workers=1`
        - Result: 5 passed, 0 failed.
2. `bun test packages/sidflow-play/test/station-similarity-e2e.test.ts packages/sidflow-play/test/station-multi-profile-e2e.test.ts`
        - Result: 2 passed, 0 failed.
3. `bun test packages/sidflow-play/test/station-multi-profile-e2e.test.ts` x3 consecutive
        - Run 1: 1 passed, 0 failed.
        - Run 2: 1 passed, 0 failed.
        - Run 3: 1 passed, 0 failed.

### Residual state
1. Full Chromium Playwright still has unrelated failures in `accessibility.spec.ts` and `advanced-search.spec.ts`.
2. Those failures are outside the classification/station changes validated here.
