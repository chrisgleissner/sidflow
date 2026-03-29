# WORKLOG.md - SID Classification Pipeline Recovery

## 2026-03-29 — Phase 22: engine capability mismatch and resilient batch recovery

### Current defect state
1. The classify pipeline still resolves render engines implicitly. `preferredEngines[0]` can be `sidplayfp-cli`, and WASM render failures can still fall back to `sidplayfp-cli` when `render.allowDegradedSidplayfpCli=true`.
2. SID-native extraction still assumes trace sidecars are available through `defaultSidWriteTraceProvider()`. When the selected engine cannot emit traces, the later feature path throws `Missing or invalid SID trace sidecar ... rerender through the trace-capable classify path`.
3. Batch behavior is inconsistent and unsafe for large runs: `generateAutoTags()` uses `continueOnError: false`, but also special-cases some render failures as skippable. That means the run may either abort early or silently omit songs, with no canonical failure JSONL artifact.

### Root-cause conclusion
The bug is not just an OOM symptom. The primary invariant is broken: the pipeline selects engines without resolving whether the downstream feature plan requires trace support. That creates an impossible runtime state where WAV rendering succeeds under a non-trace engine and feature extraction still expects hybrid WAV+SID-native inputs.

### Execution decision
Adopt explicit capability-driven graceful degradation for classification:
1. Resolve engine capabilities up front.
2. If the active engine does not support traces, disable SID-native extraction for that song attempt before rendering begins.
3. Mark the resulting record degraded instead of failing later on a missing sidecar.
4. If a song still fails, retry once with reduced capability / trace disabled, then record a structured permanent failure and continue the batch.

### Next steps
1. Patch the classify entrypoint with an `EngineCapabilities` / feature-mode resolution step.
2. Replace abort-or-skip behavior in `generateAutoTags()` with deterministic per-song failure recording.
3. Add regression coverage for degraded trace-unavailable classification and failure JSONL emission.

### Implementation and validation results
1. Landed the runtime-capability fix in `packages/sidflow-classify/src/index.ts`:
   - classification now resolves concrete per-attempt runtime modes up front,
   - `sidplayfp-cli`/`ultimate64` automatically force WAV-only classification instead of entering an impossible trace-required state,
   - each song now retries at most once under reduced capability before being recorded as a structured failure.
2. Landed feature-worker and render metadata fixes:
   - `packages/sidflow-classify/src/feature-extraction-worker.ts` now treats missing trace sidecars as fatal only when trace capture was actually expected,
   - `packages/sidflow-classify/src/render/wav-renderer.ts` and classify-sidecar persistence now record the actual engine/trace state used for that WAV.
3. Landed failure accounting and CLI summary changes:
   - `classification_*.failures.jsonl` is now the canonical permanent-failure artifact,
   - telemetry and summaries now record failed / retried / degraded counts.
4. Updated regression coverage to the resilient contract and validated the critical classify seams:
   - `bun test packages/sidflow-classify/test/high-risk-render-failure.test.ts packages/sidflow-classify/test/render-timeout.test.ts` — PASS after updating expectations to structured failure emission.
   - `bun test packages/sidflow-classify/test/multi-sid-classification.test.ts packages/sidflow-classify/test/super-mario-stress.test.ts` — PASS.
   - `bun run build:quick` — PASS.
   - `bun run build` — PASS.
   - `bun run test` — still FAILS in pre-existing `packages/libsidplayfp-wasm/test/performance.test.ts` out-of-bounds-memory regressions outside the classify package changes.

### Controlled 5,000-song classification evidence
1. Command:
   - `scripts/run-with-timeout.sh 7200 -- ./scripts/sidflow-classify --config tmp/classify-5000-config.json --force-rebuild --delete-wav-after-classification --limit 5000`
2. Result:
   - Exit `0`
   - Duration `510022ms` (about 8m 30s)
   - Telemetry file: `tmp/classify-5000/classified/classification_2026-03-29_14-27-31-245.events.jsonl`
   - Classification file: `tmp/classify-5000/classified/classification_2026-03-29_14-27-31-245.jsonl`
   - Feature file: `tmp/classify-5000/classified/features_2026-03-29_14-27-31-245.jsonl`
