# WORKLOG — Release Tag CI Fix (0.5.0-RC3)

Append-only execution trace. Each entry records commands, CI results, observations, and outcomes.

---

## 2026-03-23 — Dual-source classification audit and HVSC export

### Scope

Phase 1 audit of the dual-source (WAV + SID-native) classification pipeline, schema, and documentation; followed by full HVSC reclassification and SQLite export.

### Phase 1 audit findings

**Pipeline**
- SID-native register-write tracing is fully implemented in `packages/libsidplayfp-wasm/src/bindings/bindings.cpp` and exposed via `SidAudioEngine.setSidWriteTraceEnabled()` / `getAndClearSidWriteTraces()`.
- Frame compaction is implemented in `packages/sidflow-classify/src/sid-register-trace.ts` (PAL/NTSC, carry-forward state, per-voice and global events).
- SID-native feature extraction is implemented in `packages/sidflow-classify/src/sid-native-features.ts`; all 29 extracted fields use the `sid` prefix (`sidFeatureVariant`, `sidTraceClock`, `sidGateOnsetDensity`, etc.).
- `createHybridFeatureExtractor()` merges WAV and SID-native results with WAV-first collision semantics: SID fields never overwrite existing WAV-derived keys.
- The 24D perceptual vector is built by `buildPerceptualVector()` in `packages/sidflow-classify/src/deterministic-ratings.ts`. Shared features (`tempo`, `onsetDensity`, `rhythmicRegularity`, `filterMotion`, `melodicClarity`, `bassPresence`, `loudness`) are explicitly fused via weighted blends; `mfccResidual1/2` subtract the SID-timbre-basis projection, preventing double counting of timbral variance.
- Feature schema version bumped to `1.3.0` for the SID-native additions.

**No double counting identified.** WAV and SID signals share no vector dimension independently; every dimension is either purely one source or an explicit weighted fusion/residual.

**Schema**
- SQLite `tracks` table stores: `track_id`, `sid_path`, `song_index`, `vector_json` (24D), `e`/`m`/`c`/`p` ratings, raw and decayed feedback counters, `last_played`, `classified_at`, `source`, `render_engine`, `features_json` (all features serialized; WAV features identifiable by absence of `sid` prefix, SID features by `sid*` prefix).
- Schema version is `sidcorr-1`. No changes required.

**Existing state (stale)**
- `data/classified/`: 1,003 entries from 2026-03-13 at `feature_schema_version: 1.2.0` — these predate SID-native features and must be replaced with a full rerun.
- `data/exports/sidcorr-hvsc-full-sidcorr-1.sqlite`: 7 tracks, 4D vectors, generated 2026-03-13 — stale test artifact, will be replaced.

**Documentation**
- `README.md` "Portable Similarity Export" section lacked the reclassification command and contained optional branching steps. Updated in this session.
- `doc/similarity-export.md` is complete and accurate.

**Phase 2 conclusion: no code or schema changes required.**

### Commands

Build:
```bash
bun run build
```

Full reclassification + export (Phase 4):
```bash
bash scripts/run-similarity-export.sh --mode local --full-rerun true
```

Publish (Phase 5):
```bash
bash scripts/run-similarity-export.sh --workflow publish-only --mode local --publish-release true
```

### Validation

- Build result: `tsc -b` exit 0 ✅
- Reclassification result: RUNNING (started 2026-03-23 08:26 UTC; 87,074 total items including sub-songs; 103 processed at 08:28, ~7h estimated)
- Export track count: PENDING
- SQLite feature_schema_version: PENDING
- Release publish: PENDING

---

## 2026-03-22 — SID-native enhancement implementation slice: shared windows + shared feedback semantics

### Scope

Implemented the first production-code slice from `doc/research/sid-classification-enhancement-report.md` after the design/audit pass:
- settle the shared classify window at `15s` skip + `15s` analyze
- remove the remaining common-layer drift in feedback aggregation / recommendation semantics before starting SID-native trace work

### Files changed

- `packages/sidflow-classify/src/audio-window.ts`
- `packages/sidflow-classify/src/index.ts`
- `packages/sidflow-classify/src/essentia-features.ts`
- `packages/sidflow-classify/src/feature-extraction-worker.ts`
- `packages/sidflow-classify/src/render/render-orchestrator.ts`
- `packages/sidflow-classify/test/audio-window.test.ts`
- `packages/sidflow-classify/test/index.test.ts`
- `packages/sidflow-common/src/feedback-aggregation.ts`
- `packages/sidflow-common/src/vector-similarity.ts`
- `packages/sidflow-common/src/index.ts`
- `packages/sidflow-common/src/lancedb-builder.ts`
- `packages/sidflow-common/src/recommender.ts`
- `packages/sidflow-common/src/similarity-export.ts`
- `packages/sidflow-web/lib/server/rating-aggregator.ts`
- `packages/sidflow-common/test/feedback-aggregation.test.ts`
- `packages/sidflow-common/test/recommender.test.ts`
- `packages/sidflow-common/test/similarity-export.test.ts`

### Implemented

- Introduced shared classify defaults `DEFAULT_ANALYSIS_SKIP_SEC = 15` and `DEFAULT_ANALYSIS_WINDOW_SEC = 15` and threaded them through the representative-window, render, and feature-extraction paths.
- Added `packages/sidflow-common/src/feedback-aggregation.ts` with shared temporal decay and action-weight semantics for `play_complete`, `skip_early`, `skip_late`, and `replay`.
- Added `packages/sidflow-common/src/vector-similarity.ts` so 24D weighted cosine behavior is defined once and reused rather than reimplemented.
- Migrated these consumers onto the shared helpers:
  - `packages/sidflow-common/src/lancedb-builder.ts`
  - `packages/sidflow-common/src/similarity-export.ts`
  - `packages/sidflow-common/src/recommender.ts`
  - `packages/sidflow-web/lib/server/rating-aggregator.ts`
- Extended similarity export and LanceDB records to persist decayed feedback metrics alongside raw counts.

### Validation

Focused tests:

```bash
bun test packages/sidflow-common/test/feedback-aggregation.test.ts \
  packages/sidflow-common/test/recommender.test.ts \
  packages/sidflow-common/test/similarity-export.test.ts \
  packages/sidflow-web/tests/unit/rating-aggregator-decay.test.ts
```

