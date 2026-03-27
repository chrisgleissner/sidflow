# WORKLOG.md - SID Classification Pipeline Recovery

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