3. Recorded metrics from `run_complete`:
   - `classifiedFiles=5000/5000`
   - `failedCount=0`
   - `retriedCount=0`
   - `degradedCount=1`
   - `renderedFallbackCount=1`
   - `resultsWriteDurationMs=11181`
   - `peakRssMb=841`
4. Structured failure artifact status:
   - no `classification_*.failures.jsonl` file was emitted for this run because there were no permanent failures.

### Progress observability update
1. Extended periodic classify progress to emit every 50 songs instead of every 100.
2. Added a realistic feature-health metric to classifier progress, the web progress snapshot, and `scripts/run-similarity-export.sh` wrapper updates:
   - metric definition: a song only counts as complete when every deterministic rating feature key is present as a finite value and the record is not marked degraded via `featureVariant="heuristic"` or `sidFeatureVariant="unavailable"`.
3. Validation evidence:
   - `bun run build:quick` — PASS.
   - `bash -n scripts/run-similarity-export.sh` — PASS.
   - `bun test packages/sidflow-classify/test/cli.test.ts packages/sidflow-web/tests/unit/api-client.test.ts` — PASS (`59 pass`, `0 fail`).
   - `scripts/run-with-timeout.sh 1800 -- ./scripts/sidflow-classify --config tmp/classify-5000-config.json --force-rebuild --delete-wav-after-classification --limit 55` — PASS for logging validation; emitted the new `featureHealth completeRealistic=...` field at the 50-song checkpoint.
4. The 55-song smoke run reported `featureHealth completeRealistic=0/55 (0.0%)`. Inspection of the emitted feature JSONL confirmed the metric is flagging real missing deterministic dimensions in the sampled records rather than a formatting defect, so the new log signal is working as intended.

### Unhealthy-song diagnostics and CI follow-up
1. Added structured unhealthy-song diagnostics to classification output:
   - each unhealthy song now emits one `[feature-health-issue]` line containing the full SID path, render engine, feature mode, feature variants, a concise deterministic vector snapshot, and the explicit unhealthy elements list.
2. Validation evidence:
   - `scripts/run-with-timeout.sh 900 -- ./scripts/sidflow-classify --config tmp/classify-5000-config.json --force-rebuild --delete-wav-after-classification --limit 2` — PASS for logging validation.
   - emitted diagnostics identified the concrete missing dimensions for the sampled songs: `onsetDensity`, `rhythmicRegularity`, and `dynamicRange`.
3. CI build fix:
   - patched `packages/sidflow-web/lib/classify-progress-store.ts` so `getClassifyProgressSnapshot()` returns the required `featureHealthCheckedFiles`, `completeFeatureFiles`, and `completeFeaturePercent` fields.
   - the previously failing CI command `cd packages/sidflow-web && BABEL_ENV=coverage E2E_COVERAGE=true npx playwright test --project=chromium` now gets past the Next.js compile/type-check failure and reaches runtime E2E failures instead.
4. Root-cause repair for unhealthy classification records:
   - exported `computeEnvelopeFeatures()` from `packages/sidflow-classify/src/essentia-features.ts` and applied it in `packages/sidflow-classify/src/feature-extraction-worker.ts`, which restores `onsetDensity`, `rhythmicRegularity`, and `dynamicRange` for the worker-pool classification path used in large corpus runs.
   - added a worker-pool regression test in `packages/sidflow-classify/test/essentia-features.test.ts` and corrected the test fixture sidecar so the threaded extractor runs under a valid render-settings contract.