Result:
- initial run: `31 passed, 1 failed`
- failure cause: new recommender test helper wrote to the fixed shared temp DB path instead of the test-local path
- fix: updated `createTestDatabase` test helper to support an alternate DB path
- rerun: `32 passed, 0 failed`

Quick build:

```bash
bun run build:quick
```

Result:
- PASS (`tsc -b`)

### Outcome

The current codebase now matches the settled 15s/15s analysis window and no longer has separate feedback-decay implementations in the common export path versus the web aggregator. The next unresolved enhancement step is the actual SID-native trace/binding work in `@sidflow/libsidplayfp-wasm`.

---

## 2026-03-22 — SID-native enhancement implementation slice: WASM SID write tracing

### Scope

Implemented the first SID-native runtime hook from the enhancement roadmap: deterministic SID register-write tracing exposed through `@sidflow/libsidplayfp-wasm`.

### Files changed

- `packages/libsidplayfp-wasm/src/bindings/bindings.cpp`
- `packages/libsidplayfp-wasm/src/player.ts`
- `packages/libsidplayfp-wasm/test/index.test.ts`
- `packages/libsidplayfp-wasm/test/sid-write-trace.test.ts`

### Implemented

- Added a tracing SID builder/wrapper in `bindings.cpp` that wraps each created `sidemu` instance, intercepts validated register writes, and records `{ sidNumber, address, value, cyclePhi1 }` entries.
- Exposed two new runtime methods on `SidPlayerContext`:
  - `setSidWriteTraceEnabled(boolean)`
  - `getAndClearSidWriteTraces()`
- Added matching `SidAudioEngine` methods in `player.ts` and preserved the trace-enabled flag across context reloads so tracing can be enabled before `loadSidBuffer()` to capture init writes.

### Validation

Commands run:

```bash
bun test packages/libsidplayfp-wasm/test/sid-write-trace.test.ts
bun run build:quick
bun run scripts/build-libsidplayfp-wasm.ts --skip-check
bun test packages/libsidplayfp-wasm/test/index.test.ts \
  packages/libsidplayfp-wasm/test/sid-write-trace.test.ts
```

Observed results:
- `sid-write-trace.test.ts` — PASS (`1 passed, 0 failed`)
- `bun run build:quick` — PASS (`tsc -b`)
- first wasm rebuild attempt — FAIL due to missing `libsidplayfp::` namespace qualifiers for `event_clock_t` and `EVENT_CLOCK_PHI1`
- second wasm rebuild attempt — PASS; artifacts regenerated under `packages/libsidplayfp-wasm/dist`
- focused libsidplayfp-wasm tests — PASS (`15 passed, 0 failed`)

### Outcome

The codebase now has a real SID-native write-trace API available from the wasm player layer. The next step is no longer emulator plumbing; it is transforming those raw trace entries into canonical frame-bucketed events for feature extraction.

---

## 2026-03-22 — SID-native enhancement implementation slice: canonical frame compaction

### Scope

Implemented the next roadmap slice after raw trace capture: deterministic compaction of SID register writes into PAL/NTSC frame-bucketed canonical register events for classify-side feature extraction.

### Files changed

- `packages/sidflow-classify/src/sid-register-trace.ts`
- `packages/sidflow-classify/src/index.ts`
- `packages/sidflow-classify/test/sid-register-trace.test.ts`

### Implemented

- Added `packages/sidflow-classify/src/sid-register-trace.ts` with:
  - deterministic PAL/NTSC clock normalization (`Unknown` and `PAL+NTSC` resolve to PAL)
  - frame-window resolution from the settled 15s skip + 15s analyze model
  - raw `SidWriteTrace[]` sorting and frame bucketing
  - carry-forward SID register state snapshots across skipped and analysis frames
  - canonical per-frame voice events for all voice-local registers
  - broadcast per-frame events for global SID registers (`$D415-$D418`) across voices
  - derived signal decoding for frequency, pulse width, ADSR, waveform/control bits, filter routing, and volume/mode state
- Re-exported the new helpers from `@sidflow/classify`.
- Added focused tests covering clock normalization, frame-window calculation, carry-forward state through the skip window, last-write-wins semantics within a frame, and multi-SID separation.

### Validation

Commands run:

```bash
bun test packages/sidflow-classify/test/sid-register-trace.test.ts
bun run build:quick
```

Observed results:
- focused sid-register-trace tests — PASS (`5 passed, 0 failed`)
- quick build — PASS (`tsc -b`)

### Outcome

The classify package now has a deterministic canonical SID event layer sitting between the wasm raw write trace API and the upcoming SID-native feature extractor. The next implementation step is I4: aggregating these canonical frame events into bounded causal features for the hybrid classifier.

---

## 2026-03-22 — SID-native enhancement implementation slice: feature extraction + default hybrid classify path

### Scope

Implemented classify-side SID-native feature extraction over canonical frame events and wired it into the default classify pipeline so emitted records now merge WAV-domain and SID-native causal features.

### Files changed

- `packages/sidflow-classify/src/sid-native-features.ts`
- `packages/sidflow-classify/src/index.ts`
- `packages/sidflow-classify/test/sid-native-features.test.ts`

### Implemented

- Added `packages/sidflow-classify/src/sid-native-features.ts` with:
  - a default SID trace provider backed by `SidAudioEngine` and the wasm write-trace API
  - a pure `extractSidNativeFeaturesFromWriteTrace(...)` path for deterministic aggregation and testing
  - bounded causal feature extraction for gate-onset density, rhythmic regularity, arpeggio activity, waveform occupancy, PWM activity, filter cutoff/motion, `$D418` write intensity, voice-role ratios, and ADSR pluck/pad ratios
  - `createHybridFeatureExtractor(...)` to merge WAV and SID-native feature groups without changing custom extractor contracts
- Updated the default classify flow in `packages/sidflow-classify/src/index.ts` so:
  - default runs merge pooled/default WAV features with SID-native features
  - explicit custom `featureExtractor` overrides keep their existing behavior unchanged
  - multi-song calls now pass `songIndex` and `songCount` through feature extraction options
- Added focused tests for:
  - pure SID-native feature aggregation from representative raw traces
  - stable empty-feature behavior when no trace exists
  - end-to-end `generateAutoTags(...)` emission of merged WAV + SID-native features using an injected trace provider

### Validation

Commands run:

```bash
bun test packages/sidflow-classify/test/sid-register-trace.test.ts \
  packages/sidflow-classify/test/sid-native-features.test.ts \
  packages/sidflow-classify/test/auto-tags.test.ts
bun run build:quick
```

