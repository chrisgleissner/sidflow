# WORKLOG.md - SID Classification Pipeline Recovery

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