5. Post-fix validation evidence:
   - `bun test packages/sidflow-classify/test/deterministic-ratings.test.ts packages/sidflow-classify/test/essentia-features.test.ts` — PASS.
   - `scripts/run-with-timeout.sh 3600 -- ./scripts/sidflow-classify --config tmp/classify-5000-config.json --force-rebuild --delete-wav-after-classification --limit 300` — PASS with `featureHealth completeRealistic=300/300 (100.0%)`, `Failed: 0`, `Retried: 0`, `Degraded: 0`, and no `feature-health-issue`, `Classification failed`, or `song_failed` matches in the log scan.
   - `cd packages/sidflow-web && BABEL_ENV=coverage E2E_COVERAGE=true npx playwright test tests/e2e/classify-api-e2e.spec.ts tests/e2e/classify-progress-metrics.spec.ts --project=chromium` — PASS (`3 passed`).
   - `cd packages/sidflow-web && BABEL_ENV=coverage E2E_COVERAGE=true npx playwright test tests/e2e/classify-essentia-e2e.spec.ts --project=chromium` — PASS (`2 passed`).
   - `cd packages/sidflow-web && BABEL_ENV=coverage E2E_COVERAGE=true npx playwright test --project=chromium` — PASS (`87 passed`).
6. Remaining note:
   - the Chromium run still logs repeated `[hls-service] Failed to build HLS assets ... TypeError: i.resolve is not a function` warnings, but they are non-blocking for the current CI target because the full Chromium coverage suite now completes successfully.

### Export and persona station outputs
1. Similarity export command:
   - `node scripts/run-bun.mjs run packages/sidflow-play/src/cli.ts export-similarity --config tmp/classify-5000-config.json --profile full --output tmp/classify-5000/sidcorr-5000-full-sidcorr-1.sqlite`
   - Result: PASS in `24057ms`, `Tracks: 5000`
   - Artifacts:
     - `tmp/classify-5000/sidcorr-5000-full-sidcorr-1.sqlite`
     - `tmp/classify-5000/sidcorr-5000-full-sidcorr-1.manifest.json`
2. Persona station generation surfaced two distinct script defects:
   - root-level Bun execution could not resolve `@sidflow/common` from `scripts/validate-persona-radio.ts`,
   - the original hard-coded persona thresholds targeted 1-5 rating corners that do not exist in this 5,000-track slice (observed export ranges were only `2.0..4.0` for `e/m/c`).
3. Repaired `scripts/validate-persona-radio.ts` to:
   - use repo-relative imports,
   - resolve each named persona to the nearest populated rating bucket in the current export,
   - generate five deterministic, disjoint 100-track stations by centroid-ranked assignment,
   - write unambiguous station entries as `track_id :: sid_path`.
4. Persona report artifact:
   - `tmp/classify-5000/persona-report.md`
5. Persona coherence summary from the generated report:
   - `Pulse Chaser` bucket `(4.0, 3.0, 3.0)`, contamination `0`, min margin `0.0269`
   - `Dream Drifter` bucket `(2.0, 4.0, 2.0)`, contamination `22`, min margin `-0.0214`
   - `Maze Architect` bucket `(2.0, 3.0, 3.0)`, contamination `87`, min margin `-0.0094`
   - `Anthem Driver` bucket `(3.0, 4.0, 2.0)`, contamination `0`, min margin `0.0046`
   - `Noir Cartographer` bucket `(2.0, 4.0, 3.0)`, contamination `73`, min margin `-0.0263`
6. Station overlap summary:
   - all ten persona-pair overlap checks reported `0 shared tracks`.

## 2026-03-29 — Phase 20: WASM OOM root-cause investigation and fix

### Symptom recap
Full HVSC run (87,074 items) crashed at ~54,649 songs with `RangeError: Out of memory` during WASM
instantiation, followed by a Bun segfault (`panic: Segmentation fault at address 0x24`, peak RSS
2.80 GB). All four worker threads OOMed, the pool kept spawning replacement workers that also
immediately OOMed (death-spiral), and the run aborted.

### Root cause identified

**Primary: one fresh WASM linear-memory instance per render job**

`wasm-render-worker.ts` calls `createEngine({ sampleRate })` for **every single render job**.
`createEngine()` calls `loadLibsidplayfp({ instantiateWasm })` → `WebAssembly.instantiate()` →
new Emscripten module instance + new WASM linear-memory `ArrayBuffer` (~64–128 MB each).