Observed results:
- focused classify suite — PASS (`9 passed, 0 failed`)
- quick build — PASS (`tsc -b`)

### Outcome

The suggested next steps after I3 are now in place: the new compactor is connected to classify through a real SID-native feature extractor, the default classify path emits hybrid feature records, and focused tests cover compaction-to-feature extraction and record emission. The next roadmap step is I5: residualizing output-domain timbre against these causal SID-native features.

---

## 2026-03-22 — Station similarity audit implementation (Phases A and B)

### Phase 0: Repo guidance and code-path discovery

Read and confirmed:
- `PLANS.md`
- `README.md`
- `doc/developer.md`
- `doc/technical-reference.md`
- `doc/research/sid-station-similarity-audit.md`

Key findings from live code inspection before edits:
- `packages/sidflow-play/src/station/queue.ts`
  - `buildWeightsByTrackId()` still uses the old aggressive mapping `5→9, 4→4, 3→1.5, else 0.1`
  - local queue-flow cosine helper is unweighted and dimension-agnostic, but there is no minimum similarity filter or deviation rejection around candidate retrieval
- `packages/sidflow-common/src/similarity-export.ts`
  - export vectors are still assembled only from `e/m/c` or `e/m/c/p` (`dims?: 3 | 4`)
  - `recommendFromSeedTrack()` and `recommendFromFavorites()` still use plain cosine on stored vectors
  - feedback aggregation there still understands only `play|like|dislike|skip`
- `packages/sidflow-classify/src/deterministic-ratings.ts`
  - deterministic tag/rating mapping exists, but there is no perceptual-vector builder yet
- `packages/sidflow-classify/src/index.ts`
  - classification JSONL currently writes ratings plus features; no 24D vector field is included
- `packages/sidflow-common/src/jsonl-schema.ts`
  - feedback actions are still limited to `play|like|dislike|skip`
  - classification schema has no explicit vector field yet
- `packages/sidflow-web/app/api/feedback/sync/route.ts`
  - route is still a stub returning `{ success: true }` without persistence
- `packages/sidflow-web/lib/server/rating-aggregator.ts`
  - aggregation is count-based only; no temporal decay is applied

Implementation order chosen:
1. Update plan/log files first
2. Land Phase A in shared similarity + station queue code with tests
3. Extend schema + classifier feature/vector pipeline
4. Upgrade similarity/export to variable dimensions and weighted cosine
5. Finish feedback sync + temporal decay
6. Produce validation artifacts and run build/tests

### Phase 1: Station core quick fixes (A1-A4)

Files changed:
- `packages/sidflow-play/src/station/constants.ts`
- `packages/sidflow-play/src/station/args.ts`
- `packages/sidflow-play/src/station/queue.ts`
- `packages/sidflow-play/src/station/index.ts`
- `packages/sidflow-play/src/sid-station.ts`
- `packages/sidflow-play/test/cli.test.ts`

Implemented:
- Reduced the minimum rated-track gate from `10` to `5`
- Updated CLI defaults/help to reflect the 5-track activation threshold
- Replaced the old aggressive weight curve with `5→3, 4→2, 3→1, 2→0.3, 1→0.1`
- Added minimum similarity thresholds: `0.82` during cold start (`<10` ratings) and `0.75` otherwise
- Added weighted centroid construction across favorite rows and rejected candidates whose `e/m/c` deviations exceed `1.5`

Focused validation:
- `packages/sidflow-play/test/cli.test.ts` — PASS after updating expectations for the stricter queue policy
- `tsc -b` quick build — PASS

### Phase 2: Schema, features, and 24D perceptual vectors (B1-B3)

Files changed:
- `packages/sidflow-common/src/jsonl-schema.ts`
- `packages/sidflow-classify/src/deterministic-ratings.ts`
- `packages/sidflow-classify/src/essentia-features.ts`
- `packages/sidflow-classify/src/essentia-frame-features.ts`
- `packages/sidflow-classify/src/index.ts`
- `packages/sidflow-common/src/similarity-export.ts`
- `packages/sidflow-classify/test/deterministic-ratings.test.ts`
- `packages/sidflow-classify/test/essentia-features.test.ts`
- `packages/sidflow-classify/test/jsonl.test.ts`
- `packages/sidflow-common/test/jsonl-schema.test.ts`
- `packages/sidflow-common/test/similarity-export.test.ts`

Implemented:
- Extended the shared classification schema with `vector?: number[]` and the new feature fields: `onsetDensity`, `rhythmicRegularity`, `spectralFluxMean`, `dynamicRange`, `pitchSalience`, `inharmonicity`, `lowFrequencyEnergyRatio`, and `spectralCentroidStd`
- Added deterministic/heuristic extraction for those features in both Essentia and fallback paths
- Added `buildPerceptualVector()` to construct a 24D vector from normalized spectral, temporal, MFCC, and derived features
- Threaded the 24D vector through both classification-record emission paths
- Upgraded shared similarity export and recommendation helpers to auto-detect vector dimensionality, preserve legacy 4D behavior, and use weighted cosine automatically for 24D vectors

Focused validation:
- Classifier/common focused tests — PASS (`32 passed, 0 failed`)
- `tsc -b` quick build — PASS after importing `buildDeterministicRatingModel` in `packages/sidflow-classify/src/index.ts`

### Phase 3: Feedback persistence and temporal decay (B4-B5)

Files changed:
- `packages/sidflow-common/src/feedback.ts`
- `packages/sidflow-web/app/api/feedback/sync/route.ts`
- `packages/sidflow-web/lib/server/rating-aggregator.ts`
- `packages/sidflow-web/tests/unit/feedback-sync-route.test.ts`
- `packages/sidflow-web/tests/unit/rating-aggregator-decay.test.ts`
- `packages/sidflow-web/tests/unit/feedback-recorder.test.ts`

Implemented:
- Extended feedback logging/types to support `play_complete`, `skip_early`, `skip_late`, `replay`, and persisted `song_index`
- Replaced the sync endpoint stub with real persistence of raw sync batches under `data/feedback-sync/YYYY/MM/DD/events.jsonl`
- Emitted aggregate-friendly implicit feedback events under `data/feedback/YYYY/MM/DD/events.jsonl`
- Applied a 90-day half-life decay model in the server rating aggregator and differentiated skip/play/replay event weights

Focused validation:
- Feedback/web focused tests — PASS (`43 passed, 0 failed`)
- `tsc -b` quick build — PASS

### Phase 4: Validation artifacts

Files added:
- `scripts/validate-phase-ab.ts`
- `doc/research/phase-ab-sample-24d-classification.json`
- `doc/research/phase-ab-validation-report.md`

Command run:

```bash
bun run scripts/validate-phase-ab.ts
```

Results written to `tmp/phase-ab-validation/` and promoted to tracked deliverables.

Measured outputs:
- Vector dimensions: `24`
- Sample classification artifact: `MUSICIANS/A/Artist/ambient-1.sid` with ratings `{ c: 2, e: 2, m: 4 }`
- Feature means:
  - `onsetDensity = 2.56`
  - `rhythmicRegularity = 0.556`
  - `spectralFluxMean = 0.274`
  - `dynamicRange = 0.558`
  - `pitchSalience = 0.646`
  - `inharmonicity = 0.414`
  - `lowFrequencyEnergyRatio = 0.210`
- Similarity ranking from ambient seed:
  - `ambient-2.sid = 0.9890891539407359`
  - `demo-hybrid.sid = 0.8984677871565525`
  - `game-drive.sid = 0.6770255496725501`
  - `game-drive-2.sid = 0.6420971850981998`
- Station coherence:
  - `meanPairwiseWeightedCosine = 0.9389623462074951`
  - `minPairwiseWeightedCosine = 0.8984677871565525`
  - `maxPairwiseWeightedCosine = 0.9890891539407359`

Next step queued:
- Run full repository `build` and `test` gates and record the final results here

### Phase 5: Full repository validation and test-harness hardening

Commands run:

```bash
bun run build
npm run test:ci
```

Observed outcomes:
- `bun run build` completed successfully
- `npm run test:ci` completed successfully with exit code `0`
- A separate local repro established that `packages/sidflow-classify/test/render-integration.test.ts` passes under direct coverage execution but can hang when the entire test run is wrapped by `scripts/run-with-timeout.sh`

Follow-up hardening change:
- Updated `packages/sidflow-classify/test/render-integration.test.ts` to avoid the Bun-based `which sidplayfp` probe, switch to `spawnSync` availability detection, reduce the sidplayfp render duration from `10s` to `2s`, tighten the watchdog window, and stop piping child stderr in the integration helper

Validation evidence:
- Direct isolated repro: `node scripts/run-bun.mjs test packages/sidflow-classify/test/render-integration.test.ts --coverage --coverage-reporter=lcov --exclude=**/*.spec.ts --exclude=**/tests/e2e/** --exclude=**/dist/**` — PASS (`17 pass, 0 fail`)
- Direct suite run written to `tmp/phase-ab-direct-1774189212/test.log` with `tmp/phase-ab-direct-1774189212/test.status = 0`

Coverage snapshot for key Phase A/B files from merged LCOV:
- `packages/sidflow-play/src/station/queue.ts` — `467/503` (`92.8%`)
- `packages/sidflow-classify/src/deterministic-ratings.ts` — `301/328` (`91.8%`)
- `packages/sidflow-classify/src/essentia-frame-features.ts` — `222/269` (`82.5%`)
- `packages/sidflow-common/src/jsonl-schema.ts` — `11/11` (`100.0%`)
- `packages/sidflow-web/app/api/feedback/sync/route.ts` — `90/105` (`85.7%`)

---

## 2026-03-22 — Phase 5: Repository build and test validation (final gates)

### Build gate

Command: `bun run build` (installs deps, checks upstream WASM, runs `tsc -b`)
Result: **PASS** — `tsc -b` exits 0, zero TypeScript errors across all packages.
WASM upstream check emits an informational warning (upstream changed but no code
changes required for current task).

### Test gate — package-by-package results (3 consecutive runs each)

Test runner: `bun test` via `node scripts/run-bun.mjs test <package-dir>`

| Package | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| sidflow-play | 385/385 pass | 385/385 pass | 385/385 pass |
| sidflow-common | 445/445 pass | 445/445 pass | 445/445 pass |
| sidflow-classify | 287/287 pass | 287/287 pass | 287/287 pass |
| sidflow-web (unit) | 1062/1062 pass | 1062/1062 pass | 1062/1062 pass |
| sidflow-train | 23/23 pass | — | — |
| libsidplayfp-wasm + fetch + performance + rate | 173/173 pass | — | — |

All Phase A/B modified packages: **100% pass across 3 consecutive runs.**

### Timing-sensitive flaky tests (pre-existing, not related to Phase A/B)

When all packages are combined in a single bun test invocation under concurrent
scheduler pressure, 7 time-dependent tests in `cache.test.ts` and
`rate-limiter.test.ts` fail intermittently (LRUCache TTL and RateLimiter window
timeout assertions). These tests pass in isolation and were not modified in any
Phase A/B commit (confirmed via git log). They represent a pre-existing
infrastructure flakiness documented in prior WORKLOG entries.

### Convergence confirmation

All Phase A/B PLANS.md tasks are DONE. All acceptance criteria met:
- A1: min similarity threshold 0.75 (cold-start 0.82) enforced in station queue
- A2: weight mapping 5→3, 4→2, 3→1, 2→0.3, 1→0.1 applied
- A3: minimum rated tracks reduced from 10 to 5
- A4: per-dimension deviation ≤1.5 rejection applied against weighted centroid
- B1: onset_density, rhythmic_regularity, spectral_flux_mean, dynamic_range,
      pitch_salience, inharmonicity, low_frequency_energy_ratio extracted
- B2: 24D perceptual vector built deterministically from normalized features
- B3: similarity export handles 4D and 24D with auto-detected weighted cosine
- B4: sync route persists play_complete/skip_early/skip_late/replay events
- B5: 90-day half-life temporal decay applied in server rating aggregator

### Phase 6: CI perf-smoke investigation and fix

Problem observed from GitHub Actions:
- `Build and Test` was failing after unit tests and Playwright succeeded
- failure point was perf smoke (`k6`) with `http_req_failed` threshold crossed on `play-start-stream`

Local reproduction against the production-like standalone server:
- `GET /api/health` — immediate `200`
- `GET /api/search?q=ambient` — immediate `200` with `Test_Artist/Ambient_Dream.sid`
- `POST /api/play` — stalled before response headers when the server had no prebuilt HLS assets