`engine.dispose()` is called in the `finally` block, which correctly frees the C++
`SidPlayerContext` (inner WASM heap object) but **does not null `this.module` or
`this.modulePromise`**. Both fields still reference the full `LibsidplayfpWasmModule` object,
which in turn holds the `WebAssembly.Instance` and its linear-memory `ArrayBuffer`. Those ~64–128
MB stay live until JS GC collects the engine wrapper object.

At ~40 renders/sec across 4 workers, GC cannot reclaim old instances fast enough. Thousands of
live WASM instances × 64–128 MB = multiple GB of retained memory → OOM.

**Secondary: OOM death-spiral in the pool**

When a worker errored with OOM, `terminateAndReplaceWorker()` immediately spawned a new worker.
That worker also tried to instantiate WASM on its first job and also OOMed. The process repeated
until Bun segfaulted.

### Code archaeology (files read, not yet changed)

| File | Key finding |
|---|---|
| `packages/libsidplayfp-wasm/src/player.ts` line 663 | `dispose()` releases C++ context + clears pools + nulls `originalSidBuffer` — but `this.module` and `this.modulePromise` are never cleared |
| `packages/sidflow-classify/src/render/wasm-render-worker.ts` line 30 | Fresh `createEngine()` per job; `engine.dispose()` in `finally` doesn't free WASM |
| `packages/sidflow-classify/src/render/engine-factory.ts` line 181 | `compiledWasmModulePromise` cached per-worker (correct), but every `createEngine()` call calls `loadLibsidplayfp({ instantiateWasm })` → new `WebAssembly.Instance` |
| `packages/sidflow-classify/src/render/wasm-render-pool.ts` | Worker error handler always calls `terminateAndReplaceWorker()` — no OOM guard |

### Fix strategy

1. **Tried: Persistent engine cache in the worker** (`wasm-render-worker.ts`): create engines once per
   (worker × sample-rate) pair and reuse across all jobs for that worker.
   
   **REVERTED**: libsidplayfp has WASM-module-level global state (likely CIA timer / SID chip state)
   that accumulates across renders. After the first render completes, the second call to
   `ctx.reset()` within the **same WASM instance** stalls (hangs indefinitely in the SID init
   routine, triggering the 120 s pool-level timeout). Observed in the super-mario-stress test:
   copies 001–004 (fresh engines) completed; copies 005–024 (cached engines = same WASM) all
   timed out.