Root cause:
- `packages/sidflow-web/app/api/play/route.ts` and sibling playback-entry routes awaited `ensureHlsForTrack()` on the request path
- in fresh CI containers, that forced on-demand WAV render + ffmpeg HLS generation before returning a playback session
- the reduced k6 journey treats any stalled/non-2xx request as failure, so the smoke test tripped on cold-start asset generation rather than on search or path resolution

Files changed:
- `packages/sidflow-web/lib/server/playback-stream-prep.ts`
- `packages/sidflow-web/app/api/play/route.ts`
- `packages/sidflow-web/app/api/play/manual/route.ts`
- `packages/sidflow-web/app/api/play/random/route.ts`
- `packages/sidflow-web/app/api/rate/random/route.ts`
- `packages/sidflow-web/tests/unit/playback-stream-prep.test.ts`

Implemented:
- Added `preparePlaybackSessionStreams()` to keep playback session creation non-blocking
- If stream assets already exist, sessions include them immediately
- If no stream assets exist yet, routes now kick off HLS warming in the background instead of awaiting it
- Playback sessions still return `sidUrl` immediately, so the perf smoke and legacy playback path can start without waiting for HLS generation

Validation:
- `packages/sidflow-web/tests/unit/playback-stream-prep.test.ts` — PASS

---

## 2026-03-22 — SID-native classification enhancement audit + design

### Scope and mandatory inputs

Read and incorporated:
- `doc/research/sid-station-similarity-audit.md`
- `doc/c64/sid-file-structure.md`
- `doc/c64/sid-spec.md`
- `doc/research/phase-ab-sample-24d-classification.json`
- supporting repo guidance: `PLANS.md`, `README.md`, `doc/developer.md`, `doc/technical-reference.md`

Explicit constraints fixed up front:
- offline-first
- deterministic execution
- commodity hardware target: 8 CPU cores, <= 16 GiB RAM
- shared analysis region: skip first 15s, analyze next 15s only
- frame-based SID timing only: PAL 50 Hz or NTSC 60 Hz
- anti-double-counting invariant for all retained features

### Evidence-based implementation audit findings

Verified directly in source:
- Phase A station fixes are implemented in `packages/sidflow-play/src/station/{constants,queue,run}.ts`
  - `MINIMUM_RATED_TRACKS = 5`
  - softened rating weights (`5→3, 4→2, 3→1, 2→0.3, 1→0.1`)
  - minimum similarity floors and per-dimension deviation rejection
- Phase B representation changes are implemented in `packages/sidflow-classify/src/deterministic-ratings.ts`, `packages/sidflow-classify/src/index.ts`, and `packages/sidflow-common/src/jsonl-schema.ts`
  - new audio features present in schema and extraction pipeline
  - deterministic 24D vector construction present and emitted in classification output
- Phase C station-model changes are implemented in `packages/sidflow-play/src/station/{intent,queue}.ts`
  - multi-centroid intent clustering
  - adventure radius expansion with exploit/explore split
- Phase D training stack is implemented in `packages/sidflow-train/src/{pair-builder,metric-learning,evaluate,scheduler,cli}.ts`
  - pair derivation, metric-learning MLP, challenger evaluation, versioned model save, CLI rollback

Confirmed residual gaps / partials:
- No SID-native register-trace or canonical register-event model exists. Current `packages/sidflow-common/src/sid-parser.ts` parses PSID/RSID headers only.
- Current WAV classification defaults still use `introSkipSec ?? 30` and `maxClassifySec ?? 15`, so the requested shared 15s+15s window is not the current implementation.
- Feedback modernization is not propagated consistently into all shared aggregation paths:
  - `packages/sidflow-web/lib/server/rating-aggregator.ts` applies 90-day temporal decay and new action types
  - `packages/sidflow-common/src/lancedb-builder.ts` still aggregates only `play|like|dislike|skip` with raw counts
  - `packages/sidflow-common/src/similarity-export.ts` still uses count-based feedback aggregation without decay
  - `packages/sidflow-common/src/recommender.ts` still contains an unweighted cosine implementation
- `runScheduler()` exists, but source inspection found no autonomous service integration; it is currently invoked via the train CLI path rather than a continuously running scheduler.

### Deliverable written

Created:
- `doc/research/sid-classification-enhancement-report.md`

Content delivered there:
- atomic implementation audit table with DONE / PARTIAL / MISSING status
- bounded SID-native execution model tied to PSID/RSID init/play semantics and the SID register map
- formal feature definitions for arpeggios, ADSR classes, waveform usage, filter sweeps, D418 digi detection, rhythm, and voice roles
- WAV/SID orthogonalization table with KEEP / REPLACE / FUSE / REMOVE actions
- final hybrid vector design, evaluation thresholds, roadmap, and test plan

### Validation note

No production code changed in this task; only planning and research documents were updated. I did not run build/test gates because there was no executable behavior change to validate.
- `bun run build` — PASS
- live standalone repro after restart:
  - `POST /api/play` returned `200` immediately
  - response included `sidUrl` and `fallbackHlsUrl: null`
- exact local `perf:run` k6 smoke could not be executed end-to-end in this environment because `k6` is not installed locally (`spawn k6 ENOENT`); GitHub Actions already installs it in the workflow

---

## 2026-03-21 — Phase 1: Discovery

### Observation: All release tags failing in CI

```
gh run list --workflow=release.yaml --limit=10
```

Result: Every tag from `0.3.43` through `0.5.0-rc2` has `conclusion: failure`.

### Finding the failure step

```
gh run view 23367403686 --log-failed
```

Grep for actual error:
```
mktemp: failed to create directory via template
'/home/runner/work/sidflow/sidflow/tmp/docker-smoke.XXXXXX':
No such file or directory
##[error]Process completed with exit code 1.
```

The Docker image build **succeeded** — the failure happens in the `Smoke test Docker image` step,
specifically on the very first line of `scripts/docker-smoke.sh` that calls `mktemp`.

### Root Cause

`scripts/docker-smoke.sh` line:
```bash
TMP_ROOT="$(mktemp -d "${ROOT_DIR}/tmp/docker-smoke.XXXXXX")"
```

The `tmp/` directory is in `.gitignore` and therefore absent in fresh CI checkouts.
`mktemp` cannot create a subdirectory when the parent does not exist.

---

## 2026-03-21 — Phase 2–3: Fix