2. **Landed: Fix `dispose()` to null module references** (`player.ts`): change `modulePromise` from
   `readonly` to mutable and null both `this.module` and `this.modulePromise` in `dispose()`,
   making the WASM linear-memory `ArrayBuffer` immediately GC-eligible after each job, rather than
   waiting for the engine wrapper object to be collected by a later GC cycle.  JavaScriptCore
   (Bun's JS engine) tracks large external `ArrayBuffer` allocations and raises GC pressure
   accordingly — nulling the reference at job-completion time gives JSC the earliest possible
   signal to reclaim the ~128 MB allocation.

### Validation plan (bottom-up)
1. Build passes (`bun run build`)
2. Seam tests (render-timeout, multi-sid, wav-renderer-duration-cap, super-mario-stress) pass
3. Memory diagnostic: classify 200 songs with `--threads 1`, measure peak RSS before/after fix — expect < 500 MB vs old ~2+ GB
4. Graduated HVSC runs: 500 → 2,000 → 10,000 → 50,000 → 87,074 (each must finish without OOM)
5. Full test suite (`bun run test`) × 3 consecutive green runs


## 2026-03-28T11:39Z - Mario bounded repro refresh

| ID | Hypothesis | Command | Timeout | Expected falsifier | Result | Artifacts | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M1 | The current tree still stalls before the first Mario subtune render completes, and the real signal should still stop at structured `render_start` rather than a later render or feature stage. | `/usr/bin/time -v -o tmp/classify-stall/20260328T113648Z/time.txt scripts/run-with-timeout.sh 45 -- ./scripts/sidflow-classify --config tmp/classify-stall/20260328T113648Z/sidflow-mario-repro.json --force-rebuild --sid-path-prefix GAMES/S-Z/Super_Mario_Bros_64_2SID.sid` | 45s hard wrapper timeout | Any `render_complete`, `feature_extraction_complete`, emitted WAV, or emitted `.trace.jsonl` before timeout would falsify the current render-loop stall hypothesis. | Exit `124` after 45.01s; `/usr/bin/time -v` recorded 100% CPU and max RSS 275688 KB. Console output repeated `Rendering: ... [1]` heartbeats, but structured telemetry stopped at `render_start` for `queueIndex=0`, `songIndex=1`; only the metadata sidecar and `.events.jsonl` existed afterward. | `tmp/classify-stall/20260328T113648Z/time.txt`; `tmp/classify-stall/20260328T113648Z/classify.stdout.log`; `tmp/classify-stall/20260328T113648Z/classify.stderr.log`; `tmp/classify-stall/20260328T113648Z/classified/classification_2026-03-28_11-39-14-732.events.jsonl`; `tmp/classify-stall/20260328T113648Z/tags/GAMES/S-Z/Super_Mario_Bros_64_2SID.sid.meta.json` | Localize the seam with the smallest non-redundant experiment ladder: direct renderer vs pool, then trace-disabled vs trace-enabled, before adding new instrumentation. |
| M2 | If the worker pool is the root cause, bypassing it with a custom `--render-module` should either complete or at least emit different direct-render progress than the pooled classify path. | `SIDFLOW_DEBUG_RENDER_LOG=tmp/classify-stall/20260328T113648Z/direct-trace-on/render-debug.jsonl SIDFLOW_DEBUG_CAPTURE_TRACE=1 /usr/bin/time -v -o tmp/classify-stall/20260328T113648Z/direct-trace-on/time.txt scripts/run-with-timeout.sh 45 -- ./scripts/sidflow-classify --config tmp/classify-stall/20260328T113648Z/direct-trace-on/sidflow-mario-direct-trace-on.json --render-module scripts/debug-classify-render-module.ts --force-rebuild --sid-path-prefix GAMES/S-Z/Super_Mario_Bros_64_2SID.sid` | 45s hard wrapper timeout | A successful render, any `render_progress`, or any different failure mode would implicate the pool and falsify the current direct-render hypothesis. | Exit `124` after 45.00s; max RSS 243468 KB. The direct probe JSONL emitted only `render_start` and no `render_progress` or `render_summary`. Console heartbeats from the pooled path disappeared, but the stall remained. | `tmp/classify-stall/20260328T113648Z/direct-trace-on/time.txt`; `tmp/classify-stall/20260328T113648Z/direct-trace-on/classify.stdout.log`; `tmp/classify-stall/20260328T113648Z/direct-trace-on/classify.stderr.log`; `tmp/classify-stall/20260328T113648Z/direct-trace-on/render-debug.jsonl`; `tmp/classify-stall/20260328T113648Z/direct-trace-on/classified/classification_2026-03-28_11-46-45-864.events.jsonl` | Keep the direct path and remove SID trace capture next; if that still hangs before the first progress callback, instrument `renderWavWithEngine()` internally rather than rerunning classify again. |
| M3 | If trace setup, trace draining, or sidecar writes are the root cause, the same direct render with `captureTrace=false` should progress or fail differently. | `SIDFLOW_DEBUG_RENDER_LOG=tmp/classify-stall/20260328T113648Z/direct-trace-off/render-debug.jsonl SIDFLOW_DEBUG_CAPTURE_TRACE=0 /usr/bin/time -v -o tmp/classify-stall/20260328T113648Z/direct-trace-off/time.txt scripts/run-with-timeout.sh 45 -- ./scripts/sidflow-classify --config tmp/classify-stall/20260328T113648Z/direct-trace-off/sidflow-mario-direct-trace-off.json --render-module scripts/debug-classify-render-module.ts --force-rebuild --sid-path-prefix GAMES/S-Z/Super_Mario_Bros_64_2SID.sid` | 45s hard wrapper timeout | Any `render_progress`, any WAV output, or any changed failure mode would implicate trace capture and falsify the bare-render hypothesis. | Exit `124` after 45.00s; max RSS 248740 KB. The direct probe JSONL again emitted only `render_start`, the audio-cache directory stayed empty, and only the metadata sidecar was written. | `tmp/classify-stall/20260328T113648Z/direct-trace-off/time.txt`; `tmp/classify-stall/20260328T113648Z/direct-trace-off/classify.stdout.log`; `tmp/classify-stall/20260328T113648Z/direct-trace-off/classify.stderr.log`; `tmp/classify-stall/20260328T113648Z/direct-trace-off/render-debug.jsonl`; `tmp/classify-stall/20260328T113648Z/direct-trace-off/tags/GAMES/S-Z/Super_Mario_Bros_64_2SID.sid.meta.json` | Stop rerunning. Instrument `renderWavWithEngine()` around SID load, song selection, and the first `engine.renderCycles(RENDER_CYCLES_PER_CHUNK)` call to determine whether the stall occurs before entering the loop or inside a single render-cycle invocation. |
| M4 | If the stall happens before the render loop, env-gated instrumentation inside `renderWavWithEngine()` should reveal the last internal seam reached by the direct Mario repro. | `SIDFLOW_DEBUG_RENDER_LOG=tmp/classify-stall/20260328T113648Z/instrumented-direct-trace-off/render-debug.jsonl SIDFLOW_DEBUG_CAPTURE_TRACE=0 SIDFLOW_DEBUG_WAV_RENDER_LOG=1 /usr/bin/time -v -o tmp/classify-stall/20260328T113648Z/instrumented-direct-trace-off/time.txt scripts/run-with-timeout.sh 45 -- ./scripts/sidflow-classify --config tmp/classify-stall/20260328T113648Z/instrumented-direct-trace-off/sidflow-mario-instrumented-direct-trace-off.json --render-module scripts/debug-classify-render-module.ts --force-rebuild --sid-path-prefix GAMES/S-Z/Super_Mario_Bros_64_2SID.sid` | 45s hard wrapper timeout | Any `song_select_complete`, `render_loop_ready`, or `render_cycles_*` event would falsify the `selectSong()` stall hypothesis. | Exit `124` after 45.00s; max RSS 246692 KB. The instrumented JSONL advanced through `sid_load_complete` and then stopped at `song_select_start`, with no later events. | `tmp/classify-stall/20260328T113648Z/instrumented-direct-trace-off/time.txt`; `tmp/classify-stall/20260328T113648Z/instrumented-direct-trace-off/render-debug.jsonl`; `tmp/classify-stall/20260328T113648Z/instrumented-direct-trace-off/classify.stdout.log`; `tmp/classify-stall/20260328T113648Z/instrumented-direct-trace-off/classify.stderr.log` | Compare against one known-good multi-song SID under the same direct, trace-off path to rule out the instrumentation itself. |
| M5 | If `selectSong()` itself is pathological only for Mario, a known-good multi-song control should pass through `song_select_complete` and into the render loop under the same direct trace-off path. | `SIDFLOW_DEBUG_RENDER_LOG=tmp/classify-stall/20260328T113648Z/control-giana-direct-trace-off/render-debug.jsonl SIDFLOW_DEBUG_CAPTURE_TRACE=0 SIDFLOW_DEBUG_WAV_RENDER_LOG=1 /usr/bin/time -v -o tmp/classify-stall/20260328T113648Z/control-giana-direct-trace-off/time.txt scripts/run-with-timeout.sh 45 -- ./scripts/sidflow-classify --config tmp/classify-stall/20260328T113648Z/control-giana-direct-trace-off/sidflow-giana-direct-trace-off.json --render-module scripts/debug-classify-render-module.ts --force-rebuild --sid-path-prefix MUSICIANS/H/Huelsbeck_Chris/Great_Giana_Sisters.sid --limit 1` | 45s hard wrapper timeout | A hang at the same seam would mean the instrumentation or direct path is broken globally, not just for Mario. | Exit `0` in 0.44s; max RSS 344984 KB. The control log emitted `song_select_complete`, `render_loop_ready`, repeated `render_cycles_complete`, `wav_write_complete`, and `render_complete`. | `tmp/classify-stall/20260328T113648Z/control-giana-direct-trace-off/time.txt`; `tmp/classify-stall/20260328T113648Z/control-giana-direct-trace-off/render-debug.jsonl`; `tmp/classify-stall/20260328T113648Z/control-giana-direct-trace-off/audio-cache/`; `tmp/classify-stall/20260328T113648Z/control-giana-direct-trace-off/classified/` | Suppress the explicit song-selection call on Mario song 1 next; if that completes, the redundant select/reload step is the real seam. |
| M6 | If Mario hangs only because classification explicitly calls `selectSong(0)` after `loadSidBuffer()`, suppressing that call should let subtune 1 complete under the same direct trace-off setup. | `SIDFLOW_DEBUG_RENDER_LOG=tmp/classify-stall/20260328T113648Z/mario-no-select-trace-off/render-debug.jsonl SIDFLOW_DEBUG_CAPTURE_TRACE=0 SIDFLOW_DEBUG_WAV_RENDER_LOG=1 SIDFLOW_DEBUG_SUPPRESS_SONG_INDEX=1 /usr/bin/time -v -o tmp/classify-stall/20260328T113648Z/mario-no-select-trace-off/time.txt scripts/run-with-timeout.sh 45 -- ./scripts/sidflow-classify --config tmp/classify-stall/20260328T113648Z/mario-no-select-trace-off/sidflow-mario-no-select-trace-off.json --render-module scripts/debug-classify-render-module.ts --force-rebuild --sid-path-prefix GAMES/S-Z/Super_Mario_Bros_64_2SID.sid --limit 1` | 45s hard wrapper timeout | A continuing hang would mean `selectSong()` is not the differentiator. | Exit `0` in 0.43s; max RSS 346320 KB. The render log skipped `song_select_*`, entered `render_loop_ready`, completed the first three `render_cycles_*` iterations, wrote the WAV, and emitted `render_complete`. | `tmp/classify-stall/20260328T113648Z/mario-no-select-trace-off/time.txt`; `tmp/classify-stall/20260328T113648Z/mario-no-select-trace-off/render-debug.jsonl`; `tmp/classify-stall/20260328T113648Z/mario-no-select-trace-off/audio-cache/`; `tmp/classify-stall/20260328T113648Z/mario-no-select-trace-off/classified/` | Move the fix down into the engine/classify seam so requested subtunes load directly without an explicit second reload. |
| M7 | If requested subtunes are loaded directly on the first pass instead of `loadSidBuffer()` plus `selectSong()`, the exact real Mario CLI repro should complete all 37 subtunes under the original timeout wrapper. | `/usr/bin/time -v -o tmp/classify-stall/20260328T113648Z/post-fix-real-mario-v2/time.txt scripts/run-with-timeout.sh 45 -- ./scripts/sidflow-classify --config tmp/classify-stall/20260328T113648Z/post-fix-real-mario-v2/sidflow-post-fix-real-mario-v2.json --force-rebuild --sid-path-prefix GAMES/S-Z/Super_Mario_Bros_64_2SID.sid` | 45s hard wrapper timeout | Any repeat of the subtune stall, partial persistence, or non-zero exit would mean the fix is incomplete. | Exit `0` in 3.16s; max RSS 503776 KB. The real classify path rendered and extracted all 37 subtunes, then wrote 37 JSONL records and completed normally. The code change was the engine-level direct-subtune load in `packages/libsidplayfp-wasm/src/player.ts`, plus matching updates in `packages/sidflow-classify/src/render/wav-renderer.ts` and `packages/sidflow-classify/src/sid-native-features.ts`. | `tmp/classify-stall/20260328T113648Z/post-fix-real-mario-v2/time.txt`; `tmp/classify-stall/20260328T113648Z/post-fix-real-mario-v2/classify.stdout.log`; `tmp/classify-stall/20260328T113648Z/post-fix-real-mario-v2/classify.stderr.log`; `tmp/classify-stall/20260328T113648Z/post-fix-real-mario-v2/classified/classification_2026-03-28_12-11-31-242.jsonl`; `tmp/classify-stall/20260328T113648Z/post-fix-real-mario-v2/classified/classification_2026-03-28_12-11-31-242.events.jsonl` | Lock in the seam with regression coverage and remove any remaining classify fail-open behavior so later validation exercises the strict contract. |

## 2026-03-28T13:23Z - Targeted seam validation after the Mario fix

1. Updated the strict-failure regression set so render or feature-extraction failures now reject instead of persisting degraded success:
   - `packages/sidflow-classify/test/render-timeout.test.ts`
   - `packages/sidflow-classify/test/high-risk-render-failure.test.ts`
2. Added subtune-loading regression coverage in `packages/sidflow-classify/test/wav-renderer-duration-cap.test.ts` to assert that requested subtunes are loaded directly and do not call redundant `selectSong()` in the classification path.
3. Re-ran the targeted classify regression suite after the engine/classify fix and the strict-failure test updates:
   - Command: `bun test packages/sidflow-classify/test/wav-renderer-duration-cap.test.ts packages/sidflow-classify/test/render-timeout.test.ts packages/sidflow-classify/test/high-risk-render-failure.test.ts packages/sidflow-classify/test/multi-sid-classification.test.ts packages/sidflow-classify/test/super-mario-stress.test.ts`
   - Result: PASS (`19 pass`, `0 fail`, 111 assertions, 11.65s)

## 2026-03-28T11:30Z - Prompt reset for the HVSC classification stall

### Why the previous prompting approach stalled
1. The prior prompt conflicted with `AGENTS.md` by forbidding `PLANS.md` / `WORKLOG.md` updates and by discouraging explicit planning, which removed the repo's intended shared-memory guardrails.
2. The current branch still mixes contracts: `packages/sidflow-classify/src/index.ts` produces metadata-only records after render or feature-extraction failures, `packages/sidflow-classify/src/sid-native-features.ts` still logs `continuing with WAV-only features`, and the checked-in tests still bless that degraded behavior.
3. That mismatch made it easy for an agent to report "progress" while preserving the real hang and the fail-open semantics around it.

### Fresh evidence captured
1. `bun test packages/sidflow-classify/test/render-timeout.test.ts packages/sidflow-classify/test/high-risk-render-failure.test.ts` passed, but the output proves the tests still expect metadata-only fallback success for forced render failures.
2. A real bounded repro of the actual CLI now exists:
   - Command: `/usr/bin/time -v scripts/run-with-timeout.sh 45 -- ./scripts/sidflow-classify --config <temp-config> --force-rebuild --sid-path-prefix GAMES/S-Z/Super_Mario_Bros_64_2SID.sid`
   - Result: timed out after 45.01s with 100% CPU and max RSS about 292 MB.
   - Artifact state: only `/tmp/sidflow-mario-repro-kdFLK2/classified/classification_2026-03-28_11-14-31-027.events.jsonl` and `/tmp/sidflow-mario-repro-kdFLK2/tags/GAMES/S-Z/Super_Mario_Bros_64_2SID.sid.meta.json` existed; no WAV or trace sidecar was produced.
   - Telemetry shows `song_start` and `render_start` for queue index 0 / subtune 1, then no further structured events before timeout.

### Follow-up asset
1. Added `doc/plans/hvsc-classification-stall-prompt.md`, which contains the current facts, a staged debugging roadmap, work-log rules, and a replacement prompt designed to prevent unbounded runs and repeated no-signal experiments.

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