**File changed:** `scripts/docker-smoke.sh`

**Change:** Added `mkdir -p "${ROOT_DIR}/tmp"` immediately before the `mktemp` call.

```diff
 CLASSIFY_LIMIT="${CLASSIFY_LIMIT:-10}"
 HEALTH_URL="http://127.0.0.1:${HOST_PORT}/api/health"
 READINESS_URL="${HEALTH_URL}?scope=readiness"
+# Ensure the tmp directory exists (it is gitignored and therefore absent in CI checkouts)
+mkdir -p "${ROOT_DIR}/tmp"
 TMP_ROOT="$(mktemp -d "${ROOT_DIR}/tmp/docker-smoke.XXXXXX")"
```

---

## 2026-03-21 — Phase 4: Local Docker Build

Command:
```
docker build -f Dockerfile.production -t sidflow:rc3-local .
```

Result: **SUCCESS** — cached layers used, build completed in ~90s.

---

## 2026-03-21 — Phase 5: Local Smoke Test

Command:
```
IMAGE_TAG=sidflow:rc3-local DOCKER_SMOKE_MODE=build \
  CONTAINER_NAME=sidflow-smoke-rc3-local \
  bash scripts/docker-smoke.sh
```

Result: **SUCCESS**

Smoke test evidence:
- `mktemp` directory created successfully (fix validated)
- Container started and became healthy
- Health endpoint: `liveness=healthy`, `readiness=ready`
- Admin metrics API: responded with correct job queue data
- Playback API: returned `10_Orbyte.sid` track data
- Favorites add/list/delete: all succeeded
- Classification (limit=10): 10/10 files processed, 10 JSONL records written
- Final: `[docker-smoke] Success! Image 'sidflow:rc3-local' passed smoke test.`

---

## 2026-03-21 — Phase 6: Commit and Tag

```
git add scripts/docker-smoke.sh PLANS.md WORKLOG.md
git commit -m "fix(ci): create tmp/ before mktemp in docker-smoke.sh"
git push origin main
git tag 0.5.0-rc3
git push origin 0.5.0-rc3
```

---

## 2026-03-21 — Phase 7: CI Validation

CI run 23376286432 for tag `0.5.0-rc3`:
- Polled every 30s for ~7 minutes
- Result: **`completed/success`** ✅
- Image published to `ghcr.io/chrisgleissner/sidflow:0.5.0-rc3`

---

## 2026-03-21 — Phase 8: GHCR Pull

```
docker pull ghcr.io/chrisgleissner/sidflow:0.5.0-rc3
```

Result: **SUCCESS** — image pulled, digest `sha256:397c0dff6a0dc00269348ebdc45d67f34d370e71a6897275ef11f21cdee39a52`

---

## 2026-03-21 — Phase 9: Functional Smoke Test (GHCR image)

Command:
```
IMAGE_TAG=ghcr.io/chrisgleissner/sidflow:0.5.0-rc3 \
  DOCKER_SMOKE_MODE=pull \
  CONTAINER_NAME=sidflow-smoke-rc3-ghcr \
  bash scripts/docker-smoke.sh
```

Result: **SUCCESS** ✅

- Container became healthy
- Health endpoint: `liveness=healthy`, `readiness=ready`
- Admin metrics API: responded correctly
- Playback API: returned track data for `C64Music/DEMOS/0-9/10_Orbyte.sid`
- Favorites add/list/delete: all passed
- Classification (limit=10): 10/10 files processed, 20 JSONL records across 2 files
- Final: `[docker-smoke] Success! Image 'ghcr.io/chrisgleissner/sidflow:0.5.0-rc3' passed smoke test.`

---

## OUTCOME: ALL TERMINATION CRITERIA MET ✅

1. ✅ Tag `0.5.0-rc3` exists and CI (release.yaml) is GREEN
2. ✅ Docker image published to `ghcr.io/chrisgleissner/sidflow:0.5.0-rc3`
3. ✅ Image pulled from GHCR successfully
4. ✅ Container runs and health endpoint responds
5. ✅ Functional smoke: UI accessible, classify (10 songs) works, playback works
6. ✅ PLANS.md updated with final state
7. ✅ WORKLOG.md contains full trace

---

## 2026-03-21 — SID CLI Station rating-column integration

### Source of rating data

- The playlist window now sources per-track ratings from the existing station selection ratings map that is already persisted and reused by the station CLI.
- Rendering reads `state.ratings.get(track.track_id)` for each playlist row.
- Missing ratings are normalized to `0` and render as `[☆☆☆☆☆]`.

### Invalid rating handling

- Before the change, malformed persisted ratings outside `0..5` were discarded during selection-state hydration.
- That meant bad historical values such as `11` implicitly fell back to “missing”, which rendered as zero stars instead of a clamped maximum.
- The normalization layer now clamps every numeric persisted rating through a pure `normalizeRating(...)` helper:
  - `null`/missing/NaN -> `0`
  - negative -> `0`
  - greater than `5` -> `5`
  - fractional -> truncated integer, then clamped
- Regression coverage now verifies that malformed persisted values such as `11` render as `[★★★★★]` instead of disappearing.

### Layout comparison

Before:
```text
▶ 001/100 Title — Author — 1:00
```

After:
```text
001/100  ► [★★★★★] Title...  Author...  1:00 1989
```

- The playlist row layout is now a fixed column contract:
  - `index(7, right-aligned)`
  - `marker(2)`
  - `rating(7)`
  - `title(fixed width)`
  - `artist(fixed width)`
  - `duration(6, right-aligned)`
  - `extra/meta(6)`
- Column widths are resolved once per render width and reused for every row, so mixed ratings and long titles no longer shift downstream columns.

### Performance considerations

- Star rendering uses a precomputed string table for ratings `0..5` rather than rebuilding star strings for every row.
- Rating normalization is a small pure clamp/truncation helper with no I/O and no per-row dynamic width discovery.
- Playlist row widths are computed once per render call, not per row, which keeps redraw cost stable even with a long visible playlist window.

### Validation status

- Fast build: `bun run build:quick` — PASS
- Focused station tests: `packages/sidflow-play/test/cli.test.ts` — PASS after adding unit, regression, and exact-layout assertions for the new rating column
- Full build + full-suite validation: in progress

---

## 2026-03-21 — SID CLI Station deterministic TUI overhaul

### Before behavior

- Star filtering was bound to `?`, not `*`, and prompt-mode help still advertised the legacy mapping.
- `r` replayed the current song while `u` rebuilt the station, so the refresh behavior was not aligned with the visible help text or the requested spec.
- The visible filter state was mixed into a verbose shortcuts/status area instead of a dedicated unmistakable filter bar.
- The viewport logic was selection-driven, so playback and explicit play actions could reset or jump the visible window.
- ANSI redraws wrote a whole-screen string with trailing `\u001b[J`, which clears below the cursor but does not guarantee strict per-line overwrite semantics for every dynamic row.

### Phase structure for this overhaul

1. Phase 1: Input system + filters
2. Phase 2: Rendering correctness
3. Phase 3: Viewport logic
4. Phase 4: UX compression
5. Phase 5: Visual polish

### Phase 1 log

- 2026-03-21 — Audited `packages/sidflow-play/src/station/input.ts`, `packages/sidflow-play/src/station/run.ts`, and `packages/sidflow-play/src/station/screen.ts` against the target key model and filter spec.
- 2026-03-21 — Identified concrete mismatches to remove: duplicate `?` usage, legacy `f`/`u` bindings, star filter parsing that accepted optional `*` text instead of the required `*` then digit sequence, and status/help copy that still described replay/refresh semantics incorrectly.
- 2026-03-21 — Implementation started immediately after planning update. The next code changes will land in the station input, runtime, screen, and test files as one focused patch so the new key model and filter visibility stay consistent.
- 2026-03-21 — User expanded the scope mid-flight: playlists must contain unique songs only, `shuffle` must reshuffle membership-preservingly, and the Station must support saving/loading named playlists through an explicit dialog that can list prior saves.
- 2026-03-21 — Implementation decision recorded in the plan: use non-conflicting `w` = save playlist and `o` = open/load playlist. This keeps the fixed transport/filter/rating bindings intact while still exposing playlist management directly in the Station UI.
- 2026-03-21 — Implemented the deterministic Station input model, dedicated filter bar, compact controls block, playback-driven viewport handling, line-by-line ANSI redraw path, unique-song queue enforcement, and named playlist save/load persistence.
- 2026-03-21 — Validation update: `bun run build:quick` passed, and focused Station tests passed via `runTests` on `packages/sidflow-play/test/station-input.test.ts`, `packages/sidflow-play/test/station-screen.test.ts`, and `packages/sidflow-play/test/cli.test.ts` (`188 pass, 0 fail`).
- 2026-03-21 — Broader `bun run test` validation is not yet green in this session; the existing repo-level task currently exits `137` after substantial progress through the suite, so full-suite stabilization remains separate from the Station-focused fixes completed here.

### Manual validation scenarios queued for this task

- `*` then `3` filters to `>=3` stars immediately.
- `/moller` live-filters title + composer, case-insensitive.
- `*` + `/` combine as an intersection with a single visible filter bar.
- `Esc` clears active input first, then clears filters when idle.
- `Enter` plays the selected track without recentring the viewport.
- `r` performs a full refresh with no stale status or now-playing residue.

---

## 2026-03-22 — Station & Similarity System Audit

### Task

Full end-to-end audit and redesign of the SIDFlow similarity/station pipeline.

### Discovery

Mapped the complete data flow:
```
SID → WAV (11025Hz, 15s) → 35+ features (Essentia.js) → 7 sigmoid tags → 3 integer ratings [1-5]
→ vector [e,m,c,p] → SQLite/LanceDB → cosine similarity → bucket diversification → station
```

### Root Causes Proven (5)

1. **Dimensionality collapse**: 35+ features crushed to 3 integers (125 states for 50K+ tracks). Cosine similarity between `[3,4,3,3]` and `[4,4,3,3]` = 0.9978 — effectively identical despite different character.
2. **Missing perceptual dimensions**: No rhythm structure (onset patterns), timbral dynamics (spectral flux, filter sweeps), atmosphere modeling, danceability, or SID-specific features (arpeggio, voice count, waveform type).
3. **Cold-start centroid instability**: Rating 5 → weight 9x vs rating 4 → weight 4x. Ratio 90:1 (5→9 vs 1→0.1) means a single outlier highly-rated track dominates the centroid with 10 ratings.
4. **Feedback system not connected**: `POST /api/feedback/sync` accepts payloads but does not persist them server-side. No automated retraining cycle exists.
5. **No outlier rejection**: Station CLI (`buildStationQueue`) has no minimum similarity threshold. All recommendations from `recommendFromFavorites` are candidates regardless of score.

### Design Output

24D perceptual vector replacing 4D integer vector:
- 8 dims: spectral shape (continuous, not quantized)
- 6 dims: temporal dynamics (onset rate, regularity, spectral flux, dynamic range, etc.)
- 5 dims: MFCC texture
- 5 dims: derived perceptual axes (energy, mood, complexity, danceability, atmosphere)

Full redesign covers: weighted cosine similarity, confidence-aware cold start, multi-centroid intent model, metric learning self-improvement, champion/challenger safety, 4-phase roadmap.

### Output

`doc/research/sid-station-similarity-audit.md` — comprehensive research document (14 sections, all phases)

---

## 2026-03-22 — Phase C and D implementation (similarity system redesign)

### Phase C: Advanced model changes

**C1 — Multi-centroid intent model**
- New file: `packages/sidflow-play/src/station/intent.ts`
- Exports: `buildIntentModel()`, `kMeans2()`, `interleaveClusterResults()`, and cosine helpers
- `buildIntentModel`: computes pairwise cosine distances; if max distance > 0.5, runs k-means k=2 (up to 50 iterations via `KMEANS_MAX_ITER`) to detect dual-cluster preferences; builds per-cluster `{ trackIds, weights, centroid }`
- `kMeans2`: deterministic k-means seeded from the most distant pair; collapses back to a single cluster if one side ends up empty
- `interleaveClusterResults`: merges two arrays by alternating elements while preserving intra-cluster order
- Integration: `buildStationQueue` reads `intentModel.multiCluster`; if true, calls `recommendFromFavorites` for each cluster with half-limit, interleaves, and dedupes by `track_id`

**C2 — Cosine helpers and validation**
- `intent.ts` exposes pure unweighted cosine helpers (`cosineSim`, `cosineDist`, `weightedCentroid`) used by `buildIntentModel` and `kMeans2`
- Added unit tests in `intent.test.ts` covering identical, orthogonal, and centroid-construction cases for the intent math helpers
- Results verified: intent clustering remains deterministic and favors near-identical tracks over distant ones without introducing a second weighted-similarity implementation in the station layer

**C3 — Adventure radius expansion**
- Replaced the old score-flattening exponent with `computeAdventureMinSimilarity(adventure)`:
  - `min_sim = max(0.50, 0.82 − adventure * 0.03)`
  - adventure=0→0.82, adventure=3→0.73, adventure=5→0.67; hard floor 0.50
- `chooseStationTracks` refactored to 70/30 exploit/explore split:
  - Exploitation: tracks with `score > min_sim + 0.10` (top similarity)
  - Exploration band: `[min_sim, min_sim + 0.10]`
  - Fallback: when exploration band is empty, backfills from exploitation pool
  - Below-`min_sim` candidates never enter the station
- Added `MIN_SIMILARITY_FLOOR = 0.50` hard guard to prevent any score below floor

### Phase D: Self-improvement system

**D1 — Training pair derivation (`pair-builder.ts`)**
- Positive pairs: same-track `like` events, `play_complete` → `like` sequences, `like` + `replay`
- Negative pairs: `like` vs `dislike`, `like` vs `skip_early`
- Triplets: for each positive pair → find a negative anchor → emit `(anchor, positive, negative)`
- Ranking pairs: `(higherRatedTrack, lowerRatedTrack, 1.0 weight)`
- Output: `TrainingPairSet { positivePairs, negativePairs, triplets, rankingPairs }`
- De-duplication via sorted key to prevent duplicate pairs

**D2 — Metric learning MLP (`metric-learning.ts`)**
- Architecture: 24 → 48 → 24 (two-layer perceptron)
- Pure TypeScript, CPU-only, no external ML dependencies
- Activations: tanh (hidden) + L2 normalization (output)
- Losses: triplet loss (margin=0.2) + margin ranking loss
- Optimizer: mini-batch gradient descent (Adam-inspired momentum)
- Determinism: seeded PRNG via `seedrandom` pattern (mulberry32)
- Accepts `MetricLearningConfig { epochs, learningRate, batchSize, tripletMargin, seed }`
- Returns `MetricLearningModel { weights1, biases1, weights2, biases2, config }` (JSON-serializable)

**D3 — Evaluation system (`evaluate.ts`)**
- Five metrics: holdout accuracy, station coherence, output diversity, embedding drift, feedback correlation
- Holdout accuracy: fraction of test triplets where `d(anchor,positive) < d(anchor,negative)`
- Station coherence: mean pairwise cosine similarity of 20-track simulated station
- Output diversity: unique bucket coverage over 50 sampled tracks
- Embedding drift: mean absolute change vs identity transform (0→no drift, 1→max drift)
- Feedback correlation: fraction of pairs where liked track scores higher than disliked
- Promotion rules: pass ≥3/5 metrics (configurable `minPassCount`)
- Outputs `EvaluationResult { metrics, passed, metricsDetail }` for logging

**D4 — Retraining scheduler (`scheduler.ts`)**
- `runScheduler(config, options)`: reads feedback JSONL files from `data/feedback/`
- Trigger conditions: `eventCount ≥ minEvents (50)` OR `hoursSinceLastTraining ≥ intervalHours`
- Loads embedding vectors from `data/classified/` JSONL files
- Calls `deriveTrainingPairs → trainMetricLearningModel → evaluateModel`
- Promotes challenger to `data/model/current/` and versions old model as `v1..v5`; Enforces max 5 historical versions (prunes oldest)
- Returns `SchedulerResult { triggered, trained, promoted, rejected, reason }`

**D5 — CLI extensions (`cli.ts` + `scheduler.ts`)**
- `--rollback <n>`: finds `data/model/vN/` directory, copies back to `data/model/current/`; exits 1 if version not found
- `--list-models`: reads `data/model/` subdirectories, prints version table (version, timestamp, metrics) and exits 0
- `--auto [--force]`: calls `runScheduler`; prints triggered/no-trigger/promoted/rejected status

### Test suites written

| File | Tests | Coverage |
|------|-------|----------|
| `packages/sidflow-play/test/intent.test.ts` | 29 | kMeans2, buildIntentModel, weightedCosine, interleaveClusterResults |
| `packages/sidflow-play/test/queue-adventure.test.ts` | 29 | computeAdventureMinSimilarity, chooseStationTracks exploit/explore |
| `packages/sidflow-train/test/pair-builder.test.ts` | 13 | deriveTrainingPairs correctness + acceptance criteria |
| `packages/sidflow-train/test/metric-learning.test.ts` | 14 | MLP architecture, loss functions, forward pass, training convergence |
| `packages/sidflow-train/test/evaluate.test.ts` | 12 | each metric, promotion logic, edge cases |
| `packages/sidflow-train/test/scheduler.test.ts` | 5 + 5 CLI | trigger logic, scheduler-CLI integration |

### Validation results

**Build**: `tsc -b` exits 0. No TypeScript errors.

**Test run 1** (2026-03-22):
- common: 445/0
- classify: 287/0
- play: 414/0
- train: 65/0
- fetch/rate/perf: 128/0

**Test run 2** (2026-03-22):
- common: 445/0
- play: 414/0
- train: 65/0
- fetch/rate/perf: 128/0
- classify: 287/0

**Test run 3** (2026-03-22):
- Combined (non-classify): 1052/0
- classify: 287/0

All three runs: **0 failures**. Phase A/B not regressed.

### Notable bug fixed during validation

During run 2, 3 `runPlayCli` tests failed with "only N long-enough station tracks were available; at least 100 required." Root cause: `createStationDemoFixture` generated tracks with `energy = 0.99 − index × 0.003` (bottoming at 0.57 for index 140). With adventure=3, `min_sim = 0.73`. When SQLite's `ORDER BY RANDOM()` selected seed tracks that included outlier tracks (songs 7/8 with vector `[0,1,0]`), the resulting centroid fell below the cluster, causing many generated tracks to fail the similarity floor.

Fix: extended the fixture from index 13..140 to 13..250, changing the energy formula to `max(0.848, 0.99 − (index−13) × 0.0006)` so all generated tracks have energy ≥ 0.848 and cosine similarity ≥ 0.985 to any cluster centroid, guaranteeing ≥200 candidates above `min_sim=0.73` regardless of seed selection.

### Phase C and D — COMPLETED 2026-03-22
